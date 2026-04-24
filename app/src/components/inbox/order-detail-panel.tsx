import type { InboxOrder } from '#/lib/inbox-logic'
import { formatOrderTotal } from '#/lib/order-logic'

interface OrderDetailPanelProps {
  order: InboxOrder | null
}

function label(t: string) {
  return (
    <span className="text-[10px] uppercase tracking-[0.14em] font-medium" style={{ color: '#555', fontFamily: 'var(--font-mono)' }}>
      {t}
    </span>
  )
}

export function OrderDetailPanel({ order }: OrderDetailPanelProps) {
  if (!order) {
    return (
      <div className="w-[480px] shrink-0 flex items-center justify-center" style={{ background: '#0c0c0f', borderLeft: '1px solid #1a1a1e', color: '#444' }}>
        <p className="text-[12px]" style={{ fontFamily: 'var(--font-mono)' }}>Select an item to review</p>
      </div>
    )
  }

  return (
    <aside
      className="w-[480px] shrink-0 flex flex-col h-full overflow-auto"
      style={{ background: '#0c0c0f', borderLeft: '1px solid #1a1a1e' }}
    >
      <div className="px-6 py-5 border-b" style={{ borderColor: '#1a1a1e' }}>
        <p className="text-[9px] uppercase tracking-[0.2em] mb-1" style={{ color: '#444', fontFamily: 'var(--font-mono)' }}>
          Sale
        </p>
        <h2 className="text-[15px] font-bold" style={{ color: '#f0ede8', fontFamily: 'var(--font-display)' }}>
          Sale confirmed
        </h2>
      </div>

      <div className="px-6 py-5 flex flex-col gap-4">
        <div>
          {label('Product')}
          <p className="mt-1.5 text-[13px]" style={{ color: '#e8e6e2' }}>{order.productName} × {order.qty}</p>
        </div>
        <div>
          {label('Total')}
          <p className="mt-1.5 text-[15px] font-bold" style={{ color: '#00c97a' }}>{formatOrderTotal(order.totalAmount)}</p>
        </div>
        <div>
          {label('Buyer')}
          <p className="mt-1.5 text-[13px]" style={{ color: '#e8e6e2' }}>{order.buyerName ?? '—'}</p>
          <p className="text-[12px]" style={{ color: '#888' }}>{order.buyerContact ?? '—'}</p>
        </div>
        <div>
          {label('Paid at')}
          <p className="mt-1.5 text-[12px]" style={{ color: '#888', fontFamily: 'var(--font-mono)' }}>
            {order.paidAt ? new Date(order.paidAt).toLocaleString() : '—'}
          </p>
        </div>
        <div>
          {label('Order id')}
          <p className="mt-1.5 text-[12px]" style={{ color: '#888', fontFamily: 'var(--font-mono)' }}>{order.id}</p>
        </div>
      </div>
    </aside>
  )
}
