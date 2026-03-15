// Backend API client — bridges the desktop Electron app to the Go backend.
// Translates between desktop Run types and backend Issue types.

import http from 'node:http'
import https from 'node:https'
import type { Run, SSEEvent, CreateRunParams } from './shared-types'

function httpModule(url: URL) {
  return url.protocol === 'https:' ? https : http
}

let BACKEND_URL = process.env.BACKEND_URL || 'https://auto-issue.onrender.com'
export function setBackendUrl(url: string): void { BACKEND_URL = url }

// Auth token getter — set by main process so backend requests carry the user's GitHub token
let authTokenGetter: (() => string | null) | null = null
export function setAuthTokenGetter(getter: () => string | null): void { authTokenGetter = getter }

// --- HTTP helpers ---

function request(method: string, path: string, body?: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BACKEND_URL)
    const payload = body ? JSON.stringify(body) : undefined

    const token = authTokenGetter?.()
    const req = httpModule(url).request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data)
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(parsed.message || `HTTP ${res.statusCode}`))
            } else {
              resolve(parsed)
            }
          } catch {
            resolve(data)
          }
        })
      },
    )

    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

// --- Phase ↔ Status mapping ---

function phaseToStatus(phase: string): Run['status'] {
  switch (phase) {
    case 'backlog':
      return 'queued'
    case 'developing':
    case 'code_reviewing':
      return 'running'
    case 'human_review':
      return 'awaiting_approval'
    case 'done':
      return 'done'
    case 'failed':
      return 'failed'
    default:
      return 'queued'
  }
}

// Convert backend Issue to desktop Run
// Map backend agent_type to desktop provider
const agentTypeToProvider: Record<string, Run['provider']> = {
  'claude-code': 'anthropic',
  codex: 'openai',
  gemini: 'gemini',
}

function issueToRun(issue: any): Run {
  return {
    id: issue.id,
    run_number: issue.run_number || 0,
    issue_number: issue.issue_number || 0,
    issue_title: issue.title,
    issue_body: issue.description,
    repo: issue.github_repo || issue.repo_path || '',
    status: phaseToStatus(issue.phase),
    provider: agentTypeToProvider[issue.agent_type] || 'anthropic',
    model: issue.agent_model || 'claude-opus-4-6',
    started_at: issue.started_at || issue.created_at,
    finished_at: issue.phase === 'done' || issue.phase === 'failed' ? issue.updated_at : undefined,
    turns: issue.turns || 0,
    pr_url: issue.pr_url || undefined,
    cost_usd: issue.cost_usd || undefined,
    workspace_path: issue.workspace_path || undefined,
  }
}

// --- Public API ---

export async function backendListRuns(githubUser?: string): Promise<Run[]> {
  const query = githubUser ? `?github_user=${encodeURIComponent(githubUser)}` : ''
  const resp = await request('GET', `/api/v1/issues${query}`)
  const issues = resp.issues || []
  return issues.map(issueToRun)
}

export async function backendGetRun(id: string): Promise<Run | null> {
  try {
    const issue = await request('GET', `/api/v1/issues/${id}`)
    return issueToRun(issue)
  } catch {
    return null
  }
}

export async function backendCreateRun(params: CreateRunParams, githubUser: string): Promise<Run> {
  // Map desktop provider names to backend agent_type
  const providerToAgentType: Record<string, string> = {
    anthropic: 'claude-code',
    openai: 'codex',
    gemini: 'gemini',
  }

  const issue = await request('POST', '/api/v1/issues', {
    title: params.issue_title,
    description: params.issue_body || '',
    repo_path: '',
    github_repo: params.repo,
    issue_number: params.issue_number,
    agent_type: providerToAgentType[params.provider] || '',
    agent_model: params.model || '',
    github_user: githubUser,
  })

  return issueToRun(issue)
}

export async function backendStartRun(id: string): Promise<void> {
  // Move issue to in_progress → triggers agent in backend
  await request('PUT', `/api/v1/issues/${id}/move`, { to: 'in_progress' })
}

export async function backendApproveRun(id: string): Promise<void> {
  await request('PUT', `/api/v1/issues/${id}/move`, { to: 'done' })
}

export async function backendCancelRun(id: string): Promise<void> {
  await request('POST', `/api/v1/issues/${id}/cancel`)
}

export async function backendDeleteRun(id: string): Promise<void> {
  await request('DELETE', `/api/v1/issues/${id}`)
}

export async function backendSubmitFeedback(id: string, feedback: string): Promise<void> {
  await request('POST', `/api/v1/issues/${id}/feedback`, { feedback })
}

// --- SSE subscription ---

export interface SSEConnection {
  close: () => void
}

// Subscribe to SSE events from backend for a given issue.
// Calls onEvent for each event received.
export function backendSubscribeSSE(
  issueId: string,
  onEvent: (event: SSEEvent) => void,
): SSEConnection {
  let closed = false
  let req: http.ClientRequest | null = null

  function connect() {
    if (closed) return

    const url = new URL(`/api/v1/issues/${issueId}/events`, BACKEND_URL)
    const token = authTokenGetter?.()

    req = httpModule(url).request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let buffer = ''

        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString()

          // Parse SSE frames
          const parts = buffer.split('\n\n')
          buffer = parts.pop() ?? ''

          for (const part of parts) {
            if (!part.trim() || part.startsWith(':')) continue

            let eventType = ''
            let data = ''

            for (const line of part.split('\n')) {
              if (line.startsWith('event: ')) {
                eventType = line.slice(7)
              } else if (line.startsWith('data: ')) {
                data = line.slice(6)
              }
            }

            if (data) {
              try {
                const parsed = JSON.parse(data)
                // Map backend AgentEvent to desktop SSEEvent
                const sseEvent: SSEEvent = {
                  type: mapEventType(eventType || parsed.type),
                  timestamp: parsed.timestamp || new Date().toISOString(),
                  prefix: parsed.prefix || 'INFO',
                  content: parsed.content || '',
                }
                onEvent(sseEvent)
              } catch {
                // ignore parse errors
              }
            }
          }
        })

        res.on('end', () => {
          // Reconnect after 2s if not explicitly closed
          if (!closed) {
            setTimeout(connect, 2000)
          }
        })

        res.on('error', () => {
          if (!closed) {
            setTimeout(connect, 2000)
          }
        })
      },
    )

    req.on('error', () => {
      if (!closed) {
        setTimeout(connect, 2000)
      }
    })

    req.end()
  }

  connect()

  return {
    close: () => {
      closed = true
      req?.destroy()
    },
  }
}

function mapEventType(type: string): SSEEvent['type'] {
  switch (type) {
    case 'text':
      return 'log'
    case 'tool':
      return 'turn'
    case 'status':
      return 'status'
    case 'pr':
      return 'status'
    case 'cost':
      return 'status'
    case 'error':
      return 'status'
    default:
      return 'log'
  }
}

export async function backendGetDiff(id: string): Promise<any> {
  return request('GET', `/api/v1/issues/${id}/diff`)
}

// Check if backend is reachable
export async function backendHealthCheck(): Promise<boolean> {
  try {
    const resp = await request('GET', '/api/v1/status')
    return resp.status === 'running'
  } catch {
    return false
  }
}
