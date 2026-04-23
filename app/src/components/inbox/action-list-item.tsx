import type { InboxAction } from '#/lib/inbox-logic'

interface ActionListItemProps {
  action: InboxAction
  selected: boolean
  onClick: () => void
}

function confidenceColor(conf: number): { bg: string; fg: string; label: string } {
  if (conf >= 0.9) return { bg: 'rgba(0,201,122,0.1)', fg: '#00a863', label: 'high' }
  if (conf >= 0.7) return { bg: 'rgba(245,158,11,0.1)', fg: '#f59e0b', label: 'med' }
  return { bg: 'rgba(239,68,68,0.1)', fg: '#ef4444', label: 'low' }
}

function relativeTime(date: Date): string {
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

export function ActionListItem({ action, selected, onClick }: ActionListItemProps) {
  const conf = confidenceColor(action.confidence)
  const isUnread = action.viewedAt === null
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3 transition-colors flex items-start gap-2 border-b"
      style={{
        background: selected ? '#1a1a1e' : 'transparent',
        borderColor: '#1a1a1e',
      }}
    >
      <div className="w-1.5 h-1.5 rounded-full mt-2 shrink-0" style={{ background: isUnread ? '#3b7ef8' : 'transparent' }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span
            className="text-[10px] px-1.5 py-0.5 rounded font-medium"
            style={{ background: conf.bg, color: conf.fg, fontFamily: 'var(--font-mono)' }}
          >
            {conf.label} · {action.confidence.toFixed(2)}
          </span>
          <span className="text-[10px] ml-auto shrink-0" style={{ color: '#555', fontFamily: 'var(--font-mono)' }}>
            {relativeTime(action.createdAt)}
          </span>
        </div>
        <p
          className="text-[13px] truncate"
          style={{ color: isUnread ? '#e8e6e2' : '#888', fontWeight: isUnread ? 500 : 400 }}
        >
          {action.customerMsg}
        </p>
      </div>
    </button>
  )
}
