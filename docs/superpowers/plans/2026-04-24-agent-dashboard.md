# Agent Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move auto-sent chatter out of the inbox and into a per-agent dashboard page with Dashboard, Runs, and Budget tabs.

**Architecture:** Single TanStack route `/$businessCode/agents/$agentType` with a `tab` search param driving three tab components. Pure stat helpers tested with vitest. Reuse existing dashboard chart primitives. Extend `ActionDetailPanel` with a `readOnly` mode for non-PENDING rows.

**Tech Stack:** TanStack Start + Router, Prisma (Postgres), React, vitest, Tailwind, existing CSS-based charts in `app/src/components/dashboard/charts.tsx`.

**Working directory for all commands:** `app/` (run `cd app` once per shell or prefix pnpm/prisma commands).

---

## File Structure

New files:
- `app/src/routes/$businessCode/agents/$agentType.tsx` — route
- `app/src/lib/agent-stats.ts` — pure computations
- `app/src/lib/agent-server-fns.ts` — TanStack server fns
- `app/src/components/agents/agent-page-header.tsx`
- `app/src/components/agents/agent-tab-bar.tsx`
- `app/src/components/agents/dashboard-tab.tsx`
- `app/src/components/agents/runs-tab.tsx`
- `app/src/components/agents/budget-tab.tsx`
- `app/src/components/agents/run-list-item.tsx`
- `app/src/__tests__/agent-stats.test.ts`
- Prisma migration folder created by `prisma migrate dev`

Moved (directory-form routes):
- `app/src/routes/$businessCode.dashboard.tsx` → `app/src/routes/$businessCode/dashboard.tsx`
- `app/src/routes/$businessCode.inbox.tsx` → `app/src/routes/$businessCode/inbox.tsx`
- `app/src/routes/$businessCode.products.tsx` → `app/src/routes/$businessCode/products.tsx`

Modified:
- `app/prisma/schema.prisma` — add token/cost cols on `AgentAction`
- `app/src/lib/inbox-server-fns.ts` — exclude AUTO_SENT in recent/unread
- `app/src/lib/inbox-logic.ts` — `matchesTab` also excludes AUTO_SENT in recent/unread
- `app/src/__tests__/inbox-logic.test.ts` — update recent test
- `app/src/components/inbox/action-detail-panel.tsx` — read-only mode
- `app/src/components/sidebar.tsx` — wire agent click + active state

---

## Task 1: Inbox — exclude AUTO_SENT from Recent/Unread

**Files:**
- Modify: `app/src/lib/inbox-logic.ts`
- Modify: `app/src/__tests__/inbox-logic.test.ts`
- Modify: `app/src/lib/inbox-server-fns.ts`

- [ ] **Step 1: Update tests for `matchesTab`**

Replace the `recent` and `unread` test cases in `app/src/__tests__/inbox-logic.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd app && pnpm vitest run src/__tests__/inbox-logic.test.ts
```

Expected: the two updated tests fail (AUTO_SENT still returned as `true`).

- [ ] **Step 3: Update `matchesTab`**

In `app/src/lib/inbox-logic.ts`, replace the `recent` and `unread` cases:

```ts
    case 'recent':
      return (
        action.status !== 'AUTO_SENT' &&
        now.getTime() - action.createdAt.getTime() <= SEVEN_DAYS_MS
      )
    case 'unread':
      return action.viewedAt === null && action.status !== 'AUTO_SENT'
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd app && pnpm vitest run src/__tests__/inbox-logic.test.ts
```

Expected: all pass.

- [ ] **Step 5: Update server fns**

In `app/src/lib/inbox-server-fns.ts`, modify `fetchInbox` handler where clauses:

```ts
    if (data.tab === 'mine') {
      where = { ...whereBase, status: 'PENDING' }
    } else if (data.tab === 'recent') {
      where = {
        ...whereBase,
        status: { not: 'AUTO_SENT' },
        createdAt: { gte: new Date(Date.now() - SEVEN_DAYS_MS) },
      }
    } else if (data.tab === 'unread') {
      where = { ...whereBase, status: { not: 'AUTO_SENT' }, viewedAt: null }
    }
```

And in `fetchTabCounts` handler, update the recent + unread counts:

```ts
    const [mine, recent, unread] = await Promise.all([
      prisma.agentAction.count({ where: { businessId: data.businessId, status: 'PENDING' } }),
      prisma.agentAction.count({
        where: {
          businessId: data.businessId,
          status: { not: 'AUTO_SENT' },
          createdAt: { gte: new Date(Date.now() - SEVEN_DAYS_MS) },
        },
      }),
      prisma.agentAction.count({
        where: { businessId: data.businessId, status: { not: 'AUTO_SENT' }, viewedAt: null },
      }),
    ])
```

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/inbox-logic.ts app/src/__tests__/inbox-logic.test.ts app/src/lib/inbox-server-fns.ts
git commit -m "feat: exclude AUTO_SENT actions from inbox recent/unread tabs"
```

---

## Task 2: Directory-form route restructure

**Files:**
- Move: `app/src/routes/$businessCode.dashboard.tsx` → `app/src/routes/$businessCode/dashboard.tsx`
- Move: `app/src/routes/$businessCode.inbox.tsx` → `app/src/routes/$businessCode/inbox.tsx`
- Move: `app/src/routes/$businessCode.products.tsx` → `app/src/routes/$businessCode/products.tsx`

- [ ] **Step 1: Create target directory and move files**

```bash
cd app/src/routes
mkdir -p '$businessCode'
git mv '$businessCode.dashboard.tsx' '$businessCode/dashboard.tsx'
git mv '$businessCode.inbox.tsx' '$businessCode/inbox.tsx'
git mv '$businessCode.products.tsx' '$businessCode/products.tsx'
```

- [ ] **Step 2: Regenerate route tree**

```bash
cd app && pnpm dev &  # starts dev to regenerate routeTree.gen.ts
```

Wait 5 seconds then stop the dev server (Ctrl-C) once `routeTree.gen.ts` has been regenerated. If `pnpm dev` is not suitable for CI-style steps, instead run:

```bash
cd app && pnpm exec tsc --noEmit
```

to verify types still compile. Route tree regenerates automatically on next dev run.

- [ ] **Step 3: Type-check**

```bash
cd app && pnpm exec tsc --noEmit
```

Expected: no errors. Existing `createFileRoute('/$businessCode/dashboard')` strings already match the new path.

- [ ] **Step 4: Commit**

```bash
git add -A app/src/routes app/src/routeTree.gen.ts
git commit -m "refactor: move businessCode routes to directory form"
```

---

## Task 3: Prisma — add token/cost columns

**Files:**
- Modify: `app/prisma/schema.prisma`
- Create: new migration folder under `app/prisma/migrations/`

- [ ] **Step 1: Update schema**

In `app/prisma/schema.prisma`, `AgentAction` model, add four lines before `createdAt`:

```prisma
  inputTokens   Int?
  outputTokens  Int?
  cachedTokens  Int?
  costUsd       Decimal? @db.Decimal(10, 6)
```

- [ ] **Step 2: Generate migration**

```bash
cd app && pnpm exec prisma migrate dev --name agent_action_tokens
```

Expected: new migration folder created, Prisma client regenerated. Database updated.

- [ ] **Step 3: Verify generated types**

```bash
cd app && pnpm exec tsc --noEmit
```

Expected: no type errors. The four new fields now appear in `AgentAction` type.

- [ ] **Step 4: Commit**

```bash
git add app/prisma/schema.prisma app/prisma/migrations app/src/generated
git commit -m "feat: add token usage and cost columns to AgentAction"
```

---

## Task 4: Agent stats helpers (pure, TDD)

**Files:**
- Create: `app/src/lib/agent-stats.ts`
- Create: `app/src/__tests__/agent-stats.test.ts`

- [ ] **Step 1: Write failing tests**

Create `app/src/__tests__/agent-stats.test.ts`:

```ts
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
      mk({ createdAt: new Date('2026-04-20T09:00:00Z') }), // outside 3-day window
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd app && pnpm vitest run src/__tests__/agent-stats.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement helpers**

Create `app/src/lib/agent-stats.ts`:

```ts
import type { AgentActionStatus } from '#/lib/inbox-logic'

export interface StatAction {
  status: AgentActionStatus
  confidence: number
  createdAt: Date
}

export interface Totals {
  total: number
  pending: number
  approved: number
  rejected: number
  autoSent: number
}

export function computeTotals(actions: StatAction[]): Totals {
  const totals: Totals = { total: 0, pending: 0, approved: 0, rejected: 0, autoSent: 0 }
  for (const a of actions) {
    totals.total++
    if (a.status === 'PENDING') totals.pending++
    else if (a.status === 'APPROVED') totals.approved++
    else if (a.status === 'REJECTED') totals.rejected++
    else if (a.status === 'AUTO_SENT') totals.autoSent++
  }
  return totals
}

export function computeRates(totals: Totals): { autoSendRate: number; approvalRate: number } {
  const autoSendRate = totals.total === 0 ? 0 : totals.autoSent / totals.total
  const decided = totals.approved + totals.rejected
  const approvalRate = decided === 0 ? 0 : totals.approved / decided
  return { autoSendRate, approvalRate }
}

export function averageConfidence(actions: StatAction[]): number {
  if (actions.length === 0) return 0
  const sum = actions.reduce((acc, a) => acc + a.confidence, 0)
  return sum / actions.length
}

function dayKey(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function lastNDays(days: number, now: Date): string[] {
  const out: string[] = []
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base)
    d.setUTCDate(base.getUTCDate() - i)
    out.push(dayKey(d))
  }
  return out
}

export function dailyActivity(
  actions: StatAction[],
  days: number,
  now: Date = new Date(),
): { date: string; count: number }[] {
  const keys = lastNDays(days, now)
  const counts = new Map<string, number>(keys.map((k) => [k, 0]))
  for (const a of actions) {
    const key = dayKey(a.createdAt)
    if (counts.has(key)) counts.set(key, counts.get(key)! + 1)
  }
  return keys.map((date) => ({ date, count: counts.get(date)! }))
}

export interface StatusDay {
  date: string
  pending: number
  approved: number
  rejected: number
  autoSent: number
}

export function dailyStatusBreakdown(
  actions: StatAction[],
  days: number,
  now: Date = new Date(),
): StatusDay[] {
  const keys = lastNDays(days, now)
  const map = new Map<string, StatusDay>(
    keys.map((k) => [k, { date: k, pending: 0, approved: 0, rejected: 0, autoSent: 0 }]),
  )
  for (const a of actions) {
    const day = map.get(dayKey(a.createdAt))
    if (!day) continue
    if (a.status === 'PENDING') day.pending++
    else if (a.status === 'APPROVED') day.approved++
    else if (a.status === 'REJECTED') day.rejected++
    else if (a.status === 'AUTO_SENT') day.autoSent++
  }
  return keys.map((k) => map.get(k)!)
}

const CONF_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: '0-0.2', min: 0, max: 0.2 },
  { label: '0.2-0.4', min: 0.2, max: 0.4 },
  { label: '0.4-0.6', min: 0.4, max: 0.6 },
  { label: '0.6-0.8', min: 0.6, max: 0.8 },
  { label: '0.8-1.0', min: 0.8, max: 1.0001 },
]

export function confidenceDistribution(actions: StatAction[]): { bucket: string; count: number }[] {
  const counts = CONF_BUCKETS.map((b) => ({ bucket: b.label, count: 0 }))
  for (const a of actions) {
    const i = CONF_BUCKETS.findIndex((b) => a.confidence >= b.min && a.confidence < b.max)
    if (i >= 0) counts[i].count++
  }
  return counts
}

export function dailySuccessRate(
  actions: StatAction[],
  days: number,
  now: Date = new Date(),
): { date: string; rate: number }[] {
  const breakdown = dailyStatusBreakdown(actions, days, now)
  return breakdown.map((d) => {
    const total = d.pending + d.approved + d.rejected + d.autoSent
    const good = d.approved + d.autoSent
    return { date: d.date, rate: total === 0 ? 0 : good / total }
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd app && pnpm vitest run src/__tests__/agent-stats.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/agent-stats.ts app/src/__tests__/agent-stats.test.ts
git commit -m "feat: add agent-stats pure helpers"
```

---

## Task 5: Agent server fns

**Files:**
- Create: `app/src/lib/agent-server-fns.ts`

- [ ] **Step 1: Create server fns file**

Create `app/src/lib/agent-server-fns.ts`:

```ts
import { createServerFn } from '@tanstack/react-start'
import { redirect } from '@tanstack/react-router'
import { prisma } from '#/db'
import { auth } from '#/lib/auth'
import {
  computeTotals,
  computeRates,
  averageConfidence,
  dailyActivity,
  dailyStatusBreakdown,
  confidenceDistribution,
  dailySuccessRate,
} from '#/lib/agent-stats'

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

export const KNOWN_AGENT_TYPES = ['support'] as const
export type KnownAgentType = (typeof KNOWN_AGENT_TYPES)[number]

function validateAgentType(raw: unknown): KnownAgentType {
  if (typeof raw !== 'string' || !(KNOWN_AGENT_TYPES as readonly string[]).includes(raw)) {
    throw new Error('Unknown agentType')
  }
  return raw as KnownAgentType
}

function validateCommon(data: unknown) {
  if (typeof data !== 'object' || data === null) throw new Error('Invalid input')
  const d = data as Record<string, unknown>
  if (typeof d.businessId !== 'string') throw new Error('businessId required')
  const agentType = validateAgentType(d.agentType)
  return { businessId: d.businessId, agentType, raw: d }
}

export const fetchAgentStats = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => {
    const { businessId, agentType, raw } = validateCommon(data)
    const rangeDays = typeof raw.rangeDays === 'number' ? raw.rangeDays : 14
    return { businessId, agentType, rangeDays }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    await requireBusinessOwner(data.businessId, session.user.id)

    const since = new Date(Date.now() - data.rangeDays * 24 * 60 * 60 * 1000)
    const [actions, latestRun] = await Promise.all([
      prisma.agentAction.findMany({
        where: { businessId: data.businessId, agentType: data.agentType, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.agentAction.findFirst({
        where: { businessId: data.businessId, agentType: data.agentType },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    const totals = computeTotals(actions)
    const rates = computeRates(totals)
    return {
      latestRun,
      totals,
      autoSendRate: rates.autoSendRate,
      approvalRate: rates.approvalRate,
      avgConfidence: averageConfidence(actions),
      runActivity: dailyActivity(actions, data.rangeDays),
      statusBreakdown: dailyStatusBreakdown(actions, data.rangeDays),
      confidenceDistribution: confidenceDistribution(actions),
      successRate: dailySuccessRate(actions, data.rangeDays),
      recent: actions.slice(0, 10),
    }
  })

export const fetchAgentRuns = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => {
    const { businessId, agentType, raw } = validateCommon(data)
    const status = raw.status
    if (status !== undefined && status !== 'PENDING' && status !== 'APPROVED' && status !== 'REJECTED' && status !== 'AUTO_SENT') {
      throw new Error('Invalid status filter')
    }
    const limit = typeof raw.limit === 'number' ? Math.min(raw.limit, 100) : 50
    const cursor = typeof raw.cursor === 'string' ? raw.cursor : undefined
    return { businessId, agentType, status: status as undefined | 'PENDING' | 'APPROVED' | 'REJECTED' | 'AUTO_SENT', limit, cursor }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    await requireBusinessOwner(data.businessId, session.user.id)

    const where: Record<string, unknown> = { businessId: data.businessId, agentType: data.agentType }
    if (data.status) where.status = data.status

    const rows = await prisma.agentAction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: data.limit + 1,
      ...(data.cursor ? { cursor: { id: data.cursor }, skip: 1 } : {}),
    })
    const hasMore = rows.length > data.limit
    const page = hasMore ? rows.slice(0, data.limit) : rows
    return { rows: page, nextCursor: hasMore ? page[page.length - 1].id : null }
  })

export const fetchAgentBudget = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => {
    const { businessId, agentType, raw } = validateCommon(data)
    const rangeDays = typeof raw.rangeDays === 'number' ? raw.rangeDays : 30
    return { businessId, agentType, rangeDays }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    await requireBusinessOwner(data.businessId, session.user.id)

    const since = data.rangeDays > 0 ? new Date(Date.now() - data.rangeDays * 24 * 60 * 60 * 1000) : new Date(0)
    const rows = await prisma.agentAction.findMany({
      where: { businessId: data.businessId, agentType: data.agentType, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        inputTokens: true,
        outputTokens: true,
        cachedTokens: true,
        costUsd: true,
      },
    })

    let inputTokens = 0
    let outputTokens = 0
    let cachedTokens = 0
    let totalCostUsd = 0
    for (const r of rows) {
      inputTokens += r.inputTokens ?? 0
      outputTokens += r.outputTokens ?? 0
      cachedTokens += r.cachedTokens ?? 0
      totalCostUsd += r.costUsd ? Number(r.costUsd) : 0
    }
    return {
      totals: { inputTokens, outputTokens, cachedTokens, totalCostUsd },
      rows,
    }
  })
```

- [ ] **Step 2: Type-check**

```bash
cd app && pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/agent-server-fns.ts
git commit -m "feat: add agent-server-fns for stats, runs, budget"
```

---

## Task 6: Extend ActionDetailPanel with readOnly mode

**Files:**
- Modify: `app/src/components/inbox/action-detail-panel.tsx`

- [ ] **Step 1: Update component**

In `app/src/components/inbox/action-detail-panel.tsx`, update the props interface and signature:

```ts
interface ActionDetailPanelProps {
  action: InboxAction | null
  onApprove?: (action: InboxAction) => Promise<void>
  onEdit?: (action: InboxAction, reply: string) => Promise<void>
  onReject?: (action: InboxAction) => Promise<void>
  readOnly?: boolean
}

export function ActionDetailPanel({ action, onApprove, onEdit, onReject, readOnly = false }: ActionDetailPanelProps) {
```

Replace `const isPending = action.status === 'PENDING'` with:

```ts
  const canAct = !readOnly && action.status === 'PENDING' && onApprove && onEdit && onReject
```

Then in the JSX, replace every occurrence of `isPending` with `canAct`. The edit button, the action buttons row, the save-and-approve handler — all gated on `canAct`. The `onApprove(action)`, `onEdit(action, draft)`, `onReject(action)` calls already exist; wrap them with non-null asserts (`onApprove!(action)` etc) inside the `canAct` branch where TypeScript needs it.

The final JSX block that uses the callbacks:

```tsx
        {canAct && (
          <div className="flex gap-2 mt-2">
            {editing ? (
              <>
                <Button
                  onClick={() => run(async () => { await onEdit!(action, draft); setEditing(false) })}
                  disabled={busy || !draft.trim()}
                  className="flex-1 flex items-center gap-1.5"
                  style={{ background: '#3b7ef8', color: '#fff' }}
                >
                  <Check size={14} /> Save & approve
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => { setEditing(false); setDraft(action.draftReply) }}
                  disabled={busy}
                  style={{ color: '#666' }}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button
                  onClick={() => run(async () => { await onApprove!(action) })}
                  disabled={busy}
                  className="flex-1 flex items-center gap-1.5"
                  style={{ background: '#00c97a', color: '#0a0a0c' }}
                >
                  <Check size={14} /> Approve
                </Button>
                <Button
                  onClick={() => run(async () => { await onReject!(action) })}
                  disabled={busy}
                  variant="ghost"
                  className="flex items-center gap-1.5"
                  style={{ color: '#ef4444' }}
                >
                  <X size={14} /> Reject
                </Button>
              </>
            )}
          </div>
        )}
```

Also replace the edit pencil gate with `canAct && !editing`.

- [ ] **Step 2: Type-check**

```bash
cd app && pnpm exec tsc --noEmit
```

Expected: no errors. Existing inbox usage still supplies all three callbacks.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/inbox/action-detail-panel.tsx
git commit -m "feat: make ActionDetailPanel support read-only mode"
```

---

## Task 7: RunListItem component

**Files:**
- Create: `app/src/components/agents/run-list-item.tsx`

- [ ] **Step 1: Create component**

Create `app/src/components/agents/run-list-item.tsx`:

```tsx
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
```

- [ ] **Step 2: Type-check**

```bash
cd app && pnpm exec tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add app/src/components/agents/run-list-item.tsx
git commit -m "feat: add RunListItem component"
```

---

## Task 8: Agent page header + tab bar

**Files:**
- Create: `app/src/components/agents/agent-page-header.tsx`
- Create: `app/src/components/agents/agent-tab-bar.tsx`

- [ ] **Step 1: Create header component**

Create `app/src/components/agents/agent-page-header.tsx`:

```tsx
import { Play, Pause } from 'lucide-react'

interface AgentPageHeaderProps {
  name: string
  color: string
  paused?: boolean
}

export function AgentPageHeader({ name, color, paused = false }: AgentPageHeaderProps) {
  return (
    <div className="px-8 pt-6 pb-4 border-b flex items-center gap-3" style={{ borderColor: '#1a1a1e' }}>
      <div className="w-6 h-6 rounded-full" style={{ background: color + '30', border: `1.5px solid ${color}80` }} />
      <div className="flex-1">
        <p className="text-[9px] uppercase tracking-[0.2em] mb-1" style={{ color: '#444', fontFamily: 'var(--font-mono)' }}>
          Agent
        </p>
        <h1 className="text-[22px] font-bold tracking-tight" style={{ color: '#f0ede8', fontFamily: 'var(--font-display)' }}>
          {name}
        </h1>
      </div>
      <button
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px]"
        style={{ background: '#16161a', border: '1px solid #1e1e24', color: '#c8c5c0' }}
        disabled
        title="Coming soon"
      >
        {paused ? <Play size={12} /> : <Pause size={12} />}
        {paused ? 'Resume' : 'Pause'}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Create tab bar**

Create `app/src/components/agents/agent-tab-bar.tsx`:

```tsx
export type AgentTab = 'dashboard' | 'runs' | 'budget'

interface AgentTabBarProps {
  active: AgentTab
  onChange: (tab: AgentTab) => void
}

const TABS: { id: AgentTab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'runs', label: 'Runs' },
  { id: 'budget', label: 'Budget' },
]

export function AgentTabBar({ active, onChange }: AgentTabBarProps) {
  return (
    <div className="flex gap-4 px-8 border-b" style={{ borderColor: '#1a1a1e' }}>
      {TABS.map((t) => {
        const isActive = t.id === active
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className="py-3 text-[12px] transition-colors"
            style={{
              color: isActive ? '#f0ede8' : '#555',
              borderBottom: isActive ? '1.5px solid #3b7ef8' : '1.5px solid transparent',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 3: Type-check and commit**

```bash
cd app && pnpm exec tsc --noEmit
git add app/src/components/agents/agent-page-header.tsx app/src/components/agents/agent-tab-bar.tsx
git commit -m "feat: add agent page header and tab bar"
```

---

## Task 9: Dashboard tab component

**Files:**
- Create: `app/src/components/agents/dashboard-tab.tsx`

- [ ] **Step 1: Create component**

Create `app/src/components/agents/dashboard-tab.tsx`:

```tsx
import type { InboxAction } from '#/lib/inbox-logic'
import type { StatusDay } from '#/lib/agent-stats'
import { ActivityChart, BarChart, SuccessRate } from '#/components/dashboard/charts'

interface DashboardTabProps {
  latestRun: InboxAction | null
  totals: { total: number; pending: number; approved: number; rejected: number; autoSent: number }
  autoSendRate: number
  approvalRate: number
  avgConfidence: number
  runActivity: { date: string; count: number }[]
  statusBreakdown: StatusDay[]
  confidenceDistribution: { bucket: string; count: number }[]
  successRate: { date: string; rate: number }[]
  recent: InboxAction[]
  onSelectRun: (id: string) => void
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl p-4" style={{ background: '#161618', border: '1px solid #1e1e24' }}>
      <p className="text-[10px] uppercase tracking-[0.14em] mb-2" style={{ color: '#555', fontFamily: 'var(--font-mono)' }}>{label}</p>
      <p className="text-[22px] font-bold" style={{ color: '#f0ede8', fontFamily: 'var(--font-display)' }}>{value}</p>
      {sub && <p className="text-[10px] mt-1" style={{ color: '#444', fontFamily: 'var(--font-mono)' }}>{sub}</p>}
    </div>
  )
}

function normalizeBars(values: number[]): number[] {
  const max = Math.max(1, ...values)
  return values.map((v) => (v / max) * 100)
}

export function DashboardTab(props: DashboardTabProps) {
  const activityBars = normalizeBars(props.runActivity.map((d) => d.count))
  const confBars = props.confidenceDistribution.map((b) => ({
    label: b.bucket,
    height: (b.count / Math.max(1, ...props.confidenceDistribution.map((x) => x.count))) * 100,
    color: '#3b7ef8',
  }))
  const successPercent = Math.round(
    (props.successRate.reduce((a, r) => a + r.rate, 0) / Math.max(1, props.successRate.length)) * 100,
  )
  const statusBars = props.statusBreakdown.map((d) => {
    const total = d.pending + d.approved + d.rejected + d.autoSent
    return {
      label: d.date.slice(5),
      height: total === 0 ? 0 : (total / Math.max(1, ...props.statusBreakdown.map((x) => x.pending + x.approved + x.rejected + x.autoSent))) * 100,
      color: '#00c97a',
    }
  })

  return (
    <div className="p-8 overflow-auto flex flex-col gap-6">
      {/* Latest run */}
      {props.latestRun && (
        <div className="rounded-xl p-4" style={{ background: '#161618', border: '1px solid #1e1e24' }}>
          <p className="text-[10px] uppercase tracking-[0.14em] mb-2" style={{ color: '#555', fontFamily: 'var(--font-mono)' }}>Latest run</p>
          <p className="text-[13px] mb-1" style={{ color: '#e8e6e2' }}>{props.latestRun.customerMsg}</p>
          <p className="text-[11px]" style={{ color: '#666', fontFamily: 'var(--font-mono)' }}>
            {props.latestRun.status} · conf {props.latestRun.confidence.toFixed(2)} · {new Date(props.latestRun.createdAt).toLocaleString()}
          </p>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-3">
        <StatTile label="Total runs" value={String(props.totals.total)} sub={`${props.totals.pending} pending`} />
        <StatTile label="Auto-send rate" value={`${Math.round(props.autoSendRate * 100)}%`} />
        <StatTile label="Approval rate" value={`${Math.round(props.approvalRate * 100)}%`} sub={`${props.totals.approved} / ${props.totals.approved + props.totals.rejected}`} />
        <StatTile label="Avg confidence" value={props.avgConfidence.toFixed(2)} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-3">
        <ActivityChart bars={activityBars} />
        <BarChart bars={statusBars} title="Status breakdown" />
        <BarChart bars={confBars} title="Confidence distribution" />
        <SuccessRate percent={successPercent} />
      </div>

      {/* Recent */}
      <div className="rounded-xl" style={{ background: '#161618', border: '1px solid #1e1e24' }}>
        <p className="px-4 py-3 text-[10px] uppercase tracking-[0.14em] border-b" style={{ color: '#555', fontFamily: 'var(--font-mono)', borderColor: '#1e1e24' }}>
          Recent runs
        </p>
        {props.recent.length === 0 ? (
          <p className="px-4 py-6 text-[12px]" style={{ color: '#444' }}>No runs yet</p>
        ) : (
          props.recent.map((r) => (
            <button
              key={r.id}
              onClick={() => props.onSelectRun(r.id)}
              className="w-full text-left px-4 py-2.5 border-b flex items-center gap-3 hover:bg-white/5"
              style={{ borderColor: '#1a1a1e' }}
            >
              <span className="text-[10px] w-16 shrink-0" style={{ color: '#555', fontFamily: 'var(--font-mono)' }}>
                {new Date(r.createdAt).toLocaleDateString()}
              </span>
              <span className="text-[13px] truncate flex-1" style={{ color: '#c8c5c0' }}>{r.customerMsg}</span>
              <span className="text-[10px] shrink-0" style={{ color: '#666', fontFamily: 'var(--font-mono)' }}>{r.status}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check and commit**

```bash
cd app && pnpm exec tsc --noEmit
git add app/src/components/agents/dashboard-tab.tsx
git commit -m "feat: add agent dashboard tab component"
```

---

## Task 10: Runs tab component

**Files:**
- Create: `app/src/components/agents/runs-tab.tsx`

- [ ] **Step 1: Create component**

Create `app/src/components/agents/runs-tab.tsx`:

```tsx
import React from 'react'
import type { InboxAction, AgentActionStatus } from '#/lib/inbox-logic'
import { RunListItem } from '#/components/agents/run-list-item'
import { ActionDetailPanel } from '#/components/inbox/action-detail-panel'

type FilterStatus = 'ALL' | AgentActionStatus

interface RunsTabProps {
  rows: InboxAction[]
  nextCursor: string | null
  selectedId: string | null
  filter: FilterStatus
  onFilterChange: (status: FilterStatus) => void
  onSelect: (action: InboxAction) => void
  onLoadMore: () => Promise<void>
  onApprove: (action: InboxAction) => Promise<void>
  onEdit: (action: InboxAction, reply: string) => Promise<void>
  onReject: (action: InboxAction) => Promise<void>
}

const FILTERS: { id: FilterStatus; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'PENDING', label: 'Pending' },
  { id: 'APPROVED', label: 'Approved' },
  { id: 'REJECTED', label: 'Rejected' },
  { id: 'AUTO_SENT', label: 'Auto-sent' },
]

export function RunsTab(props: RunsTabProps) {
  const selected = props.rows.find((r) => r.id === props.selectedId) ?? null
  const isPending = selected?.status === 'PENDING'

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="flex-1 overflow-auto flex flex-col">
        <div className="flex gap-1.5 px-6 py-3 border-b" style={{ borderColor: '#1a1a1e' }}>
          {FILTERS.map((f) => {
            const active = f.id === props.filter
            return (
              <button
                key={f.id}
                onClick={() => props.onFilterChange(f.id)}
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
        <div className="flex-1">
          {props.rows.length === 0 ? (
            <p className="px-6 py-10 text-[12px]" style={{ color: '#444' }}>No runs</p>
          ) : (
            props.rows.map((r) => (
              <RunListItem
                key={r.id}
                action={r}
                selected={r.id === props.selectedId}
                onClick={() => props.onSelect(r)}
              />
            ))
          )}
          {props.nextCursor && (
            <button
              onClick={() => props.onLoadMore()}
              className="w-full py-3 text-[11px]"
              style={{ color: '#3b7ef8', fontFamily: 'var(--font-mono)' }}
            >
              Load more
            </button>
          )}
        </div>
      </div>
      <ActionDetailPanel
        action={selected}
        readOnly={!isPending}
        onApprove={isPending ? props.onApprove : undefined}
        onEdit={isPending ? props.onEdit : undefined}
        onReject={isPending ? props.onReject : undefined}
      />
    </div>
  )
}
```

- [ ] **Step 2: Type-check and commit**

```bash
cd app && pnpm exec tsc --noEmit
git add app/src/components/agents/runs-tab.tsx
git commit -m "feat: add agent runs tab component"
```

---

## Task 11: Budget tab component

**Files:**
- Create: `app/src/components/agents/budget-tab.tsx`

- [ ] **Step 1: Create component**

Create `app/src/components/agents/budget-tab.tsx`:

```tsx
interface BudgetRow {
  id: string
  createdAt: Date
  inputTokens: number | null
  outputTokens: number | null
  costUsd: unknown
}

interface BudgetTabProps {
  totals: { inputTokens: number; outputTokens: number; cachedTokens: number; totalCostUsd: number }
  rows: BudgetRow[]
  rangeDays: number
  onRangeChange: (days: number) => void
  onSelectRun: (id: string) => void
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function cell(v: number | null): string {
  return v == null ? '—' : formatTokens(v)
}

const RANGES: { label: string; days: number }[] = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: 'All', days: 365 * 100 },
]

export function BudgetTab({ totals, rows, rangeDays, onRangeChange, onSelectRun }: BudgetTabProps) {
  return (
    <div className="p-8 overflow-auto flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <p className="text-[14px] font-semibold" style={{ color: '#f0ede8', fontFamily: 'var(--font-display)' }}>Costs</p>
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

      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Input tokens', value: formatTokens(totals.inputTokens) },
          { label: 'Output tokens', value: formatTokens(totals.outputTokens) },
          { label: 'Cached tokens', value: formatTokens(totals.cachedTokens) },
          { label: 'Total cost', value: `$${totals.totalCostUsd.toFixed(2)}` },
        ].map((s) => (
          <div key={s.label} className="rounded-xl p-4" style={{ background: '#161618', border: '1px solid #1e1e24' }}>
            <p className="text-[10px] uppercase tracking-[0.14em] mb-2" style={{ color: '#555', fontFamily: 'var(--font-mono)' }}>{s.label}</p>
            <p className="text-[22px] font-bold" style={{ color: '#f0ede8', fontFamily: 'var(--font-display)' }}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl overflow-hidden" style={{ background: '#161618', border: '1px solid #1e1e24' }}>
        <div className="grid grid-cols-5 px-4 py-2.5 border-b text-[10px] uppercase tracking-[0.14em]" style={{ borderColor: '#1e1e24', color: '#555', fontFamily: 'var(--font-mono)' }}>
          <span>Date</span>
          <span>Run</span>
          <span className="text-right">Input</span>
          <span className="text-right">Output</span>
          <span className="text-right">Cost</span>
        </div>
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-[12px]" style={{ color: '#444' }}>No runs in range</p>
        ) : (
          rows.map((r) => (
            <button
              key={r.id}
              onClick={() => onSelectRun(r.id)}
              className="w-full grid grid-cols-5 px-4 py-2.5 border-b text-[12px] hover:bg-white/5"
              style={{ borderColor: '#1a1a1e' }}
            >
              <span style={{ color: '#888' }}>{new Date(r.createdAt).toLocaleDateString()}</span>
              <span style={{ color: '#c8c5c0', fontFamily: 'var(--font-mono)' }}>{r.id.slice(0, 8)}</span>
              <span className="text-right" style={{ color: '#c8c5c0', fontFamily: 'var(--font-mono)' }}>{cell(r.inputTokens)}</span>
              <span className="text-right" style={{ color: '#c8c5c0', fontFamily: 'var(--font-mono)' }}>{cell(r.outputTokens)}</span>
              <span className="text-right" style={{ color: '#c8c5c0', fontFamily: 'var(--font-mono)' }}>{r.costUsd == null ? '—' : `$${Number(r.costUsd).toFixed(4)}`}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check and commit**

```bash
cd app && pnpm exec tsc --noEmit
git add app/src/components/agents/budget-tab.tsx
git commit -m "feat: add agent budget tab component"
```

---

## Task 12: Agent route wiring

**Files:**
- Create: `app/src/routes/$businessCode/agents/$agentType.tsx`

- [ ] **Step 1: Create route**

Create `app/src/routes/$businessCode/agents/$agentType.tsx`:

```tsx
import React from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { fetchBusinesses } from '#/lib/business-server-fns'
import { fetchAgentStats, fetchAgentRuns, fetchAgentBudget, KNOWN_AGENT_TYPES } from '#/lib/agent-server-fns'
import { approveAction, editAction, rejectAction } from '#/lib/inbox-server-fns'
import { BusinessStrip } from '#/components/business-strip'
import { Sidebar } from '#/components/sidebar'
import { AgentPageHeader } from '#/components/agents/agent-page-header'
import { AgentTabBar, type AgentTab } from '#/components/agents/agent-tab-bar'
import { DashboardTab } from '#/components/agents/dashboard-tab'
import { RunsTab } from '#/components/agents/runs-tab'
import { BudgetTab } from '#/components/agents/budget-tab'
import type { InboxAction, AgentActionStatus } from '#/lib/inbox-logic'

const AGENT_META: Record<string, { name: string; color: string }> = {
  support: { name: 'Support Agent', color: '#3b7ef8' },
}

type FilterStatus = 'ALL' | AgentActionStatus

export const Route = createFileRoute('/$businessCode/agents/$agentType')({
  validateSearch: (search: Record<string, unknown>) => {
    const tab = search.tab
    const actionId = search.actionId
    return {
      tab: (tab === 'dashboard' || tab === 'runs' || tab === 'budget' ? tab : 'dashboard') as AgentTab,
      actionId: typeof actionId === 'string' ? actionId : undefined,
    }
  },
  loader: async ({ params }) => {
    if (!(KNOWN_AGENT_TYPES as readonly string[]).includes(params.agentType)) {
      throw redirect({ to: '/$businessCode/inbox', params: { businessCode: params.businessCode } })
    }
    const businesses = await fetchBusinesses()
    const current = businesses.find((b) => b.code === params.businessCode)
    if (!current) {
      if (businesses.length > 0) {
        throw redirect({ to: '/$businessCode/dashboard', params: { businessCode: businesses[0].code } })
      }
      throw redirect({ to: '/' })
    }
    const stats = await fetchAgentStats({ data: { businessId: current.id, agentType: params.agentType, rangeDays: 14 } })
    return { businesses, current, agentType: params.agentType, stats }
  },
  component: AgentPage,
})

function normalize(raw: any): InboxAction {
  return {
    ...raw,
    createdAt: new Date(raw.createdAt),
    updatedAt: new Date(raw.updatedAt),
    viewedAt: raw.viewedAt ? new Date(raw.viewedAt) : null,
  }
}

function AgentPage() {
  const { businesses, current, agentType, stats } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const meta = AGENT_META[agentType] ?? { name: agentType, color: '#888' }

  const [runsRows, setRunsRows] = React.useState<InboxAction[]>([])
  const [runsCursor, setRunsCursor] = React.useState<string | null>(null)
  const [runsFilter, setRunsFilter] = React.useState<FilterStatus>('ALL')
  const [runsLoaded, setRunsLoaded] = React.useState(false)

  const [budgetRows, setBudgetRows] = React.useState<any[]>([])
  const [budgetTotals, setBudgetTotals] = React.useState({ inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalCostUsd: 0 })
  const [budgetRange, setBudgetRange] = React.useState(30)
  const [budgetLoaded, setBudgetLoaded] = React.useState(false)

  async function loadRuns(filter: FilterStatus, cursor: string | null = null) {
    const res = await fetchAgentRuns({
      data: {
        businessId: current.id,
        agentType,
        status: filter === 'ALL' ? undefined : filter,
        cursor: cursor ?? undefined,
      },
    })
    const rows = res.rows.map(normalize)
    setRunsRows((prev) => (cursor ? [...prev, ...rows] : rows))
    setRunsCursor(res.nextCursor)
    setRunsLoaded(true)
  }

  async function loadBudget(days: number) {
    const res = await fetchAgentBudget({ data: { businessId: current.id, agentType, rangeDays: days } })
    setBudgetRows(res.rows.map((r) => ({ ...r, createdAt: new Date(r.createdAt) })))
    setBudgetTotals(res.totals)
    setBudgetLoaded(true)
  }

  React.useEffect(() => {
    if (search.tab === 'runs' && !runsLoaded) loadRuns(runsFilter)
    if (search.tab === 'budget' && !budgetLoaded) loadBudget(budgetRange)
  }, [search.tab])

  function setTab(tab: AgentTab) {
    navigate({
      to: '/$businessCode/agents/$agentType',
      params: { businessCode: current.code, agentType },
      search: { tab, actionId: undefined },
    } as any)
  }

  function selectRun(id: string) {
    navigate({
      to: '/$businessCode/agents/$agentType',
      params: { businessCode: current.code, agentType },
      search: { tab: 'runs', actionId: id },
    } as any)
    if (!runsLoaded) loadRuns(runsFilter)
  }

  async function handleApprove(action: InboxAction) {
    const updated = await approveAction({ data: { actionId: action.id } })
    const u = normalize(updated)
    setRunsRows((prev) => prev.map((r) => (r.id === u.id ? u : r)))
  }
  async function handleEdit(action: InboxAction, reply: string) {
    const updated = await editAction({ data: { actionId: action.id, reply } })
    const u = normalize(updated)
    setRunsRows((prev) => prev.map((r) => (r.id === u.id ? u : r)))
  }
  async function handleReject(action: InboxAction) {
    const updated = await rejectAction({ data: { actionId: action.id } })
    const u = normalize(updated)
    setRunsRows((prev) => prev.map((r) => (r.id === u.id ? u : r)))
  }

  const sidebarAgents = [{ id: 'support', name: 'Support Agent', color: '#3b7ef8', live: false }]
  const latestRun = stats.latestRun ? normalize(stats.latestRun) : null
  const recent = stats.recent.map(normalize)

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0a0a0c' }}>
      <BusinessStrip businesses={businesses} />
      <Sidebar business={current} agents={sidebarAgents} activeAgentType={agentType} />
      <main className="flex-1 flex flex-col overflow-hidden" style={{ background: '#111113' }}>
        <AgentPageHeader name={meta.name} color={meta.color} />
        <AgentTabBar active={search.tab} onChange={setTab} />
        {search.tab === 'dashboard' && (
          <DashboardTab
            latestRun={latestRun}
            totals={stats.totals}
            autoSendRate={stats.autoSendRate}
            approvalRate={stats.approvalRate}
            avgConfidence={stats.avgConfidence}
            runActivity={stats.runActivity}
            statusBreakdown={stats.statusBreakdown}
            confidenceDistribution={stats.confidenceDistribution}
            successRate={stats.successRate}
            recent={recent}
            onSelectRun={selectRun}
          />
        )}
        {search.tab === 'runs' && (
          <RunsTab
            rows={runsRows.filter((r) => runsFilter === 'ALL' || r.status === runsFilter)}
            nextCursor={runsCursor}
            selectedId={search.actionId ?? null}
            filter={runsFilter}
            onFilterChange={(f) => { setRunsFilter(f); setRunsRows([]); setRunsCursor(null); loadRuns(f) }}
            onSelect={(a) => selectRun(a.id)}
            onLoadMore={() => loadRuns(runsFilter, runsCursor)}
            onApprove={handleApprove}
            onEdit={handleEdit}
            onReject={handleReject}
          />
        )}
        {search.tab === 'budget' && (
          <BudgetTab
            totals={budgetTotals}
            rows={budgetRows}
            rangeDays={budgetRange}
            onRangeChange={(d) => { setBudgetRange(d); loadBudget(d) }}
            onSelectRun={selectRun}
          />
        )}
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd app && pnpm exec tsc --noEmit
```

Expected: one error in `Sidebar` usage because `activeAgentType` prop does not exist yet. Fixed in next task.

- [ ] **Step 3: Commit (will fully pass after Task 13)**

```bash
git add app/src/routes/$businessCode/agents/$agentType.tsx app/src/routeTree.gen.ts
git commit -m "feat: add agent dashboard route"
```

---

## Task 13: Sidebar wiring + active state

**Files:**
- Modify: `app/src/components/sidebar.tsx`

- [ ] **Step 1: Update Sidebar**

In `app/src/components/sidebar.tsx`, update the interface:

```ts
interface SidebarProps {
  business: Business
  agents?: Agent[]
  activeAgentType?: string
}

export function Sidebar({ business, agents = [], activeAgentType }: SidebarProps) {
```

Update the agent button to navigate and show active state. Replace the `{agents.map((agent) => (...))}` block with:

```tsx
            {agents.map((agent) => {
              const active = agent.id === activeAgentType
              return (
                <button
                  key={agent.id}
                  onClick={() => navigate({
                    to: '/$businessCode/agents/$agentType',
                    params: { businessCode: business.code, agentType: agent.id },
                  } as any)}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] transition-colors hover:bg-white/5"
                  style={{
                    color: active ? '#e8e6e2' : '#555',
                    background: active ? '#16161a' : 'transparent',
                    border: active ? '1px solid #1e1e24' : '1px solid transparent',
                  }}
                >
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ background: agent.color + '25', border: `1.5px solid ${agent.color}50` }}
                  />
                  <span className="flex-1 text-left truncate">{agent.name}</span>
                  {agent.live && (
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: '#00c97a', animation: 'pulse-dot 1.8s ease-in-out infinite' }}
                    />
                  )}
                </button>
              )
            })}
```

- [ ] **Step 2: Type-check**

```bash
cd app && pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Manual smoke test**

```bash
cd app && pnpm dev
```

Open `http://localhost:3000/<businessCode>/inbox` — inbox should no longer show AUTO_SENT in Recent/Unread tabs.
Click Support Agent in sidebar — should navigate to `/<businessCode>/agents/support?tab=dashboard`.
Switch tabs — Runs shows list, Budget shows table (`—` for null token cols).
Click a run in Dashboard's "Recent runs" — should jump to Runs tab with detail open.
PENDING row in Runs still has approve/edit/reject; non-PENDING rows show detail read-only.

Stop dev server (Ctrl-C).

- [ ] **Step 4: Commit**

```bash
git add app/src/components/sidebar.tsx
git commit -m "feat: wire sidebar agent click with active state"
```

---

## Self-Review Summary

Spec coverage check:
- Inbox filter change → Task 1 ✓
- Route restructure → Task 2 ✓
- Schema change → Task 3 ✓
- Agent stats helpers → Task 4 ✓
- Server fns (stats, runs, budget) → Task 5 ✓
- Agent route + tab param → Task 12 ✓
- Dashboard tab → Task 9 ✓
- Runs tab + readOnly panel → Tasks 6, 7, 10 ✓
- Budget tab → Task 11 ✓
- Sidebar wiring + active state → Task 13 ✓
- Tests for stat helpers → Task 4 ✓

Out-of-scope (documented in spec): Python agent token emission, Instructions/Skills/Config tabs, pause/resume functionality.
