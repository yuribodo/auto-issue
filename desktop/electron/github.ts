import type { GitHubUser, GitHubRepo, GitHubIssue } from './shared-types'

const BASE_URL = 'https://api.github.com'

async function githubFetch<T>(endpoint: string, token: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`GitHub API ${res.status}: ${res.statusText} — ${body}`)
  }

  return res.json() as Promise<T>
}

export async function getAuthenticatedUser(token: string): Promise<GitHubUser> {
  return githubFetch<GitHubUser>('/user', token)
}

export async function getUserRepos(
  token: string,
  page = 1,
  perPage = 30,
): Promise<GitHubRepo[]> {
  return githubFetch<GitHubRepo[]>(
    `/user/repos?sort=updated&type=all&per_page=${perPage}&page=${page}`,
    token,
  )
}

export async function getRepoIssues(
  token: string,
  owner: string,
  repo: string,
  page = 1,
  perPage = 30,
): Promise<GitHubIssue[]> {
  const items = await githubFetch<Array<GitHubIssue & { pull_request?: unknown }>>(
    `/repos/${owner}/${repo}/issues?state=open&per_page=${perPage}&page=${page}`,
    token,
  )
  // Filter out pull requests (GitHub API returns PRs in the issues endpoint)
  return items.filter((item) => !item.pull_request)
}

export async function getIssueDetail(
  token: string,
  owner: string,
  repo: string,
  number: number,
): Promise<GitHubIssue> {
  return githubFetch<GitHubIssue>(
    `/repos/${owner}/${repo}/issues/${number}`,
    token,
  )
}
