# Payment Gateway Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a mock payment loop — agent issues a payment URL via tool call, buyer pays on a public page, seller sees a Sale-Confirmed notification in the inbox and in a new Sales tab on the agent dashboard.

**Architecture:** New `Order` table joins Product+Business. Python LangGraph agent gains a `create_payment_link` tool that inserts a `PENDING_PAYMENT` order and returns a `/pay/<id>` URL. Public TanStack route lets the buyer flip the order to `PAID` via a mock form. Inbox merges `AgentAction` + `Order` into a single discriminated-union list. Agent dashboard gets a Sales tab reading from the same data.

**Tech Stack:** Prisma + Postgres, TanStack Start (React), vitest, SQLAlchemy + LangGraph + LangChain tools (Python 3.13, pip in `agents/.venv`).

**Working directories:**
- TS app: `/Users/hariz/PisangProject/umhackathon2026/app` (use `pnpm`)
- Python agent: `/Users/hariz/PisangProject/umhackathon2026/agents` (use `.venv`)
- Repo root: `/Users/hariz/PisangProject/umhackathon2026`

---

## File Structure

New:
- `app/src/routes/pay/$orderId.tsx` — public payment route
- `app/src/lib/order-logic.ts` — pure helpers (formatOrderTotal, paymentUrl, matchesItemTab)
- `app/src/lib/order-server-fns.ts` — server fns for public + authed order operations
- `app/src/components/inbox/order-inbox-card.tsx` — list row for PAID order
- `app/src/components/inbox/order-detail-panel.tsx` — right panel for selected order
- `app/src/components/agents/sales-tab.tsx` — agent dashboard sales tab
- `app/src/__tests__/order-logic.test.ts`
- Prisma migration folder (auto-generated)

Modified:
- `app/prisma/schema.prisma` — Order model, OrderStatus enum, Product reverse relation
- `app/src/lib/inbox-logic.ts` — add `InboxItem` union, `InboxOrder` type, rename tab matcher
- `app/src/lib/inbox-server-fns.ts` — fetchInbox + fetchTabCounts return merged items
- `app/src/routes/$businessCode/inbox.tsx` — handle mixed items + order acknowledgement
- `app/src/__tests__/inbox-logic.test.ts` — update tests for merged items
- `app/src/components/agents/agent-tab-bar.tsx` — add `'sales'` tab
- `app/src/lib/agent-server-fns.ts` — no change required; sales uses `order-server-fns`
- `app/src/routes/$businessCode/agents/$agentType.tsx` — handle sales tab
- `agents/app/db.py` — Order model + OrderStatus enum
- `agents/app/agents/customer_support.py` — tool-capable LangGraph, system prompt, tool function

---

## Task 1: Prisma schema — Order model

**Files:**
- Modify: `app/prisma/schema.prisma`
- Generated: `app/prisma/migrations/<timestamp>_add_order_model/`

- [ ] **Step 1: Add Order + OrderStatus to schema**

Open `app/prisma/schema.prisma`. After the `AgentAction` model, add:

```prisma
enum OrderStatus {
  PENDING_PAYMENT
  PAID
  CANCELLED
}

model Order {
  id              String      @id @default(cuid())
  businessId      String
  business        Business    @relation(fields: [businessId], references: [id], onDelete: Cascade)
  productId       String
  product         Product     @relation(fields: [productId], references: [id])
  agentType       String?
  qty             Int
  unitPrice       Decimal     @db.Decimal(10, 2)
  totalAmount     Decimal     @db.Decimal(10, 2)
  status          OrderStatus @default(PENDING_PAYMENT)
  buyerName       String?
  buyerContact    String?
  paidAt          DateTime?
  acknowledgedAt  DateTime?
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  @@map("order")
  @@index([businessId, status])
}
```

In the `Business` model, add to the bottom of its relations list:

```prisma
  orders       Order[]
```

In the `Product` model, add:

```prisma
  orders      Order[]
```

- [ ] **Step 2: Generate migration**

```bash
cd /Users/hariz/PisangProject/umhackathon2026/app
pnpm exec prisma migrate dev --name add_order_model
```

If the shadow DB fails, fall back:

```bash
pnpm exec prisma db push
pnpm exec prisma migrate resolve --applied <new_migration_name>
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/hariz/PisangProject/umhackathon2026/app && pnpm exec tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
cd /Users/hariz/PisangProject/umhackathon2026
git add app/prisma/schema.prisma app/prisma/migrations app/src/generated
git commit -m "feat: add Order model and OrderStatus enum"
```

---

## Task 2: Python SQLAlchemy Order model

**Files:**
- Modify: `agents/app/db.py`

- [ ] **Step 1: Extend db.py**

Open `agents/app/db.py`. Add after `AgentAction`:

```python
class OrderStatus(enum.Enum):
    PENDING_PAYMENT = "PENDING_PAYMENT"
    PAID = "PAID"
    CANCELLED = "CANCELLED"


class Order(Base):
    __tablename__ = "order"
    id = Column(String, primary_key=True)
    businessId = Column(String, nullable=False)
    productId = Column(String, nullable=False)
    agentType = Column(String, nullable=True)
    qty = Column(Integer, nullable=False)
    unitPrice = Column(Numeric(10, 2), nullable=False)
    totalAmount = Column(Numeric(10, 2), nullable=False)
    status = Column(SAEnum(OrderStatus, name="OrderStatus"), nullable=False, default=OrderStatus.PENDING_PAYMENT)
    buyerName = Column(String, nullable=True)
    buyerContact = Column(String, nullable=True)
    paidAt = Column(DateTime, nullable=True)
    acknowledgedAt = Column(DateTime, nullable=True)
    createdAt = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updatedAt = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
```

- [ ] **Step 2: Quick import check**

```bash
cd /Users/hariz/PisangProject/umhackathon2026/agents
.venv/bin/python -c "from app.db import Order, OrderStatus; print(Order.__tablename__, list(OrderStatus))"
```

Expected: `order [<OrderStatus.PENDING_PAYMENT: 'PENDING_PAYMENT'>, <OrderStatus.PAID: 'PAID'>, <OrderStatus.CANCELLED: 'CANCELLED'>]`

- [ ] **Step 3: Commit**

```bash
cd /Users/hariz/PisangProject/umhackathon2026
git add agents/app/db.py
git commit -m "feat(agents): add SQLAlchemy Order model"
```

---

## Task 3: TS order-logic pure helpers (TDD)

**Files:**
- Create: `app/src/lib/order-logic.ts`
- Create: `app/src/__tests__/order-logic.test.ts`

- [ ] **Step 1: Write failing tests**

Create `app/src/__tests__/order-logic.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { paymentUrl, formatOrderTotal, isValidBuyerInput } from '#/lib/order-logic'

describe('paymentUrl', () => {
  it('builds a /pay/<id> path from base and orderId', () => {
    expect(paymentUrl('https://app.com', 'abc123')).toBe('https://app.com/pay/abc123')
  })

  it('strips trailing slash from base', () => {
    expect(paymentUrl('https://app.com/', 'abc123')).toBe('https://app.com/pay/abc123')
  })
})

describe('formatOrderTotal', () => {
  it('formats number as RMx.xx', () => {
    expect(formatOrderTotal(12)).toBe('RM12.00')
    expect(formatOrderTotal(3.5)).toBe('RM3.50')
    expect(formatOrderTotal(0)).toBe('RM0.00')
  })
})

describe('isValidBuyerInput', () => {
  it('requires non-empty trimmed name and contact', () => {
    expect(isValidBuyerInput({ name: 'Ali', contact: '012' })).toBe(true)
    expect(isValidBuyerInput({ name: '  ', contact: '012' })).toBe(false)
    expect(isValidBuyerInput({ name: 'Ali', contact: '' })).toBe(false)
    expect(isValidBuyerInput({ name: '', contact: '' })).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd /Users/hariz/PisangProject/umhackathon2026/app && pnpm vitest run src/__tests__/order-logic.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement helpers**

Create `app/src/lib/order-logic.ts`:

```ts
export function paymentUrl(base: string, orderId: string): string {
  const trimmed = base.endsWith('/') ? base.slice(0, -1) : base
  return `${trimmed}/pay/${orderId}`
}

export function formatOrderTotal(amount: number): string {
  return `RM${amount.toFixed(2)}`
}

export function isValidBuyerInput(input: { name: string; contact: string }): boolean {
  return input.name.trim().length > 0 && input.contact.trim().length > 0
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd /Users/hariz/PisangProject/umhackathon2026/app && pnpm vitest run src/__tests__/order-logic.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/hariz/PisangProject/umhackathon2026
git add app/src/lib/order-logic.ts app/src/__tests__/order-logic.test.ts
git commit -m "feat: add order-logic helpers with tests"
```

---

## Task 4: Inbox merge helpers (TDD)

**Files:**
- Modify: `app/src/lib/inbox-logic.ts`
- Modify: `app/src/__tests__/inbox-logic.test.ts`

- [ ] **Step 1: Update tests**

In `app/src/__tests__/inbox-logic.test.ts`, keep existing `groupByAgent` and `matchesTab` tests (those still apply to action-only matching). Add new test blocks at the bottom of the file:

```ts
import {
  groupByAgent,
  matchesTab,
  matchesItemTab,
  type InboxAction,
  type InboxOrder,
  type InboxItem,
} from '#/lib/inbox-logic'

// ...existing tests unchanged...

function mkOrder(overrides: Partial<InboxOrder> = {}): InboxOrder {
  return {
    id: 'o1',
    businessId: 'b1',
    productName: 'Pisang',
    qty: 2,
    totalAmount: 4,
    buyerName: 'Ali',
    buyerContact: '012',
    status: 'PAID',
    paidAt: new Date('2026-04-23T10:00:00Z'),
    acknowledgedAt: null,
    createdAt: new Date('2026-04-23T10:00:00Z'),
    ...overrides,
  }
}

describe('matchesItemTab — action kind', () => {
  const now = new Date('2026-04-24T12:00:00Z')

  it('delegates to matchesTab for action kind', () => {
    const pending: InboxItem = { kind: 'action', action: mk({ status: 'PENDING' }) }
    expect(matchesItemTab(pending, 'mine', now)).toBe(true)
    const autoSent: InboxItem = { kind: 'action', action: mk({ status: 'AUTO_SENT' }) }
    expect(matchesItemTab(autoSent, 'mine', now)).toBe(false)
  })
})

describe('matchesItemTab — order kind', () => {
  const now = new Date('2026-04-24T12:00:00Z')

  it('mine: PAID and not acknowledged', () => {
    const paid: InboxItem = { kind: 'order', order: mkOrder({ status: 'PAID', acknowledgedAt: null }) }
    expect(matchesItemTab(paid, 'mine', now)).toBe(true)

    const acked: InboxItem = { kind: 'order', order: mkOrder({ status: 'PAID', acknowledgedAt: new Date() }) }
    expect(matchesItemTab(acked, 'mine', now)).toBe(false)

    const pending: InboxItem = { kind: 'order', order: mkOrder({ status: 'PENDING_PAYMENT' }) }
    expect(matchesItemTab(pending, 'mine', now)).toBe(false)
  })

  it('recent: PAID/CANCELLED within 7 days', () => {
    const recent = new Date('2026-04-22T12:00:00Z')
    const old = new Date('2026-04-10T12:00:00Z')
    expect(matchesItemTab({ kind: 'order', order: mkOrder({ status: 'PAID', createdAt: recent }) }, 'recent', now)).toBe(true)
    expect(matchesItemTab({ kind: 'order', order: mkOrder({ status: 'CANCELLED', createdAt: recent }) }, 'recent', now)).toBe(true)
    expect(matchesItemTab({ kind: 'order', order: mkOrder({ status: 'PENDING_PAYMENT', createdAt: recent }) }, 'recent', now)).toBe(false)
    expect(matchesItemTab({ kind: 'order', order: mkOrder({ status: 'PAID', createdAt: old }) }, 'recent', now)).toBe(false)
  })

  it('unread: PAID and acknowledgedAt null', () => {
    expect(matchesItemTab({ kind: 'order', order: mkOrder({ status: 'PAID', acknowledgedAt: null }) }, 'unread', now)).toBe(true)
    expect(matchesItemTab({ kind: 'order', order: mkOrder({ status: 'PAID', acknowledgedAt: new Date() }) }, 'unread', now)).toBe(false)
    expect(matchesItemTab({ kind: 'order', order: mkOrder({ status: 'PENDING_PAYMENT', acknowledgedAt: null }) }, 'unread', now)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd /Users/hariz/PisangProject/umhackathon2026/app && pnpm vitest run src/__tests__/inbox-logic.test.ts
```

Expected: `matchesItemTab`, `InboxOrder`, `InboxItem` not exported.

- [ ] **Step 3: Extend inbox-logic.ts**

In `app/src/lib/inbox-logic.ts`, replace the existing file with:

```ts
export type AgentActionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'AUTO_SENT'
export type InboxTab = 'mine' | 'recent' | 'unread'
export type OrderItemStatus = 'PENDING_PAYMENT' | 'PAID' | 'CANCELLED'

export interface InboxAction {
  id: string
  businessId: string
  customerMsg: string
  draftReply: string
  finalReply: string | null
  confidence: number
  reasoning: string
  status: AgentActionStatus
  viewedAt: Date | null
  agentType: string
  createdAt: Date
  updatedAt: Date
}

export interface InboxOrder {
  id: string
  businessId: string
  productName: string
  qty: number
  totalAmount: number
  buyerName: string | null
  buyerContact: string | null
  status: OrderItemStatus
  paidAt: Date | null
  acknowledgedAt: Date | null
  createdAt: Date
}

export type InboxItem =
  | { kind: 'action'; action: InboxAction }
  | { kind: 'order'; order: InboxOrder }

export interface AgentGroup {
  agentType: string
  actions: InboxAction[]
}

export function groupByAgent(actions: InboxAction[]): AgentGroup[] {
  const map = new Map<string, InboxAction[]>()
  for (const action of actions) {
    const existing = map.get(action.agentType)
    if (existing) {
      existing.push(action)
    } else {
      map.set(action.agentType, [action])
    }
  }
  return Array.from(map.entries()).map(([agentType, actions]) => ({ agentType, actions }))
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export function matchesTab(action: InboxAction, tab: InboxTab, now: Date = new Date()): boolean {
  switch (tab) {
    case 'mine':
      return action.status === 'PENDING'
    case 'recent':
      return (
        action.status !== 'AUTO_SENT' &&
        now.getTime() - action.createdAt.getTime() <= SEVEN_DAYS_MS
      )
    case 'unread':
      return action.viewedAt === null && action.status !== 'AUTO_SENT'
  }
}

function matchesOrderTab(order: InboxOrder, tab: InboxTab, now: Date): boolean {
  switch (tab) {
    case 'mine':
      return order.status === 'PAID' && order.acknowledgedAt === null
    case 'recent':
      return (
        (order.status === 'PAID' || order.status === 'CANCELLED') &&
        now.getTime() - order.createdAt.getTime() <= SEVEN_DAYS_MS
      )
    case 'unread':
      return order.status === 'PAID' && order.acknowledgedAt === null
  }
}

export function matchesItemTab(item: InboxItem, tab: InboxTab, now: Date = new Date()): boolean {
  return item.kind === 'action'
    ? matchesTab(item.action, tab, now)
    : matchesOrderTab(item.order, tab, now)
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd /Users/hariz/PisangProject/umhackathon2026/app && pnpm vitest run src/__tests__/inbox-logic.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/hariz/PisangProject/umhackathon2026
git add app/src/lib/inbox-logic.ts app/src/__tests__/inbox-logic.test.ts
git commit -m "feat: add InboxItem union and matchesItemTab helper"
```

---

## Task 5: order-server-fns (public + authed)

**Files:**
- Create: `app/src/lib/order-server-fns.ts`

- [ ] **Step 1: Create file**

Create `app/src/lib/order-server-fns.ts`:

```ts
import { createServerFn } from '@tanstack/react-start'
import { redirect } from '@tanstack/react-router'
import { prisma } from '#/db'
import { auth } from '#/lib/auth'

async function requireSession() {
  const { getRequest } = await import('@tanstack/react-start/server')
  const session = await auth.api.getSession({ headers: getRequest().headers })
  if (!session) throw redirect({ to: '/login' })
  return session
}

async function requireBusinessOwner(businessId: string, userId: string) {
  const business = await prisma.business.findFirst({ where: { id: businessId, userId } })
  if (!business) throw new Error('Business not found or access denied')
  return business
}

function serializeOrder(o: any) {
  return {
    ...o,
    unitPrice: o.unitPrice == null ? null : Number(o.unitPrice),
    totalAmount: o.totalAmount == null ? null : Number(o.totalAmount),
  }
}

export const fetchPublicOrder = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null || typeof (data as Record<string, unknown>).orderId !== 'string') {
      throw new Error('Invalid input')
    }
    return { orderId: (data as { orderId: string }).orderId }
  })
  .handler(async ({ data }) => {
    const order = await prisma.order.findUnique({
      where: { id: data.orderId },
      include: { product: { select: { id: true, name: true } }, business: { select: { name: true } } },
    })
    if (!order) return null
    return {
      order: serializeOrder({ ...order, business: undefined, product: undefined }),
      product: order.product,
      businessName: order.business.name,
    }
  })

export const submitMockPayment = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null) throw new Error('Invalid input')
    const d = data as Record<string, unknown>
    if (typeof d.orderId !== 'string') throw new Error('orderId required')
    if (typeof d.buyerName !== 'string' || d.buyerName.trim().length < 1) throw new Error('buyerName required')
    if (typeof d.buyerContact !== 'string' || d.buyerContact.trim().length < 1) throw new Error('buyerContact required')
    return { orderId: d.orderId, buyerName: d.buyerName.trim(), buyerContact: d.buyerContact.trim() }
  })
  .handler(async ({ data }) => {
    return prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: data.orderId } })
      if (!order) throw new Error('Order not found')
      if (order.status !== 'PENDING_PAYMENT') throw new Error(`Order is ${order.status}`)
      const updated = await tx.order.update({
        where: { id: data.orderId },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          buyerName: data.buyerName,
          buyerContact: data.buyerContact,
        },
      })
      return serializeOrder(updated)
    })
  })

export const acknowledgeOrder = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null || typeof (data as Record<string, unknown>).orderId !== 'string') {
      throw new Error('Invalid input')
    }
    return { orderId: (data as { orderId: string }).orderId }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    const order = await prisma.order.findUnique({ where: { id: data.orderId }, include: { business: true } })
    if (!order || order.business.userId !== session.user.id) throw new Error('Order not found or access denied')
    if (order.acknowledgedAt) return serializeOrder(order)
    const updated = await prisma.order.update({
      where: { id: data.orderId },
      data: { acknowledgedAt: new Date() },
    })
    return serializeOrder(updated)
  })

export const fetchAgentSales = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null) throw new Error('Invalid input')
    const d = data as Record<string, unknown>
    if (typeof d.businessId !== 'string') throw new Error('businessId required')
    if (typeof d.agentType !== 'string') throw new Error('agentType required')
    const rangeDays = typeof d.rangeDays === 'number' ? d.rangeDays : 30
    return { businessId: d.businessId, agentType: d.agentType, rangeDays }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    await requireBusinessOwner(data.businessId, session.user.id)

    const since = data.rangeDays > 0 ? new Date(Date.now() - data.rangeDays * 24 * 60 * 60 * 1000) : new Date(0)
    const orders = await prisma.order.findMany({
      where: { businessId: data.businessId, agentType: data.agentType, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      include: { product: { select: { id: true, name: true } } },
    })

    let count = 0
    let revenue = 0
    for (const o of orders) {
      if (o.status === 'PAID') {
        count++
        revenue += Number(o.totalAmount)
      }
    }
    return {
      totals: { count, revenue },
      rows: orders.map((o) => ({
        ...serializeOrder({ ...o, product: undefined }),
        productName: o.product.name,
      })),
    }
  })
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/hariz/PisangProject/umhackathon2026/app && pnpm exec tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/hariz/PisangProject/umhackathon2026
git add app/src/lib/order-server-fns.ts
git commit -m "feat: add order-server-fns for public + authed order ops"
```

---

## Task 6: Public /pay/$orderId route

**Files:**
- Create: `app/src/routes/pay/$orderId.tsx`

- [ ] **Step 1: Create directory and route**

```bash
mkdir -p /Users/hariz/PisangProject/umhackathon2026/app/src/routes/pay
```

Create `app/src/routes/pay/$orderId.tsx`:

```tsx
import React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { fetchPublicOrder, submitMockPayment } from '#/lib/order-server-fns'
import { formatOrderTotal } from '#/lib/order-logic'

export const Route = createFileRoute('/pay/$orderId')({
  loader: async ({ params }) => {
    const data = await fetchPublicOrder({ data: { orderId: params.orderId } })
    return { data }
  },
  component: PaymentPage,
})

function PaymentPage() {
  const { data } = Route.useLoaderData()

  if (!data) {
    return (
      <Shell title="Order not found">
        <p style={{ color: '#888', fontSize: '13px' }}>This payment link is invalid or has expired.</p>
      </Shell>
    )
  }

  const { order, product, businessName } = data
  const [status, setStatus] = React.useState<string>(order.status)
  const [paid, setPaid] = React.useState(order.status === 'PAID' ? order : null)
  const [buyerName, setBuyerName] = React.useState('')
  const [buyerContact, setBuyerContact] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function onPay() {
    setBusy(true)
    setError(null)
    try {
      const updated = await submitMockPayment({ data: { orderId: order.id, buyerName, buyerContact } })
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

  const canSubmit = buyerName.trim().length > 0 && buyerContact.trim().length > 0 && !busy
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
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ color: '#888', fontSize: '11px' }}>Phone or email</span>
          <input
            value={buyerContact}
            onChange={(e) => setBuyerContact(e.target.value)}
            style={{ background: '#16161a', border: '1px solid #2a2a32', borderRadius: '8px', padding: '10px', color: '#e8e6e2', fontSize: '13px' }}
          />
        </label>
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
```

- [ ] **Step 2: Regenerate route tree**

```bash
cd /Users/hariz/PisangProject/umhackathon2026/app
(pnpm dev &) ; sleep 10 ; pkill -f "vite\|tanstack" 2>/dev/null || true
```

Verify `app/src/routeTree.gen.ts` now references `/pay/$orderId`:

```bash
grep -c "pay/\\\$orderId\|pay_orderId\|pay\\.orderId" /Users/hariz/PisangProject/umhackathon2026/app/src/routeTree.gen.ts
```

Expected: > 0.

- [ ] **Step 3: Typecheck**

```bash
cd /Users/hariz/PisangProject/umhackathon2026/app && pnpm exec tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
cd /Users/hariz/PisangProject/umhackathon2026
git add app/src/routes/pay app/src/routeTree.gen.ts
git commit -m "feat: add public /pay/\$orderId mock payment route"
```

---

## Task 7: Inbox server fns — merge orders

**Files:**
- Modify: `app/src/lib/inbox-server-fns.ts`

- [ ] **Step 1: Rewrite fetchInbox + fetchTabCounts**

In `app/src/lib/inbox-server-fns.ts`, replace `fetchInbox` and `fetchTabCounts` with versions that return merged items. Keep `markAsViewed`, `approveAction`, `editAction`, `rejectAction`, and `serializeAction` unchanged.

Insert at the top of the file, after existing imports and helpers, a new helper:

```ts
function serializeOrder(o: any) {
  return {
    ...o,
    unitPrice: o.unitPrice == null ? null : Number(o.unitPrice),
    totalAmount: o.totalAmount == null ? null : Number(o.totalAmount),
  }
}
```

Replace the entire `fetchInbox` export with:

```ts
export const fetchInbox = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null) throw new Error('Invalid input')
    const d = data as Record<string, unknown>
    if (typeof d.businessId !== 'string') throw new Error('businessId required')
    if (d.tab !== 'mine' && d.tab !== 'recent' && d.tab !== 'unread') {
      throw new Error('tab must be mine, recent, or unread')
    }
    return { businessId: d.businessId, tab: d.tab as InboxTab }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    await requireBusinessOwner(data.businessId, session.user.id)

    let actionWhere: Record<string, unknown> = { businessId: data.businessId }
    let orderWhere: Record<string, unknown> | null = { businessId: data.businessId }
    const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS)

    if (data.tab === 'mine') {
      actionWhere = { ...actionWhere, status: 'PENDING' }
      orderWhere = { ...orderWhere, status: 'PAID', acknowledgedAt: null }
    } else if (data.tab === 'recent') {
      actionWhere = { ...actionWhere, status: { not: 'AUTO_SENT' }, createdAt: { gte: sevenDaysAgo } }
      orderWhere = { ...orderWhere, status: { in: ['PAID', 'CANCELLED'] }, createdAt: { gte: sevenDaysAgo } }
    } else if (data.tab === 'unread') {
      actionWhere = { ...actionWhere, status: { not: 'AUTO_SENT' }, viewedAt: null }
      orderWhere = { ...orderWhere, status: 'PAID', acknowledgedAt: null }
    }

    const [actions, orders] = await Promise.all([
      prisma.agentAction.findMany({ where: actionWhere, orderBy: { createdAt: 'desc' } }),
      prisma.order.findMany({
        where: orderWhere,
        orderBy: { createdAt: 'desc' },
        include: { product: { select: { name: true } } },
      }),
    ])

    const items = [
      ...actions.map((a) => ({ kind: 'action' as const, action: serializeAction(a), createdAt: a.createdAt })),
      ...orders.map((o) => ({
        kind: 'order' as const,
        order: {
          id: o.id,
          businessId: o.businessId,
          productName: o.product.name,
          qty: o.qty,
          totalAmount: Number(o.totalAmount),
          buyerName: o.buyerName,
          buyerContact: o.buyerContact,
          status: o.status,
          paidAt: o.paidAt,
          acknowledgedAt: o.acknowledgedAt,
          createdAt: o.createdAt,
        },
        createdAt: o.createdAt,
      })),
    ]
    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    return items.map(({ createdAt, ...rest }) => rest)
  })
```

Replace the entire `fetchTabCounts` export with:

```ts
export const fetchTabCounts = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null || typeof (data as Record<string, unknown>).businessId !== 'string') {
      throw new Error('Invalid input')
    }
    return { businessId: (data as { businessId: string }).businessId }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    await requireBusinessOwner(data.businessId, session.user.id)

    const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS)
    const [mineActions, mineOrders, recentActions, recentOrders, unreadActions, unreadOrders] = await Promise.all([
      prisma.agentAction.count({ where: { businessId: data.businessId, status: 'PENDING' } }),
      prisma.order.count({ where: { businessId: data.businessId, status: 'PAID', acknowledgedAt: null } }),
      prisma.agentAction.count({
        where: {
          businessId: data.businessId,
          status: { not: 'AUTO_SENT' },
          createdAt: { gte: sevenDaysAgo },
        },
      }),
      prisma.order.count({
        where: {
          businessId: data.businessId,
          status: { in: ['PAID', 'CANCELLED'] },
          createdAt: { gte: sevenDaysAgo },
        },
      }),
      prisma.agentAction.count({ where: { businessId: data.businessId, status: { not: 'AUTO_SENT' }, viewedAt: null } }),
      prisma.order.count({ where: { businessId: data.businessId, status: 'PAID', acknowledgedAt: null } }),
    ])
    return {
      mine: mineActions + mineOrders,
      recent: recentActions + recentOrders,
      unread: unreadActions + unreadOrders,
    }
  })
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/hariz/PisangProject/umhackathon2026/app && pnpm exec tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/hariz/PisangProject/umhackathon2026
git add app/src/lib/inbox-server-fns.ts
git commit -m "feat: merge orders into fetchInbox and fetchTabCounts"
```

---

## Task 8: Order inbox components

**Files:**
- Create: `app/src/components/inbox/order-inbox-card.tsx`
- Create: `app/src/components/inbox/order-detail-panel.tsx`

- [ ] **Step 1: Create card**

Create `app/src/components/inbox/order-inbox-card.tsx`:

```tsx
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
```

- [ ] **Step 2: Create detail panel**

Create `app/src/components/inbox/order-detail-panel.tsx`:

```tsx
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
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/hariz/PisangProject/umhackathon2026/app && pnpm exec tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
cd /Users/hariz/PisangProject/umhackathon2026
git add app/src/components/inbox/order-inbox-card.tsx app/src/components/inbox/order-detail-panel.tsx
git commit -m "feat: add order-inbox-card and order-detail-panel components"
```

---

## Task 9: Inbox route — render mixed items

**Files:**
- Modify: `app/src/routes/$businessCode/inbox.tsx`

- [ ] **Step 1: Replace file**

Replace the content of `app/src/routes/$businessCode/inbox.tsx` with:

```tsx
import React from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { fetchBusinesses } from '#/lib/business-server-fns'
import {
  fetchInbox,
  fetchTabCounts,
  markAsViewed,
  approveAction,
  editAction,
  rejectAction,
} from '#/lib/inbox-server-fns'
import { acknowledgeOrder } from '#/lib/order-server-fns'
import { BusinessStrip } from '#/components/business-strip'
import { Sidebar } from '#/components/sidebar'
import { InboxTabs } from '#/components/inbox/inbox-tabs'
import { AgentGroup } from '#/components/inbox/agent-group'
import { ActionDetailPanel } from '#/components/inbox/action-detail-panel'
import { OrderInboxCard } from '#/components/inbox/order-inbox-card'
import { OrderDetailPanel } from '#/components/inbox/order-detail-panel'
import {
  groupByAgent,
  type InboxAction,
  type InboxItem,
  type InboxOrder,
  type InboxTab,
} from '#/lib/inbox-logic'

export const Route = createFileRoute('/$businessCode/inbox')({
  loader: async ({ params }) => {
    const businesses = await fetchBusinesses()
    const current = businesses.find((b) => b.code === params.businessCode)
    if (!current) {
      if (businesses.length > 0) {
        throw redirect({ to: '/$businessCode/inbox', params: { businessCode: businesses[0].code } })
      }
      throw redirect({ to: '/' })
    }
    const [initialItems, initialCounts] = await Promise.all([
      fetchInbox({ data: { businessId: current.id, tab: 'mine' } }),
      fetchTabCounts({ data: { businessId: current.id } }),
    ])
    return { businesses, current, initialItems, initialCounts }
  },
  component: InboxPage,
})

function normalizeAction(raw: any): InboxAction {
  return {
    ...raw,
    createdAt: new Date(raw.createdAt),
    updatedAt: new Date(raw.updatedAt),
    viewedAt: raw.viewedAt ? new Date(raw.viewedAt) : null,
  }
}

function normalizeOrder(raw: any): InboxOrder {
  return {
    ...raw,
    createdAt: new Date(raw.createdAt),
    paidAt: raw.paidAt ? new Date(raw.paidAt) : null,
    acknowledgedAt: raw.acknowledgedAt ? new Date(raw.acknowledgedAt) : null,
  }
}

function normalizeItem(raw: any): InboxItem {
  return raw.kind === 'order'
    ? { kind: 'order', order: normalizeOrder(raw.order) }
    : { kind: 'action', action: normalizeAction(raw.action) }
}

type Selection = { kind: 'action'; id: string } | { kind: 'order'; id: string } | null

function InboxPage() {
  const { businesses, current, initialItems, initialCounts } = Route.useLoaderData()
  const [tab, setTab] = React.useState<InboxTab>('mine')
  const [items, setItems] = React.useState<InboxItem[]>(initialItems.map(normalizeItem))
  const [counts, setCounts] = React.useState(initialCounts)
  const [selected, setSelected] = React.useState<Selection>(null)

  const selectedItem = selected
    ? items.find((it) =>
        it.kind === selected.kind &&
        (it.kind === 'action' ? it.action.id === selected.id : it.order.id === selected.id),
      ) ?? null
    : null

  const actions = items.filter((it): it is Extract<InboxItem, { kind: 'action' }> => it.kind === 'action').map((it) => it.action)
  const orders = items.filter((it): it is Extract<InboxItem, { kind: 'order' }> => it.kind === 'order').map((it) => it.order)
  const agentGroups = groupByAgent(actions)

  async function switchTab(nextTab: InboxTab) {
    setTab(nextTab)
    setSelected(null)
    const next = await fetchInbox({ data: { businessId: current.id, tab: nextTab } })
    setItems(next.map(normalizeItem))
  }

  async function refreshCounts() {
    const c = await fetchTabCounts({ data: { businessId: current.id } })
    setCounts(c)
  }

  async function selectAction(action: InboxAction) {
    setSelected({ kind: 'action', id: action.id })
    if (!action.viewedAt) {
      try {
        const updated = await markAsViewed({ data: { actionId: action.id } })
        const u = normalizeAction(updated)
        setItems((prev) => prev.map((it) => (it.kind === 'action' && it.action.id === u.id ? { kind: 'action', action: u } : it)))
        await refreshCounts()
      } catch (err) {
        console.error('markAsViewed failed', err)
      }
    }
  }

  async function selectOrder(order: InboxOrder) {
    setSelected({ kind: 'order', id: order.id })
    if (!order.acknowledgedAt) {
      try {
        const updated = await acknowledgeOrder({ data: { orderId: order.id } })
        const u = normalizeOrder(updated)
        setItems((prev) => prev.map((it) => (it.kind === 'order' && it.order.id === u.id ? { kind: 'order', order: u } : it)))
        await refreshCounts()
      } catch (err) {
        console.error('acknowledgeOrder failed', err)
      }
    }
  }

  async function handleApprove(action: InboxAction) {
    const updated = await approveAction({ data: { actionId: action.id } })
    const u = normalizeAction(updated)
    setItems((prev) =>
      tab === 'mine'
        ? prev.filter((it) => !(it.kind === 'action' && it.action.id === u.id))
        : prev.map((it) => (it.kind === 'action' && it.action.id === u.id ? { kind: 'action', action: u } : it)),
    )
    await refreshCounts()
    setSelected(null)
  }

  async function handleEdit(action: InboxAction, reply: string) {
    const updated = await editAction({ data: { actionId: action.id, reply } })
    const u = normalizeAction(updated)
    setItems((prev) =>
      tab === 'mine'
        ? prev.filter((it) => !(it.kind === 'action' && it.action.id === u.id))
        : prev.map((it) => (it.kind === 'action' && it.action.id === u.id ? { kind: 'action', action: u } : it)),
    )
    await refreshCounts()
    setSelected(null)
  }

  async function handleReject(action: InboxAction) {
    const updated = await rejectAction({ data: { actionId: action.id } })
    const u = normalizeAction(updated)
    setItems((prev) =>
      tab === 'mine'
        ? prev.filter((it) => !(it.kind === 'action' && it.action.id === u.id))
        : prev.map((it) => (it.kind === 'action' && it.action.id === u.id ? { kind: 'action', action: u } : it)),
    )
    await refreshCounts()
    setSelected(null)
  }

  const MOCK_SIDEBAR_AGENTS = [{ id: 'support', name: 'Support Agent', color: '#3b7ef8', live: false }]

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0a0a0c' }}>
      <BusinessStrip businesses={businesses} />
      <Sidebar business={current} agents={MOCK_SIDEBAR_AGENTS} />
      <main className="flex-1 flex flex-col overflow-hidden" style={{ background: '#111113' }}>
        <div className="px-8 pt-6 pb-4 border-b" style={{ borderColor: '#1a1a1e' }}>
          <p className="text-[9px] uppercase tracking-[0.2em] mb-1" style={{ color: '#444', fontFamily: 'var(--font-mono)' }}>
            Review
          </p>
          <h1 className="text-[22px] font-bold tracking-tight" style={{ color: '#f0ede8', fontFamily: 'var(--font-display)' }}>
            Inbox
          </h1>
        </div>
        <InboxTabs active={tab} counts={counts} onChange={switchTab} />
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-auto">
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16" style={{ color: '#444' }}>
                <p className="text-[13px]" style={{ fontFamily: 'var(--font-mono)' }}>No items</p>
                <p className="text-[11px] mt-1" style={{ color: '#333' }}>Nothing needs your attention right now</p>
              </div>
            ) : (
              <>
                {orders.length > 0 && (
                  <div>
                    <div className="px-4 pt-4 pb-2 text-[9px] uppercase tracking-[0.14em]" style={{ color: '#444', fontFamily: 'var(--font-mono)' }}>
                      Sales
                    </div>
                    {orders.map((o) => (
                      <OrderInboxCard
                        key={o.id}
                        order={o}
                        selected={selected?.kind === 'order' && selected.id === o.id}
                        onClick={() => selectOrder(o)}
                      />
                    ))}
                  </div>
                )}
                {agentGroups.map((g) => (
                  <AgentGroup
                    key={g.agentType}
                    agentType={g.agentType}
                    actions={g.actions}
                    selectedId={selected?.kind === 'action' ? selected.id : null}
                    onSelect={selectAction}
                  />
                ))}
              </>
            )}
          </div>
          {selectedItem?.kind === 'order' ? (
            <OrderDetailPanel order={selectedItem.order} />
          ) : (
            <ActionDetailPanel
              action={selectedItem?.kind === 'action' ? selectedItem.action : null}
              onApprove={handleApprove}
              onEdit={handleEdit}
              onReject={handleReject}
            />
          )}
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck + tests**

```bash
cd /Users/hariz/PisangProject/umhackathon2026/app && pnpm exec tsc --noEmit && pnpm vitest run --reporter=dot
```

Expected: tsc exit 0; all tests pass.

- [ ] **Step 3: Commit**

```bash
cd /Users/hariz/PisangProject/umhackathon2026
git add app/src/routes/\$businessCode/inbox.tsx
git commit -m "feat: render orders alongside actions in inbox"
```

---

## Task 10: Agent dashboard — Sales tab

**Files:**
- Modify: `app/src/components/agents/agent-tab-bar.tsx`
- Create: `app/src/components/agents/sales-tab.tsx`
- Modify: `app/src/routes/$businessCode/agents/$agentType.tsx`

- [ ] **Step 1: Extend AgentTab type**

In `app/src/components/agents/agent-tab-bar.tsx`, change:

```ts
export type AgentTab = 'dashboard' | 'runs' | 'budget'
```

to:

```ts
export type AgentTab = 'dashboard' | 'runs' | 'budget' | 'sales'
```

And add a new entry to `TABS`:

```ts
const TABS: { id: AgentTab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'runs', label: 'Runs' },
  { id: 'budget', label: 'Budget' },
  { id: 'sales', label: 'Sales' },
]
```

- [ ] **Step 2: Create sales-tab.tsx**

Create `app/src/components/agents/sales-tab.tsx`:

```tsx
import { formatOrderTotal } from '#/lib/order-logic'

type SalesStatus = 'ALL' | 'PAID' | 'PENDING_PAYMENT' | 'CANCELLED'

interface SalesRow {
  id: string
  createdAt: Date
  buyerName: string | null
  productName: string
  qty: number
  totalAmount: number
  status: 'PAID' | 'PENDING_PAYMENT' | 'CANCELLED'
}

interface SalesTabProps {
  totals: { count: number; revenue: number }
  rows: SalesRow[]
  rangeDays: number
  filter: SalesStatus
  onRangeChange: (days: number) => void
  onFilterChange: (status: SalesStatus) => void
}

const RANGES: { label: string; days: number }[] = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: 'All', days: 365 * 100 },
]

const FILTERS: { id: SalesStatus; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'PAID', label: 'Paid' },
  { id: 'PENDING_PAYMENT', label: 'Pending' },
  { id: 'CANCELLED', label: 'Cancelled' },
]

export function SalesTab({ totals, rows, rangeDays, filter, onRangeChange, onFilterChange }: SalesTabProps) {
  const shown = filter === 'ALL' ? rows : rows.filter((r) => r.status === filter)
  return (
    <div className="p-8 overflow-auto flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <p className="text-[14px] font-semibold" style={{ color: '#f0ede8', fontFamily: 'var(--font-display)' }}>Sales</p>
        <div className="flex gap-1">
          {RANGES.map((r) => {
            const active = r.days === rangeDays
            return (
              <button
                key={r.label}
                onClick={() => onRangeChange(r.days)}
                className="px-2.5 py-1 rounded text-[11px]"
                style={{
                  background: active ? '#1a1a1e' : 'transparent',
                  color: active ? '#e8e6e2' : '#666',
                  border: `1px solid ${active ? '#2a2a32' : '#1a1a1e'}`,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {r.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Total sales" value={String(totals.count)} />
        <Stat label="Revenue" value={formatOrderTotal(totals.revenue)} />
      </div>

      <div className="flex gap-1.5">
        {FILTERS.map((f) => {
          const active = f.id === filter
          return (
            <button
              key={f.id}
              onClick={() => onFilterChange(f.id)}
              className="px-2.5 py-1 rounded-full text-[11px]"
              style={{
                background: active ? '#1a1a1e' : 'transparent',
                color: active ? '#e8e6e2' : '#666',
                border: `1px solid ${active ? '#2a2a32' : '#1a1a1e'}`,
                fontFamily: 'var(--font-mono)',
              }}
            >
              {f.label}
            </button>
          )
        })}
      </div>

      <div className="rounded-xl overflow-hidden" style={{ background: '#161618', border: '1px solid #1e1e24' }}>
        <div className="grid px-4 py-2.5 border-b text-[10px] uppercase tracking-[0.14em]"
          style={{ borderColor: '#1e1e24', color: '#555', fontFamily: 'var(--font-mono)', gridTemplateColumns: '90px 1fr 1fr 60px 90px 90px' }}
        >
          <span>Date</span>
          <span>Buyer</span>
          <span>Product</span>
          <span className="text-right">Qty</span>
          <span className="text-right">Total</span>
          <span className="text-right">Status</span>
        </div>
        {shown.length === 0 ? (
          <p className="px-4 py-6 text-[12px]" style={{ color: '#444' }}>No sales</p>
        ) : (
          shown.map((r) => (
            <div
              key={r.id}
              className="grid px-4 py-2.5 border-b text-[12px]"
              style={{ borderColor: '#1a1a1e', gridTemplateColumns: '90px 1fr 1fr 60px 90px 90px' }}
            >
              <span style={{ color: '#888' }}>{new Date(r.createdAt).toLocaleDateString()}</span>
              <span style={{ color: '#c8c5c0' }}>{r.buyerName ?? '—'}</span>
              <span style={{ color: '#c8c5c0' }}>{r.productName}</span>
              <span className="text-right" style={{ color: '#c8c5c0', fontFamily: 'var(--font-mono)' }}>{r.qty}</span>
              <span className="text-right" style={{ color: '#c8c5c0', fontFamily: 'var(--font-mono)' }}>{formatOrderTotal(r.totalAmount)}</span>
              <span className="text-right" style={{ color: '#888', fontFamily: 'var(--font-mono)' }}>{r.status}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl p-4" style={{ background: '#161618', border: '1px solid #1e1e24' }}>
      <p className="text-[10px] uppercase tracking-[0.14em] mb-2" style={{ color: '#555', fontFamily: 'var(--font-mono)' }}>{label}</p>
      <p className="text-[22px] font-bold" style={{ color: '#f0ede8', fontFamily: 'var(--font-display)' }}>{value}</p>
    </div>
  )
}
```

- [ ] **Step 3: Wire into agent route**

In `app/src/routes/$businessCode/agents/$agentType.tsx`:

Add import at top:

```tsx
import { fetchAgentSales } from '#/lib/order-server-fns'
import { SalesTab } from '#/components/agents/sales-tab'
```

Inside `AgentPage`, add state + loader (near existing budget state):

```tsx
  const [salesRows, setSalesRows] = React.useState<any[]>([])
  const [salesTotals, setSalesTotals] = React.useState({ count: 0, revenue: 0 })
  const [salesRange, setSalesRange] = React.useState(30)
  const [salesFilter, setSalesFilter] = React.useState<'ALL' | 'PAID' | 'PENDING_PAYMENT' | 'CANCELLED'>('ALL')
  const [salesLoaded, setSalesLoaded] = React.useState(false)

  async function loadSales(days: number) {
    const res = await fetchAgentSales({ data: { businessId: current.id, agentType, rangeDays: days } })
    setSalesRows(res.rows.map((r: any) => ({ ...r, createdAt: new Date(r.createdAt) })))
    setSalesTotals(res.totals)
    setSalesLoaded(true)
  }
```

Extend the existing tab effect:

```tsx
  React.useEffect(() => {
    if (search.tab === 'runs' && !runsLoaded) loadRuns(runsFilter)
    if (search.tab === 'budget' && !budgetLoaded) loadBudget(budgetRange)
    if (search.tab === 'sales' && !salesLoaded) loadSales(salesRange)
  }, [search.tab])
```

Add at the bottom of the tab-render JSX (after `{search.tab === 'budget' && (...)}`):

```tsx
        {search.tab === 'sales' && (
          <SalesTab
            totals={salesTotals}
            rows={salesRows}
            rangeDays={salesRange}
            filter={salesFilter}
            onRangeChange={(d) => { setSalesRange(d); loadSales(d) }}
            onFilterChange={setSalesFilter}
          />
        )}
```

- [ ] **Step 4: Typecheck + tests**

```bash
cd /Users/hariz/PisangProject/umhackathon2026/app && pnpm exec tsc --noEmit && pnpm vitest run --reporter=dot
```

Expected: exit 0, all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/hariz/PisangProject/umhackathon2026
git add app/src/components/agents/agent-tab-bar.tsx app/src/components/agents/sales-tab.tsx app/src/routes/\$businessCode/agents/\$agentType.tsx
git commit -m "feat: add Sales tab to agent dashboard"
```

---

## Task 11: Python agent — create_payment_link tool

**Files:**
- Modify: `agents/app/agents/customer_support.py`
- Modify: `agents/.env` (if not present, document in task description)

- [ ] **Step 1: Ensure APP_URL env**

Check `agents/.env`:

```bash
cd /Users/hariz/PisangProject/umhackathon2026/agents
grep -c APP_URL .env 2>/dev/null || echo 0
```

If 0, append to `.env`:

```
APP_URL=http://localhost:3000
```

- [ ] **Step 2: Rewrite customer_support.py**

Replace `agents/app/agents/customer_support.py` with:

```python
import json
import os
from cuid2 import Cuid as _Cuid
generate_cuid = _Cuid().generate
from decimal import Decimal
from typing import Annotated, Literal
from typing_extensions import TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langchain_core.messages import BaseMessage, SystemMessage, ToolMessage, AIMessage
from langchain_core.tools import tool
from app.db import (
    SessionLocal,
    Business,
    Product,
    AgentAction,
    AgentActionStatus,
    Order,
    OrderStatus,
)


class SupportAgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    business_context: str
    business_id: str
    customer_id: str
    draft_reply: str
    confidence: float
    reasoning: str
    action: Literal["auto_send", "queue_approval"]
    action_id: str


APP_URL = os.environ.get("APP_URL", "http://localhost:3000")


def _build_context(business_id: str) -> str:
    with SessionLocal() as session:
        business = session.query(Business).filter(Business.id == business_id).first()
        if not business:
            raise ValueError(f"Business {business_id} not found")
        products = session.query(Product).filter(Product.businessId == business_id).all()

    lines = [f"Business: {business.name}"]
    if business.mission:
        lines.append(f"About: {business.mission}")

    if products:
        lines.append("\nProducts available (use product id when creating payment links):")
        for p in products:
            stock_note = f"{p.stock} in stock" if p.stock > 0 else "OUT OF STOCK"
            desc = f" — {p.description}" if p.description else ""
            lines.append(f"- [{p.id}] {p.name}: RM{p.price:.2f}, {stock_note}{desc}")
    else:
        lines.append("\nNo products listed yet.")

    return "\n".join(lines)


def _create_order(business_id: str, product_id: str, qty: int) -> str:
    with SessionLocal() as session:
        product = session.query(Product).filter(
            Product.id == product_id,
            Product.businessId == business_id,
        ).first()
        if not product:
            raise ValueError(f"Product {product_id} not found for this business")
        if qty <= 0:
            raise ValueError("qty must be positive")
        if product.stock < qty:
            raise ValueError(f"Only {product.stock} in stock")
        order_id = generate_cuid()
        unit_price = Decimal(product.price)
        total = unit_price * Decimal(qty)
        order = Order(
            id=order_id,
            businessId=business_id,
            productId=product_id,
            agentType="support",
            qty=qty,
            unitPrice=unit_price,
            totalAmount=total,
            status=OrderStatus.PENDING_PAYMENT,
        )
        session.add(order)
        session.commit()
        return order_id


SYSTEM_TEMPLATE = """\
You are a helpful customer support agent for a seller.

{context}

Your job:
- Answer buyer questions accurately using ONLY the info above
- Be friendly and concise
- Reply in the same language the buyer uses (Malay or English)
- If you are unsure about anything, say so honestly — never fabricate stock or prices

Purchase flow:
- If the buyer clearly wants to purchase a specific product and quantity, call the create_payment_link tool with the product id and quantity.
- After the tool returns a URL, include that URL verbatim in your reply.
- Never invent a payment URL.

After any tool calls, you MUST respond with valid JSON only, no other text:
{{
  "reply": "<your reply to the buyer (include payment URL when a link was generated)>",
  "confidence": <float between 0.0 and 1.0>,
  "reasoning": "<one sentence explaining your confidence>"
}}

Confidence guide:
- 0.9+   : Direct factual answer from product data above, or confirmed payment link
- 0.7-0.9: Reasonable inference from available info
- <0.7   : Uncertain, info missing, or sensitive topic (complaints, refunds, shipping)
"""


def build_customer_support_agent(llm):
    async def load_context(state: SupportAgentState) -> dict:
        context = _build_context(state["business_id"])
        return {"business_context": context}

    def _make_tool(business_id: str):
        @tool
        def create_payment_link(product_id: str, qty: int) -> str:
            """Create a payment link for a buyer who wants to purchase a product.
            Args:
                product_id: the product id from the product list
                qty: quantity the buyer wants (positive integer)
            Returns a URL the buyer can open to pay, or an error message.
            """
            try:
                order_id = _create_order(business_id, product_id, qty)
                return f"{APP_URL}/pay/{order_id}"
            except Exception as e:
                return f"ERROR: {e}"
        return create_payment_link

    async def draft_reply(state: SupportAgentState) -> dict:
        tool_fn = _make_tool(state["business_id"])
        llm_with_tools = llm.bind_tools([tool_fn])
        system_prompt = SYSTEM_TEMPLATE.format(context=state["business_context"])

        history: list[BaseMessage] = [SystemMessage(content=system_prompt)] + list(state["messages"])

        for _ in range(3):
            response = await llm_with_tools.ainvoke(history)
            history.append(response)
            tool_calls = getattr(response, "tool_calls", None) or []
            if not tool_calls:
                break
            for call in tool_calls:
                result = tool_fn.invoke(call["args"])
                history.append(ToolMessage(content=str(result), tool_call_id=call["id"]))

        final = history[-1]
        content = final.content.strip() if isinstance(final.content, str) else ""
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
            content = content.strip()

        try:
            parsed = json.loads(content)
            return {
                "draft_reply": parsed["reply"],
                "confidence": float(parsed["confidence"]),
                "reasoning": parsed.get("reasoning", ""),
            }
        except (json.JSONDecodeError, KeyError):
            return {
                "draft_reply": content,
                "confidence": 0.5,
                "reasoning": "Failed to parse structured output",
            }

    async def route_decision(state: SupportAgentState) -> dict:
        action = "auto_send" if state["confidence"] >= 0.8 else "queue_approval"
        return {"action": action}

    def _route_edge(state: SupportAgentState) -> Literal["auto_send", "queue_approval"]:
        return state["action"]

    async def auto_send(state: SupportAgentState) -> dict:
        customer_msg = state["messages"][-1].content if state["messages"] else ""
        action_id = generate_cuid()
        with SessionLocal() as session:
            record = AgentAction(
                id=action_id,
                businessId=state["business_id"],
                customerMsg=customer_msg,
                draftReply=state["draft_reply"],
                finalReply=state["draft_reply"],
                confidence=state["confidence"],
                reasoning=state["reasoning"],
                status=AgentActionStatus.AUTO_SENT,
            )
            session.add(record)
            session.commit()
        return {"action_id": action_id}

    async def queue_approval(state: SupportAgentState) -> dict:
        customer_msg = state["messages"][-1].content if state["messages"] else ""
        action_id = generate_cuid()
        with SessionLocal() as session:
            record = AgentAction(
                id=action_id,
                businessId=state["business_id"],
                customerMsg=customer_msg,
                draftReply=state["draft_reply"],
                confidence=state["confidence"],
                reasoning=state["reasoning"],
                status=AgentActionStatus.PENDING,
            )
            session.add(record)
            session.commit()
        return {"action_id": action_id}

    graph = StateGraph(SupportAgentState)
    graph.add_node("load_context", load_context)
    graph.add_node("draft_reply", draft_reply)
    graph.add_node("route_decision", route_decision)
    graph.add_node("auto_send", auto_send)
    graph.add_node("queue_approval", queue_approval)

    graph.add_edge(START, "load_context")
    graph.add_edge("load_context", "draft_reply")
    graph.add_edge("draft_reply", "route_decision")
    graph.add_conditional_edges("route_decision", _route_edge, {
        "auto_send": "auto_send",
        "queue_approval": "queue_approval",
    })
    graph.add_edge("auto_send", END)
    graph.add_edge("queue_approval", END)

    return graph.compile()
```

- [ ] **Step 3: Import smoke test**

```bash
cd /Users/hariz/PisangProject/umhackathon2026/agents
.venv/bin/python -c "from app.agents.customer_support import build_customer_support_agent, _create_order; print('ok')"
```

Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
cd /Users/hariz/PisangProject/umhackathon2026
git add agents/app/agents/customer_support.py agents/.env
git commit -m "feat(agents): add create_payment_link tool and tool loop"
```

If `agents/.env` is gitignored, omit it from `git add`; just commit the python file.

---

## Task 12: Manual smoke test

**Files:** none changed

- [ ] **Step 1: Run TS app + python agent**

Terminal A:
```bash
cd /Users/hariz/PisangProject/umhackathon2026/agents
.venv/bin/python main.py
```

Terminal B:
```bash
cd /Users/hariz/PisangProject/umhackathon2026/app
pnpm dev
```

- [ ] **Step 2: Trigger a purchase intent**

Call the support chat endpoint with a buy message (adjust business_id to a real one in the DB):

```bash
curl -s http://localhost:8000/agent/support/chat \
  -H "Content-Type: application/json" \
  -d '{"business_id": "<BUSINESS_ID>", "customer_id": "test-buyer", "message": "I want to buy 2 pisang"}'
```

Expected: response includes a reply string containing `http://localhost:3000/pay/<cuid>`.

- [ ] **Step 3: Open the payment URL in a browser**

- Confirm summary shows the right product, qty, total.
- Fill name + contact, click "Pay".
- Success page appears.

- [ ] **Step 4: Verify inbox shows the sale**

- Sign in to `http://localhost:3000/<businessCode>/inbox`.
- "Sales" group should show one unread sale card.
- Click it → `OrderDetailPanel` appears with buyer + total.

- [ ] **Step 5: Verify Sales tab**

- Go to `http://localhost:3000/<businessCode>/agents/support?tab=sales`.
- Stats show 1 sale, revenue RMx.xx.
- Table lists the order.

- [ ] **Step 6: No commit**

This task is a manual verification only. If anything fails, open a targeted fix task.

---

## Self-Review Summary

Spec coverage:
- Order schema → Task 1 ✓
- Python Order model → Task 2 ✓
- Agent tool + LangGraph loop → Task 11 ✓
- order-logic helpers + tests → Task 3 ✓
- InboxItem union + matchesItemTab → Task 4 ✓
- Order server fns (public + authed + sales) → Task 5 ✓
- Public /pay/$orderId route → Task 6 ✓
- Inbox merge backend → Task 7 ✓
- Order inbox components → Task 8 ✓
- Inbox route mixed rendering + acknowledge → Task 9 ✓
- Sales tab + agent-tab-bar extension + route wiring → Task 10 ✓
- Manual end-to-end smoke test → Task 12 ✓

Out-of-scope items (real payment provider, multi-product cart, refund flow, SMS/email delivery, rate limiting) remain out-of-scope as documented in the spec.
