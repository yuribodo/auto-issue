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
import { getUserRepos, getRepoIssues, getIssueDetail } from './github'
import { loadConfig, persistConfig, loadRuns, persistRuns } from './store'
import {
  createRun,
  startRun,
  startTestRun,
  cancelRun,
  getAllRuns,
  getRun,
  getRunEvents,
  recoverRuns,
  killAll,
  setBroadcast,
} from './runner'
import type { SSEEvent, SettingsData, CreateRunParams, Provider } from './shared-types'

let mainWindow: BrowserWindow | null = null

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

function registerIpcHandlers() {
  // --- Runs ---
  ipcMain.handle('runs:list', () => {
    return getAllRuns()
  })

  ipcMain.handle('runs:get', (_event, id: string) => {
    return getRun(id)
  })

  ipcMain.handle('runs:create', async (_event, params: CreateRunParams) => {
    const run = createRun(params)
    // Start asynchronously — don't block the IPC response
    startRun(run.id).catch((err) => {
      console.error(`[runner] startRun error for ${run.id}:`, err)
    })
    return run
  })

  ipcMain.handle('runs:test', async (_event, provider: Provider) => {
    return startTestRun(provider)
  })

  ipcMain.handle('runs:cancel', (_event, id: string) => {
    cancelRun(id)
  })

  ipcMain.handle('runs:approve', (_event, id: string) => {
    const runs = loadRuns()
    const run = runs.find((r) => r.id === id)
    if (run) {
      run.status = 'done'
      run.finished_at = new Date().toISOString()
      persistRuns(runs)
    }
  })

  ipcMain.handle('runs:reject', (_event, id: string) => {
    const runs = loadRuns()
    const run = runs.find((r) => r.id === id)
    if (run) {
      run.status = 'failed'
      run.finished_at = new Date().toISOString()
      persistRuns(runs)
    }
  })

  ipcMain.handle('run:events:get', (_event, runId: string) => {
    return getRunEvents(runId)
  })

  // --- Config ---
  ipcMain.handle('config:get', () => {
    return loadConfig()
  })

  ipcMain.handle('config:save', (_event, config: SettingsData) => {
    persistConfig(config)
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

app.whenReady().then(() => {
  setBroadcast(broadcastEvent)
  recoverRuns()
  registerIpcHandlers()
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
  killAll()
})
