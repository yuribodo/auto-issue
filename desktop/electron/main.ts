import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import {
  registerDeepLinkProtocol,
  handleLogin,
  handleGetMe,
  handleLogout,
} from './auth'
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

registerDeepLinkProtocol()

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
