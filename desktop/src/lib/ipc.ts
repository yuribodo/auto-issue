import type { Run, User, SSEEvent, SettingsData, CreateRunParams, Provider } from './types'

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

export async function approveRun(id: string): Promise<void> {
  await window.electronAPI.invoke('runs:approve', id)
}

export async function rejectRun(id: string): Promise<void> {
  await window.electronAPI.invoke('runs:reject', id)
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

export async function getMe(): Promise<User> {
  return window.electronAPI.invoke('auth:me') as Promise<User>
}
