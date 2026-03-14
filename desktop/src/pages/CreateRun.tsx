import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MOCK_REPOSITORIES, MOCK_ISSUES, MOCK_MODELS } from '../lib/mocks'
import type { Provider, Issue } from '../lib/types'
import { createRun } from '../lib/ipc'

export default function CreateRun() {
  const navigate = useNavigate()
  const [repo, setRepo] = useState('')
  const [issue, setIssue] = useState<Issue | null>(null)
  const [provider, setProvider] = useState<Provider>('anthropic')
  const [model, setModel] = useState('claude-sonnet-4-6')
  const [submitting, setSubmitting] = useState(false)

  const monitoredRepos = MOCK_REPOSITORIES.filter((r) => r.is_monitored)
  const issues = repo ? (MOCK_ISSUES[repo] ?? []) : []

  const handleProviderChange = (p: Provider) => {
    setProvider(p)
    setModel(MOCK_MODELS[p][0])
  }

  const handleSubmit = async () => {
    if (!repo || !issue) return
    setSubmitting(true)
    try {
      const run = await createRun({
        repo,
        issue_number: issue.number,
        issue_title: issue.title,
        issue_body: issue.labels.join(', '), // best available from mock data
        provider,
        model,
      })
      navigate(`/run/${run.id}`)
    } catch (err) {
      console.error('Failed to create run:', err)
      setSubmitting(false)
    }
  }

  const canSubmit = repo && issue && !submitting

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={() => navigate('/dashboard')}>
          ← Back
        </button>
        <h1 style={styles.title}>New Run</h1>
        <p style={styles.subtitle}>Create a manual run for a specific issue</p>
      </div>

      <div style={styles.form}>
        {/* Repository */}
        <div style={styles.field}>
          <label style={styles.label}>REPOSITORY</label>
          <div style={styles.optionList}>
            {monitoredRepos.map((r) => (
              <button
                key={r.id}
                style={{
                  ...styles.optionBtn,
                  borderColor: repo === r.full_name ? 'var(--accent)' : 'var(--border-mid)',
                  color: repo === r.full_name ? 'var(--accent)' : 'var(--fg)',
                  background: repo === r.full_name ? 'var(--accent-flat)' : 'transparent',
                }}
                onClick={() => {
                  setRepo(r.full_name)
                  setIssue(null)
                }}
              >
                <span style={styles.optionName}>{r.full_name}</span>
                <span style={styles.optionMeta}>
                  {r.open_issues_count} issues · {r.language}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Issue */}
        {repo && (
          <div style={styles.field}>
            <label style={styles.label}>ISSUE</label>
            {issues.length === 0 ? (
              <div style={styles.emptyMsg}>No open issues in this repository</div>
            ) : (
              <div style={styles.optionList}>
                {issues.map((iss) => (
                  <button
                    key={iss.number}
                    style={{
                      ...styles.optionBtn,
                      borderColor: issue?.number === iss.number ? 'var(--accent)' : 'var(--border-mid)',
                      color: issue?.number === iss.number ? 'var(--accent)' : 'var(--fg)',
                      background: issue?.number === iss.number ? 'var(--accent-flat)' : 'transparent',
                    }}
                    onClick={() => setIssue(iss)}
                  >
                    <span style={styles.issueRow}>
                      <span style={styles.issueNum}>#{iss.number}</span>
                      <span style={styles.issueTitle}>{iss.title}</span>
                    </span>
                    <span style={styles.issueLabelRow}>
                      {iss.labels.map((l) => (
                        <span
                          key={l}
                          style={{
                            ...styles.issueLabel,
                            color: l === 'auto-issue' ? 'var(--accent)' : l === 'bug' ? 'var(--red)' : l === 'critical' ? 'var(--amber)' : 'var(--fg-muted)',
                            borderColor: l === 'auto-issue' ? 'rgba(0,230,118,0.3)' : l === 'bug' ? 'rgba(239,68,68,0.3)' : l === 'critical' ? 'rgba(255,171,0,0.3)' : 'var(--border-mid)',
                          }}
                        >
                          {l}
                        </span>
                      ))}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Provider / Model */}
        {repo && issue && (
          <div style={styles.field}>
            <label style={styles.label}>PROVIDER / MODEL</label>
            <div style={styles.providerRow}>
              {(['anthropic', 'openai', 'gemini'] as Provider[]).map((p) => (
                <button
                  key={p}
                  style={{
                    ...styles.providerBtn,
                    borderColor: provider === p ? 'var(--accent)' : 'var(--border-mid)',
                    color: provider === p ? 'var(--accent)' : 'var(--fg-muted)',
                    background: provider === p ? 'var(--accent-flat)' : 'transparent',
                  }}
                  onClick={() => handleProviderChange(p)}
                >
                  {p.toUpperCase()}
                </button>
              ))}
            </div>
            <select
              style={styles.select}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              {MOCK_MODELS[provider].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        )}

        {/* Summary & Submit */}
        {repo && issue && (
          <div style={styles.summary}>
            <div style={styles.summaryLine}>
              <span style={styles.summaryLabel}>Repo:</span>
              <span style={styles.summaryValue}>{repo}</span>
            </div>
            <div style={styles.summaryLine}>
              <span style={styles.summaryLabel}>Issue:</span>
              <span style={styles.summaryValue}>#{issue.number} — {issue.title}</span>
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
  optionList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
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
