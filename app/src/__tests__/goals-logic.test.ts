import { describe, it, expect } from 'vitest'
import { groupGoals, type GoalRow } from '#/lib/goals-logic'

function g(partial: Partial<GoalRow>): GoalRow {
  return {
    id: partial.id ?? 'id',
    text: partial.text ?? 'text',
    status: partial.status ?? 'ACTIVE',
    createdAt: partial.createdAt ?? new Date('2026-04-25T00:00:00Z'),
    updatedAt: partial.updatedAt ?? new Date('2026-04-25T00:00:00Z'),
  }
}

describe('groupGoals', () => {
  it('splits goals by status into active, completed, archived', () => {
    const rows: GoalRow[] = [
      g({ id: 'a1', status: 'ACTIVE' }),
      g({ id: 'c1', status: 'COMPLETED' }),
      g({ id: 'r1', status: 'ARCHIVED' }),
      g({ id: 'a2', status: 'ACTIVE' }),
    ]
    const groups = groupGoals(rows)
    expect(groups.active.map((r) => r.id)).toEqual(['a1', 'a2'])
    expect(groups.completed.map((r) => r.id)).toEqual(['c1'])
    expect(groups.archived.map((r) => r.id)).toEqual(['r1'])
  })

  it('sorts each group by createdAt desc', () => {
    const rows: GoalRow[] = [
      g({ id: 'old', status: 'ACTIVE', createdAt: new Date('2026-04-20T00:00:00Z') }),
      g({ id: 'new', status: 'ACTIVE', createdAt: new Date('2026-04-25T00:00:00Z') }),
      g({ id: 'mid', status: 'ACTIVE', createdAt: new Date('2026-04-22T00:00:00Z') }),
    ]
    const groups = groupGoals(rows)
    expect(groups.active.map((r) => r.id)).toEqual(['new', 'mid', 'old'])
  })

  it('returns empty arrays when no goals', () => {
    const groups = groupGoals([])
    expect(groups.active).toEqual([])
    expect(groups.completed).toEqual([])
    expect(groups.archived).toEqual([])
  })
})
