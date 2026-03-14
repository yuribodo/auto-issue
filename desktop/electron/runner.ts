import { spawn, ChildProcess } from 'node:child_process'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

import { loadRuns, persistRuns, loadConfig, loadEvents, appendEvent } from './store'
import { ensureClone, createWorktree, cleanupWorktree } from './workspace'
import type { Run, SSEEvent, CreateRunParams, Provider } from './shared-types'

interface ManagedProcess {
  run: Run
  child: ChildProcess | null
  clonePath: string | null
}

const registry = new Map<string, ManagedProcess>()

// Will be set from main.ts
let broadcastFn: ((runId: string, event: SSEEvent) => void) | null = null

export function setBroadcast(fn: (runId: string, event: SSEEvent) => void): void {
  broadcastFn = fn
}

function makeEvent(type: SSEEvent['type'], prefix: string, content: string): SSEEvent {
  return {
    type,
    timestamp: new Date().toISOString(),
    prefix,
    content,
  }
}

function emitEvent(runId: string, event: SSEEvent): void {
  appendEvent(runId, event)
  broadcastFn?.(runId, event)
}

function updateRun(run: Run): void {
  const runs = loadRuns()
  const idx = runs.findIndex((r) => r.id === run.id)
  if (idx >= 0) {
    runs[idx] = run
  } else {
    runs.push(run)
  }
  persistRuns(runs)
}

function buildCommand(provider: Provider): { cmd: string; args: string[] } {
  switch (provider) {
    case 'anthropic':
      return { cmd: 'claude', args: ['--print'] }
    case 'openai':
      return { cmd: 'codex', args: [] }
    case 'gemini':
      return { cmd: 'gemini', args: [] }
  }
}

function buildPrompt(run: Run): string {
  return `Fix issue #${run.issue_number}: ${run.issue_title}\n\n${run.issue_body}`
}

function envForProvider(provider: Provider, apiKeys: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  switch (provider) {
    case 'anthropic':
      if (apiKeys.anthropic) env.ANTHROPIC_API_KEY = apiKeys.anthropic
      break
    case 'openai':
      if (apiKeys.openai) env.OPENAI_API_KEY = apiKeys.openai
      break
    case 'gemini':
      if (apiKeys.gemini) env.GOOGLE_API_KEY = apiKeys.gemini
      break
  }
  return env
}

const PR_REGEX = /https:\/\/github\.com\/.+\/pull\/\d+/

// --- Public API ---

export function createRun(params: CreateRunParams): Run {
  const run: Run = {
    id: `run-${crypto.randomUUID().slice(0, 8)}`,
    issue_number: params.issue_number,
    issue_title: params.issue_title,
    issue_body: params.issue_body,
    repo: params.repo,
    status: 'queued',
    provider: params.provider,
    model: params.model,
    started_at: new Date().toISOString(),
    turns: 0,
  }

  const runs = loadRuns()
  runs.push(run)
  persistRuns(runs)

  registry.set(run.id, { run, child: null, clonePath: null })
  return run
}

export async function startRun(runId: string): Promise<void> {
  const managed = registry.get(runId)
  if (!managed) return

  const { run } = managed
  const config = loadConfig()

  run.status = 'running'
  run.started_at = new Date().toISOString()
  updateRun(run)

  emitEvent(runId, makeEvent('status', 'INFO', 'Preparing workspace...'))

  let worktreePath: string
  try {
    const clonePath = await ensureClone(run.repo, config.github_token)
    managed.clonePath = clonePath
    emitEvent(runId, makeEvent('log', 'INFO', `Repository cloned/fetched: ${run.repo}`))

    worktreePath = await createWorktree(clonePath, runId)
    emitEvent(runId, makeEvent('log', 'INFO', `Worktree created at: ${worktreePath}`))
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    emitEvent(runId, makeEvent('log', 'ERR', `Workspace setup failed: ${msg}`))
    run.status = 'failed'
    run.finished_at = new Date().toISOString()
    updateRun(run)
    return
  }

  const { cmd, args } = buildCommand(run.provider)
  const prompt = buildPrompt(run)
  const providerEnv = envForProvider(run.provider, config.api_keys)

  emitEvent(runId, makeEvent('log', 'INFO', `Spawning: ${cmd} ${args.join(' ')} "<prompt>"`))

  const child = spawn(cmd, [...args, prompt], {
    cwd: worktreePath,
    env: { ...process.env, ...providerEnv },
  })

  managed.child = child

  const handleOutput = (data: Buffer, prefix: string) => {
    const lines = data.toString().split('\n').filter((l) => l.length > 0)
    for (const line of lines) {
      emitEvent(runId, makeEvent('log', prefix, line))

      // Detect PR URL
      const prMatch = line.match(PR_REGEX)
      if (prMatch) {
        run.pr_url = prMatch[0]
        run.status = 'awaiting_approval'
        updateRun(run)
        emitEvent(runId, makeEvent('status', 'INFO', `PR detected: ${prMatch[0]}`))
      }
    }
  }

  child.stdout?.on('data', (data: Buffer) => handleOutput(data, 'INFO'))
  child.stderr?.on('data', (data: Buffer) => handleOutput(data, 'ERR'))

  child.on('close', async (code) => {
    managed.child = null

    if (run.status === 'running') {
      run.status = code === 0 ? 'done' : 'failed'
    }
    run.finished_at = new Date().toISOString()
    updateRun(run)

    const donePrefix = code === 0 ? 'DONE' : 'FAIL'
    emitEvent(runId, makeEvent('status', donePrefix, `Process exited with code ${code}`))

    // Cleanup worktree
    if (managed.clonePath) {
      try {
        await cleanupWorktree(managed.clonePath, runId)
      } catch {
        // best effort
      }
    }
  })

  child.on('error', (err) => {
    managed.child = null
    run.status = 'failed'
    run.finished_at = new Date().toISOString()
    updateRun(run)
    emitEvent(runId, makeEvent('log', 'ERR', `Failed to spawn process: ${err.message}`))
  })
}

/**
 * Start a test run — spawns the CLI in a temp directory with a test prompt.
 * No git clone/worktree needed.
 */
export async function startTestRun(provider: Provider): Promise<Run> {
  const config = loadConfig()

  const run: Run = {
    id: `test-${crypto.randomUUID().slice(0, 8)}`,
    issue_number: 0,
    issue_title: 'Test Run',
    issue_body: '',
    repo: 'test/agent',
    status: 'running',
    provider,
    model: config.default_model,
    started_at: new Date().toISOString(),
    turns: 0,
  }

  const runs = loadRuns()
  runs.push(run)
  persistRuns(runs)

  const managed: ManagedProcess = { run, child: null, clonePath: null }
  registry.set(run.id, managed)

  const testPrompt = 'Say hello and briefly explain what you can do as a coding assistant. Keep it under 5 sentences.'
  const { cmd, args } = buildCommand(provider)
  const providerEnv = envForProvider(provider, config.api_keys)

  // Use a temp directory as cwd
  const tmpDir = path.join(os.tmpdir(), `auto-issue-test-${run.id}`)
  fs.mkdirSync(tmpDir, { recursive: true })

  emitEvent(run.id, makeEvent('status', 'INFO', `Testing ${provider} agent...`))
  emitEvent(run.id, makeEvent('log', 'INFO', `Spawning: ${cmd} ${args.join(' ')} "<test prompt>"`))

  const child = spawn(cmd, [...args, testPrompt], {
    cwd: tmpDir,
    env: { ...process.env, ...providerEnv },
  })

  managed.child = child

  const handleOutput = (data: Buffer, prefix: string) => {
    const lines = data.toString().split('\n').filter((l) => l.length > 0)
    for (const line of lines) {
      emitEvent(run.id, makeEvent('log', prefix, line))
    }
  }

  child.stdout?.on('data', (data: Buffer) => handleOutput(data, 'INFO'))
  child.stderr?.on('data', (data: Buffer) => handleOutput(data, 'ERR'))

  child.on('close', (code) => {
    managed.child = null
    run.status = code === 0 ? 'done' : 'failed'
    run.finished_at = new Date().toISOString()
    updateRun(run)

    const donePrefix = code === 0 ? 'DONE' : 'FAIL'
    emitEvent(run.id, makeEvent('status', donePrefix, `Test finished with code ${code}`))

    // Cleanup temp dir
    try { fs.rmSync(tmpDir, { recursive: true }) } catch { /* best effort */ }
  })

  child.on('error', (err) => {
    managed.child = null
    run.status = 'failed'
    run.finished_at = new Date().toISOString()
    updateRun(run)
    emitEvent(run.id, makeEvent('log', 'ERR', `Failed to spawn ${cmd}: ${err.message}`))
  })

  return run
}

export function cancelRun(runId: string): void {
  const managed = registry.get(runId)
  if (!managed) return

  if (managed.child) {
    managed.child.kill('SIGTERM')
    managed.child = null
  }

  managed.run.status = 'failed'
  managed.run.finished_at = new Date().toISOString()
  updateRun(managed.run)
  emitEvent(runId, makeEvent('status', 'WARN', 'Run cancelled by user'))
}

export function getAllRuns(): Run[] {
  return loadRuns()
}

export function getRun(id: string): Run | null {
  return loadRuns().find((r) => r.id === id) ?? null
}

export function getRunEvents(id: string): SSEEvent[] {
  return loadEvents(id)
}

/**
 * On startup, mark any runs that were "running" as "failed" (app restarted).
 */
export function recoverRuns(): void {
  const runs = loadRuns()
  let changed = false
  for (const run of runs) {
    if (run.status === 'running' || run.status === 'queued') {
      run.status = 'failed'
      run.finished_at = new Date().toISOString()
      changed = true

      // Also re-populate registry so we have them available
      registry.set(run.id, { run, child: null, clonePath: null })
      appendEvent(run.id, makeEvent('status', 'WARN', 'Run interrupted — app was restarted'))
    }
  }
  if (changed) persistRuns(runs)
}

/**
 * Kill all running child processes (called on app quit).
 */
export function killAll(): void {
  for (const [, managed] of registry) {
    if (managed.child) {
      managed.child.kill('SIGTERM')
      managed.child = null
    }
  }
}
