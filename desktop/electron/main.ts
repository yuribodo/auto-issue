import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { spawnDaemon, killDaemon } from './daemon'
import {
  registerDeepLinkProtocol,
  handleLogin,
  handleGetMe,
  handleLogout,
} from './auth'

const MOCK_RUNS = [
  {
    id: 'run-001',
    issue_number: 42,
    issue_title: 'Add dark mode toggle to settings page',
    repo: 'acme/webapp',
    status: 'running',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    started_at: new Date(Date.now() - 4 * 60_000).toISOString(),
    turns: 7,
  },
  {
    id: 'run-002',
    issue_number: 87,
    issue_title: 'Fix pagination offset bug in /api/users',
    repo: 'acme/webapp',
    status: 'awaiting_approval',
    provider: 'openai',
    model: 'gpt-4o',
    started_at: new Date(Date.now() - 12 * 60_000).toISOString(),
    turns: 14,
    test_result: 'passed',
    pr_url: 'https://github.com/acme/webapp/pull/88',
  },
  {
    id: 'run-003',
    issue_number: 53,
    issue_title: 'Refactor auth middleware to use JWT',
    repo: 'acme/api-server',
    status: 'done',
    provider: 'gemini',
    model: 'gemini-2.5-pro',
    started_at: new Date(Date.now() - 30 * 60_000).toISOString(),
    turns: 22,
    test_result: 'passed',
    pr_url: 'https://github.com/acme/api-server/pull/54',
  },
  {
    id: 'run-004',
    issue_number: 15,
    issue_title: 'Update README with new API endpoints',
    repo: 'acme/docs',
    status: 'queued',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    started_at: new Date().toISOString(),
    turns: 0,
  },
  {
    id: 'run-005',
    issue_number: 99,
    issue_title: 'Migrate database schema to v3',
    repo: 'acme/webapp',
    status: 'failed',
    provider: 'openai',
    model: 'gpt-4o',
    started_at: new Date(Date.now() - 20 * 60_000).toISOString(),
    turns: 8,
    test_result: 'failed',
  },
]

const MOCK_CONFIG = {
  apiUrl: 'http://localhost:8080',
  autoApprove: false,
}

let mainWindow: BrowserWindow | null = null

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
  ipcMain.handle('runs:list', () => {
    return MOCK_RUNS
  })

  ipcMain.handle('runs:get', (_event, id: string) => {
    return MOCK_RUNS.find((r) => r.id === id) ?? null
  })

  ipcMain.handle('runs:approve', (_event, id: string) => {
    const run = MOCK_RUNS.find((r) => r.id === id)
    if (run) run.status = 'done'
  })

  ipcMain.handle('runs:reject', (_event, id: string) => {
    const run = MOCK_RUNS.find((r) => r.id === id)
    if (run) run.status = 'failed'
  })

  ipcMain.handle('config:get', () => {
    return MOCK_CONFIG
  })

  ipcMain.handle('config:save', (_event, config: typeof MOCK_CONFIG) => {
    Object.assign(MOCK_CONFIG, config)
  })

  ipcMain.handle('auth:me', () => {
    return handleGetMe()
  })

  ipcMain.handle('auth:login', () => {
    handleLogin(mainWindow)
  })

  ipcMain.handle('auth:logout', () => {
    handleLogout()
  })

  ipcMain.handle('daemon:status', () => {
    return { running: false }
  })
}

registerDeepLinkProtocol()

app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()
  spawnDaemon()

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
  killDaemon()
})
