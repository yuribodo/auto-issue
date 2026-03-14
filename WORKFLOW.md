# Auto-Issue — Go Backend Implementation Plan

## Context
Build a local Go backend (HTTP API server) embedded within an Electron app. The Electron frontend provides a Kanban board UI. When the user moves a card from Backlog to In Progress, the backend dispatches a local Claude Code agent to solve the issue, then runs the same agent for code review, and finally moves the card to Human Review. Everything runs locally on the user's machine — no GitHub polling or external triggers.

---

## Directory Structure

```
backend/
├── cmd/
│   └── main.go                 # Entry point: load config, wire components, start API server
├── internal/
│   ├── config/
│   │   └── config.go           # Parse config.json, define Config struct
│   ├── api/
│   │   └── handler.go          # HTTP handlers: PUT /issues/{id}/move, GET /issues, etc.
│   ├── workspace/
│   │   └── manager.go          # Create/destroy per-issue workspace directories
│   ├── agent/
│   │   └── runner.go           # Spawn Claude Code subprocess, capture output, enforce timeout
│   ├── state/
│   │   └── state.go            # In-memory state + JSON file persistence
│   └── orchestrator/
│       └── orchestrator.go     # Issue processing: develop → code review → move to human_review
├── go.mod
├── go.sum
└── config.example.json         # Example configuration
```

---

## Component Breakdown

### 1. `config/config.go`
Parse `~/.auto-issue/config.json` into a `Config` struct.

```go
type Config struct {
  APIPort        int             `json:"api_port"`         // default: 8080
  MaxConcurrency int             `json:"max_concurrency"`  // default: 10
  Agent          AgentConfig     `json:"agent"`
  Workspace      WorkspaceConfig `json:"workspace"`
}

type AgentConfig struct {
  Type          string        `json:"type"`            // e.g. "claude-code"
  Model         string        `json:"model"`           // e.g. "claude-opus-4-6"
  Timeout       time.Duration `json:"timeout"`         // default: 30m
  MaxIterations int           `json:"max_iterations"`  // default: 3 (feedback loops)
  Prompt        string        `json:"prompt"`          // optional system prompt override
}

type WorkspaceConfig struct {
  BasePath string `json:"base_path"` // default: ~/.auto-issue/workspaces
}
```

Config is loaded at startup and can be reloaded via API endpoint.

---

### 2. `api/handler.go`
HTTP request handlers for the API server. The Electron frontend communicates with these endpoints.

**Key handlers:**
- `GET /api/v1/status` — health check
- `GET /api/v1/issues` — list all issues (filterable by phase)
- `GET /api/v1/issues/{id}` — get issue details + latest agent output
- `POST /api/v1/issues` — create new issue (user creates a card in Electron)
- `PUT /api/v1/issues/{id}/move` — move issue to new phase (triggers agent when moving to `in_progress`)
- `POST /api/v1/issues/{id}/feedback` — submit human feedback (triggers re-run)
- `GET /api/v1/config` — get current configuration
- `POST /api/v1/config/reload` — reload config from disk

Handlers validate requests, enqueue work, and return JSON responses.

---

### 3. `workspace/manager.go`
Manages isolated directories per issue.

- `Create(issueID string, repoPath string) (string, error)` — creates `{base_path}/{issueID}/`, initializes with repo contents
- `Path(issueID string) string` — deterministic path for given issue
- `Cleanup(issueID string) error` — removes workspace after completion (optional, configurable)

Workspaces are preserved across restarts (idempotent creation). The repo source is a local path provided by the user in the issue card.

---

### 4. `agent/runner.go`
Executes Claude Code locally as a subprocess within the issue's workspace.

```go
type RunResult struct {
  Output   string
  ExitCode int
  Duration time.Duration
}

func Run(ctx context.Context, cfg AgentConfig, workspacePath string, mode string) (RunResult, error)
```

- Builds command: invokes `claude` CLI locally on the user's machine
- Accepts mode: `developing` or `code_reviewing`
- Sets working directory to `workspacePath`
- Captures stdout/stderr combined
- Enforces `cfg.Timeout` via context deadline
- Returns combined output (stored in state, returned to frontend)

---

### 5. `state/state.go`
Tracks execution state per issue. No external DB.

```go
type Phase string
const (
  PhaseBacklog        Phase = "backlog"
  PhaseDeveloping     Phase = "developing"
  PhaseCodeReviewing  Phase = "code_reviewing"
  PhaseHumanReview    Phase = "human_review"
  PhaseDone           Phase = "done"
  PhaseFailed         Phase = "failed"
)
```

```go
type IssueState struct {
  IssueID        string
  Title          string
  Description    string           // issue/card requirements
  Phase          Phase
  Iteration      int              // feedback iteration count (max 3)
  WorkspacePath  string
  RepoPath       string           // local repo path
  StartedAt      time.Time
  LastFeedback   string           // human's feedback text
  FeedbackCount  int              // how many times human rejected
  LastOutput     string           // last agent output
  AgentLogs      string           // agent execution logs
}
```

**State Machine Flow:**
```
PhaseBacklog
    ↓ [User drags card to "In Progress" in Electron Kanban]
PhaseDeveloping (In Progress column)
    ↓ [Claude Code runs locally, solves the issue]
PhaseCodeReviewing (still In Progress column)
    ↓ [same Claude Code agent reviews its own code]
PhaseHumanReview (Human Review column — card auto-moves)
    ├─ (human clicks "Approve") → PhaseDone (Done column)
    └─ (human comments "@auto-issue <prompt>" to reprove)
        ↓
    PhaseDeveloping (back to In Progress column, iteration N+1)
        ↓ (repeats full develop → review cycle until approved or max_iterations)
```

**Key point:** Both `developing` and `code_reviewing` phases map to the "In Progress" column in the Kanban UI. The card only moves to "Human Review" after the code review agent completes successfully.

**Feedback Loop Logic (reprove with `@auto-issue`):**
- In Human Review, the user can reprove the solution by writing a comment starting with `@auto-issue` followed by a prompt (e.g. `@auto-issue refactor auth to use factory pattern and add unit tests`)
- Electron sends `POST /issues/{id}/feedback` with the prompt text (everything after `@auto-issue`)
- Backend increments `FeedbackCount` (max 3 before PhaseFailed)
- Sets phase back to `developing`, moves card back to In Progress column
- Re-spawns Claude Code with injected prompt containing the user's feedback
- Agent goes through the full cycle again: develop → code review → human review
- If the user approves instead, Electron sends `PUT /issues/{id}/move` with `{"to": "done"}` and card moves to Done

- In-memory `map[string]*IssueState` protected by `sync.RWMutex`
- Persisted to `~/.auto-issue/state.json` after each mutation
- On startup: load from file, resume in-progress issues or skip done ones
- Prevents duplicate dispatches via phase check before queueing

---

### 6. `orchestrator/orchestrator.go`
Issue processing orchestration.

```go
type Orchestrator struct {
  workspace *workspace.Manager
  state     *state.Store
  agent     *agent.Runner
  queue     chan IssueRequest      // buffered work queue
  sem       chan struct{}          // semaphore for max concurrency
}
```

**API handlers enqueue issues:**
- `PUT /issues/{id}/move` with `{"to": "in_progress"}` → enqueue with phase `developing`
- `POST /issues/{id}/feedback` (human feedback) → enqueue with phase `developing` + feedback injected

**Worker goroutines (N = max_concurrency):**
```
1. Dequeue issue request
2. Load or create workspace (clone/copy local repo into workspace)
3. Phase = developing:
   a. Build prompt with issue title + description + any previous feedback
   b. Run Claude Code locally in development mode
   c. Store output in state
   d. Set phase = code_reviewing
4. Phase = code_reviewing:
   a. Build prompt: "Review the solution you just implemented for this issue"
   b. Run same Claude Code agent in code-review mode
   c. Store review output in state
   d. Set phase = human_review
5. Persist state to JSON file
6. Electron frontend polls and sees phase = human_review → moves card to Human Review column
```

**Agent modes:**
- `developing`: solve the issue, implement the feature/fix
- `code_reviewing`: review own solution, find issues, suggest improvements (if review finds problems, agent fixes them in-place before completing)

**Feedback injection:**
When agent reruns with feedback, prompt includes:
```
Previous human feedback:
"{{ LastFeedback }}"

Please make these adjustments and resubmit for review.
```

**Iteration limits:** max 3 feedback cycles before stopping (auto-fails if exceeded)

**Graceful shutdown:** catch `SIGTERM`/`SIGINT`, drain queue, wait for active agents to finish or timeout.

---

### 7. `cmd/main.go`
Entry point:
1. Load config from `~/.auto-issue/config.json`
2. Initialize components (state, workspace, orchestrator)
3. Start HTTP API server on configured port
4. Start worker pool (consumer goroutines)
5. Handle OS signals for graceful shutdown

**API server initialization:**
- Bind to `localhost:{api_port}`
- Register HTTP handlers (see api/handler.go)
- Health check endpoint

---

## Workflow Triggers (from Electron Kanban UI)

**Kanban columns (managed by Electron UI):**
| Column | Meaning |
|--------|---------|
| `Backlog` | Issue/card waiting to be worked on |
| `In Progress` | Agent is developing or code-reviewing (both sub-phases) |
| `Human Review` | Solution ready, awaiting human approval |
| `Done` | Approved and completed |

**Workflow trigger 1: User moves card from Backlog → In Progress**
- User drags card in Electron Kanban UI
- Electron sends `PUT /api/v1/issues/{id}/move` with `{"to": "in_progress"}`
- Backend enqueues issue with phase `developing`
- Worker runs Claude Code locally → develops solution → code reviews → sets phase to `human_review`
- Electron polls and auto-moves card to Human Review column

**Workflow trigger 2: Human reproves with `@auto-issue` in Human Review column**
- Human writes `@auto-issue <prompt>` in the card's comment area (e.g. `@auto-issue add error handling and unit tests`)
- Electron parses the `@auto-issue` prefix and sends `POST /api/v1/issues/{id}/feedback` with the prompt text
- Backend increments `FeedbackCount`, sets phase to `developing`, card moves back to In Progress
- Worker reruns Claude Code with feedback injected → full cycle: develop → code review → human review
- Repeats up to `max_iterations` (default 3). If max exceeded, phase set to `failed`

**Workflow trigger 3: Human approves in Human Review column**
- Human clicks "Approve" in Electron UI
- Electron sends `PUT /api/v1/issues/{id}/move` with `{"to": "done"}`
- Backend sets phase to `done`
- Card moves to Done column

---

## Key Dependencies
- `encoding/json` — config parsing (stdlib)
- Standard library only for everything else (goroutines, channels, os/exec, slog, net/http)

---

## Example config.json Configuration

```json
{
  "api_port": 8080,
  "max_concurrency": 5,
  "agent": {
    "type": "claude-code",
    "model": "claude-opus-4-6",
    "timeout": "20m",
    "max_iterations": 3,
    "prompt": "Solve this issue step by step. Write clean, testable code."
  },
  "workspace": {
    "base_path": "~/.auto-issue/workspaces"
  }
}
```

---

## Implementation Order
1. `config/config.go` — parse config
2. `state/state.go` — state store
3. `workspace/manager.go` — workspace management
4. `agent/runner.go` — Claude Code subprocess execution
5. `orchestrator/orchestrator.go` — develop → review → human_review pipeline
6. `api/handler.go` — HTTP handlers
7. `cmd/main.go` — wire everything together

---

## Verification
- Unit test: config parsing with sample config
- Unit test: state transitions (backlog → developing → code_reviewing → human_review → done)
- Integration test: mock agent runner, verify full orchestration flow
- Manual: create issue in Electron, move to In Progress, verify Claude Code runs locally and card moves to Human Review
