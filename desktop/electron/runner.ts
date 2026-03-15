import { spawn, ChildProcess } from 'node:child_process'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

import { loadRuns, persistRuns, loadConfig, loadEvents, appendEvent } from './store'
import { ensureClone, createWorktree, cleanupWorktree } from './workspace'
import { getAuthToken } from './auth'
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
      return { cmd: 'claude', args: ['-p', '--verbose', '--output-format', 'stream-json', '--dangerously-skip-permissions', '--include-partial-messages'] }
    case 'openai':
      return { cmd: 'codex', args: [] }
    case 'gemini':
      return { cmd: 'gemini', args: [] }
  }
}

function buildPrompt(run: Run): string {
  return `You are working on the repository ${run.repo}. Fix GitHub issue #${run.issue_number}.

Issue title: ${run.issue_title}

Issue description:
${run.issue_body ?? ''}

Instructions:
1. Analyze the issue and understand what needs to be fixed
2. Make the necessary code changes
3. Run any existing tests to verify your changes
4. Create a git commit with a descriptive message referencing the issue
5. Push the branch and create a pull request that closes #${run.issue_number}

Use \`gh pr create --title "Fix #${run.issue_number}: ${run.issue_title}" --body "Closes #${run.issue_number}"\` to create the PR.`
}

function envForProvider(provider: Provider, apiKeys: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  switch (provider) {
    case 'anthropic':
      // Claude CLI uses its own auth (claude login), no API key needed
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

  const authToken = getAuthToken() ?? ''

  let worktreePath: string
  try {
    const clonePath = await ensureClone(run.repo, authToken)
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

  // Use `script` to allocate a PTY so Claude CLI doesn't buffer stdout
  const fullArgs = [...args, prompt]
  const escapedCmd = [cmd, ...fullArgs].map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ')
  const child = spawn('script', ['-qc', escapedCmd, '/dev/null'], {
    cwd: worktreePath,
    env: { ...process.env, ...providerEnv, GH_TOKEN: authToken, GITHUB_TOKEN: authToken },
  })

  managed.child = child

  // Buffer for incomplete JSON lines from stdout
  let stdoutBuffer = ''

  // Buffer streaming text deltas to emit complete sentences
  let textBuffer = ''
  let textFlushTimer: ReturnType<typeof setTimeout> | null = null

  function flushTextBuffer() {
    if (textFlushTimer) { clearTimeout(textFlushTimer); textFlushTimer = null }
    if (!textBuffer.trim()) { textBuffer = ''; return }
    // Split into lines and emit each
    for (const line of textBuffer.split('\n')) {
      if (line.trim()) {
        emitEvent(runId, makeEvent('log', 'AGENT', line.trim()))
      }
    }
    textBuffer = ''
  }

  function appendTextDelta(text: string) {
    textBuffer += text
    // Flush on sentence boundaries or newlines
    if (/[.!?\n]/.test(text)) {
      flushTextBuffer()
    } else {
      if (textFlushTimer) clearTimeout(textFlushTimer)
      textFlushTimer = setTimeout(flushTextBuffer, 400)
    }
  }

  // Shorten long absolute paths to relative
  function shortPath(p: string): string {
    if (typeof p !== 'string') return ''
    return p.replace(worktreePath + '/', '').replace(worktreePath, '.')
  }

  function formatToolUse(name: string, input: Record<string, unknown>): string {
    switch (name) {
      case 'Read':
        return `${shortPath(String(input.file_path ?? ''))}${input.offset ? `:${input.offset}` : ''}`
      case 'Edit':
        return shortPath(String(input.file_path ?? ''))
      case 'Write':
        return shortPath(String(input.file_path ?? ''))
      case 'Bash': {
        const cmd = shortPath(String(input.command ?? '')).slice(0, 120)
        return cmd
      }
      case 'Glob':
        return String(input.pattern ?? '')
      case 'Grep':
        return `"${input.pattern ?? ''}"${input.path ? ` in ${shortPath(String(input.path))}` : ''}`
      case 'Agent':
        return String(input.description ?? input.prompt ?? '').slice(0, 80)
      case 'TodoWrite':
      case 'TodoRead':
        return ''
      default:
        return JSON.stringify(input).slice(0, 80)
    }
  }

  // Map tool names to short action verbs
  function toolVerb(name: string): string {
    const map: Record<string, string> = {
      Read: 'READ', Edit: 'EDIT', Write: 'WRITE', Bash: 'EXEC',
      Glob: 'FIND', Grep: 'SEARCH', Agent: 'SPAWN', TodoWrite: 'PLAN',
      TodoRead: 'PLAN', WebFetch: 'FETCH', WebSearch: 'SEARCH',
    }
    return map[name] ?? name.toUpperCase().slice(0, 6)
  }

  const handleStreamJson = (chunk: Buffer) => {
    stdoutBuffer += chunk.toString()
    const lines = stdoutBuffer.split('\n')
    stdoutBuffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.trim()) continue

      try {
        const parsed = JSON.parse(line)

        // Incremental streaming — buffer text deltas
        if (parsed.type === 'stream_event') {
          const evt = parsed.event
          if (evt?.type === 'content_block_delta' && evt.delta?.type === 'text_delta' && evt.delta?.text) {
            appendTextDelta(evt.delta.text)
          }
          continue
        }

        // Full assistant message — skip text (already streamed), handle tool_use
        if (parsed.type === 'assistant' && parsed.message?.content) {
          flushTextBuffer()
          for (const block of parsed.message.content) {
            if (block.type === 'text' && block.text) {
              // PR detection on full text
              const prMatch = block.text.match(PR_REGEX)
              if (prMatch) {
                run.pr_url = prMatch[0]
                run.status = 'awaiting_approval'
                updateRun(run)
                emitEvent(runId, makeEvent('status', 'PR', prMatch[0]))
              }
              // Skip emitting — already streamed via deltas
            } else if (block.type === 'tool_use') {
              run.turns++
              updateRun(run)
              const verb = toolVerb(block.name ?? 'tool')
              const detail = formatToolUse(block.name ?? 'tool', block.input ?? {})
              emitEvent(runId, makeEvent('turn', verb, detail))
            }
          }
        } else if (parsed.type === 'tool_result') {
          // Skip tool results — too noisy
        } else if (parsed.type === 'result') {
          flushTextBuffer()
          if (parsed.total_cost_usd) run.cost_usd = parsed.total_cost_usd
          updateRun(run)
          const summary = parsed.is_error
            ? `${String(parsed.result ?? 'Unknown error').slice(0, 200)}`
            : `${run.turns} turns · $${(run.cost_usd ?? 0).toFixed(2)}`
          emitEvent(runId, makeEvent('status', parsed.is_error ? 'FAIL' : 'DONE', summary))
        } else if (parsed.type === 'system' && parsed.subtype === 'init') {
          emitEvent(runId, makeEvent('status', 'INIT', `${parsed.model ?? 'agent'}`))
        }
      } catch {
        if (line.trim()) {
          emitEvent(runId, makeEvent('log', 'INFO', line.trim()))
          const prMatch = line.match(PR_REGEX)
          if (prMatch) {
            run.pr_url = prMatch[0]
            run.status = 'awaiting_approval'
            updateRun(run)
            emitEvent(runId, makeEvent('status', 'PR', prMatch[0]))
          }
        }
      }
    }
  }

  child.stdout?.on('data', (data: Buffer) => handleStreamJson(data))
  child.stderr?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter((l) => l.length > 0)
    for (const line of lines) {
      emitEvent(runId, makeEvent('log', 'ERR', line))
    }
  })

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
