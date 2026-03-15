import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getGitHubRepos, createGitHubIssue, createRun, getGitHubIssues } from '../lib/ipc'
import type { Provider, GitHubRepo, GitHubIssue } from '../lib/types'

const MODELS: Record<string, string[]> = {
  anthropic: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'],
  openai: ['codex-mini-latest', 'gpt-5.4', 'gpt-5.3-codex'],
  gemini: ['gemini-3.1-pro', 'gemini-3.1-flash-lite'],
}

type IssueMode = 'create' | 'select'

export default function CreateRun() {
  const navigate = useNavigate()
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [reposLoading, setReposLoading] = useState(true)
  const [reposPage, setReposPage] = useState(1)
  const [hasMoreRepos, setHasMoreRepos] = useState(true)
  const [repoSearch, setRepoSearch] = useState('')

  const [selectedRepo, setSelectedRepo] = useState('')
  const [issueMode, setIssueMode] = useState<IssueMode>('create')
  
  // For creating new issue
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  
  // For selecting existing issue
  const [issues, setIssues] = useState<GitHubIssue[]>([])
  const [issuesLoading, setIssuesLoading] = useState(false)
  const [selectedIssue, setSelectedIssue] = useState<GitHubIssue | null>(null)
  const [issueSearch, setIssueSearch] = useState('')

  const [provider, setProvider] = useState<Provider>('anthropic')
  const [model, setModel] = useState('claude-sonnet-4-6')
  const [submitting, setSubmitting] = useState(false)

  // Reset model when provider changes
  useEffect(() => {
    setModel(MODELS[provider][0])
  }, [provider])

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

  // Load issues when repo is selected and mode is 'select'
  useEffect(() => {
    if (!selectedRepo || issueMode !== 'select') {
      setIssues([])
      setSelectedIssue(null)
      return
    }

    const loadIssues = async () => {
      setIssuesLoading(true)
      try {
        const [owner, repo] = selectedRepo.split('/')
        const allIssues = await getGitHubIssues(owner, repo)
        // Filter out issues with "Auto Issue" label (these are handled by the poller)
        const manualIssues = allIssues.filter(
          (issue) => !issue.labels.some((label) => label.name.toLowerCase() === 'auto issue')
        )
        setIssues(manualIssues)
      } catch (err) {
        console.error('Failed to load issues:', err)
      } finally {
        setIssuesLoading(false)
      }
    }

    loadIssues()
  }, [selectedRepo, issueMode])

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

  const handleSubmit = async () => {
    if (!selectedRepo) return
    
    setSubmitting(true)
    try {
      let issueNumber: number
      let issueTitle: string
      let issueBody: string

      if (issueMode === 'create') {
        // Create new issue
        if (!title.trim()) {
          setSubmitting(false)
          return
        }
        const [owner, repo] = selectedRepo.split('/')
        const issue = await createGitHubIssue(owner, repo, title.trim(), description)
        issueNumber = issue.number
        issueTitle = title.trim()
        issueBody = description
      } else {
        // Use existing issue
        if (!selectedIssue) {
          setSubmitting(false)
          return
        }
        issueNumber = selectedIssue.number
        issueTitle = selectedIssue.title
        issueBody = selectedIssue.body || ''
      }

      const run = await createRun({
        repo: selectedRepo,
        issue_number: issueNumber,
        issue_title: issueTitle,
        issue_body: issueBody,
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

  const filteredIssues = issueSearch
    ? issues.filter((i) => 
        i.title.toLowerCase().includes(issueSearch.toLowerCase()) ||
        i.number.toString().includes(issueSearch)
      )
    : issues

  const canSubmit = selectedRepo && (
    (issueMode === 'create' && title.trim()) || 
    (issueMode === 'select' && selectedIssue)
  ) && !submitting

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
                    onClick={() => {
                      setSelectedRepo(r.full_name)
                      setSelectedIssue(null)
                    }}
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

        {/* Issue Mode Selection */}
        {selectedRepo && (
          <div style={styles.field}>
            <label style={styles.label}>ISSUE SOURCE</label>
            <div style={styles.modeRow}>
              <button
                style={{
                  ...styles.modeBtn,
                  borderColor: issueMode === 'create' ? 'var(--accent)' : 'var(--border-mid)',
                  color: issueMode === 'create' ? 'var(--accent)' : 'var(--fg-muted)',
                  background: issueMode === 'create' ? 'var(--accent-flat)' : 'transparent',
                }}
                onClick={() => setIssueMode('create')}
              >
                Create New Issue
              </button>
              <button
                style={{
                  ...styles.modeBtn,
                  borderColor: issueMode === 'select' ? 'var(--accent)' : 'var(--border-mid)',
                  color: issueMode === 'select' ? 'var(--accent)' : 'var(--fg-muted)',
                  background: issueMode === 'select' ? 'var(--accent-flat)' : 'transparent',
                }}
                onClick={() => setIssueMode('select')}
              >
                Select Existing
              </button>
            </div>
          </div>
        )}

        {/* Create New Issue Form */}
        {selectedRepo && issueMode === 'create' && (
          <div style={styles.field}>
            <label style={styles.label}>ISSUE DETAILS</label>
            <input
              style={styles.searchInput}
              type="text"
              placeholder="Issue title..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <textarea
              style={{ ...styles.searchInput, height: 120, resize: 'vertical' }}
              placeholder="Issue description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        )}

        {/* Select Existing Issue */}
        {selectedRepo && issueMode === 'select' && (
          <div style={styles.field}>
            <label style={styles.label}>SELECT ISSUE</label>
            <input
              style={styles.searchInput}
              type="text"
              placeholder="Search issues..."
              value={issueSearch}
              onChange={(e) => setIssueSearch(e.target.value)}
            />
            {issuesLoading ? (
              <div style={styles.emptyMsg}>Loading issues...</div>
            ) : issues.length === 0 ? (
              <div style={styles.emptyMsg}>No issues found without 'Auto Issue' label</div>
            ) : (
              <div style={styles.issueList}>
                {filteredIssues.map((issue) => (
                  <button
                    key={issue.number}
                    style={{
                      ...styles.issueBtn,
                      borderColor: selectedIssue?.number === issue.number ? 'var(--accent)' : 'var(--border-mid)',
                      background: selectedIssue?.number === issue.number ? 'var(--accent-flat)' : 'transparent',
                    }}
                    onClick={() => setSelectedIssue(issue)}
                  >
                    <div style={styles.issueRow}>
                      <span style={styles.issueNum}>#{issue.number}</span>
                      <span style={styles.issueTitle}>{issue.title}</span>
                    </div>
                    {issue.labels.length > 0 && (
                      <div style={styles.issueLabelRow}>
                        {issue.labels.map((label) => (
                          <span
                            key={label.name}
                            style={{
                              ...styles.issueLabel,
                              borderColor: `#${label.color}`,
                              color: `#${label.color}`,
                            }}
                          >
                            {label.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Provider / Model */}
        {selectedRepo && (
          <div style={styles.field}>
            <label style={styles.label}>PROVIDER / MODEL</label>
            <div style={styles.providerRow}>
              <button
                style={{
                  ...styles.providerBtn,
                  borderColor: provider === 'anthropic' ? 'var(--accent)' : 'var(--border-mid)',
                  color: provider === 'anthropic' ? 'var(--accent)' : 'var(--fg-muted)',
                  background: provider === 'anthropic' ? 'var(--accent-flat)' : 'transparent',
                }}
                onClick={() => setProvider('anthropic')}
              >
                ANTHROPIC
              </button>
              <button
                style={{
                  ...styles.providerBtn,
                  borderColor: provider === 'openai' ? 'var(--accent)' : 'var(--border-mid)',
                  color: provider === 'openai' ? 'var(--accent)' : 'var(--fg-muted)',
                  background: provider === 'openai' ? 'var(--accent-flat)' : 'transparent',
                }}
                onClick={() => setProvider('openai')}
              >
                CODEX
              </button>
              <button
                style={{
                  ...styles.providerBtn,
                  borderColor: provider === 'gemini' ? 'var(--accent)' : 'var(--border-mid)',
                  color: provider === 'gemini' ? 'var(--accent)' : 'var(--fg-muted)',
                  background: provider === 'gemini' ? 'var(--accent-flat)' : 'transparent',
                }}
                onClick={() => setProvider('gemini')}
              >
                GEMINI
              </button>
            </div>
            <select
              style={styles.select}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              {MODELS[provider].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        )}
        
        {/* Summary & Submit */}
        {selectedRepo && (
          <div style={styles.summary}>
            <div style={styles.summaryLine}>
              <span style={styles.summaryLabel}>Repo:</span>
              <span style={styles.summaryValue}>{selectedRepo}</span>
            </div>
            <div style={styles.summaryLine}>
              <span style={styles.summaryLabel}>Mode:</span>
              <span style={styles.summaryValue}>
                {issueMode === 'create' ? 'Create New Issue' : 'Use Existing Issue'}
              </span>
            </div>
            <div style={styles.summaryLine}>
              <span style={styles.summaryLabel}>Issue:</span>
              <span style={styles.summaryValue}>
                {issueMode === 'create' 
                  ? (title || 'Untitled')
                  : (selectedIssue ? `#${selectedIssue.number} ${selectedIssue.title}` : 'None selected')
                }
              </span>
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
  modeRow: {
    display: 'flex',
    gap: '8px',
  },
  modeBtn: {
    flex: 1,
    padding: '10px 16px',
    border: '1px solid',
    borderRadius: '6px',
    cursor: 'pointer',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    fontWeight: 500,
    transition: 'all 150ms ease',
  },
  issueList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    maxHeight: '300px',
    overflowY: 'auto',
  },
  issueBtn: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '10px 14px',
    border: '1px solid',
    borderRadius: '6px',
    cursor: 'pointer',
    background: 'transparent',
    textAlign: 'left' as const,
    transition: 'all 150ms ease',
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
    color: 'var(--accent)',
    flexShrink: 0,
  },
  issueTitle: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--fg)',
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