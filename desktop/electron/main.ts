import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

// Load .env manually (dotenv may not work in bundled context)
try {
  const envPath = path.resolve(__dirname, '..', '.env')
  const envContent = fs.readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx < 0) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed.slice(eqIdx + 1).trim()
    if (!process.env[key]) process.env[key] = value
  }
} catch { /* .env not found, rely on actual env vars */ }
import {
  handleLogin,
  handleGetMe,
  handleLogout,
  getAuthToken,
} from './auth'
import { getUserRepos, getRepoIssues, getIssueDetail, createGitHubIssue } from './github'
import { loadConfig, persistConfig, appendEvent, loadEvents, loadRuns, persistRuns } from './store'
import {
  startTestRun,
  killAll,
  setBroadcast,
} from './runner'
import { startPoller, stopPoller, updatePollerConfig, syncNow } from './poller'
import {
  backendListRuns,
  backendGetRun,
  backendCreateRun,
  backendStartRun,
  backendApproveRun,
  backendCancelRun,
  backendDeleteRun,
  backendSubmitFeedback,
  backendSubscribeSSE,
  backendHealthCheck,
  backendGetDiff,
  setBackendUrl,
  type SSEConnection,
} from './backend-client'
import { spawnDaemon, killDaemon } from './daemon'
import type { SSEEvent, SettingsData, CreateRunParams, Provider } from './shared-types'

let mainWindow: BrowserWindow | null = null
let useBackend = false

// Track active SSE subscriptions per run
const sseSubscriptions = new Map<string, SSEConnection>()

function broadcastEvent(runId: string, event: SSEEvent) {
  mainWindow?.webContents.send('run:event', { runId, event })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // Force external links to open in the default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// Subscribe to SSE for a run and forward events to renderer
function subscribeToRunEvents(runId: string) {
  // Don't double-subscribe
  if (sseSubscriptions.has(runId)) return

  const conn = backendSubscribeSSE(runId, (event) => {
    // Persist event locally for history
    appendEvent(runId, event)
    // Forward to renderer
    broadcastEvent(runId, event)
  })

  sseSubscriptions.set(runId, conn)
}

// Cleanup SSE subscription for a run
function unsubscribeFromRunEvents(runId: string) {
  const conn = sseSubscriptions.get(runId)
  if (conn) {
    conn.close()
    sseSubscriptions.delete(runId)
  }
}

function registerIpcHandlers() {
  // --- Runs ---
  ipcMain.handle('runs:list', async () => {
    if (!useBackend) {
      const { getAllRuns } = await import('./runner')
      return getAllRuns()
    }
    try {
      const user = await handleGetMe()
      const runs = await backendListRuns(user?.login)
      // Cache locally to survive restarts
      persistRuns(runs)
      return runs
    } catch (err) {
      console.error('[backend] list runs failed, falling back to local cache:', err)
      return loadRuns()
    }
  })

  ipcMain.handle('runs:get', async (_event, id: string) => {
    if (!useBackend) {
      const { getRun } = await import('./runner')
      return getRun(id)
    }
    try {
      const run = await backendGetRun(id)
      if (run) {
        // Update local cache
        const runs = loadRuns()
        const idx = runs.findIndex((r) => r.id === id)
        if (idx >= 0) runs[idx] = run
        else runs.push(run)
        persistRuns(runs)
      }
      return run
    } catch {
      // Fallback: read from cache
      const runs = loadRuns()
      return runs.find((r) => r.id === id) || null
    }
  })

  ipcMain.handle('runs:create', async (_event, params: CreateRunParams) => {
    if (!useBackend) {
      const { createRun, startRun } = await import('./runner')
      const run = createRun(params)
      startRun(run.id).catch((err) => {
        console.error(`[runner] startRun error for ${run.id}:`, err)
      })
      return run
    }

    // Create issue in backend, then start it
    const user = await handleGetMe()
    if (!user?.login) throw new Error('Not authenticated — cannot create run without GitHub user')
    const run = await backendCreateRun(params, user.login)
    console.log(`[backend] Created issue ${run.id}, starting...`)

    // Cache locally
    const runs = loadRuns()
    runs.push(run)
    persistRuns(runs)

    // Start the run (moves to developing → agent kicks in on backend)
    backendStartRun(run.id).catch((err) => {
      console.error(`[backend] startRun error for ${run.id}:`, err)
    })

    // Subscribe to SSE events from backend
    subscribeToRunEvents(run.id)

    return run
  })

  ipcMain.handle('runs:test', async (_event, provider: Provider) => {
    // Test runs always use local runner (no backend needed)
    return startTestRun(provider)
  })

  ipcMain.handle('runs:cancel', async (_event, id: string) => {
    if (!useBackend) {
      const { cancelRun } = await import('./runner')
      cancelRun(id)
      return
    }
    await backendCancelRun(id)
    unsubscribeFromRunEvents(id)
    // Update local cache
    const runs = loadRuns()
    const run = runs.find((r) => r.id === id)
    if (run) {
      run.status = 'failed'
      run.finished_at = new Date().toISOString()
      persistRuns(runs)
    }
  })

  ipcMain.handle('runs:delete', async (_event, id: string) => {
    unsubscribeFromRunEvents(id)
    if (!useBackend) {
      const { deleteRun } = await import('./runner')
      deleteRun(id)
      return
    }
    await backendDeleteRun(id)
    // Remove from local cache
    const runs = loadRuns().filter((r) => r.id !== id)
    persistRuns(runs)
  })

  ipcMain.handle('runs:approve', async (_event, id: string) => {
    if (!useBackend) {
      const { loadRuns, persistRuns } = await import('./store')
      const runs = loadRuns()
      const run = runs.find((r) => r.id === id)
      if (run) {
        run.status = 'done'
        run.finished_at = new Date().toISOString()
        persistRuns(runs)
      }
      return
    }

    await backendApproveRun(id)
    unsubscribeFromRunEvents(id)
    // Update local cache
    const runs = loadRuns()
    const run = runs.find((r) => r.id === id)
    if (run) {
      run.status = 'done'
      run.finished_at = new Date().toISOString()
      persistRuns(runs)
    }
  })

  ipcMain.handle('runs:reject', async (_event, id: string, feedback?: string) => {
    if (!useBackend) {
      const { loadRuns, persistRuns } = await import('./store')
      const runs = loadRuns()
      const run = runs.find((r) => r.id === id)
      if (run) {
        run.status = 'failed'
        run.finished_at = new Date().toISOString()
        persistRuns(runs)
      }
      return
    }
    await backendSubmitFeedback(id, feedback || 'Rejected by user — please fix the issues and try again.')
    // Update local cache
    const runs = loadRuns()
    const run = runs.find((r) => r.id === id)
    if (run) {
      run.status = 'running'
      persistRuns(runs)
    }
    // Re-subscribe to SSE since the agent will restart
    subscribeToRunEvents(id)
  })

  ipcMain.handle('run:events:get', (_event, runId: string) => {
    // Always load from local cache (events are persisted locally via SSE handler)
    return loadEvents(runId)
  })

  // --- Diff ---
  ipcMain.handle('runs:diff', async (_event, id: string) => {
    return await backendGetDiff(id)
  })

  // --- Workspace ---
  ipcMain.handle('workspace:open-in-cursor', async (_event, workspacePath: string) => {
    const { exec } = await import('node:child_process')
    exec(`cursor "${workspacePath}"`)
  })

  // --- Config ---
  ipcMain.handle('config:get', () => {
    return loadConfig()
  })

  ipcMain.handle('config:save', async (_event, config: SettingsData) => {
    const oldConfig = loadConfig()
    persistConfig(config)
    const token = getAuthToken()
    if (token) {
      updatePollerConfig({
        enabled: config.polling_enabled !== false,
        intervalSeconds: config.polling_interval || 5,
        monitoredRepos: config.monitored_repos || []
      }, token)
    }

    // Restart bundled backend if database_url changed
    if (config.database_url && config.database_url !== oldConfig.database_url) {
      killDaemon()
      try {
        const port = await spawnDaemon(config.database_url)
        if (port > 0) {
          setBackendUrl(`http://127.0.0.1:${port}`)
          useBackend = true
          console.log(`[main] Restarted bundled backend on port ${port}`)
        }
      } catch (err) {
        console.error('[main] Failed to restart bundled backend:', err)
      }
    }
  })

  // --- Shell ---
  ipcMain.handle('shell:open-external', (_event, url: string) => {
    shell.openExternal(url)
  })

  // --- GitHub ---
  ipcMain.handle('github:repos', async (_event, page?: number) => {
    const token = getAuthToken()
    if (!token) throw new Error('Not authenticated')
    return getUserRepos(token, page)
  })

  ipcMain.handle('github:issues', async (_event, owner: string, repo: string, page?: number) => {
    const token = getAuthToken()
    if (!token) throw new Error('Not authenticated')
    return getRepoIssues(token, owner, repo, page)
  })

  ipcMain.handle('github:issue-detail', async (_event, owner: string, repo: string, num: number) => {
    const token = getAuthToken()
    if (!token) throw new Error('Not authenticated')
    return getIssueDetail(token, owner, repo, num)
  })

  ipcMain.handle('github:createIssue', async (_event, { owner, repo, title, body, labels }) => {
    const token = getAuthToken()
    if (!token) throw new Error('Not authenticated')
    return createGitHubIssue(token, owner, repo, title, body, labels)
  })

  ipcMain.handle('poller:sync', async () => {
    const token = getAuthToken()
    if (!token) throw new Error('Not authenticated')
    await syncNow(token)
  })

  // --- Auth ---
  ipcMain.handle('auth:me', () => {
    return handleGetMe()
  })

  ipcMain.handle('auth:login', () => {
    handleLogin(mainWindow)
  })

  ipcMain.handle('auth:logout', () => {
    handleLogout()
  })
}

app.whenReady().then(async () => {
  setBroadcast(broadcastEvent)

  // Check if backend is available
  useBackend = await backendHealthCheck()
  if (useBackend) {
    console.log('[main] Backend detected at', process.env.BACKEND_URL || 'http://localhost:8080')
    console.log('[main] Using backend for run management')

    // Subscribe to SSE for any currently running issues
    try {
      const user = await handleGetMe()
      const runs = await backendListRuns(user?.login)
      // Cache locally to survive restarts
      persistRuns(runs)
      for (const run of runs) {
        if (run.status === 'running') {
          subscribeToRunEvents(run.id)
        }
      }
    } catch (err) {
      console.error('[main] Failed to list running issues:', err)
    }
  }

  // If no external backend, try spawning the bundled one
  if (!useBackend) {
    const config = loadConfig()
    if (config.database_url) {
      try {
        const port = await spawnDaemon(config.database_url)
        if (port > 0) {
          setBackendUrl(`http://127.0.0.1:${port}`)
          useBackend = true
          console.log(`[main] Bundled backend started on port ${port}`)

          // Subscribe to SSE for running issues
          try {
            const user = await handleGetMe()
            const runs = await backendListRuns(user?.login)
            persistRuns(runs)
            for (const run of runs) {
              if (run.status === 'running') {
                subscribeToRunEvents(run.id)
              }
            }
          } catch (err) {
            console.error('[main] Failed to list running issues:', err)
          }
        }
      } catch (err) {
        console.error('[main] Failed to start bundled backend:', err)
      }
    }
  }

  if (!useBackend) {
    console.log('[main] Backend not available, using local runner')
    const { recoverRuns } = await import('./runner')
    recoverRuns()
  }

  registerIpcHandlers()
  // Initialize poller after IPC handlers are ready
  const config = loadConfig()
  const token = getAuthToken()
  // Debug diagnostics for poller startup
  console.debug('[main] Poller startup check:', {
    enabledFlag: config.polling_enabled !== false,
    tokenAvailable: !!token,
    reposConfigured: config.monitored_repos?.length ?? 0,
  })
  if (config.polling_enabled !== false && token && config.monitored_repos?.length > 0) {
    console.debug('[main] Starting poller with config', {
      enabled: true,
      intervalSeconds: config.polling_interval || 5,
      monitoredRepos: config.monitored_repos,
    })
    startPoller({
      enabled: true,
      intervalSeconds: config.polling_interval || 5,
      monitoredRepos: config.monitored_repos
    }, token)
  }
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('quit', () => {
  // Stop poller before shutdown
  stopPoller()
  // Close all SSE connections
  for (const [, conn] of sseSubscriptions) {
    conn.close()
  }
  sseSubscriptions.clear()
  killAll()
  killDaemon()
})
