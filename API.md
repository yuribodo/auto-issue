# Auto-Issue HTTP API

The Go backend exposes a REST HTTP API on `localhost:8080` (port configurable via `api_port` in config). The Electron frontend communicates with this API to manage the Kanban board and trigger agent runs.

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
- `limit`: max results (default 100)

**Response:**
```json
{
  "issues": [
    {
      "id": "issue-42",
      "title": "Add authentication middleware",
      "description": "Implement JWT-based auth middleware for all API routes.",
      "phase": "human_review",
      "iteration": 1,
      "feedback_count": 0,
      "started_at": "2026-03-14T09:15:00Z",
      "workspace_path": "/home/user/.auto-issue/workspaces/issue-42"
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
  "title": "Add authentication middleware",
  "description": "Implement JWT-based auth middleware for all API routes.",
  "phase": "human_review",
  "iteration": 1,
  "feedback_count": 0,
  "repo_path": "/home/user/projects/my-app",
  "started_at": "2026-03-14T09:15:00Z",
  "workspace_path": "/home/user/.auto-issue/workspaces/issue-42",
  "last_run_at": "2026-03-14T10:25:30Z",
  "last_output": "# Solution Summary\n\n## Changes Made\n- Created middleware/auth.go\n- Added JWT validation\n...",
  "agent_logs": "[10:25:30] Starting development phase\n[10:25:45] Running Claude Code...\n[10:26:30] Code complete, starting code review...\n[10:28:00] Code review passed, moving to human review"
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
  "repo_path": "/home/user/projects/my-app"
}
```

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

### `PUT /issues/{id}/move`
Move an issue to a new phase. This is the primary trigger for agent execution.

**Request:**
```json
{
  "to": "in_progress"
}
```

**Valid transitions:**
- `backlog` → `in_progress` — triggers agent: develop → code review → human_review
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
Reprove a solution and send the issue back for rework. Only valid when issue is in `human_review` phase. The Electron frontend parses the user's `@auto-issue <prompt>` comment and sends the prompt text here.

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

### `GET /config`
Current parsed configuration.

**Response:**
```json
{
  "api_port": 8080,
  "max_concurrency": 5,
  "agent": {
    "type": "claude-code",
    "model": "claude-opus-4-6",
    "timeout": "20m",
    "max_iterations": 3,
    "prompt": "Solve this issue step by step."
  },
  "workspace": {
    "base_path": "~/.auto-issue/workspaces"
  }
}
```

---

### `POST /config/reload`
Force reload config from `~/.auto-issue/config.json`.

**Response:**
```json
{
  "success": true,
  "message": "Config reloaded successfully"
}
```

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
- `agent_error` — Claude Code execution failed
- `max_iterations` — feedback loop limit reached
- `unauthorized` — missing or invalid GitHub token
- `internal_error` — backend internal error

---

## Rate Limiting

- No rate limits (local API, single user)
- Electron frontend should poll `/issues` no more than every 2 seconds for UI updates

---

## WebSocket (Future)

SSE or WebSocket for real-time updates is not implemented in MVP. The Electron frontend polls endpoints at reasonable intervals to detect phase changes and update the Kanban board.

---

## Environment Variables (Backend)

```bash
# Port for HTTP API (overrides config file)
API_PORT=8080

# GitHub OAuth client credentials (for login flow)
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...

# Config file location (default: ~/.auto-issue/config.json)
CONFIG_PATH=~/.auto-issue/config.json

# Workspaces location (default: ~/.auto-issue/workspaces)
WORKSPACES_PATH=~/.auto-issue/workspaces
```
