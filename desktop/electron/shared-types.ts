// Shared types used by both electron main process and renderer.
// Keep in sync with src/lib/types.ts

export interface GitHubUser {
  login: string
  avatar_url: string
  name: string | null
}

export interface GitHubRepo {
  id: number
  full_name: string
  description: string | null
  language: string | null
  open_issues_count: number
  private: boolean
}

export interface GitHubIssue {
  number: number
  title: string
  body: string | null
  labels: Array<{ name: string; color: string }>
  created_at: string
}

export type RunStatus =
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'pr_opened'
  | 'done'
  | 'failed'

export type Provider = 'openai' | 'anthropic' | 'gemini'

export interface Run {
  id: string
  run_number: number
  issue_number: number
  issue_title: string
  issue_body?: string
  repo: string
  status: RunStatus
  provider: Provider
  model: string
  started_at: string
  finished_at?: string
  turns: number
  test_result?: 'passed' | 'failed' | 'skipped'
  pr_url?: string
  files_changed?: number
  lines_added?: number
  lines_removed?: number
  cost_usd?: number
  workspace_path?: string
}

export interface SSEEvent {
  type: 'log' | 'turn' | 'test' | 'status'
  timestamp: string
  prefix: string
  content: string
}

export interface SettingsData {
  default_provider: Provider
  default_model: string
  api_keys: {
    openai: string
    anthropic: string
    gemini: string
  }
  notifications: {
    approval_needed: boolean
    run_failed: boolean
    pr_opened: boolean
  }
  polling_interval: number
  monitored_repos: string[]
}

export interface CreateRunParams {
  repo: string
  issue_number: number
  issue_title: string
  issue_body: string
  provider: Provider
  model: string
}
