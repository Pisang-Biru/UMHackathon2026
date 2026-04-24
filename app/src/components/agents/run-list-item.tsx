import type { InboxAction } from '#/lib/inbox-logic'

interface RunListItemProps {
  action: InboxAction
  selected: boolean
  onClick: () => void
}

const STATUS_COLORS: Record<string, { bg: string; fg: string; label: string }> = {
  PENDING: { bg: 'rgba(59,126,248,0.12)', fg: '#5b94f9', label: 'pending' },
  APPROVED: { bg: 'rgba(0,201,122,0.12)', fg: '#00a863', label: 'approved' },
  REJECTED: { bg: 'rgba(239,68,68,0.12)', fg: '#ef4444', label: 'rejected' },
  AUTO_SENT: { bg: 'rgba(167,139,250,0.12)', fg: '#a78bfa', label: 'auto-sent' },
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

export function RunListItem({ action, selected, onClick }: RunListItemProps) {
  const status = STATUS_COLORS[action.status] ?? STATUS_COLORS.PENDING
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3 transition-colors flex items-start gap-2 border-b"
      style={{ background: selected ? '#1a1a1e' : 'transparent', borderColor: '#1a1a1e' }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span
            className="text-[10px] px-1.5 py-0.5 rounded font-medium"
            style={{ background: status.bg, color: status.fg, fontFamily: 'var(--font-mono)' }}
          >
            {status.label}
          </span>
          <span className="text-[10px]" style={{ color: '#555', fontFamily: 'var(--font-mono)' }}>
            conf {action.confidence.toFixed(2)}
          </span>
          <span className="text-[10px] ml-auto shrink-0" style={{ color: '#555', fontFamily: 'var(--font-mono)' }}>
            {relativeTime(action.createdAt)}
          </span>
        </div>
        <p className="text-[13px] truncate" style={{ color: '#c8c5c0' }}>{action.customerMsg}</p>
      </div>
    </button>
  )
}
