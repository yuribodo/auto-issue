import { app, shell, BrowserWindow } from 'electron'

const PROTOCOL = 'auto-issue'

const MOCK_USER = {
  login: 'octocat',
  avatar_url: 'https://github.com/octocat.png',
  name: 'The Octocat',
}

export function registerDeepLinkProtocol(): void {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
        process.argv[1],
      ])
    }
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL)
  }
}

export function handleLogin(mainWindow: BrowserWindow | null): void {
  // MVP: log instead of opening real OAuth flow
  console.log('[auth] login requested — returning mock user (MVP)')
  mainWindow?.webContents.send('auth:success', MOCK_USER)
}

export function handleGetMe() {
  return MOCK_USER
}

export function handleLogout(): void {
  // MVP: no-op
  console.log('[auth] logout requested — no-op (MVP)')
}
