import { describe, it, expect } from 'vitest'
import {
  computeTotals,
  computeRates,
  averageConfidence,
  dailyActivity,
  dailyStatusBreakdown,
  confidenceDistribution,
  dailySuccessRate,
  type StatAction,
} from '#/lib/agent-stats'

function mk(overrides: Partial<StatAction> = {}): StatAction {
  return {
    status: 'PENDING',
    confidence: 0.5,
    createdAt: new Date('2026-04-24T10:00:00Z'),
    ...overrides,
  }
}

describe('computeTotals', () => {
  it('returns zeros for empty input', () => {
    expect(computeTotals([])).toEqual({ total: 0, pending: 0, approved: 0, rejected: 0, autoSent: 0 })
  })

  it('counts each status', () => {
    const actions = [
      mk({ status: 'PENDING' }),
      mk({ status: 'APPROVED' }),
      mk({ status: 'APPROVED' }),
      mk({ status: 'REJECTED' }),
      mk({ status: 'AUTO_SENT' }),
    ]
    expect(computeTotals(actions)).toEqual({ total: 5, pending: 1, approved: 2, rejected: 1, autoSent: 1 })
  })
})

describe('computeRates', () => {
  it('returns zero rates when total is 0', () => {
    expect(computeRates({ total: 0, pending: 0, approved: 0, rejected: 0, autoSent: 0 })).toEqual({
      autoSendRate: 0,
      approvalRate: 0,
    })
  })

  it('autoSendRate = autoSent/total, approvalRate = approved/(approved+rejected)', () => {
    const result = computeRates({ total: 10, pending: 2, approved: 4, rejected: 1, autoSent: 3 })
    expect(result.autoSendRate).toBeCloseTo(0.3)
    expect(result.approvalRate).toBeCloseTo(0.8)
  })

  it('approvalRate is 0 when no approved/rejected decisions exist', () => {
    const result = computeRates({ total: 5, pending: 5, approved: 0, rejected: 0, autoSent: 0 })
    expect(result.approvalRate).toBe(0)
  })
})

describe('averageConfidence', () => {
  it('returns 0 for empty input', () => {
    expect(averageConfidence([])).toBe(0)
  })

  it('averages confidence values', () => {
    expect(averageConfidence([mk({ confidence: 0.2 }), mk({ confidence: 0.8 })])).toBeCloseTo(0.5)
  })
})

describe('dailyActivity', () => {
  it('returns N zero buckets when no actions', () => {
    const now = new Date('2026-04-24T12:00:00Z')
    const result = dailyActivity([], 3, now)
    expect(result).toEqual([
      { date: '2026-04-22', count: 0 },
      { date: '2026-04-23', count: 0 },
      { date: '2026-04-24', count: 0 },
    ])
  })

  it('counts actions per day within range', () => {
    const now = new Date('2026-04-24T12:00:00Z')
    const actions = [
      mk({ createdAt: new Date('2026-04-24T01:00:00Z') }),
      mk({ createdAt: new Date('2026-04-24T09:00:00Z') }),
      mk({ createdAt: new Date('2026-04-23T09:00:00Z') }),
      mk({ createdAt: new Date('2026-04-20T09:00:00Z') }),
    ]
    const result = dailyActivity(actions, 3, now)
    expect(result.find((d) => d.date === '2026-04-24')?.count).toBe(2)
    expect(result.find((d) => d.date === '2026-04-23')?.count).toBe(1)
    expect(result.find((d) => d.date === '2026-04-22')?.count).toBe(0)
  })
})

describe('dailyStatusBreakdown', () => {
  it('returns per-status counts per day', () => {
    const now = new Date('2026-04-24T12:00:00Z')
    const actions = [
      mk({ createdAt: new Date('2026-04-24T01:00:00Z'), status: 'APPROVED' }),
      mk({ createdAt: new Date('2026-04-24T02:00:00Z'), status: 'AUTO_SENT' }),
      mk({ createdAt: new Date('2026-04-23T05:00:00Z'), status: 'REJECTED' }),
    ]
    const result = dailyStatusBreakdown(actions, 2, now)
    const today = result.find((d) => d.date === '2026-04-24')!
    expect(today).toEqual({ date: '2026-04-24', pending: 0, approved: 1, rejected: 0, autoSent: 1 })
    const yesterday = result.find((d) => d.date === '2026-04-23')!
    expect(yesterday.rejected).toBe(1)
  })
})

describe('confidenceDistribution', () => {
  it('buckets confidences into 5 ranges (0-0.2, 0.2-0.4, ..., 0.8-1.0)', () => {
    const actions = [
      mk({ confidence: 0.05 }),
      mk({ confidence: 0.3 }),
      mk({ confidence: 0.3 }),
      mk({ confidence: 0.95 }),
    ]
    const result = confidenceDistribution(actions)
    expect(result).toEqual([
      { bucket: '0-0.2', count: 1 },
      { bucket: '0.2-0.4', count: 2 },
      { bucket: '0.4-0.6', count: 0 },
      { bucket: '0.6-0.8', count: 0 },
      { bucket: '0.8-1.0', count: 1 },
    ])
  })
})

describe('dailySuccessRate', () => {
  it('rate = (approved + autoSent) / total per day, 0 when no actions', () => {
    const now = new Date('2026-04-24T12:00:00Z')
    const actions = [
      mk({ createdAt: new Date('2026-04-24T01:00:00Z'), status: 'APPROVED' }),
      mk({ createdAt: new Date('2026-04-24T02:00:00Z'), status: 'REJECTED' }),
      mk({ createdAt: new Date('2026-04-24T03:00:00Z'), status: 'AUTO_SENT' }),
    ]
    const result = dailySuccessRate(actions, 2, now)
    const today = result.find((d) => d.date === '2026-04-24')!
    expect(today.rate).toBeCloseTo(2 / 3)
    const yesterday = result.find((d) => d.date === '2026-04-23')!
    expect(yesterday.rate).toBe(0)
  })
})
