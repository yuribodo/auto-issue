import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

import type { Run, SSEEvent, SettingsData } from './shared-types'

const userData = app.getPath('userData')
const runsPath = path.join(userData, 'runs.json')
const configPath = path.join(userData, 'config.json')
const eventsDir = path.join(userData, 'events')

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function readJSON<T>(filePath: string, fallback: T): T {
  try {
    const data = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(data) as T
  } catch {
    return fallback
  }
}

function writeJSON(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

// --- Runs ---

export function loadRuns(): Run[] {
  return readJSON<Run[]>(runsPath, [])
}

export function persistRuns(runs: Run[]): void {
  writeJSON(runsPath, runs)
}

// --- Config ---

const DEFAULT_CONFIG: SettingsData = {
  default_provider: 'anthropic',
  default_model: 'claude-sonnet-4-6',
  api_keys: { openai: '', anthropic: '', gemini: '' },
  notifications: { approval_needed: true, run_failed: true, pr_opened: false },
  polling_interval: 5,
  github_token: '',
}

export function loadConfig(): SettingsData {
  return { ...DEFAULT_CONFIG, ...readJSON<Partial<SettingsData>>(configPath, {}) }
}

export function persistConfig(config: SettingsData): void {
  writeJSON(configPath, config)
}

// --- Events (NDJSON: one JSON object per line, append-only) ---

function eventsPath(runId: string): string {
  return path.join(eventsDir, `${runId}.ndjson`)
}

export function loadEvents(runId: string): SSEEvent[] {
  try {
    const data = fs.readFileSync(eventsPath(runId), 'utf-8')
    return data
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as SSEEvent)
  } catch {
    return []
  }
}

export function appendEvent(runId: string, event: SSEEvent): void {
  ensureDir(eventsDir)
  fs.appendFileSync(eventsPath(runId), JSON.stringify(event) + '\n', 'utf-8')
}
