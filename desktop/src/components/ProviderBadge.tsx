import type { Provider } from '../lib/types'

interface ProviderBadgeProps {
  provider: Provider
  model?: string
}

export default function ProviderBadge({ provider, model }: ProviderBadgeProps) {
  const label = model ? `[ ${provider} · ${model} ]` : `[ ${provider} ]`

  return (
    <span style={styles.badge}>{label}</span>
  )
}

const styles: Record<string, React.CSSProperties> = {
  badge: {
    display: 'inline-block',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    letterSpacing: '0.08em',
    padding: '2px 8px',
    borderRadius: '4px',
    background: 'var(--accent-flat)',
    border: '1px solid rgba(0,230,118,0.15)',
    color: 'var(--accent)',
    whiteSpace: 'nowrap',
  },
}
