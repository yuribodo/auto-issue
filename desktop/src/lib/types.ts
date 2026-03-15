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

export interface Repository {
  id: string
  full_name: string
  description: string
  language: string
  open_issues_count: number
  is_monitored: boolean
}

export interface Issue {
  number: number
  title: string
  labels: string[]
  created_at: string
}

export interface Notification {
  id: string
  type: 'approval_needed' | 'run_failed' | 'pr_opened'
  run_id: string
  repo: string
  issue_number: number
  message: string
  timestamp: string
  read: boolean
}

export interface DailyStats {
  date: string
  total: number
  success: number
  failed: number
}

export interface ProviderStats {
  provider: Provider
  runs: number
  cost_usd: number
  avg_time_min: number
}

export interface RepoStats {
  repo: string
  runs: number
  success_rate: number
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
