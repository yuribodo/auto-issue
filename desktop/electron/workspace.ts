import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const userData = app.getPath('userData')
const reposDir = path.join(userData, 'repos')
const workspacesDir = path.join(userData, 'workspaces')

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/**
 * Clone the repo if it doesn't exist, otherwise fetch.
 * Returns the path to the local clone.
 */
export async function ensureClone(repo: string, token: string): Promise<string> {
  const [owner, name] = repo.split('/')
  const clonePath = path.join(reposDir, owner, name)
  const url = `https://github.com/${repo}.git`

  // Use extraHeader for auth so the token never leaks into .git/config
  const authArgs = token
    ? ['-c', `http.extraHeader=Authorization: Bearer ${token}`]
    : []

  if (fs.existsSync(path.join(clonePath, '.git'))) {
    await execFileAsync('git', [...authArgs, 'fetch', '--all'], { cwd: clonePath })
    return clonePath
  }

  ensureDir(path.dirname(clonePath))
  await execFileAsync('git', [...authArgs, 'clone', url, clonePath])
  return clonePath
}

/**
 * Create a git worktree for a specific run.
 * Returns the path to the worktree directory.
 */
export async function createWorktree(clonePath: string, runId: string): Promise<string> {
  const worktreePath = path.join(workspacesDir, runId)
  const branchName = `auto-issue/${runId}`

  ensureDir(workspacesDir)
  await execFileAsync('git', ['worktree', 'add', '-b', branchName, worktreePath, 'HEAD'], {
    cwd: clonePath,
  })
  return worktreePath
}

/**
 * Remove worktree and its branch after run completion.
 */
export async function cleanupWorktree(clonePath: string, runId: string): Promise<void> {
  const worktreePath = path.join(workspacesDir, runId)
  const branchName = `auto-issue/${runId}`

  try {
    await execFileAsync('git', ['worktree', 'remove', worktreePath, '--force'], {
      cwd: clonePath,
    })
  } catch {
    // worktree may already be removed
  }

  try {
    await execFileAsync('git', ['branch', '-D', branchName], {
      cwd: clonePath,
    })
  } catch {
    // branch may already be removed
  }
}
