export type RunStatus =
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'pr_opened'
  | 'done'
  | 'failed'

export interface Run {
  id: string
  issue_number: number
  issue_title: string
  repo: string
  status: RunStatus
  provider: 'openai' | 'anthropic' | 'gemini'
  model: string
  started_at: string
  turns: number
  test_result?: 'passed' | 'failed' | 'skipped'
  pr_url?: string
}

export interface SSEEvent {
  type: 'log' | 'turn' | 'test' | 'status'
  timestamp: string
  prefix: string
  content: string
}

export interface User {
  login: string
  avatar_url: string
  name: string
}
