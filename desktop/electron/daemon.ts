/**
 * Bundled Go backend process manager.
 * Spawns the auto-issue-backend binary in agent mode as a child process,
 * assigns a free port, and polls /api/v1/status until the backend is healthy.
 *
 * In agent mode, the binary talks to the remote Render API for DB operations
 * and runs agents locally on the user's machine.
 */

import { spawn, execSync, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import net from 'node:net'
import http from 'node:http'

let daemonProcess: ChildProcess | null = null
let daemonPort = 0

/** Returns the binary name for the current platform. */
function binaryName(): string {
  return process.platform === 'win32' ? 'auto-issue-backend.exe' : 'auto-issue-backend'
}

/** Resolves the path to the backend binary. */
function resolveBinaryPath(): string {
  // Packaged app: binary is in resources/backend/
  const packaged = path.join(process.resourcesPath, 'backend', binaryName())
  try {
    require('node:fs').accessSync(packaged)
    return packaged
  } catch { /* not packaged */ }

  // Dev mode: binary is in desktop/resources/backend/
  const dev = path.join(__dirname, '..', 'resources', 'backend', binaryName())
  return dev
}

/** Finds a free TCP port by briefly listening on port 0. */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      if (addr && typeof addr === 'object') {
        const port = addr.port
        srv.close(() => resolve(port))
      } else {
        srv.close(() => reject(new Error('Failed to get free port')))
      }
    })
    srv.on('error', reject)
  })
}

/** Polls the backend /api/v1/status endpoint until it responds with status "running". */
function waitForHealthy(port: number, timeoutMs = 15000): Promise<void> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    function check() {
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Backend did not become healthy within ${timeoutMs}ms`))
        return
      }

      const req = http.request(
        { hostname: '127.0.0.1', port, path: '/api/v1/status', method: 'GET', timeout: 2000 },
        (res) => {
          let data = ''
          res.on('data', (chunk) => (data += chunk))
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data)
              if (parsed.status === 'running') {
                resolve()
                return
              }
            } catch { /* not ready yet */ }
            setTimeout(check, 300)
          })
        },
      )
      req.on('error', () => setTimeout(check, 300))
      req.end()
    }
    check()
  })
}

export interface DaemonOptions {
  /** URL of the remote API (Render) that the agent binary talks to for DB operations. */
  backendUrl: string
  /** GitHub OAuth token for the authenticated user. */
  ghToken: string
}

/**
 * Spawns the bundled Go backend in agent mode.
 * The binary talks to the remote API for DB operations and runs agents locally.
 * Returns the port the local binary is listening on.
 */
export async function spawnDaemon(opts: DaemonOptions): Promise<number> {
  if (daemonProcess) {
    return daemonPort
  }

  const binPath = resolveBinaryPath()
  const port = await getFreePort()

  console.log(`[daemon] Starting backend in agent mode: ${binPath} on port ${port}`)

  const child = spawn(binPath, [], {
    env: {
      ...process.env,
      MODE: 'agent',
      PORT: String(port),
      BACKEND_URL: opts.backendUrl,
      GH_TOKEN: opts.ghToken,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout?.on('data', (data: Buffer) => {
    console.log(`[backend] ${data.toString().trimEnd()}`)
  })
  child.stderr?.on('data', (data: Buffer) => {
    console.error(`[backend] ${data.toString().trimEnd()}`)
  })

  child.on('exit', (code) => {
    console.log(`[daemon] Backend exited with code ${code}`)
    daemonProcess = null
    daemonPort = 0
  })

  daemonProcess = child
  daemonPort = port

  await waitForHealthy(port)
  console.log(`[daemon] Backend healthy on port ${port}`)
  return port
}

/** Kills the daemon process if running. */
export function killDaemon(): void {
  if (!daemonProcess) return

  console.log('[daemon] Stopping backend...')
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /pid ${daemonProcess.pid} /T /F`, { stdio: 'ignore' })
    } catch { /* already dead */ }
  } else {
    daemonProcess.kill('SIGTERM')
  }

  daemonProcess = null
  daemonPort = 0
}

/** Returns the port the daemon is listening on, or 0 if not running. */
export function getDaemonPort(): number {
  return daemonPort
}
