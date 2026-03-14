# Auto-Issue (GitHub Edition) — Implementation Plan

## Context
Build a long-running Go daemon that polls GitHub issues, dispatches them to a configurable coding agent (e.g. claude-code), executes the agent in an isolated workspace, and posts results back to GitHub. The agent type and runtime behavior are defined per-repo in a `WORKFLOW.md` config file.

---

## Directory Structure

```
auto-issue/
├── cmd/
│   └── main.go                 # Entry point: load config, wire components, start
├── internal/
│   ├── config/
│   │   └── workflow.go         # Parse WORKFLOW.md, define Config struct
│   ├── github/
│   │   └── client.go           # GitHub API: poll issues, post comments, update labels
│   ├── workspace/
│   │   └── manager.go          # Create/destroy per-issue workspace directories
│   ├── agent/
│   │   └── runner.go           # Spawn agent subprocess, capture output, enforce timeout
│   ├── orchestrator/
│   │   └── orchestrator.go     # Core loop: poll → filter → dispatch → update state
│   └── state/
│       └── state.go            # In-memory state + JSON file persistence
├── go.mod
└── WORKFLOW.md                  # Example workflow config (ships with repo)
```

---

## Component Breakdown

### 1. `config/workflow.go`
Parse `WORKFLOW.md` (YAML frontmatter or embedded YAML block) into a `Config` struct.

```go
type Config struct {
  PollingInterval time.Duration `yaml:"polling_interval"`  // default: 30s
  MaxConcurrency  int           `yaml:"max_concurrency"`   // default: 10
  Trigger         TriggerConfig `yaml:"trigger"`
  Agent           AgentConfig   `yaml:"agent"`
  Workspace       WorkspaceConfig `yaml:"workspace"`
}

type TriggerConfig struct {
  Labels []string `yaml:"labels"`  // e.g. ["agent-ready"]
}

type AgentConfig struct {
  Type           string        `yaml:"type"`            // e.g. "claude-code"
  Model          string        `yaml:"model"`           // e.g. "claude-opus-4-6"
  Timeout        time.Duration `yaml:"timeout"`         // default: 30m
  MaxIterations  int           `yaml:"max_iterations"`  // default: 3 (feedback loops)
  Prompt         string        `yaml:"prompt"`          // optional system prompt override
}

type WorkspaceConfig struct {
  BasePath string `yaml:"base_path"` // default: ~/.auto-issue/workspaces
}
```

Config is reloaded dynamically on each poll cycle (no restart needed).

---

### 2. `github/client.go`
Thin wrapper around GitHub REST API using `go-github` or raw `net/http`.

**Operations:**
- `PollIssuesInColumn(ctx, columnName string) ([]Issue, error)` — fetch open issues in specific project column (e.g., "In Progress")
- `MoveIssueToColumn(ctx, issueNum int, columnName string) error` — move issue to new column (e.g., "Human Review")
- `GetIssueComments(ctx, issueNum int, since time.Time) ([]Comment, error)` — fetch comments since last poll
- `PostComment(ctx, issueNum, body string) error` — post agent result as comment
- `GetWorkflowFile(ctx) (string, error)` — fetch `WORKFLOW.md` contents from default branch

Auth: `GITHUB_TOKEN` env var. Target repo: `GITHUB_REPO` env var (`owner/repo`).

**Note:** Uses GitHub Projects v2 API (graphql) to detect column changes. Polling detects issues that have moved into trigger columns since last check.

---

### 3. `workspace/manager.go`
Manages isolated directories per issue.

- `Create(issueNum int) (string, error)` — creates `{base_path}/{issueNum}/`, clones or copies repo into it
- `Path(issueNum int) string` — deterministic path for given issue
- `Cleanup(issueNum int) error` — removes workspace after completion (optional, configurable)

Workspaces are preserved across restarts (idempotent creation).

---

### 4. `agent/runner.go`
Executes the configured agent as a subprocess within the issue's workspace.

```go
type RunResult struct {
  Output   string
  ExitCode int
  Duration time.Duration
}

func Run(ctx context.Context, cfg AgentConfig, workspacePath string, issue Issue) (RunResult, error)
```

- Builds command based on `cfg.Type` (e.g. `claude-code`, extensible)
- Sets working directory to `workspacePath`
- Captures stdout/stderr combined
- Enforces `cfg.Timeout` via context deadline
- Returns combined output for posting to GitHub

---

### 5. `state/state.go`
Tracks execution state per issue. No external DB.

```go
type Phase string
const (
  PhaseDeveloping     Phase = "developing"
  PhaseCodeReviewing  Phase = "code_reviewing"
  PhaseHumanReview    Phase = "human_review"
  PhaseDone           Phase = "done"
  PhaseFailed         Phase = "failed"
)

type IssueState struct {
  IssueNum       int
  Phase          Phase
  Iteration      int              // feedback iteration count (max 3)
  WorkspacePath  string
  StartedAt      time.Time
  LastFeedback   string           // human's feedback from comment
  FeedbackCount  int              // how many times human rejected
}
```

**State Machine Flow:**
```
Backlog (GitHub column)
    ↓
User moves to "In Progress"
    ↓
PhaseDeveloping (agent writes solution, posts comments)
    ↓
PhaseCodeReviewing (same agent reviews code, posts review comments)
    ↓
PhaseHumanReview (daemon moves issue to "Human Review" column, awaits human decision)
    ├─ (human approves) → PhaseDone
    └─ (human rejects + comments "@auto-issue adjust" + feedback)
        ↓
    PhaseDeveloping (iteration N+1, feedback injected in prompt)
        ↓ (repeats until approved or max_iteration reached)
```

**Feedback Loop Logic:**
- When human posts reply comment with `@auto-issue adjust`, daemon detects it
- Extracts feedback text from comment
- Increments `FeedbackCount` (max 3 before PhaseFailed)
- Moves issue back to "In Progress" column
- Re-spawns agent with injected prompt: "Previous feedback: {comment}. Adjust accordingly."
- Agent develops → code reviews → back to human review

- In-memory `map[int]*IssueState` protected by `sync.RWMutex`
- Persisted to `~/.auto-issue/state.json` after each mutation
- On startup: load from file, reconcile with GitHub (skip already-done issues)
- Prevents duplicate dispatches via phase check before queueing

---

### 6. `orchestrator/orchestrator.go`
Core coordination loop.

```go
type Orchestrator struct {
  github    *github.Client
  workspace *workspace.Manager
  state     *state.Store
  queue     chan Issue          // buffered work queue
  sem       chan struct{}       // semaphore for max concurrency
}
```

**Main loop:**
```
every polling_interval:
  1. Reload WORKFLOW.md config
  2. Fetch issues moved from "Backlog" to "In Progress" (via GitHub API column status)
  3. For each issue:
     a. Skip if phase = code_reviewing, human_review, done, or failed
     b. Enqueue to work queue
  4. Check "Human Review" column for comments with "@auto-issue adjust"
     a. If found: extract feedback, increment FeedbackCount
     b. If FeedbackCount < 3: move back to "In Progress", set phase = developing
     c. If FeedbackCount >= 3: move to "Rework", set phase = failed

Worker goroutines (N = max_concurrency):
  1. Dequeue issue
  2. Create workspace (or reuse existing for iteration)
  3. If phase = developing:
     a. Run agent in development mode
     b. Post solution comments
     c. Set phase = code_reviewing
  4. If phase = code_reviewing:
     a. Run SAME agent in code-review mode
     b. Post review comments (findings, improvements, etc.)
     c. Move issue to "Human Review" column
     d. Set phase = human_review
  5. Update state in persistent store
```

**Agent modes:**
- `developing`: solve the issue, implement the feature/fix
- `code_reviewing`: review own solution, find issues, suggest improvements

**Feedback injection:**
When agent reruns with feedback, prompt includes:
```
Previous human feedback:
"{{ LastFeedback }}"

Please make these adjustments and resubmit for review.
```

**Iteration limits:** max 3 feedback cycles before stopping (MVP for hackathon)

**Graceful shutdown:** catch `SIGTERM`/`SIGINT`, drain queue, wait for active agents to finish or timeout.

---

### 7. `cmd/main.go`
Entry point:
1. Initialize GitHub OAuth or token-based authentication
2. Load authorized repositories from config file (`~/.auto-issue/config.json`)
3. For each authorized repository:
   - Fetch and parse `WORKFLOW.md` from repo
   - Initialize orchestrator components
   - Start monitoring loop in separate goroutine
4. Handle OS signals for graceful shutdown across all repos

### 8. Authentication Handler
GitHub authentication in main.go:
- Support personal access token via `GITHUB_TOKEN` env var (optional)
- Support OAuth flow for interactive authorization
- Store authorized repos in `~/.auto-issue/config.json`
- Provide CLI to add/remove authorized repositories

---

## GitHub Columns & Workflow Triggers

**Project columns** (GitHub Projects kanban board):
| Column | Meaning |
|--------|---------|
| `Backlog` | Issue waiting to be worked on |
| `In Progress` | Agent is developing or code-reviewing |
| `Human Review` | Solution ready, awaiting human approval |
| `Rework` | Human rejected, needs iteration (max 3x) |
| `Done` | Approved and completed |

**Trigger:** Issue moved from `Backlog` → `In Progress`
- Daemon detects column change via GitHub API polling
- Spawns agent in `PhaseDeveloping` mode

**Feedback trigger:** Human posts reply comment with `@auto-issue adjust` in `Human Review` column
- Daemon detects new comment via API polling
- Extracts comment text after the mention as feedback
- Increments `FeedbackCount` in state
- If `FeedbackCount < max_iterations` (default 3): moves issue back to `In Progress`, reruns agent with feedback injected
- If `FeedbackCount >= max_iterations`: moves to `Rework` column, sets phase = failed, stops iterating

**Comment detection logic:**
```
every polling_interval:
  Check all issues in "Human Review" column
  For each issue:
    Fetch latest comments since last check
    If comment contains "@auto-issue adjust":
      Extract comment text (everything after mention)
      Store as LastFeedback
      Move issue back to "In Progress"
      Set phase = developing
      Continue orchestration loop
```

---

## Key Dependencies
- `github.com/google/go-github/v60` — GitHub API client
- `gopkg.in/yaml.v3` — WORKFLOW.md parsing
- Standard library only for everything else (goroutines, channels, os/exec, slog)

---

## Example WORKFLOW.md Configuration

```yaml
---
polling_interval: 30s
max_concurrency: 5
trigger:
  # Detects issues moved to "In Progress" column in GitHub Projects
  columns:
    - "In Progress"
agent:
  type: claude-code
  model: claude-opus-4-6
  timeout: 20m
  max_iterations: 3  # max feedback loops before stopping
  prompt: "Solve this issue step by step. Write clean, testable code."
workspace:
  base_path: ~/.auto-issue/workspaces
---
```

---

## Implementation Order
1. `config/workflow.go` — parse config
2. `state/state.go` — state store
3. `github/client.go` — API client
4. `workspace/manager.go` — workspace management
5. `agent/runner.go` — agent execution
6. `orchestrator/orchestrator.go` — main loop + worker pool
7. `cmd/main.go` — wire everything together

---

## Verification
- Unit test: config parsing with sample WORKFLOW.md
- Integration test: mock GitHub API, verify poll → dispatch → post flow
- Manual: point at a real repo, create issue with `agent-ready` label, verify agent runs and posts result
