export function ConnectionBanner({ fallback }: { fallback: boolean }) {
  if (!fallback) return null
  return (
    <div
      className="px-4 py-1.5 text-[11px]"
      style={{
        background: 'rgba(245,158,11,0.08)',
        borderBottom: '1px solid rgba(245,158,11,0.25)',
        color: '#fbbf24',
        fontFamily: 'var(--font-mono)',
      }}
    >
      Live updates paused. Refreshing every 5s.
    </div>
  )
}
