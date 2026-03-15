import { app, shell, safeStorage, BrowserWindow } from 'electron'
import http from 'node:http'
import crypto from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs'
import { getAuthenticatedUser } from './github'
import type { GitHubUser } from './shared-types'

const OAUTH_PORT = 17249
const OAUTH_SCOPES = 'repo'

const userData = app.getPath('userData')
const authFilePath = path.join(userData, 'auth.enc')

let cachedToken: string | null = null
let cachedUser: GitHubUser | null = null

function saveToken(token: string): void {
  const encrypted = safeStorage.encryptString(token)
  fs.mkdirSync(path.dirname(authFilePath), { recursive: true })
  fs.writeFileSync(authFilePath, encrypted)
}

function loadToken(): string | null {
  try {
    if (!fs.existsSync(authFilePath)) return null
    const encrypted = fs.readFileSync(authFilePath)
    return safeStorage.decryptString(encrypted)
  } catch {
    return null
  }
}

export function getAuthToken(): string | null {
  if (cachedToken) return cachedToken
  cachedToken = loadToken()
  return cachedToken
}

export function handleLogin(mainWindow: BrowserWindow | null): void {
  const clientId = process.env.GITHUB_CLIENT_ID ?? ''
  const clientSecret = process.env.GITHUB_CLIENT_SECRET ?? ''

  if (!clientId || !clientSecret) {
    console.error('[auth] clientId or GITHUB_CLIENT_SECRET not set')
    return
  }

  const state = crypto.randomBytes(16).toString('hex')

  const server = http.createServer(async (req, res) => {
    if (!req.url?.startsWith('/oauth/callback')) {
      res.writeHead(404)
      res.end('Not found')
      return
    }

    const url = new URL(req.url, `http://localhost:${OAUTH_PORT}`)
    const code = url.searchParams.get('code')
    const returnedState = url.searchParams.get('state')

    if (returnedState !== state || !code) {
      res.writeHead(400)
      res.end('Invalid state or missing code')
      return
    }

    try {
      // Exchange code for token
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
        }),
      })

      const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string }

      if (!tokenData.access_token) {
        throw new Error(tokenData.error ?? 'Failed to obtain access token')
      }

      const token = tokenData.access_token

      // Save encrypted token
      saveToken(token)
      cachedToken = token

      // Get user info
      const user = await getAuthenticatedUser(token)
      cachedUser = user

      // Send success response to browser
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body style="background:#0a0a0a;color:#fff;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div><h2>Authentication successful!</h2><p>You can close this window and return to auto-issue.</p></div></body></html>')

      // Notify renderer
      mainWindow?.webContents.send('auth:success', user)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[auth] OAuth token exchange failed:', msg)
      res.writeHead(500)
      res.end(`Authentication failed: ${msg}`)
    } finally {
      // Close server after handling
      server.close()
    }
  })

  server.listen(OAUTH_PORT, () => {
    const authUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(`http://localhost:${OAUTH_PORT}/oauth/callback`)}&scope=${OAUTH_SCOPES}&state=${state}`
    shell.openExternal(authUrl)
  })

  // Timeout: close server after 5 minutes if no callback received
  setTimeout(() => {
    server.close()
  }, 5 * 60_000)
}

export async function handleGetMe(): Promise<GitHubUser | null> {
  if (cachedUser) return cachedUser

  const token = getAuthToken()
  if (!token) return null

  try {
    cachedUser = await getAuthenticatedUser(token)
    return cachedUser
  } catch {
    // Token is invalid — clear it
    cachedToken = null
    cachedUser = null
    try { fs.unlinkSync(authFilePath) } catch { /* ignore */ }
    return null
  }
}

export function handleLogout(): void {
  cachedToken = null
  cachedUser = null
  try { fs.unlinkSync(authFilePath) } catch { /* ignore */ }
}
