import type { Run, User } from './types'

export async function getRuns(): Promise<Run[]> {
  return window.electronAPI.invoke('runs:list') as Promise<Run[]>
}

export async function getRun(id: string): Promise<Run> {
  return window.electronAPI.invoke('runs:get', id) as Promise<Run>
}

export async function approveRun(id: string): Promise<void> {
  await window.electronAPI.invoke('runs:approve', id)
}

export async function rejectRun(id: string): Promise<void> {
  await window.electronAPI.invoke('runs:reject', id)
}

export interface AppConfig {
  apiUrl: string
  autoApprove: boolean
}

export async function getConfig(): Promise<AppConfig> {
  return window.electronAPI.invoke('config:get') as Promise<AppConfig>
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await window.electronAPI.invoke('config:save', config)
}

export async function getMe(): Promise<User> {
  return window.electronAPI.invoke('auth:me') as Promise<User>
}
