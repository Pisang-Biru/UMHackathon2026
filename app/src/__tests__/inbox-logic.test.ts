import { describe, it, expect } from 'vitest'
import {
  groupByAgent,
  matchesTab,
  matchesItemTab,
  pickDisplayDraft,
  type InboxAction,
  type InboxOrder,
  type InboxItem,
} from '#/lib/inbox-logic'

function mk(overrides: Partial<InboxAction> = {}): InboxAction {
  return {
    id: 'a1',
    businessId: 'b1',
    customerMsg: 'msg',
    draftReply: 'reply',
    finalReply: null,
    confidence: 0.5,
    reasoning: 'r',
    status: 'PENDING',
    viewedAt: null,
    agentType: 'support',
    createdAt: new Date(),
    updatedAt: new Date(),
    bestDraft: null,
    escalationSummary: null,
    ...overrides,
  }
}

describe('groupByAgent', () => {
  it('returns empty array for empty input', () => {
    expect(groupByAgent([])).toEqual([])
  })

  it('groups actions by agentType', () => {
    const actions = [
      mk({ id: '1', agentType: 'support' }),
      mk({ id: '2', agentType: 'sales' }),
      mk({ id: '3', agentType: 'support' }),
    ]
    const result = groupByAgent(actions)
    expect(result).toHaveLength(2)
    const support = result.find((g) => g.agentType === 'support')
    const sales = result.find((g) => g.agentType === 'sales')
    expect(support?.actions).toHaveLength(2)
    expect(sales?.actions).toHaveLength(1)
  })

  it('preserves order within groups', () => {
    const a1 = mk({ id: '1', agentType: 'support' })
    const a2 = mk({ id: '2', agentType: 'support' })
    const a3 = mk({ id: '3', agentType: 'support' })
    const result = groupByAgent([a1, a2, a3])
    expect(result[0].actions.map((a) => a.id)).toEqual(['1', '2', '3'])
  })
})

describe('matchesTab', () => {
  const now = new Date('2026-04-24T12:00:00Z')

  it('mine: returns only PENDING', () => {
    expect(matchesTab(mk({ status: 'PENDING' }), 'mine', now)).toBe(true)
    expect(matchesTab(mk({ status: 'APPROVED' }), 'mine', now)).toBe(false)
    expect(matchesTab(mk({ status: 'REJECTED' }), 'mine', now)).toBe(false)
    expect(matchesTab(mk({ status: 'AUTO_SENT' }), 'mine', now)).toBe(false)
  })

  it('recent: within last 7 days and not AUTO_SENT', () => {
    const recent = new Date('2026-04-22T12:00:00Z')
    const old = new Date('2026-04-10T12:00:00Z')
    expect(matchesTab(mk({ createdAt: recent, status: 'APPROVED' }), 'recent', now)).toBe(true)
    expect(matchesTab(mk({ createdAt: recent, status: 'PENDING' }), 'recent', now)).toBe(true)
    expect(matchesTab(mk({ createdAt: recent, status: 'AUTO_SENT' }), 'recent', now)).toBe(false)
    expect(matchesTab(mk({ createdAt: old, status: 'APPROVED' }), 'recent', now)).toBe(false)
  })

  it('unread: only when viewedAt is null and not AUTO_SENT', () => {
    expect(matchesTab(mk({ viewedAt: null, status: 'PENDING' }), 'unread', now)).toBe(true)
    expect(matchesTab(mk({ viewedAt: null, status: 'AUTO_SENT' }), 'unread', now)).toBe(false)
    expect(matchesTab(mk({ viewedAt: new Date(), status: 'PENDING' }), 'unread', now)).toBe(false)
  })
})

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

describe('pickDisplayDraft', () => {
  it('prefers bestDraft when present', () => {
    const a = { bestDraft: 'rewrite', draftReply: 'v1' } as any
    expect(pickDisplayDraft(a)).toBe('rewrite')
  })
  it('falls back to draftReply when bestDraft is null', () => {
    const a = { bestDraft: null, draftReply: 'v1' } as any
    expect(pickDisplayDraft(a)).toBe('v1')
  })
  it('falls back to draftReply when bestDraft is undefined', () => {
    const a = { draftReply: 'v1' } as any
    expect(pickDisplayDraft(a)).toBe('v1')
  })
})
