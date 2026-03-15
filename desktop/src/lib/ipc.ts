import type { Run, User, SSEEvent, SettingsData, CreateRunParams, Provider, GitHubRepo, GitHubIssue } from './types'

export async function getRuns(): Promise<Run[]> {
  return window.electronAPI.invoke('runs:list') as Promise<Run[]>
}

export async function getRun(id: string): Promise<Run> {
  return window.electronAPI.invoke('runs:get', id) as Promise<Run>
}

export async function createRun(params: CreateRunParams): Promise<Run> {
  return window.electronAPI.invoke('runs:create', params) as Promise<Run>
}

export async function testRun(provider: Provider): Promise<Run> {
  return window.electronAPI.invoke('runs:test', provider) as Promise<Run>
}

export async function cancelRun(id: string): Promise<void> {
  await window.electronAPI.invoke('runs:cancel', id)
}

export async function deleteRun(id: string): Promise<void> {
  await window.electronAPI.invoke('runs:delete', id)
}

export async function approveRun(id: string): Promise<void> {
  await window.electronAPI.invoke('runs:approve', id)
}

export async function rejectRun(id: string, feedback?: string): Promise<void> {
  await window.electronAPI.invoke('runs:reject', id, feedback)
}

export async function getRunEvents(id: string): Promise<SSEEvent[]> {
  return window.electronAPI.invoke('run:events:get', id) as Promise<SSEEvent[]>
}

export async function getConfig(): Promise<SettingsData> {
  return window.electronAPI.invoke('config:get') as Promise<SettingsData>
}

export async function saveConfig(config: SettingsData): Promise<void> {
  await window.electronAPI.invoke('config:save', config)
}

export async function getMe(): Promise<User | null> {
  return window.electronAPI.invoke('auth:me') as Promise<User | null>
}

export async function getGitHubRepos(page?: number) {
  return window.electronAPI.invoke('github:repos', page) as Promise<GitHubRepo[]>
}

export async function getGitHubIssues(owner: string, repo: string, page?: number) {
  return window.electronAPI.invoke('github:issues', owner, repo, page) as Promise<GitHubIssue[]>
}

export async function getGitHubIssueDetail(owner: string, repo: string, num: number) {
  return window.electronAPI.invoke('github:issue-detail', owner, repo, num) as Promise<GitHubIssue>
}

export async function getRunDiff(id: string): Promise<any> {
  return window.electronAPI.invoke('runs:diff', id)
}

export async function openInCursor(workspacePath: string): Promise<void> {
  await window.electronAPI.invoke('workspace:open-in-cursor', workspacePath)
}
