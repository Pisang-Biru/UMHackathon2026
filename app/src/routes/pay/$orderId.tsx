import React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { fetchPublicOrder, submitMockPayment } from '#/lib/order-server-fns'
import { formatOrderTotal } from '#/lib/order-logic'

export const Route = createFileRoute('/pay/$orderId')({
  loader: async ({ params }) => {
    const data = await fetchPublicOrder({ data: { orderId: params.orderId } })
    return { data, paramId: params.orderId }
  },
  component: PaymentPage,
})

type GroupItem = {
  order: {
    id: string
    qty: number
    unitPrice: number | null
    totalAmount: number | null
    status: string
    buyerContact: string | null
    buyerName: string | null
  }
  product: { id: string; name: string }
}

function PaymentPage() {
  const { data, paramId } = Route.useLoaderData()

  if (!data) {
    return (
      <Shell title="Order not found">
        <p style={{ color: '#888', fontSize: '13px' }}>This payment link is invalid or has expired.</p>
      </Shell>
    )
  }

  if (data.kind === 'group') {
    return <GroupPaymentView data={data} paramId={paramId} />
  }
  return <SingleOrderView order={data.order} product={data.product} businessName={data.businessName} />
}

function GroupPaymentView({
  data,
  paramId,
}: {
  data: {
    kind: 'group'
    groupId: string
    businessName: string
    items: GroupItem[]
    totalAmount: number
    status: string
    buyerContact: string | null
    buyerName: string | null
  }
  paramId: string
}) {
  const [status, setStatus] = React.useState<string>(data.status)
  const [buyerName, setBuyerName] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [paidName, setPaidName] = React.useState<string | null>(data.buyerName)

  async function onPay() {
    setBusy(true)
    setError(null)
    try {
      await submitMockPayment({ data: { orderId: paramId, buyerName } })
      setPaidName(buyerName)
      setStatus('PAID')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment failed')
    } finally {
      setBusy(false)
    }
  }

  if (status === 'CANCELLED') {
    return (
      <Shell title="Order cancelled">
        <p style={{ color: '#ef4444', fontSize: '13px' }}>This order has been cancelled.</p>
      </Shell>
    )
  }

  if (status === 'PAID') {
    return (
      <Shell title="Payment confirmed">
        <div style={{ background: 'rgba(0,201,122,0.1)', border: '1px solid rgba(0,201,122,0.3)', borderRadius: '12px', padding: '16px', color: '#00c97a', fontSize: '13px' }}>
          ✓ Payment received
        </div>
        <Row label="Reference" value={data.groupId} />
        <Row label="Amount" value={formatOrderTotal(data.totalAmount)} />
        <Row label="Buyer" value={paidName ?? '—'} />
        <p style={{ color: '#888', fontSize: '12px', marginTop: '16px' }}>
          The seller has been notified.
        </p>
      </Shell>
    )
  }

  const canSubmit = buyerName.trim().length > 0 && !busy
  const total = formatOrderTotal(data.totalAmount)

  return (
    <Shell title={data.businessName}>
      <div style={{ background: '#16161a', border: '1px solid #1e1e24', borderRadius: '12px', padding: '16px' }}>
        <p style={{ color: '#888', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: '8px' }}>Order summary</p>
        {data.items.map((it) => (
          <Row
            key={it.order.id}
            label={`${it.order.qty} × ${it.product.name}`}
            value={formatOrderTotal(Number(it.order.totalAmount ?? 0))}
          />
        ))}
        <div style={{ height: '1px', background: '#1e1e24', margin: '12px 0' }} />
        <Row label="Total" value={total} bold />
      </div>

      <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ color: '#888', fontSize: '11px' }}>Your name</span>
          <input
            value={buyerName}
            onChange={(e) => setBuyerName(e.target.value)}
            style={{ background: '#16161a', border: '1px solid #2a2a32', borderRadius: '8px', padding: '10px', color: '#e8e6e2', fontSize: '13px' }}
          />
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ color: '#888', fontSize: '11px' }}>Phone on file</span>
          <div
            style={{ background: '#0f0f12', border: '1px solid #1e1e24', borderRadius: '8px', padding: '10px', color: data.buyerContact ? '#e8e6e2' : '#555', fontSize: '13px' }}
          >
            {data.buyerContact ?? '(not set)'}
          </div>
        </div>
      </div>

      {error && <p style={{ color: '#ef4444', fontSize: '12px', marginTop: '12px' }}>{error}</p>}

      <button
        onClick={onPay}
        disabled={!canSubmit}
        style={{
          marginTop: '20px',
          width: '100%',
          padding: '12px',
          borderRadius: '12px',
          border: 'none',
          background: canSubmit ? '#00c97a' : '#1a1a1e',
          color: canSubmit ? '#0a0a0c' : '#555',
          fontSize: '14px',
          fontWeight: 600,
          cursor: canSubmit ? 'pointer' : 'not-allowed',
        }}
      >
        {busy ? 'Processing…' : `Pay ${total}`}
      </button>
    </Shell>
  )
}

function SingleOrderView({
  order,
  product,
  businessName,
}: {
  order: any
  product: { id: string; name: string }
  businessName: string
}) {
  const [status, setStatus] = React.useState<string>(order.status)
  const [paid, setPaid] = React.useState(order.status === 'PAID' ? order : null)
  const [buyerName, setBuyerName] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function onPay() {
    setBusy(true)
    setError(null)
    try {
      const updated = await submitMockPayment({ data: { orderId: order.id, buyerName } })
      setPaid(updated)
      setStatus('PAID')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment failed')
    } finally {
      setBusy(false)
    }
  }

  if (status === 'CANCELLED') {
    return (
      <Shell title="Order cancelled">
        <p style={{ color: '#ef4444', fontSize: '13px' }}>This order has been cancelled.</p>
      </Shell>
    )
  }

  if (status === 'PAID' && paid) {
    return (
      <Shell title="Payment confirmed">
        <div style={{ background: 'rgba(0,201,122,0.1)', border: '1px solid rgba(0,201,122,0.3)', borderRadius: '12px', padding: '16px', color: '#00c97a', fontSize: '13px' }}>
          ✓ Payment received
        </div>
        <Row label="Transaction" value={order.id} />
        <Row label="Amount" value={formatOrderTotal(Number(order.totalAmount))} />
        <Row label="Buyer" value={paid.buyerName ?? '—'} />
        <p style={{ color: '#888', fontSize: '12px', marginTop: '16px' }}>
          The seller has been notified.
        </p>
      </Shell>
    )
  }

  const canSubmit = buyerName.trim().length > 0 && !busy
  const total = formatOrderTotal(Number(order.totalAmount))

  return (
    <Shell title={businessName}>
      <div style={{ background: '#16161a', border: '1px solid #1e1e24', borderRadius: '12px', padding: '16px' }}>
        <p style={{ color: '#888', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: '8px' }}>Order summary</p>
        <Row label="Product" value={product.name} />
        <Row label="Quantity" value={String(order.qty)} />
        <Row label="Unit price" value={formatOrderTotal(Number(order.unitPrice))} />
        <div style={{ height: '1px', background: '#1e1e24', margin: '12px 0' }} />
        <Row label="Total" value={total} bold />
      </div>

      <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ color: '#888', fontSize: '11px' }}>Your name</span>
          <input
            value={buyerName}
            onChange={(e) => setBuyerName(e.target.value)}
            style={{ background: '#16161a', border: '1px solid #2a2a32', borderRadius: '8px', padding: '10px', color: '#e8e6e2', fontSize: '13px' }}
          />
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ color: '#888', fontSize: '11px' }}>Phone on file</span>
          <div
            style={{ background: '#0f0f12', border: '1px solid #1e1e24', borderRadius: '8px', padding: '10px', color: order.buyerContact ? '#e8e6e2' : '#555', fontSize: '13px' }}
          >
            {order.buyerContact ?? '(not set)'}
          </div>
        </div>
      </div>

      {error && <p style={{ color: '#ef4444', fontSize: '12px', marginTop: '12px' }}>{error}</p>}

      <button
        onClick={onPay}
        disabled={!canSubmit}
        style={{
          marginTop: '20px',
          width: '100%',
          padding: '12px',
          borderRadius: '12px',
          border: 'none',
          background: canSubmit ? '#00c97a' : '#1a1a1e',
          color: canSubmit ? '#0a0a0c' : '#555',
          fontSize: '14px',
          fontWeight: 600,
          cursor: canSubmit ? 'pointer' : 'not-allowed',
        }}
      >
        {busy ? 'Processing…' : `Pay ${total}`}
      </button>
    </Shell>
  )
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0c', padding: '40px 16px', display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: '440px' }}>
        <h1 style={{ color: '#f0ede8', fontSize: '22px', fontWeight: 700, marginBottom: '20px' }}>{title}</h1>
        {children}
      </div>
    </div>
  )
}

function Row({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '13px' }}>
      <span style={{ color: '#888' }}>{label}</span>
      <span style={{ color: '#e8e6e2', fontWeight: bold ? 700 : 400 }}>{value}</span>
    </div>
  )
}
