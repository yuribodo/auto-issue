# Auto-Issue

You give it a GitHub issue and pick an AI agent. It clones the repo, writes a solution, reviews its own code, and waits for you to approve or reject. If you reject, you write why and it tries again.

Supports Claude Code, Codex (OpenAI), and Gemini. Runs on your machine as local CLI processes.

- Live demo: https://www.youtube.com/watch?v=qi4a_To_nfU
- PDF presentation: https://drive.google.com/file/d/1lk69PKdagKQ1LXtqaCb6IfsZdLt4quVs/view

## How it works

1. Create or import a GitHub issue into the Kanban board
2. Drag it to "In Progress" and pick a provider (or use your default)
3. The agent clones the repo into an isolated git worktree, writes a solution, then reviews its own code
4. The card moves to "Awaiting Approval" with a live terminal log of what the agent did
5. Approve (a PR gets created) or reject with feedback, and the agent goes again. Up to 3 rounds before it gives up.

All agent execution happens locally as CLI subprocesses.

## Parts

The Go backend is a REST API with SSE streaming. Manages the issue lifecycle, spawns agent processes, tracks costs. PostgreSQL stores state.

The desktop app is Electron + React. Kanban board, live terminal output, per-issue provider selection, analytics, run history.

A separate Next.js landing page lives in `landing/`.

## Architecture

```
desktop/          Electron + React + Vite (renderer)
backend/          Go HTTP server (REST + SSE)
landing/          Next.js landing page
```

```
┌─────────────┐       REST / SSE        ┌──────────────┐
│  Electron   │ ◄──────────────────────► │  Go Backend  │
│  Desktop    │                          │  :8080       │
└──────┬──────┘                          └──────┬───────┘
       │                                        │
       │  GitHub OAuth                          │  spawns local CLI
       ▼                                        ▼
   GitHub API                          Claude / Codex / Gemini
```

## Supported agents

| Provider | CLI | Notes |
|----------|-----|-------|
| Claude Code | `claude` | Stream-JSON output, PTY execution, cost tracking |
| Codex (OpenAI) | `codex` | JSONL output, requires `OPENAI_API_KEY` |
| Gemini | `gemini` | Plain text output, requires `GOOGLE_API_KEY` |

Each issue can use a different provider. Set a default in config, override per-issue when creating a run.

## Getting started

### Prerequisites

- Go 1.26+
- Node.js 18+
- PostgreSQL 16+
- At least one agent CLI installed (`claude`, `codex`, or `gemini`)
- A GitHub account (for OAuth and repo access)

### Backend

```bash
cd backend
cp .env.example .env
# Edit .env with your database credentials and API keys

# Option 1: Docker (includes PostgreSQL)
docker-compose up --build

# Option 2: Run directly (requires local PostgreSQL)
go run ./cmd/server
```

The API starts on `http://localhost:8080`. First run creates the tables and seeds default config.

### Desktop app

```bash
cd desktop
npm install
npm run dev
```

Sign in with GitHub and you're on the board.

### Landing page

```bash
cd landing
npm install
npm run dev
# Runs at http://localhost:3000
```

## Environment variables

Backend (`.env`):

```bash
DB_HOST=localhost
DB_PORT=5432
DB_USER=auto_issue
DB_PASSWORD=auto_issue
DB_NAME=auto_issue
DB_SSLMODE=disable
DB_TIMEZONE=UTC

# GitHub token for cloning repos and creating PRs
GH_TOKEN=ghp_...

# Agent API keys (optional, can also be set via the config API)
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=AI...
```

## The Kanban board

Five columns:

| Column | What it means |
|--------|---------------|
| Queued | Waiting to be picked up |
| Running | Agent is coding or reviewing |
| Awaiting Approval | Your turn to look at it |
| Done | Approved |
| Failed | Hit the iteration limit or crashed |

## Issue lifecycle

```
Backlog → Developing → Code Reviewing → Human Review → Done
                ▲                              │
                └──── feedback (max 3x) ───────┘
```

When you reject a solution, your feedback gets injected into the agent's next prompt. It runs the full cycle again: develop, self-review, back to you. Three feedback rounds max, then it moves to Failed.

## API

See [API.md](API.md) for the full reference.

Some of the endpoints:
- `GET /api/v1/issues` - list issues
- `POST /api/v1/issues` - create issue
- `PUT /api/v1/issues/{id}/move` - trigger agent or approve
- `POST /api/v1/issues/{id}/feedback` - reject with notes
- `GET /api/v1/issues/{id}/events` - SSE stream of agent output

## Tech stack

Backend: Go (standard library HTTP server), GORM + PostgreSQL, `creack/pty` for pseudo-terminal agent execution.

Desktop: Electron 33, React 18, React Router 6, Vite 6, TypeScript.

Landing: Next.js 16, React 19.

## Project structure

```
auto-issue/
├── backend/
│   ├── cmd/server/          # Entry point
│   ├── internal/
│   │   ├── agent/           # Multi-provider system (Claude, Codex, Gemini)
│   │   ├── api/             # HTTP handlers, CORS, SSE broadcaster
│   │   ├── config/          # App configuration
│   │   ├── constants/       # Phase definitions and transition rules
│   │   ├── db/              # PostgreSQL connection and migrations
│   │   ├── models/          # GORM models (Issue, Config)
│   │   ├── repository/      # Data access layer
│   │   ├── service/         # Orchestrator (develop → review pipeline)
│   │   └── workspace/       # Git worktree management
│   ├── Dockerfile
│   └── docker-compose.yml
├── desktop/
│   ├── src/                 # React renderer (pages, components, hooks)
│   └── electron/            # Main process (IPC, auth, backend client)
├── landing/
│   └── app/                 # Next.js landing page
├── API.md                   # REST API reference
├── WORKFLOW.md              # Backend implementation details
└── FRONTEND.md              # Frontend implementation details
```

## Our team

<table>
  <tr>
    <td align="center">
      <a href="https://github.com/yuribodo" title="Yuri Bodó">
        <img src="https://avatars3.githubusercontent.com/u/83407152" width="100px;" alt="Yuri Bodó"/><br>
        <sub><b>Yuri Bodó</b></sub>
      </a>
      <br />
      <a href="https://linkedin.com/in/mario-lara-1a801b272">
        <img src="https://img.shields.io/badge/LinkedIn-0077B5?style=flat&logo=linkedin&logoColor=white" alt="LinkedIn Badge"/>
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/Dnreikronos" title="João Soares">
        <img src="https://avatars3.githubusercontent.com/u/37777652" width="100px;" alt="João Soares"/><br>
        <sub><b>João Soares</b></sub>
      </a>
      <br />
      <a href="https://linkedin.com/in/joao-roberto-lawall-soares-a58468242">
        <img src="https://img.shields.io/badge/LinkedIn-0077B5?style=flat&logo=linkedin&logoColor=white" alt="LinkedIn Badge"/>
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/pedrogagodev" title="Pedro Gago">
        <img src="https://avatars.githubusercontent.com/u/178530456" width="100px;" alt="Pedro Gago"/><br>
        <sub><b>Pedro Gago</b></sub>
      </a>
      <br />
      <a href="https://linkedin.com/in/pedrogagodev">
        <img src="https://img.shields.io/badge/LinkedIn-0077B5?style=flat&logo=linkedin&logoColor=white" alt="LinkedIn Badge"/>
      </a>
    </td>
  </tr>
</table>

## License

MIT

---

> Why do programmers prefer dark mode? Because light attracts bugs.
