# Auto-Issue — Go Backend Implementation Plan

## Context
Build a local Go backend (HTTP API server) embedded within an Electron app. The Electron frontend provides a Kanban board UI. When the user moves a card from Backlog to In Progress, the backend dispatches a local Claude Code agent to solve the issue, then runs the same agent for code review, and finally moves the card to Human Review. Everything runs locally on the user's machine — no GitHub polling or external triggers.

---

## Directory Structure

```
backend/
├── cmd/
│   └── server/
│       └── main.go                # Entry point: connect DB, run migrations, wire components, start API
├── internal/
│   ├── api/
│   │   └── handler.go             # HTTP handlers: PUT /issues/{id}/move, GET /issues, etc.
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
│   │   └── runner.go              # Spawn Claude Code subprocess, capture output, enforce timeout
│   └── workspace/
│       └── manager.go             # Create/destroy per-issue workspace directories
├── docker-compose.yml             # PostgreSQL + app containers
├── Dockerfile                     # Multi-stage Go build
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

On first startup, if no config exists in the database, defaults are seeded automatically. Config can be reloaded from the database via API endpoint.

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

---

### 3. `db/db.go` + `db/migration.go`
Database connection and schema management.

- `OpenConnection()` — connects to PostgreSQL using `DATABASE_URL` env var, or falls back to individual `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_SSLMODE`, `DB_TIMEZONE` env vars.
- `RunMigration(db)` — runs GORM AutoMigrate for `Issue` and `Config` models.

---

### 4. `models/issue.go` + `models/config.go`
GORM models mapped to PostgreSQL tables.

- `Issue` — stores issue state, phase, agent output, feedback, iteration count, timestamps.
- `Config` — singleton row (`id = 1`) storing all application configuration.

---

### 5. `repository/`
Data access layer following the repository pattern.

- `IssueRepository` interface — `Create`, `Get`, `List`, `Transition`, `SetFeedback`, `StartDeveloping`, `UpdateOutput`.
- `PGIssueRepository` — PostgreSQL implementation using GORM with `SELECT ... FOR UPDATE` for safe concurrent transitions.
- `MemoryIssueRepository` — in-memory implementation for unit tests.
- `ConfigRepository` interface — `Load`, `Save`.
- `PGConfigRepository` — PostgreSQL implementation.

---

### 6. `api/handler.go`
HTTP request handlers for the API server. The Electron frontend communicates with these endpoints.

**Key handlers:**
- `GET /api/v1/status` — health check
- `GET /api/v1/issues` — list all issues (filterable by phase)
- `GET /api/v1/issues/{id}` — get issue details + latest agent output
- `POST /api/v1/issues` — create new issue (user creates a card in Electron)
- `PUT /api/v1/issues/{id}/move` — move issue to new phase (triggers agent when moving to `in_progress`)
- `POST /api/v1/issues/{id}/feedback` — submit human feedback (triggers re-run)
- `GET /api/v1/config` — get current configuration
- `POST /api/v1/config/reload` — reload config from database

Handlers accept `IssueRepository` and `ConfigRepository` interfaces for testability.

---

### 7. `workspace/manager.go`
Manages isolated directories per issue.

- `Create(issueID string, repoPath string) (string, error)` — creates `{base_path}/{issueID}/`, initializes with repo contents
- `Path(issueID string) string` — deterministic path for given issue
- `Cleanup(issueID string) error` — removes workspace after completion (optional, configurable)

Workspaces are preserved across restarts (idempotent creation). The repo source is a local path provided by the user in the issue card.

---

### 8. `agent/runner.go`
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
- Returns combined output (stored in database, returned to frontend)

---

### 9. `service/orchestrator.go`
Issue processing orchestration (business logic layer).

```go
type Orchestrator struct {
  workspace *workspace.Manager
  issues    repository.IssueRepository
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
   c. Store output in database
   d. Set phase = code_reviewing
4. Phase = code_reviewing:
   a. Build prompt: "Review the solution you just implemented for this issue"
   b. Run same Claude Code agent in code-review mode
   c. Store review output in database
   d. Set phase = human_review
5. Electron frontend polls and sees phase = human_review → moves card to Human Review column
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

### 10. `cmd/server/main.go`
Entry point:
1. Connect to PostgreSQL via `db.OpenConnection()`
2. Run migrations via `db.RunMigration()`
3. Initialize repositories (`PGIssueRepository`, `PGConfigRepository`)
4. Load config from database (seed defaults on first run)
5. Initialize workspace manager, agent runner, orchestrator
6. Start HTTP API server on configured port
7. Handle OS signals for graceful shutdown

---

## State Machine Flow

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

**Persistence:** All issue state and config are stored in PostgreSQL. Concurrent access is handled by GORM transactions with `SELECT ... FOR UPDATE`. Duplicate dispatches are prevented via phase check before queueing.

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
- `gorm.io/gorm` — ORM for PostgreSQL
- `gorm.io/driver/postgres` — PostgreSQL driver for GORM
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
6. `workspace/manager.go` — workspace management
7. `agent/runner.go` — Claude Code subprocess execution
8. `service/orchestrator.go` — develop → review → human_review pipeline
9. `api/handler.go` — HTTP handlers
10. `cmd/server/main.go` — wire everything together

---

## Verification
- Unit test: config defaults and validation
- Unit test: phase transitions (backlog → developing → code_reviewing → human_review → done)
- Unit test: API handlers with in-memory repository
- Integration test: mock agent runner, verify full orchestration flow
- Manual: create issue in Electron, move to In Progress, verify Claude Code runs locally and card moves to Human Review
