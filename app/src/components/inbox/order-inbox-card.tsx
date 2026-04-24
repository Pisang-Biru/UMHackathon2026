import type { InboxOrder } from '#/lib/inbox-logic'
import { formatOrderTotal } from '#/lib/order-logic'

interface OrderInboxCardProps {
  order: InboxOrder
  selected: boolean
  onClick: () => void
}

function relativeTime(date: Date | null): string {
  if (!date) return '—'
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

export function OrderInboxCard({ order, selected, onClick }: OrderInboxCardProps) {
  const unread = order.acknowledgedAt === null
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3 transition-colors flex items-start gap-2 border-b"
      style={{ background: selected ? '#1a1a1e' : 'transparent', borderColor: '#1a1a1e' }}
    >
      <div className="w-1.5 h-1.5 rounded-full mt-2 shrink-0" style={{ background: unread ? '#00c97a' : 'transparent' }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span
            className="text-[10px] px-1.5 py-0.5 rounded font-medium"
            style={{ background: 'rgba(0,201,122,0.12)', color: '#00a863', fontFamily: 'var(--font-mono)' }}
          >
            💰 sale
          </span>
          <span className="text-[10px]" style={{ color: '#555', fontFamily: 'var(--font-mono)' }}>
            {formatOrderTotal(order.totalAmount)}
          </span>
          <span className="text-[10px] ml-auto shrink-0" style={{ color: '#555', fontFamily: 'var(--font-mono)' }}>
            {relativeTime(order.paidAt)}
          </span>
        </div>
        <p className="text-[13px] truncate" style={{ color: unread ? '#e8e6e2' : '#888', fontWeight: unread ? 500 : 400 }}>
          {order.productName} × {order.qty} — {order.buyerName ?? 'Anonymous'}
        </p>
      </div>
    </button>
  )
}
