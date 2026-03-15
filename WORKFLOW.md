# Auto-Issue — Go Backend Implementation Plan

## Context
Build a local Go backend (HTTP API server) that communicates with an Electron desktop app. The Electron app provides a Kanban board UI. When the user moves a card from Backlog to In Progress, the backend dispatches a local agent (Claude Code, Codex, or Gemini) to solve the issue, then runs the same agent for code review, and finally moves the card to Human Review. Everything runs locally on the user's machine.

---

## Directory Structure

```
backend/
├── cmd/
│   └── server/
│       └── main.go                # Entry point: connect DB, run migrations, wire components, start API
├── internal/
│   ├── api/
│   │   ├── handler.go             # HTTP handlers: all REST endpoints
│   │   ├── middleware.go          # CORS middleware
│   │   └── broadcaster.go        # SSE event broadcaster (per-issue subscriptions)
│   ├── constants/
│   │   └── phases.go              # Phase constants + transition rules
│   ├── config/
│   │   └── config.go              # Config struct, defaults, validation
│   ├── db/
│   │   ├── db.go                  # PostgreSQL connection via GORM
│   │   └── migration.go           # AutoMigrate for all models
│   ├── models/
│   │   ├── issue.go               # GORM model for issues table
│   │   └── config.go              # GORM model for config table (singleton)
│   ├── repository/
│   │   ├── issue_repository.go    # IssueRepository interface + PG implementation
│   │   ├── memory_issue_repository.go  # In-memory implementation for tests
│   │   └── config_repository.go   # ConfigRepository interface + PG implementation
│   ├── service/
│   │   └── orchestrator.go        # Issue processing: develop → code review → move to human_review
│   ├── agent/
│   │   ├── provider.go            # ProviderRunner interface + factory (NewProvider)
│   │   ├── base_provider.go       # Shared utilities: prompt building, process spawning, text buffering
│   │   ├── claude_provider.go     # Claude Code provider (CLI: claude, stream-json output)
│   │   ├── codex_provider.go      # Codex/OpenAI provider (CLI: codex, JSONL output)
│   │   ├── gemini_provider.go     # Gemini provider (CLI: gemini, plain text output)
│   │   ├── runner.go              # Legacy wrapper
│   │   └── events.go              # Event type constants (text, tool, status, pr, cost, error)
│   └── workspace/
│       └── manager.go             # Git worktree management for per-issue workspaces
├── docker-compose.yml             # PostgreSQL + app containers
├── Dockerfile                     # Multi-stage Go build (Alpine)
├── .env.example                   # Environment variable template
├── go.mod
└── go.sum
```

---

## Component Breakdown

### 1. `config/config.go`
Define the `Config` struct with defaults. Config is stored in PostgreSQL (singleton row in `config` table) and loaded via `ConfigRepository`.

```go
type Config struct {
  APIPort        int             `json:"api_port"`         // default: 8080
  MaxConcurrency int             `json:"max_concurrency"`  // default: 10
  Agent          AgentConfig     `json:"agent"`
  Workspace      WorkspaceConfig `json:"workspace"`
}

type AgentConfig struct {
  Type          string            `json:"type"`            // "claude-code" | "codex" | "gemini"
  Model         string            `json:"model"`           // e.g. "claude-opus-4-6", "o3", "gemini-2.5-pro"
  Timeout       time.Duration     `json:"timeout"`         // default: 30m
  MaxIterations int               `json:"max_iterations"`  // default: 3 (feedback loops)
  Prompt        string            `json:"prompt"`          // optional system prompt override
  APIKeys       map[string]string `json:"api_keys"`        // "openai" -> key, "gemini" -> key
}

type WorkspaceConfig struct {
  BasePath string `json:"base_path"` // default: ~/.auto-issue/workspaces
}
```

On first startup, if no config exists in the database, defaults are seeded automatically (with API keys read from environment variables `OPENAI_API_KEY` and `GOOGLE_API_KEY`). Config can be reloaded from the database via API endpoint.

---

### 2. `constants/phases.go`
Shared domain constants for the issue lifecycle phases and transition validation logic.

```go
const (
  PhaseBacklog       = "backlog"
  PhaseDeveloping    = "developing"
  PhaseCodeReviewing = "code_reviewing"
  PhaseHumanReview   = "human_review"
  PhaseDone          = "done"
  PhaseFailed        = "failed"
)

func IsValidTransition(from, to string) bool
```

**Valid transitions:**
- backlog → developing
- developing → code_reviewing, failed
- code_reviewing → human_review, failed
- human_review → developing (with feedback), done

---

### 3. `db/db.go` + `db/migration.go`
Database connection and schema management.

- `OpenConnection()` — connects to PostgreSQL using `DATABASE_URL` env var, or falls back to individual `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_SSLMODE`, `DB_TIMEZONE` env vars.
- `RunMigration(db)` — runs GORM AutoMigrate for `Issue` and `Config` models.

---

### 4. `models/issue.go` + `models/config.go`
GORM models mapped to PostgreSQL tables.

**Issue model fields:**
- `IssueID` (string, PK)
- `RunNumber` (int)
- `GithubUser` (string, indexed)
- `Title`, `Description` (string)
- `Phase` (string, indexed) — state machine phase
- `Iteration` (int) — current attempt number
- `WorkspacePath`, `RepoPath` (string)
- `GithubRepo` (string, optional) — e.g. "owner/repo"
- `IssueNumber` (int, optional) — GitHub issue number
- `AgentType` (string, optional) — per-issue agent override
- `AgentModel` (string, optional) — per-issue model override
- `StartedAt`, `LastRunAt` (*time.Time)
- `LastFeedback` (string), `FeedbackCount` (int)
- `LastOutput`, `AgentLogs` (string)
- `PRURL` (string)
- `CostUSD` (float64), `Turns` (int)
- `CreatedAt`, `UpdatedAt` (timestamps)

**Config model fields:**
- `ID` (int, singleton = 1)
- `APIPort` (int), `MaxConcurrency` (int)
- `AgentType`, `AgentModel`, `AgentTimeout`, `AgentPrompt` (string)
- `AgentMaxIter` (int)
- `WorkspaceBase` (string)
- `OpenAIAPIKey`, `GeminiAPIKey` (string, secret)
- `UpdatedAt` (timestamp)

---

### 5. `repository/`
Data access layer following the repository pattern.

- `IssueRepository` interface — `Create`, `CreateWithGithub`, `Get`, `List`, `Transition`, `SetFeedback`, `StartDeveloping`, `UpdateOutput`, `UpdatePR`, `UpdateCost`, `UpdateAgentInfo`, `Delete`.
- `PGIssueRepository` — PostgreSQL implementation using GORM with `SELECT ... FOR UPDATE` for safe concurrent transitions.
- `MemoryIssueRepository` — in-memory implementation for unit tests (uses `sync.RWMutex`).
- `ConfigRepository` interface — `Load`, `Save`.
- `PGConfigRepository` — PostgreSQL implementation (converts between `models.Config` and `config.Config`).

---

### 6. `api/handler.go` + `api/middleware.go` + `api/broadcaster.go`
HTTP request handlers, CORS middleware, and SSE event broadcasting.

**Key handlers:**
- `GET /api/v1/status` — health check
- `GET /api/v1/issues` — list all issues (filterable by phase, github_user)
- `GET /api/v1/issues/{id}` — get issue details + latest agent output
- `POST /api/v1/issues` — create new issue (supports per-issue agent type/model)
- `DELETE /api/v1/issues/{id}` — delete issue
- `PUT /api/v1/issues/{id}/move` — move issue to new phase (triggers agent when moving to `in_progress`)
- `POST /api/v1/issues/{id}/feedback` — submit human feedback (triggers re-run)
- `GET /api/v1/issues/{id}/events` — SSE stream for real-time agent events
- `GET /api/v1/config` — get current configuration
- `POST /api/v1/config/reload` — reload config from database

**CORS middleware:** Allows all origins (`*`), supports GET/POST/PUT/DELETE/OPTIONS.

**Broadcaster:** Manages per-issue SSE subscriptions. Events are sent as JSON. Keepalive heartbeat every 15 seconds. Non-blocking send (drops events for slow consumers).

Handlers accept `IssueRepository` and `ConfigRepository` interfaces for testability.

---

### 7. `workspace/manager.go`
Manages git worktrees for per-issue isolated development.

- `Create(issueID string, repoPath string) (string, error)` — creates a git worktree from a local repository
- `CreateFromRemote(issueID string, repo string, ghToken string) (string, error)` — clones a GitHub repo and creates a worktree from it
- `Path(issueID string) string` — deterministic path for given issue
- `Exists(issueID string) bool` — check if workspace exists
- `Cleanup(issueID string) error` — removes worktree and branch

**Implementation details:**
- Base path: `~/.auto-issue/workspaces/`
- Clone cache: `~/.auto-issue/clones/` (for remote repos)
- Worktree branch naming: `auto-issue/{issueID}`
- GitHub authentication via `x-access-token:{token}@github.com` URL
- Sets `GH_TOKEN` and `GITHUB_TOKEN` env vars for fetch/pull operations
- Idempotent: safe to call multiple times for the same issue

---

### 8. `agent/` — Multi-Provider Agent System
Executes AI agents locally as subprocesses within the issue's workspace.

**Provider interface:**
```go
type ProviderRunner interface {
  Run(ctx context.Context, workspacePath string, mode string, eventCh chan<- AgentEvent) (RunResult, error)
}
```

**Supported providers:**

1. **Claude Code** (`claude_provider.go`)
   - CLI: `claude -p <prompt> --verbose --output-format stream-json --dangerously-skip-permissions --model <model>`
   - Uses pseudo-terminal (PTY) for execution
   - Parses JSON stream events (stream_event, assistant, result, system)
   - Tracks costs, turns, PR URLs

2. **Codex** (`codex_provider.go`)
   - CLI: `codex exec --full-auto --json --model <model> <prompt>`
   - Requires `OPENAI_API_KEY` environment variable
   - Parses JSONL stream (thread.started, turn.started, item.completed, thread.completed, error)
   - Tracks tool executions, file edits, command executions

3. **Gemini** (`gemini_provider.go`)
   - CLI: `gemini -p <prompt>`
   - Requires `GOOGLE_API_KEY` environment variable
   - Parses plain text output
   - PR URL detection via regex

**Provider factory:**
```go
func NewProvider(cfg ProviderConfig) ProviderRunner
```
Accepts type: `"claude-code"`, `"codex"`, `"gemini"`.

**Shared utilities** (`base_provider.go`):
- `buildPrompt()` — constructs mode-specific prompts (developing/code_reviewing), with GitHub-aware PR instructions
- `spawnWithPTY()` — pseudo-terminal execution (used by Claude)
- `spawnDirect()` — direct process execution (used by Codex, Gemini)
- `textBufferer` — accumulates text and flushes on sentence boundaries or timeout
- PR URL regex detection

**Event types** (`events.go`): `text`, `tool`, `status`, `pr`, `cost`, `error`

---

### 9. `service/orchestrator.go`
Issue processing orchestration (business logic layer).

```go
type Orchestrator struct {
  workspace  *workspace.Manager
  issues     repository.IssueRepository
  config     *config.Config
  ghToken    string
  broadcaster *api.Broadcaster
  queue      chan string           // buffered work queue
  sem        chan struct{}         // semaphore for max concurrency
}
```

**API handlers enqueue issues:**
- `PUT /issues/{id}/move` with `{"to": "in_progress"}` → enqueue with phase `developing`
- `POST /issues/{id}/feedback` (human feedback) → enqueue with phase `developing` + feedback injected

**Worker goroutines (N = max_concurrency):**
```
1. Dequeue issue ID
2. Load issue from database
3. Resolve agent type/model (per-issue override or global default)
4. Create provider instance via NewProvider()
5. Create or reuse workspace (git worktree from local or remote repo)
6. Phase = developing:
   a. Build prompt with issue title + description + any previous feedback
   b. Run agent in development mode (streaming events to broadcaster)
   c. Store output, PR URL, cost, turns in database
   d. Set phase = code_reviewing
7. Phase = code_reviewing:
   a. Build prompt: "Review the solution you just implemented for this issue"
   b. Run same agent in code-review mode
   c. Append review output (prefixed with "# Code Review")
   d. Accumulate costs
   e. Set phase = human_review
8. Broadcast status events throughout for SSE subscribers
```

**Per-issue agent override:** Issues can specify `agent_type` and `agent_model` fields that override the global config values for that specific issue.

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

**Iteration limits:** max 3 feedback cycles before stopping (auto-fails if exceeded)

**Graceful shutdown:** catch `SIGTERM`/`SIGINT`, drain queue, wait for active agents to finish or timeout.

---

### 10. `cmd/server/main.go`
Entry point:
1. Connect to PostgreSQL via `db.OpenConnection()`
2. Run migrations via `db.RunMigration()`
3. Initialize repositories (`PGIssueRepository`, `PGConfigRepository`)
4. Load config from database (seed defaults on first run)
5. Read `GH_TOKEN` from environment
6. Initialize workspace manager, broadcaster, orchestrator
7. Start orchestrator (begin consuming queue)
8. Register API routes
9. Wrap mux with CORS middleware
10. Start HTTP server on configured port
11. Handle OS signals for graceful shutdown (orchestrator shutdown + HTTP server close)

---

## State Machine Flow

```
PhaseBacklog
    ↓ [User drags card to "In Progress" in Electron Kanban]
PhaseDeveloping (In Progress column)
    ↓ [Agent runs locally, solves the issue]
    ↓ (can transition to PhaseFailed on error)
PhaseCodeReviewing (still In Progress column)
    ↓ [Same agent reviews its own code]
    ↓ (can transition to PhaseFailed on error)
PhaseHumanReview (Human Review column — card auto-moves)
    ├─ (human clicks "Approve") → PhaseDone (Done column)
    └─ (human submits feedback to reprove)
        ↓
    PhaseDeveloping (back to In Progress column, iteration N+1)
        ↓ (repeats full develop → review cycle until approved or max_iterations)
```

**Key point:** Both `developing` and `code_reviewing` phases map to the "In Progress" column in the Kanban UI. The card only moves to "Human Review" after the code review agent completes successfully.

**Feedback Loop Logic:**
- In Human Review, the user can reprove the solution by submitting feedback text
- Electron sends `POST /issues/{id}/feedback` with the feedback text
- Backend increments `FeedbackCount` (max 3 before PhaseFailed)
- Sets phase back to `developing`, moves card back to In Progress column
- Re-spawns agent with injected prompt containing the user's feedback
- Agent goes through the full cycle again: develop → code review → human review
- If the user approves instead, Electron sends `PUT /issues/{id}/move` with `{"to": "done"}` and card moves to Done

**Persistence:** All issue state and config are stored in PostgreSQL. Concurrent access is handled by GORM transactions with `SELECT ... FOR UPDATE`. Duplicate dispatches are prevented via phase check before queueing.

---

## Workflow Triggers (from Electron Kanban UI)

**Kanban columns (managed by Electron UI):**
| Column | Meaning |
|--------|---------|
| `Queued` | Issue/card waiting to be worked on (backlog) |
| `Running` | Agent is developing or code-reviewing (both sub-phases) |
| `Awaiting Approval` | Solution ready, awaiting human approval (human_review) |
| `Done` | Approved and completed |
| `Failed` | Gave up after max iterations or agent error |

**Workflow trigger 1: User moves card from Backlog → In Progress**
- User drags card in Electron Kanban UI
- Electron sends `PUT /api/v1/issues/{id}/move` with `{"to": "in_progress"}`
- Backend enqueues issue with phase `developing`
- Worker resolves agent type (per-issue or global), creates provider, runs agent locally → develops solution → code reviews → sets phase to `human_review`
- Electron polls and auto-moves card to Human Review column

**Workflow trigger 2: Human reproves in Human Review column**
- Human writes feedback in the approval panel
- Electron sends `POST /api/v1/issues/{id}/feedback` with the feedback text
- Backend increments `FeedbackCount`, sets phase to `developing`, card moves back to In Progress
- Worker reruns agent with feedback injected → full cycle: develop → code review → human review
- Repeats up to `max_iterations` (default 3). If max exceeded, phase set to `failed`

**Workflow trigger 3: Human approves in Human Review column**
- Human clicks "Approve" in Electron UI
- Electron sends `PUT /api/v1/issues/{id}/move` with `{"to": "done"}`
- Backend sets phase to `done`
- Card moves to Done column

---

## Key Dependencies
- `gorm.io/gorm` — ORM for PostgreSQL
- `gorm.io/driver/postgres` — PostgreSQL driver for GORM
- `github.com/creack/pty` — pseudo-terminal support (for Claude Code provider)
- Standard library for everything else (goroutines, channels, os/exec, slog, net/http)

---

## Running the Application

```bash
cd backend

# 1. Copy and configure environment variables
cp .env.example .env

# 2. Start PostgreSQL and the app
docker-compose up --build
```

The app connects to PostgreSQL, runs migrations automatically, seeds default config if needed, and starts the API on port `8080`.

---

## Implementation Order
1. `models/` — GORM models (Issue, Config)
2. `constants/phases.go` — phase constants + transition rules
3. `db/` — database connection + migration
4. `repository/` — data access layer (issue + config repositories)
5. `config/config.go` — config struct + defaults
6. `workspace/manager.go` — git worktree management
7. `agent/` — multi-provider agent system (provider interface, Claude, Codex, Gemini)
8. `api/broadcaster.go` — SSE event broadcasting
9. `service/orchestrator.go` — develop → review → human_review pipeline
10. `api/handler.go` + `api/middleware.go` — HTTP handlers + CORS
11. `cmd/server/main.go` — wire everything together

---

## Verification
- Unit test: config defaults and validation
- Unit test: phase transitions (backlog → developing → code_reviewing → human_review → done)
- Unit test: API handlers with in-memory repository
- Unit test: multi-provider agent tests (Claude, Codex, Gemini)
- Integration test: mock agent runner, verify full orchestration flow
- Manual: create issue in Electron, move to In Progress, verify agent runs locally and card moves to Human Review
