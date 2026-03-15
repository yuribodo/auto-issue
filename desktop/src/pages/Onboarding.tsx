import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getGitHubRepos, getConfig, saveConfig } from '../lib/ipc'
import type { GitHubRepo } from '../lib/types'

type Step = 'repos' | 'agent' | 'done'

const STEPS: { key: Step; label: string }[] = [
  { key: 'repos', label: 'Select Repos' },
  { key: 'agent', label: 'Configure Agent' },
  { key: 'done', label: 'All Set' },
]

const MODELS: Record<string, string[]> = {
  anthropic: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'],
}

export default function Onboarding() {
  const navigate = useNavigate()
  const [currentStep, setCurrentStep] = useState<Step>('repos')
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set())
  const [model, setModel] = useState('claude-sonnet-4-6')
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [reposLoading, setReposLoading] = useState(true)

  useEffect(() => {
    getGitHubRepos()
      .then((r) => {
        setRepos(r)
        setReposLoading(false)
      })
      .catch(() => setReposLoading(false))
  }, [])

  const stepIndex = STEPS.findIndex((s) => s.key === currentStep)

  const toggleRepo = (name: string) => {
    setSelectedRepos((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const provider = 'anthropic'

  return (
    <div style={styles.page}>
      {/* Progress bar */}
      <div style={styles.progress}>
        {STEPS.map((step, i) => (
          <div key={step.key} style={styles.stepRow}>
            <span
              style={{
                ...styles.stepDot,
                background: i <= stepIndex ? 'var(--accent)' : 'var(--border-mid)',
              }}
            />
            <span
              style={{
                ...styles.stepLabel,
                color: i <= stepIndex ? 'var(--fg)' : 'var(--fg-muted)',
              }}
            >
              {step.label}
            </span>
            {i < STEPS.length - 1 && <span style={styles.stepLine} />}
          </div>
        ))}
      </div>

      <div style={styles.card}>
        {/* Step: Select Repos */}
        {currentStep === 'repos' && (
          <>
            <h2 style={styles.title}>Select repositories to monitor</h2>
            <p style={styles.subtitle}>
              Auto-Issue will watch these repos for issues labeled <span style={styles.labelBadge}>auto-issue</span>
            </p>
            <div style={styles.repoList}>
              {reposLoading ? (
                <div style={styles.subtitle}>Loading repositories from GitHub...</div>
              ) : repos.map((repo) => (
                <div
                  key={repo.id}
                  style={{
                    ...styles.repoItem,
                    borderColor: selectedRepos.has(repo.full_name) ? 'var(--accent)' : 'var(--border-mid)',
                    background: selectedRepos.has(repo.full_name) ? 'var(--accent-flat)' : 'transparent',
                  }}
                  onClick={() => toggleRepo(repo.full_name)}
                >
                  <div style={styles.repoHeader}>
                    <span style={styles.repoCheckbox}>
                      {selectedRepos.has(repo.full_name) ? '◉' : '○'}
                    </span>
                    <span style={styles.repoName}>{repo.full_name}</span>
                    <span style={styles.repoLang}>{repo.language ?? ''}</span>
                  </div>
                  <div style={styles.repoDesc}>{repo.description ?? 'No description'}</div>
                </div>
              ))}
            </div>
            <div style={styles.actions}>
              <button
                style={{
                  ...styles.primaryBtn,
                  opacity: selectedRepos.size === 0 ? 0.4 : 1,
                }}
                onClick={() => setCurrentStep('agent')}
                disabled={selectedRepos.size === 0}
              >
                Continue ({selectedRepos.size} selected)
              </button>
            </div>
          </>
        )}

        {/* Step: Configure Agent */}
        {currentStep === 'agent' && (
          <>
            <h2 style={styles.title}>Configure default agent</h2>
            <p style={styles.subtitle}>
              Choose the default AI provider and model for new runs. You can change this per-run later.
            </p>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>PROVIDER</label>
              <div style={styles.providerGrid}>
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
                  CODEX (Soon)
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
                  GEMINI (Soon)
                </button>
              </div>
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>MODEL</label>
              <div style={styles.modelList}>
                {MODELS.anthropic.map((m) => (
                  <button
                    key={m}
                    style={{
                      ...styles.modelBtn,
                      borderColor: model === m ? 'var(--accent)' : 'var(--border-mid)',
                      color: model === m ? 'var(--accent)' : 'var(--fg)',
                      background: model === m ? 'var(--accent-flat)' : 'transparent',
                    }}
                    onClick={() => setModel(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div style={styles.actions}>
              <button style={styles.secondaryBtn} onClick={() => setCurrentStep('repos')}>
                Back
              </button>
              <button style={styles.primaryBtn} onClick={async () => {
                // Save monitored repos and default model to config
                const config = await getConfig()
                await saveConfig({
                  ...config,
                  monitored_repos: [...selectedRepos],
                  default_provider: 'anthropic',
                  default_model: model,
                })
                setCurrentStep('done')
              }}>
                Finish Setup
              </button>
            </div>
          </>
        )}

        {/* Step: Done */}
        {currentStep === 'done' && (
          <>
            <div style={styles.doneIcon}>&#10003;</div>
            <h2 style={styles.title}>You're all set!</h2>
            <p style={styles.subtitle}>
              Auto-Issue is now monitoring {selectedRepos.size} repositories using {provider}/{model}.
              Issues labeled <span style={styles.labelBadge}>auto-issue</span> will be automatically processed.
            </p>
            <button style={styles.primaryBtn} onClick={() => navigate('/dashboard')}>
              Go to Dashboard
            </button>
          </>
        )}
      </div>

    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    background: 'var(--bg)',
    padding: '40px 24px',
    gap: '32px',
  },
  progress: {
    display: 'flex',
    alignItems: 'center',
    gap: '0',
  },
  stepRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  stepDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
    transition: 'background 300ms ease',
  },
  stepLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    letterSpacing: '0.1em',
    whiteSpace: 'nowrap',
    transition: 'color 300ms ease',
  },
  stepLine: {
    display: 'inline-block',
    width: '40px',
    height: '1px',
    background: 'var(--border-mid)',
    margin: '0 8px',
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '20px',
    maxWidth: '520px',
    width: '100%',
  },
  title: {
    fontFamily: 'var(--font-mono)',
    fontSize: '18px',
    fontWeight: 600,
    color: 'var(--fg)',
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--fg-muted)',
    textAlign: 'center',
    lineHeight: '1.6',
  },
  labelBadge: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--accent)',
    background: 'var(--accent-flat)',
    border: '1px solid rgba(0,230,118,0.15)',
    borderRadius: '3px',
    padding: '1px 6px',
  },
  primaryBtn: {
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
    cursor: 'pointer',
    letterSpacing: '0.02em',
  },
  secondaryBtn: {
    padding: '10px 20px',
    background: 'transparent',
    color: 'var(--fg-muted)',
    border: '1px solid var(--border-mid)',
    borderRadius: '6px',
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    cursor: 'pointer',
    letterSpacing: '0.02em',
  },
  repoList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    width: '100%',
  },
  repoItem: {
    padding: '12px 14px',
    border: '1px solid',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 150ms ease',
  },
  repoHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '4px',
  },
  repoCheckbox: {
    fontFamily: 'var(--font-mono)',
    fontSize: '14px',
    color: 'var(--accent)',
    flexShrink: 0,
  },
  repoName: {
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    fontWeight: 500,
    color: 'var(--fg)',
    flex: 1,
  },
  repoLang: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    color: 'var(--fg-muted)',
    letterSpacing: '0.08em',
  },
  repoDesc: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--fg-muted)',
    marginLeft: '22px',
  },
  fieldGroup: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  fieldLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    letterSpacing: '0.12em',
    color: 'var(--fg-muted)',
  },
  providerGrid: {
    display: 'flex',
    gap: '8px',
  },
  providerBtn: {
    flex: 1,
    padding: '10px',
    border: '1px solid',
    borderRadius: '6px',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.1em',
    cursor: 'pointer',
    background: 'transparent',
    transition: 'all 150ms ease',
  },
  modelList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  modelBtn: {
    padding: '8px 12px',
    border: '1px solid',
    borderRadius: '4px',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    cursor: 'pointer',
    background: 'transparent',
    textAlign: 'left' as const,
    transition: 'all 150ms ease',
  },
  actions: {
    display: 'flex',
    gap: '10px',
    marginTop: '8px',
  },
  doneIcon: {
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    background: 'var(--accent-flat)',
    border: '2px solid var(--accent)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'var(--font-mono)',
    fontSize: '24px',
    color: 'var(--accent)',
  },
}
