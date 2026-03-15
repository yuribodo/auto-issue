import path from 'node:path'
import fs from 'node:fs'
import { app } from 'electron'

import { getRepoIssues } from './github'
import { getAuthToken } from './auth'
import { loadConfig } from './store'
import { backendCreateRun, backendStartRun } from './backend-client'
import type { GitHubIssue } from './shared-types'

interface PollerConfig {
  enabled: boolean
  intervalSeconds: number
  monitoredRepos: string[]
}

interface TrackedIssue {
  repo: string
  issueNumber: number
  importedAt: string
  backendIssueId: string
  title: string
}

const userData = app.getPath('userData')
const trackedFile = path.join(userData, 'tracked-issues.json')

let timer: NodeJS.Timeout | null = null

export function startPoller(config: PollerConfig, token: string): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }

  if (!config.enabled || config.monitoredRepos.length === 0) {
    console.log('[Poller] Poller disabled or no monitored repositories')
    return
  }

  void runPoll(token, config)
  timer = setInterval(() => {
    const liveToken = token || getAuthToken()
    const liveSettings = loadConfig()
    const liveConfig: PollerConfig = {
      enabled: liveSettings.polling_enabled ?? config.enabled,
      intervalSeconds: liveSettings.polling_interval || config.intervalSeconds,
      monitoredRepos: liveSettings.monitored_repos || config.monitoredRepos,
    }

    if (!liveToken) {
      console.warn('[Poller] Skipping poll: missing auth token')
      return
    }

    void runPoll(liveToken, liveConfig)
  }, config.intervalSeconds * 1000)
}

export function stopPoller(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

export function updatePollerConfig(config: PollerConfig, token: string): void {
  stopPoller()
  startPoller(config, token)
}

async function runPoll(token: string, config: PollerConfig): Promise<void> {
  console.log('[Poller] Starting poll at', new Date().toISOString())

  const tracked = loadTrackedIssues()

  for (const repo of config.monitoredRepos) {
    try {
      const [owner, repoName] = repo.split('/')
      if (!owner || !repoName) {
        console.warn(`[Poller] Invalid repository format: ${repo}`)
        continue
      }

      const issues = await getRepoIssues(token, owner, repoName)

      const autoIssues = issues.filter((issue) =>
        issue.labels.some((label) => label.name.toLowerCase() === 'auto issue'),
      )

      for (const issue of autoIssues) {
        const alreadyTracked = tracked.some(
          (item) => item.repo === repo && item.issueNumber === issue.number,
        )

        if (!alreadyTracked) {
          await importIssue(issue, repo, config, tracked)
        }
      }
    } catch (err) {
      console.error(`[Poller] Failed to poll ${repo}:`, err)
    }
  }

  saveTrackedIssues(tracked)
  console.log('[Poller] Poll completed')
}

async function importIssue(
  githubIssue: GitHubIssue,
  repo: string,
  _config: PollerConfig,
  tracked: TrackedIssue[],
): Promise<void> {
  console.log(`[Poller] Importing issue #${githubIssue.number} from ${repo}`)

  const [owner] = repo.split('/')

  try {
    const backendIssue = await backendCreateRun({
      repo,
      issue_number: githubIssue.number,
      issue_title: githubIssue.title,
      issue_body: githubIssue.body || '',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    }, owner)

    tracked.push({
      repo,
      issueNumber: githubIssue.number,
      importedAt: new Date().toISOString(),
      backendIssueId: backendIssue.id,
      title: githubIssue.title,
    })

    // Always auto-start imported issues
    await backendStartRun(backendIssue.id)
    console.log(`[Poller] Auto-started issue ${backendIssue.id}`)
  } catch (err) {
    console.error(`[Poller] Failed to import issue #${githubIssue.number}:`, err)
  }
}

function loadTrackedIssues(): TrackedIssue[] {
  try {
    if (fs.existsSync(trackedFile)) {
      const parsed = JSON.parse(fs.readFileSync(trackedFile, 'utf-8')) as unknown
      if (Array.isArray(parsed)) {
        return parsed as TrackedIssue[]
      }
    }
  } catch (err) {
    console.error('[Poller] Failed to load tracked issues:', err)
  }

  return []
}

function saveTrackedIssues(tracked: TrackedIssue[]): void {
  try {
    fs.mkdirSync(path.dirname(trackedFile), { recursive: true })
    fs.writeFileSync(trackedFile, JSON.stringify(tracked, null, 2), 'utf-8')
  } catch (err) {
    console.error('[Poller] Failed to save tracked issues:', err)
  }
}

export async function syncNow(token: string): Promise<void> {
  const settings = loadConfig()
  const config: PollerConfig = {
    enabled: settings.polling_enabled !== false,
    intervalSeconds: settings.polling_interval || 5,
    monitoredRepos: settings.monitored_repos || []
  }

  if (!config.enabled) {
    throw new Error('Polling is disabled. Enable it in Settings > Repos.')
  }
  if (config.monitoredRepos.length === 0) {
    throw new Error('No repositories configured for monitoring. Go to Settings > Repos and enable at least one repository.')
  }
  
  await runPoll(token, config)
}
