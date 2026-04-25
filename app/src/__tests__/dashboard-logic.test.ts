import { describe, it, expect } from 'vitest'
import {
  bucketActivity,
  computeSuccessRate,
  mapAgentStatus,
  type DbActionStatus,
  formatRelativeTime,
  buildAgentCards,
} from '#/lib/dashboard-logic'

const NOW = new Date('2026-04-24T12:00:00Z')

describe('bucketActivity', () => {
  it('returns 14 zeros for empty input', () => {
    expect(bucketActivity([], NOW)).toEqual(Array(14).fill(0))
  })

  it('counts today in slot 13', () => {
    const today = new Date('2026-04-24T08:00:00Z')
    const result = bucketActivity([today], NOW)
    expect(result[13]).toBe(1)
    expect(result.slice(0, 13)).toEqual(Array(13).fill(0))
  })

  it('counts 1 day ago in slot 12', () => {
    const yesterday = new Date('2026-04-23T08:00:00Z')
    const result = bucketActivity([yesterday], NOW)
    expect(result[12]).toBe(1)
  })

  it('counts 13 days ago in slot 0', () => {
    const old = new Date('2026-04-11T08:00:00Z')
    const result = bucketActivity([old], NOW)
    expect(result[0]).toBe(1)
  })

  it('ignores dates older than 13 days', () => {
    const tooOld = new Date('2026-04-10T08:00:00Z')
    const result = bucketActivity([tooOld], NOW)
    expect(result).toEqual(Array(14).fill(0))
  })

  it('accumulates multiple dates in same slot', () => {
    const d1 = new Date('2026-04-24T08:00:00Z')
    const d2 = new Date('2026-04-24T10:00:00Z')
    const result = bucketActivity([d1, d2], NOW)
    expect(result[13]).toBe(2)
  })
})

describe('computeSuccessRate', () => {
  it('returns 0 when no resolved actions', () => {
    expect(computeSuccessRate([])).toBe(0)
    expect(computeSuccessRate([{ status: 'PENDING', _count: { _all: 5 } }])).toBe(0)
  })

  it('returns 100 when all approved', () => {
    expect(computeSuccessRate([{ status: 'APPROVED', _count: { _all: 10 } }])).toBe(100)
  })

  it('returns 0 when all rejected', () => {
    expect(computeSuccessRate([{ status: 'REJECTED', _count: { _all: 10 } }])).toBe(0)
  })

  it('computes rounded percentage', () => {
    const counts = [
      { status: 'APPROVED', _count: { _all: 2 } },
      { status: 'REJECTED', _count: { _all: 1 } },
    ]
    expect(computeSuccessRate(counts)).toBe(67)
  })

  it('ignores AUTO_SENT and PENDING in calculation', () => {
    const counts = [
      { status: 'APPROVED', _count: { _all: 3 } },
      { status: 'REJECTED', _count: { _all: 1 } },
      { status: 'AUTO_SENT', _count: { _all: 100 } },
      { status: 'PENDING', _count: { _all: 50 } },
    ]
    expect(computeSuccessRate(counts)).toBe(75)
  })
})

describe('mapAgentStatus', () => {
  it('maps PENDING to live', () => {
    expect(mapAgentStatus('PENDING')).toBe('live')
  })

  it('maps AUTO_SENT to running', () => {
    expect(mapAgentStatus('AUTO_SENT')).toBe('running')
  })

  it('maps APPROVED to finished', () => {
    expect(mapAgentStatus('APPROVED')).toBe('finished')
  })

  it('maps REJECTED to finished', () => {
    expect(mapAgentStatus('REJECTED')).toBe('finished')
  })

  it('maps null to idle', () => {
    expect(mapAgentStatus(null)).toBe('idle')
  })
})

describe('formatRelativeTime', () => {
  it('returns "just now" for sub-minute', () => {
    const d = new Date(NOW.getTime() - 30000)
    expect(formatRelativeTime(d, NOW)).toBe('just now')
  })

  it('returns minutes', () => {
    const d = new Date(NOW.getTime() - 5 * 60000)
    expect(formatRelativeTime(d, NOW)).toBe('5m ago')
  })

  it('returns hours', () => {
    const d = new Date(NOW.getTime() - 3 * 3600000)
    expect(formatRelativeTime(d, NOW)).toBe('3h ago')
  })

  it('returns days', () => {
    const d = new Date(NOW.getTime() - 2 * 86400000)
    expect(formatRelativeTime(d, NOW)).toBe('2d ago')
  })
})

describe('buildAgentCards', () => {
  const makeAction = (agentType: string, status: DbActionStatus, customerMsg = 'hello', createdAt = NOW) => ({
    agentType,
    status,
    customerMsg,
    createdAt,
  })

  it('returns empty array for empty input', () => {
    expect(buildAgentCards([], NOW)).toEqual([])
  })

  it('creates one card per unique agentType', () => {
    const actions = [
      makeAction('support', 'PENDING'),
      makeAction('sales', 'APPROVED'),
      makeAction('support', 'APPROVED'),
    ]
    const cards = buildAgentCards(actions, NOW)
    expect(cards).toHaveLength(2)
    // agent-meta now derives display names via titlecase fallback;
    // backend AGENT_META is the single source of truth for canonical names.
    expect(cards.map(c => c.name)).toContain('Support')
    expect(cards.map(c => c.name)).toContain('Sales')
  })

  it('uses latest action (first in list, assumed desc order) for status', () => {
    const actions = [
      makeAction('support', 'PENDING', 'new msg', new Date(NOW.getTime() - 60000)),
      makeAction('support', 'APPROVED', 'old msg', new Date(NOW.getTime() - 120000)),
    ]
    const cards = buildAgentCards(actions, NOW)
    expect(cards[0].status).toBe('live')
  })

  it('truncates customerMsg over 60 chars', () => {
    const longMsg = 'a'.repeat(80)
    const actions = [makeAction('support', 'PENDING', longMsg)]
    const cards = buildAgentCards(actions, NOW)
    expect(cards[0].task).toBe('a'.repeat(60) + '…')
  })

  it('sets avatar from display name initials', () => {
    const actions = [makeAction('support', 'PENDING')]
    const cards = buildAgentCards(actions, NOW)
    expect(cards[0].avatar).toBe('SU')
  })

  it('assigns colors deterministically by index', () => {
    const actions = [
      makeAction('support', 'PENDING'),
      makeAction('sales', 'APPROVED'),
    ]
    const cards = buildAgentCards(actions, NOW)
    expect(cards[0].color).toBe('#3b7ef8')
    expect(cards[1].color).toBe('#00c97a')
  })
})
