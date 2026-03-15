import { app, shell, safeStorage, BrowserWindow } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { getAuthenticatedUser } from './github'
import type { GitHubUser } from './shared-types'

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID ?? 'Ov23li5OrfDADZHMPhfM'

const userData = app.getPath('userData')
const authFilePath = path.join(userData, 'auth.enc')

let cachedToken: string | null = null
let cachedUser: GitHubUser | null = null
let pollingAbort: AbortController | null = null

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

/**
 * GitHub Device Flow login.
 * Opens the browser for the user to enter a code — no client_secret needed.
 * https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
 */
export function handleLogin(mainWindow: BrowserWindow | null): void {
  if (!GITHUB_CLIENT_ID) {
    console.error('[auth] GITHUB_CLIENT_ID not set')
    return
  }

  // Cancel any previous polling
  pollingAbort?.abort()
  pollingAbort = new AbortController()
  const { signal } = pollingAbort

  ;(async () => {
    try {
      // Step 1: Request device and user codes
      const codeRes = await fetch('https://github.com/login/device/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, scope: 'repo' }),
        signal,
      })

      const codeData = (await codeRes.json()) as {
        device_code: string
        user_code: string
        verification_uri: string
        expires_in: number
        interval: number
      }

      console.log(`[auth] Device code: ${codeData.user_code}`)

      // Notify renderer to show the user code
      mainWindow?.webContents.send('auth:device-code', {
        userCode: codeData.user_code,
        verificationUri: codeData.verification_uri,
      })

      // Open browser for user to enter code
      shell.openExternal(`${codeData.verification_uri}`)

      // Step 2: Poll for token
      const intervalMs = (codeData.interval || 5) * 1000
      const expiresAt = Date.now() + codeData.expires_in * 1000

      while (Date.now() < expiresAt) {
        if (signal.aborted) return

        await new Promise((r) => setTimeout(r, intervalMs))
        if (signal.aborted) return

        const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            client_id: GITHUB_CLIENT_ID,
            device_code: codeData.device_code,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }),
          signal,
        })

        const tokenData = (await tokenRes.json()) as {
          access_token?: string
          error?: string
        }

        if (tokenData.access_token) {
          saveToken(tokenData.access_token)
          cachedToken = tokenData.access_token

          const user = await getAuthenticatedUser(tokenData.access_token)
          cachedUser = user

          mainWindow?.webContents.send('auth:success', user)
          console.log(`[auth] Logged in as ${user.login}`)
          return
        }

        if (tokenData.error === 'authorization_pending') {
          continue
        }

        if (tokenData.error === 'slow_down') {
          await new Promise((r) => setTimeout(r, 5000))
          continue
        }

        // expired_token, access_denied, etc.
        console.error('[auth] Device flow error:', tokenData.error)
        mainWindow?.webContents.send('auth:error', tokenData.error)
        return
      }

      console.error('[auth] Device code expired')
      mainWindow?.webContents.send('auth:error', 'Code expired — please try again')
    } catch (err) {
      if (signal.aborted) return
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[auth] Device flow failed:', msg)
      mainWindow?.webContents.send('auth:error', msg)
    }
  })()
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
  pollingAbort?.abort()
  cachedToken = null
  cachedUser = null
  try { fs.unlinkSync(authFilePath) } catch { /* ignore */ }
}
