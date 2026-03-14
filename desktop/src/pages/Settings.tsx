import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { MOCK_REPOSITORIES, MOCK_MODELS } from '../lib/mocks'
import { getConfig, saveConfig, testRun } from '../lib/ipc'
import type { Provider, SettingsData, Repository } from '../lib/types'

type Tab = 'repos' | 'agents' | 'notifications' | 'general'

const TABS: { key: Tab; label: string }[] = [
  { key: 'repos', label: 'REPOS' },
  { key: 'agents', label: 'AGENTS' },
  { key: 'notifications', label: 'NOTIFICATIONS' },
  { key: 'general', label: 'GENERAL' },
]

export default function Settings() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('repos')
  const [settings, setSettings] = useState<SettingsData | null>(null)
  const [repos, setRepos] = useState<Repository[]>(MOCK_REPOSITORIES)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    getConfig().then(setSettings)
  }, [])

  const handleSave = async () => {
    if (!settings) return
    await saveConfig(settings)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (!settings) {
    return (
      <div style={styles.page}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--fg-muted)', padding: '48px 0', textAlign: 'center' as const }}>
          Loading settings...
        </div>
      </div>
    )
  }

  const toggleRepo = (id: string) => {
    setRepos((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, is_monitored: !r.is_monitored } : r
      )
    )
  }

  const updateSettings = (updates: Partial<SettingsData>) => {
    setSettings((prev) => prev ? { ...prev, ...updates } : prev)
  }

  const handleProviderChange = (p: Provider) => {
    updateSettings({
      default_provider: p,
      default_model: MOCK_MODELS[p][0],
    })
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Settings</h1>
        <button
          style={{
            ...styles.saveBtn,
            background: saved ? 'rgba(0,230,118,0.2)' : 'var(--accent)',
            color: saved ? 'var(--accent)' : '#0a0a0a',
          }}
          onClick={handleSave}
        >
          {saved ? 'Saved!' : 'Save Changes'}
        </button>
      </div>

      {/* Tabs */}
      <div style={styles.tabs}>
        {TABS.map((t) => (
          <button
            key={t.key}
            style={{
              ...styles.tab,
              color: tab === t.key ? 'var(--accent)' : 'var(--fg-muted)',
              borderBottomColor: tab === t.key ? 'var(--accent)' : 'transparent',
            }}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={styles.content}>
        {/* Repos Tab */}
        {tab === 'repos' && (
          <div style={styles.section}>
            <p style={styles.sectionDesc}>
              Manage which repositories Auto-Issue monitors for labeled issues.
            </p>
            <div style={styles.repoList}>
              {repos.map((repo) => (
                <div key={repo.id} style={styles.repoRow}>
                  <div style={styles.repoInfo}>
                    <span style={styles.repoName}>{repo.full_name}</span>
                    <span style={styles.repoDesc}>{repo.description}</span>
                  </div>
                  <div style={styles.repoRight}>
                    <span style={styles.repoLang}>{repo.language}</span>
                    <span style={styles.repoIssues}>{repo.open_issues_count} issues</span>
                    <button
                      style={{
                        ...styles.toggleBtn,
                        background: repo.is_monitored ? 'var(--accent)' : 'var(--bg3)',
                      }}
                      onClick={() => toggleRepo(repo.id)}
                    >
                      <span
                        style={{
                          ...styles.toggleDot,
                          transform: repo.is_monitored ? 'translateX(14px)' : 'translateX(0)',
                        }}
                      />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Agents Tab */}
        {tab === 'agents' && (
          <div style={styles.section}>
            <p style={styles.sectionDesc}>
              Configure the default AI provider and model used for new runs.
            </p>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>DEFAULT PROVIDER</label>
              <div style={styles.providerGrid}>
                {(['anthropic', 'openai', 'gemini'] as Provider[]).map((p) => (
                  <button
                    key={p}
                    style={{
                      ...styles.providerBtn,
                      borderColor: settings.default_provider === p ? 'var(--accent)' : 'var(--border-mid)',
                      color: settings.default_provider === p ? 'var(--accent)' : 'var(--fg-muted)',
                      background: settings.default_provider === p ? 'var(--accent-flat)' : 'transparent',
                    }}
                    onClick={() => handleProviderChange(p)}
                  >
                    {p.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>DEFAULT MODEL</label>
              <select
                style={styles.selectInput}
                value={settings.default_model}
                onChange={(e) => updateSettings({ default_model: e.target.value })}
              >
                {MOCK_MODELS[settings.default_provider].map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>API KEYS</label>
              {(['openai', 'anthropic', 'gemini'] as Provider[]).map((p) => (
                <div key={p} style={styles.keyRow}>
                  <span style={styles.keyLabel}>{p.toUpperCase()}</span>
                  <input
                    style={styles.keyInput}
                    type="password"
                    value={settings.api_keys[p]}
                    onChange={(e) =>
                      updateSettings({
                        api_keys: { ...settings.api_keys, [p]: e.target.value },
                      })
                    }
                  />
                </div>
              ))}
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>GITHUB TOKEN</label>
              <p style={styles.sectionDesc}>
                Personal access token used to clone private repositories.
              </p>
              <input
                style={styles.keyInput}
                type="password"
                placeholder="ghp_..."
                value={settings.github_token}
                onChange={(e) => updateSettings({ github_token: e.target.value })}
              />
            </div>

            <div style={styles.testSection}>
              <div style={styles.testHeader}>
                <label style={styles.fieldLabel}>TEST AGENT</label>
                <p style={styles.sectionDesc}>
                  Run a quick test to verify the CLI is installed and your API key works.
                  Sends a simple prompt and streams the output in the terminal.
                </p>
              </div>
              <button
                style={{
                  ...styles.testBtn,
                  opacity: testing ? 0.6 : 1,
                  cursor: testing ? 'not-allowed' : 'pointer',
                }}
                disabled={testing}
                onClick={async () => {
                  setTesting(true)
                  try {
                    const run = await testRun(settings.default_provider)
                    navigate(`/run/${run.id}`)
                  } catch (err) {
                    console.error('Test run failed:', err)
                    setTesting(false)
                  }
                }}
              >
                {testing ? (
                  <>
                    <span style={styles.spinner} />
                    Starting...
                  </>
                ) : (
                  <>Test {settings.default_provider.toUpperCase()} Agent</>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Notifications Tab */}
        {tab === 'notifications' && (
          <div style={styles.section}>
            <p style={styles.sectionDesc}>
              Configure which events trigger native OS notifications.
            </p>
            <div style={styles.notifList}>
              {[
                { key: 'approval_needed' as const, label: 'Approval Needed', desc: 'When a run finishes and needs your review' },
                { key: 'run_failed' as const, label: 'Run Failed', desc: 'When a run fails due to errors or test failures' },
                { key: 'pr_opened' as const, label: 'PR Opened', desc: 'When a pull request is successfully created' },
              ].map((item) => (
                <div key={item.key} style={styles.notifRow}>
                  <div style={styles.notifInfo}>
                    <span style={styles.notifLabel}>{item.label}</span>
                    <span style={styles.notifDesc}>{item.desc}</span>
                  </div>
                  <button
                    style={{
                      ...styles.toggleBtn,
                      background: settings.notifications[item.key] ? 'var(--accent)' : 'var(--bg3)',
                    }}
                    onClick={() =>
                      updateSettings({
                        notifications: {
                          ...settings.notifications,
                          [item.key]: !settings.notifications[item.key],
                        },
                      })
                    }
                  >
                    <span
                      style={{
                        ...styles.toggleDot,
                        transform: settings.notifications[item.key] ? 'translateX(14px)' : 'translateX(0)',
                      }}
                    />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* General Tab */}
        {tab === 'general' && (
          <div style={styles.section}>
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>THEME</label>
              <div style={styles.themeBox}>
                <span style={styles.themeName}>Dark</span>
                <span style={styles.themeNote}>Only dark mode is available in this version</span>
              </div>
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>POLLING INTERVAL</label>
              <div style={styles.pollingRow}>
                <input
                  type="range"
                  min={1}
                  max={30}
                  value={settings.polling_interval}
                  onChange={(e) => updateSettings({ polling_interval: Number(e.target.value) })}
                  style={styles.slider}
                />
                <span style={styles.pollingValue}>{settings.polling_interval}s</span>
              </div>
              <span style={styles.pollingNote}>
                How often the dashboard checks for run updates
              </span>
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>APP INFO</label>
              <div style={styles.infoGrid}>
                <span style={styles.infoLabel}>Version</span>
                <span style={styles.infoValue}>0.2.0</span>
                <span style={styles.infoLabel}>Electron</span>
                <span style={styles.infoValue}>33.2.0</span>
                <span style={styles.infoLabel}>React</span>
                <span style={styles.infoValue}>18.3.1</span>
              </div>
            </div>
          </div>
        )}
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
    gap: '20px',
    overflowY: 'auto',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontFamily: 'var(--font-mono)',
    fontSize: '20px',
    fontWeight: 600,
    color: 'var(--fg)',
  },
  saveBtn: {
    padding: '8px 20px',
    border: 'none',
    borderRadius: '6px',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 200ms ease',
  },
  tabs: {
    display: 'flex',
    gap: '0',
    borderBottom: '1px solid var(--border-mid)',
  },
  tab: {
    padding: '10px 16px',
    background: 'none',
    border: 'none',
    borderBottom: '2px solid',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    letterSpacing: '0.12em',
    cursor: 'pointer',
    transition: 'all 150ms ease',
  },
  content: {
    flex: 1,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    maxWidth: '600px',
  },
  sectionDesc: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--fg-muted)',
    lineHeight: '1.6',
  },
  repoList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  repoRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 14px',
    border: '1px solid var(--border-mid)',
    borderRadius: '6px',
    gap: '16px',
  },
  repoInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    flex: 1,
    minWidth: 0,
  },
  repoName: {
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    fontWeight: 500,
    color: 'var(--fg)',
  },
  repoDesc: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    color: 'var(--fg-muted)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  repoRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexShrink: 0,
  },
  repoLang: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    color: 'var(--fg-muted)',
    letterSpacing: '0.06em',
  },
  repoIssues: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    color: 'var(--fg-muted)',
  },
  toggleBtn: {
    width: '32px',
    height: '18px',
    borderRadius: '9px',
    border: 'none',
    padding: '2px',
    cursor: 'pointer',
    position: 'relative',
    transition: 'background 200ms ease',
  },
  toggleDot: {
    display: 'block',
    width: '14px',
    height: '14px',
    borderRadius: '50%',
    background: '#fff',
    transition: 'transform 200ms ease',
  },
  fieldGroup: {
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
  selectInput: {
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
  keyRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  keyLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--fg-muted)',
    width: '90px',
    letterSpacing: '0.08em',
    flexShrink: 0,
  },
  keyInput: {
    flex: 1,
    padding: '8px 12px',
    background: 'var(--bg2)',
    color: 'var(--fg)',
    border: '1px solid var(--border-mid)',
    borderRadius: '4px',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    outline: 'none',
  },
  notifList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  notifRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px',
    border: '1px solid var(--border-mid)',
    borderRadius: '6px',
  },
  notifInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  notifLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    fontWeight: 500,
    color: 'var(--fg)',
  },
  notifDesc: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    color: 'var(--fg-muted)',
  },
  themeBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '12px 14px',
    border: '1px solid var(--accent)',
    borderRadius: '6px',
    background: 'var(--accent-flat)',
  },
  themeName: {
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    fontWeight: 500,
    color: 'var(--accent)',
  },
  themeNote: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    color: 'var(--fg-muted)',
  },
  pollingRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  slider: {
    flex: 1,
    accentColor: 'var(--accent)',
  },
  pollingValue: {
    fontFamily: 'var(--font-mono)',
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--fg)',
    minWidth: '36px',
  },
  pollingNote: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    color: 'var(--fg-muted)',
  },
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: '100px 1fr',
    gap: '6px',
    padding: '12px 14px',
    background: 'var(--bg2)',
    border: '1px solid var(--border-mid)',
    borderRadius: '6px',
  },
  testSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    padding: '16px',
    border: '1px dashed var(--border-mid)',
    borderRadius: '8px',
    background: 'var(--bg2)',
  },
  testHeader: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  testBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '10px 20px',
    background: 'var(--accent)',
    color: '#0a0a0a',
    border: 'none',
    borderRadius: '6px',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    fontWeight: 600,
    letterSpacing: '0.06em',
    transition: 'all 150ms ease',
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
  infoLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--fg-muted)',
  },
  infoValue: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--fg)',
  },
}
