import { describe, it, expect } from 'vitest'
import { groupByAgent, matchesTab, type InboxAction } from '#/lib/inbox-logic'

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

  it('recent: within last 7 days any status', () => {
    const recent = new Date('2026-04-22T12:00:00Z')
    const old = new Date('2026-04-10T12:00:00Z')
    expect(matchesTab(mk({ createdAt: recent, status: 'APPROVED' }), 'recent', now)).toBe(true)
    expect(matchesTab(mk({ createdAt: recent, status: 'AUTO_SENT' }), 'recent', now)).toBe(true)
    expect(matchesTab(mk({ createdAt: old }), 'recent', now)).toBe(false)
  })

  it('unread: only when viewedAt is null', () => {
    expect(matchesTab(mk({ viewedAt: null }), 'unread', now)).toBe(true)
    expect(matchesTab(mk({ viewedAt: new Date() }), 'unread', now)).toBe(false)
  })
})
