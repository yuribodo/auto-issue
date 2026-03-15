# Auto-Issue HTTP API

The Go backend exposes a REST HTTP API on `localhost:8080` (port configurable via `api_port` in the database config). The Electron desktop app communicates with this API to manage the Kanban board and trigger agent runs.

**Base URL:** `http://localhost:8080/api/v1`

---

## Authentication

The user authenticates via GitHub OAuth through the Electron app. The backend validates the GitHub token on API requests.

1. User logs in via GitHub OAuth flow in Electron
2. Electron stores the GitHub token
3. All API requests include `Authorization: Bearer <github_token>` header
4. Backend validates the token against GitHub's API to confirm identity

---

## Endpoints

### `GET /status`
Health check and daemon metadata.

**Response:**
```json
{
  "status": "running",
  "uptime": "2h34m15s",
  "active_issues": 3
}
```

---

### `GET /issues`
List all tracked issues across the Kanban board.

**Query params:**
- `phase`: filter by phase (`backlog`, `developing`, `code_reviewing`, `human_review`, `done`, `failed`)
- `github_user`: filter by GitHub username
- `limit`: max results (default 100)

**Response:**
```json
{
  "issues": [
    {
      "id": "issue-42",
      "run_number": 1,
      "github_user": "yuribodo",
      "title": "Add authentication middleware",
      "description": "Implement JWT-based auth middleware for all API routes.",
      "phase": "human_review",
      "iteration": 1,
      "feedback_count": 0,
      "started_at": "2026-03-14T09:15:00Z",
      "workspace_path": "/home/user/.auto-issue/workspaces/issue-42",
      "repo_path": "/home/user/projects/my-app",
      "github_repo": "yuribodo/my-app",
      "issue_number": 42,
      "agent_type": "claude-code",
      "agent_model": "claude-opus-4-6",
      "pr_url": "",
      "cost_usd": 0.15,
      "turns": 5
    }
  ],
  "total": 1
}
```

---

### `GET /issues/{id}`
Detailed state and latest agent output for a specific issue.

**Response:**
```json
{
  "id": "issue-42",
  "run_number": 1,
  "github_user": "yuribodo",
  "title": "Add authentication middleware",
  "description": "Implement JWT-based auth middleware for all API routes.",
  "phase": "human_review",
  "iteration": 1,
  "feedback_count": 0,
  "repo_path": "/home/user/projects/my-app",
  "github_repo": "yuribodo/my-app",
  "issue_number": 42,
  "agent_type": "claude-code",
  "agent_model": "claude-opus-4-6",
  "started_at": "2026-03-14T09:15:00Z",
  "workspace_path": "/home/user/.auto-issue/workspaces/issue-42",
  "last_run_at": "2026-03-14T10:25:30Z",
  "last_output": "# Solution Summary\n\n## Changes Made\n- Created middleware/auth.go\n- Added JWT validation\n...",
  "agent_logs": "[10:25:30] Starting development phase\n[10:25:45] Running agent...\n[10:26:30] Code complete, starting code review...\n[10:28:00] Code review passed, moving to human review",
  "pr_url": "https://github.com/yuribodo/my-app/pull/43",
  "cost_usd": 0.15,
  "turns": 5
}
```

---

### `POST /issues`
Create a new issue (card) in the Kanban board. Created in `backlog` phase.

**Request:**
```json
{
  "title": "Add authentication middleware",
  "description": "Implement JWT-based auth middleware for all API routes. Should validate tokens, handle expiry, and return 401 for unauthorized requests.",
  "repo_path": "/home/user/projects/my-app",
  "github_user": "yuribodo",
  "github_repo": "yuribodo/my-app",
  "issue_number": 42,
  "agent_type": "codex",
  "agent_model": "o3"
}
```

Fields `github_repo`, `issue_number`, `agent_type`, and `agent_model` are optional. When `agent_type`/`agent_model` are provided, they override the global config for this specific issue.

**Response:**
```json
{
  "id": "issue-42",
  "title": "Add authentication middleware",
  "phase": "backlog",
  "created_at": "2026-03-14T09:00:00Z"
}
```

---

### `DELETE /issues/{id}`
Delete an issue from the board.

**Response:**
```json
{
  "success": true,
  "message": "Issue deleted"
}
```

---

### `PUT /issues/{id}/move`
Move an issue to a new phase. This is the primary trigger for agent execution.

**Request:**
```json
{
  "to": "in_progress"
}
```

**Valid transitions:**
- `backlog` → `in_progress` (mapped to `developing`) — triggers agent: develop → code review → human_review
- `human_review` → `done` — human approves the solution

**Response:**
```json
{
  "success": true,
  "message": "Issue moved to in_progress, agent started",
  "issue": {
    "id": "issue-42",
    "phase": "developing",
    "iteration": 1
  }
}
```

---

### `POST /issues/{id}/feedback`
Reprove a solution and send the issue back for rework. Only valid when issue is in `human_review` phase. The Electron app parses the user's feedback and sends the prompt text here.

Moves issue back to `developing` (In Progress column) and reruns the full agent cycle (develop → code review → human review) with the feedback injected.

**Request:**
```json
{
  "feedback": "Refactor the auth logic to use factory pattern instead of conditional. Also add unit tests."
}
```

**Response:**
```json
{
  "success": true,
  "message": "Feedback submitted, restarting agent",
  "issue": {
    "id": "issue-42",
    "phase": "developing",
    "iteration": 2,
    "feedback_count": 1
  }
}
```

---

### `GET /issues/{id}/events`
Server-Sent Events (SSE) stream for real-time agent output.

**Event format:**
```json
{
  "type": "text",
  "content": "Reading file src/auth.go..."
}
```

**Event types:**
- `text` — Agent text output
- `tool` — Agent tool usage (read, edit, write, exec, etc.)
- `status` — Phase/status change
- `pr` — PR created (includes URL)
- `cost` — Cost update
- `error` — Error occurred

**Connection:**
- Keepalive heartbeat every 15 seconds
- Non-blocking send (drops events for slow consumers)

---

### `GET /config`
Current parsed configuration (loaded from database).

**Response:**
```json
{
  "api_port": 8080,
  "max_concurrency": 10,
  "agent": {
    "type": "claude-code",
    "model": "claude-opus-4-6",
    "timeout": "30m",
    "max_iterations": 3,
    "prompt": "Solve this issue step by step.",
    "api_keys": {
      "openai": "sk-...",
      "gemini": "AI..."
    }
  },
  "workspace": {
    "base_path": "~/.auto-issue/workspaces"
  }
}
```

---

### `POST /config/reload`
Force reload config from the database.

**Response:**
```json
{
  "success": true,
  "message": "Config reloaded successfully"
}
```

---

## CORS

The backend includes CORS middleware that allows all origins (`*`), supporting GET, POST, PUT, DELETE, and OPTIONS methods with Content-Type and Authorization headers.

---

## Error Response

All endpoints return `4xx` or `5xx` on error with consistent format:

```json
{
  "error": "error_code",
  "message": "Human-readable error message",
  "timestamp": "2026-03-14T10:30:45Z"
}
```

**Common error codes:**
- `not_found` — issue/resource doesn't exist
- `invalid_phase` — operation not valid for current phase (e.g. feedback on a non-human_review issue)
- `invalid_transition` — card move not allowed (e.g. backlog → done)
- `config_error` — config parse failed
- `agent_error` — agent execution failed
- `max_iterations` — feedback loop limit reached
- `unauthorized` — missing or invalid GitHub token
- `internal_error` — backend internal error

---

## Rate Limiting

- No rate limits (local API, single user)
- Electron app polls `/issues` every 5 seconds for UI updates

---

## Environment Variables (Backend)

Configured via `.env` file (see `.env.example`):

```bash
# PostgreSQL connection
DB_HOST=localhost
DB_PORT=5432
DB_USER=auto_issue
DB_PASSWORD=auto_issue
DB_NAME=auto_issue
DB_SSLMODE=disable
DB_TIMEZONE=UTC

# Alternative: single connection string (takes precedence over individual vars)
# DATABASE_URL=host=localhost port=5432 user=auto_issue password=auto_issue dbname=auto_issue sslmode=disable

# GitHub token (for workspace cloning and PR creation)
GH_TOKEN=ghp_...

# Provider API keys (optional, can also be set in database config)
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=AI...
```
