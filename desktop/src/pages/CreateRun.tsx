import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getGitHubRepos, getGitHubIssues, createRun } from '../lib/ipc'
import type { Provider, GitHubRepo, GitHubIssue } from '../lib/types'

const MODELS: Record<string, string[]> = {
  anthropic: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'],
}

export default function CreateRun() {
  const navigate = useNavigate()
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [reposLoading, setReposLoading] = useState(true)
  const [reposPage, setReposPage] = useState(1)
  const [hasMoreRepos, setHasMoreRepos] = useState(true)
  const [repoSearch, setRepoSearch] = useState('')

  const [selectedRepo, setSelectedRepo] = useState('')
  const [issues, setIssues] = useState<GitHubIssue[]>([])
  const [issuesLoading, setIssuesLoading] = useState(false)
  const [issuesPage, setIssuesPage] = useState(1)
  const [hasMoreIssues, setHasMoreIssues] = useState(true)
  const [selectedIssue, setSelectedIssue] = useState<GitHubIssue | null>(null)

  const [provider] = useState<Provider>('anthropic')
  const [model, setModel] = useState('claude-sonnet-4-6')
  const [submitting, setSubmitting] = useState(false)

  // Load repos
  useEffect(() => {
    setReposLoading(true)
    getGitHubRepos(1)
      .then((r) => {
        setRepos(r)
        setHasMoreRepos(r.length === 30)
        setReposLoading(false)
      })
      .catch((err) => {
        console.error('Failed to load repos:', err)
        setReposLoading(false)
      })
  }, [])

  const loadMoreRepos = async () => {
    const nextPage = reposPage + 1
    setReposPage(nextPage)
    try {
      const more = await getGitHubRepos(nextPage)
      setRepos((prev) => [...prev, ...more])
      setHasMoreRepos(more.length === 30)
    } catch (err) {
      console.error('Failed to load more repos:', err)
    }
  }

  // Load issues when repo is selected
  useEffect(() => {
    if (!selectedRepo) return
    const [owner, repo] = selectedRepo.split('/')
    setIssuesLoading(true)
    setIssues([])
    setIssuesPage(1)
    setSelectedIssue(null)
    getGitHubIssues(owner, repo, 1)
      .then((i) => {
        setIssues(i)
        setHasMoreIssues(i.length === 30)
        setIssuesLoading(false)
      })
      .catch((err) => {
        console.error('Failed to load issues:', err)
        setIssuesLoading(false)
      })
  }, [selectedRepo])

  const loadMoreIssues = async () => {
    const [owner, repo] = selectedRepo.split('/')
    const nextPage = issuesPage + 1
    setIssuesPage(nextPage)
    try {
      const more = await getGitHubIssues(owner, repo, nextPage)
      setIssues((prev) => [...prev, ...more])
      setHasMoreIssues(more.length === 30)
    } catch (err) {
      console.error('Failed to load more issues:', err)
    }
  }

  const handleSubmit = async () => {
    if (!selectedRepo || !selectedIssue) return
    setSubmitting(true)
    try {
      const run = await createRun({
        repo: selectedRepo,
        issue_number: selectedIssue.number,
        issue_title: selectedIssue.title,
        issue_body: selectedIssue.body ?? '',
        provider,
        model,
      })
      navigate(`/run/${run.id}`)
    } catch (err) {
      console.error('Failed to create run:', err)
      setSubmitting(false)
    }
  }

  const filteredRepos = repoSearch
    ? repos.filter((r) => r.full_name.toLowerCase().includes(repoSearch.toLowerCase()))
    : repos

  const canSubmit = selectedRepo && selectedIssue && !submitting

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={() => navigate('/dashboard')}>
          &larr; Back
        </button>
        <h1 style={styles.title}>New Run</h1>
        <p style={styles.subtitle}>Create a manual run for a specific issue</p>
      </div>

      <div style={styles.form}>
        {/* Repository */}
        <div style={styles.field}>
          <label style={styles.label}>REPOSITORY</label>
          <input
            style={styles.searchInput}
            type="text"
            placeholder="Search repos..."
            value={repoSearch}
            onChange={(e) => setRepoSearch(e.target.value)}
          />
          {reposLoading ? (
            <div style={styles.emptyMsg}>Loading repositories...</div>
          ) : (
            <>
              <div style={styles.optionList}>
                {filteredRepos.map((r) => (
                  <button
                    key={r.id}
                    style={{
                      ...styles.optionBtn,
                      borderColor: selectedRepo === r.full_name ? 'var(--accent)' : 'var(--border-mid)',
                      color: selectedRepo === r.full_name ? 'var(--accent)' : 'var(--fg)',
                      background: selectedRepo === r.full_name ? 'var(--accent-flat)' : 'transparent',
                    }}
                    onClick={() => setSelectedRepo(r.full_name)}
                  >
                    <span style={styles.optionName}>
                      {r.full_name}
                      {r.private && <span style={styles.privateBadge}>PRIVATE</span>}
                    </span>
                    <span style={styles.optionMeta}>
                      {r.open_issues_count} issues{r.language ? ` · ${r.language}` : ''}
                    </span>
                  </button>
                ))}
              </div>
              {hasMoreRepos && !repoSearch && (
                <button style={styles.loadMoreBtn} onClick={loadMoreRepos}>
                  Load more repos
                </button>
              )}
            </>
          )}
        </div>

        {/* Issue */}
        {selectedRepo && (
          <div style={styles.field}>
            <label style={styles.label}>ISSUE</label>
            {issuesLoading ? (
              <div style={styles.emptyMsg}>Loading issues...</div>
            ) : issues.length === 0 ? (
              <div style={styles.emptyMsg}>No open issues in this repository</div>
            ) : (
              <>
                <div style={styles.optionList}>
                  {issues.map((iss) => (
                    <button
                      key={iss.number}
                      style={{
                        ...styles.optionBtn,
                        borderColor: selectedIssue?.number === iss.number ? 'var(--accent)' : 'var(--border-mid)',
                        color: selectedIssue?.number === iss.number ? 'var(--accent)' : 'var(--fg)',
                        background: selectedIssue?.number === iss.number ? 'var(--accent-flat)' : 'transparent',
                      }}
                      onClick={() => setSelectedIssue(iss)}
                    >
                      <span style={styles.issueRow}>
                        <span style={styles.issueNum}>#{iss.number}</span>
                        <span style={styles.issueTitle}>{iss.title}</span>
                      </span>
                      <span style={styles.issueLabelRow}>
                        {iss.labels.map((l) => (
                          <span
                            key={l.name}
                            style={{
                              ...styles.issueLabel,
                              color: `#${l.color}`,
                              borderColor: `#${l.color}40`,
                            }}
                          >
                            {l.name}
                          </span>
                        ))}
                      </span>
                    </button>
                  ))}
                </div>
                {hasMoreIssues && (
                  <button style={styles.loadMoreBtn} onClick={loadMoreIssues}>
                    Load more issues
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* Provider / Model */}
        {selectedRepo && selectedIssue && (
          <div style={styles.field}>
            <label style={styles.label}>PROVIDER / MODEL</label>
            <div style={styles.providerRow}>
              <button
                style={{
                  ...styles.providerBtn,
                  borderColor: 'var(--accent)',
                  color: 'var(--accent)',
                  background: 'var(--accent-flat)',
                }}
              >
                ANTHROPIC
              </button>
              <button
                style={{
                  ...styles.providerBtn,
                  borderColor: 'var(--border-mid)',
                  color: 'var(--fg-muted)',
                  opacity: 0.5,
                  cursor: 'not-allowed',
                }}
                disabled
              >
                CODEX <span style={styles.comingSoon}>Soon</span>
              </button>
              <button
                style={{
                  ...styles.providerBtn,
                  borderColor: 'var(--border-mid)',
                  color: 'var(--fg-muted)',
                  opacity: 0.5,
                  cursor: 'not-allowed',
                }}
                disabled
              >
                GEMINI <span style={styles.comingSoon}>Soon</span>
              </button>
            </div>
            <select
              style={styles.select}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              {MODELS.anthropic.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        )}

        {/* Summary & Submit */}
        {selectedRepo && selectedIssue && (
          <div style={styles.summary}>
            <div style={styles.summaryLine}>
              <span style={styles.summaryLabel}>Repo:</span>
              <span style={styles.summaryValue}>{selectedRepo}</span>
            </div>
            <div style={styles.summaryLine}>
              <span style={styles.summaryLabel}>Issue:</span>
              <span style={styles.summaryValue}>#{selectedIssue.number} &mdash; {selectedIssue.title}</span>
            </div>
            <div style={styles.summaryLine}>
              <span style={styles.summaryLabel}>Agent:</span>
              <span style={styles.summaryValue}>{provider} / {model}</span>
            </div>
          </div>
        )}

        <div style={styles.actions}>
          <button style={styles.cancelBtn} onClick={() => navigate('/dashboard')}>
            Cancel
          </button>
          <button
            style={{
              ...styles.submitBtn,
              opacity: canSubmit ? 1 : 0.4,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {submitting ? (
              <>
                <span style={styles.spinner} />
                Starting...
              </>
            ) : (
              'Start Run'
            )}
          </button>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    background: 'var(--bg)',
    padding: '24px',
    overflowY: 'auto',
  },
  header: {
    marginBottom: '24px',
  },
  backBtn: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--fg-muted)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    marginBottom: '12px',
    letterSpacing: '0.06em',
  },
  title: {
    fontFamily: 'var(--font-mono)',
    fontSize: '20px',
    fontWeight: 600,
    color: 'var(--fg)',
    marginBottom: '6px',
  },
  subtitle: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--fg-muted)',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
    maxWidth: '600px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  label: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    letterSpacing: '0.12em',
    color: 'var(--fg-muted)',
  },
  searchInput: {
    padding: '8px 12px',
    background: 'var(--bg2)',
    color: 'var(--fg)',
    border: '1px solid var(--border-mid)',
    borderRadius: '4px',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    outline: 'none',
  },
  optionList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    maxHeight: '300px',
    overflowY: 'auto',
  },
  optionBtn: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '10px 14px',
    border: '1px solid',
    borderRadius: '6px',
    cursor: 'pointer',
    background: 'transparent',
    textAlign: 'left' as const,
    transition: 'all 150ms ease',
  },
  optionName: {
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    fontWeight: 500,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  privateBadge: {
    fontFamily: 'var(--font-mono)',
    fontSize: '9px',
    letterSpacing: '0.08em',
    padding: '1px 5px',
    border: '1px solid var(--border-mid)',
    borderRadius: '3px',
    color: 'var(--fg-muted)',
  },
  optionMeta: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    color: 'var(--fg-muted)',
    letterSpacing: '0.06em',
  },
  emptyMsg: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--fg-muted)',
    padding: '16px 0',
  },
  loadMoreBtn: {
    padding: '8px',
    background: 'transparent',
    color: 'var(--accent)',
    border: '1px dashed var(--border-mid)',
    borderRadius: '4px',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    cursor: 'pointer',
    letterSpacing: '0.06em',
  },
  issueRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  issueNum: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    fontWeight: 600,
    flexShrink: 0,
  },
  issueTitle: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  issueLabelRow: {
    display: 'flex',
    gap: '4px',
    flexWrap: 'wrap',
  },
  issueLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: '9px',
    letterSpacing: '0.08em',
    padding: '1px 5px',
    border: '1px solid',
    borderRadius: '3px',
  },
  providerRow: {
    display: 'flex',
    gap: '8px',
  },
  providerBtn: {
    flex: 1,
    padding: '8px',
    border: '1px solid',
    borderRadius: '4px',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.1em',
    cursor: 'pointer',
    background: 'transparent',
    transition: 'all 150ms ease',
  },
  comingSoon: {
    fontSize: '8px',
    opacity: 0.6,
    marginLeft: '4px',
  },
  select: {
    padding: '8px 12px',
    background: 'var(--bg2)',
    color: 'var(--fg)',
    border: '1px solid var(--border-mid)',
    borderRadius: '4px',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    cursor: 'pointer',
    outline: 'none',
  },
  summary: {
    padding: '14px',
    background: 'var(--bg2)',
    border: '1px solid var(--border-mid)',
    borderRadius: '6px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  summaryLine: {
    display: 'flex',
    gap: '8px',
  },
  summaryLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--fg-muted)',
    width: '50px',
    flexShrink: 0,
  },
  summaryValue: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--fg)',
  },
  actions: {
    display: 'flex',
    gap: '10px',
    paddingTop: '8px',
  },
  cancelBtn: {
    padding: '10px 20px',
    background: 'transparent',
    color: 'var(--fg-muted)',
    border: '1px solid var(--border-mid)',
    borderRadius: '6px',
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    cursor: 'pointer',
  },
  submitBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 24px',
    background: 'var(--accent)',
    color: '#0a0a0a',
    border: 'none',
    borderRadius: '6px',
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    fontWeight: 600,
  },
  spinner: {
    display: 'inline-block',
    width: '14px',
    height: '14px',
    border: '2px solid transparent',
    borderTopColor: 'currentColor',
    borderRadius: '50%',
    animation: 'spin 0.6s linear infinite',
  },
}
