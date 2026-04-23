# Agent-Specific Dashboard Design

Date: 2026-04-24
Status: Draft

## Problem

Inbox currently shows every `AgentAction` regardless of whether the user needs to act on it — including `AUTO_SENT` rows that were already sent without confirmation. This buries the items that genuinely need human review.

The full interaction history (auto-sent, approved, rejected, pending) still has value but belongs in a per-agent context, not in the shared inbox.

## Goals

1. Inbox shows only items needing human confirmation.
2. Each agent has its own dashboard page that preserves the full interaction history, plus stats and (eventually) configuration.
3. Ship three tabs now: Dashboard, Runs, Budget. Instructions / Skills / Configuration deferred.

Non-goals: agent config UI, per-agent pause/resume control (stubbed only), automatic token/cost capture from the Python agent (follow-up).

## Inbox Filter Change

`app/src/lib/inbox-server-fns.ts`:

- `mine` tab: unchanged (`status: 'PENDING'`).
- `recent` tab: add `status: { not: 'AUTO_SENT' }` to the where clause.
- `unread` tab: add `status: { not: 'AUTO_SENT' }`.
- `fetchTabCounts`: same exclusions applied to `recent` and `unread` counts.

`AUTO_SENT` actions remain visible in the agent dashboard Runs tab.

## Route Restructure

Move from flat-dot routing to directory routing for clarity:

- `$businessCode.dashboard.tsx` → `$businessCode/dashboard.tsx`
- `$businessCode.inbox.tsx` → `$businessCode/inbox.tsx`
- `$businessCode.products.tsx` → `$businessCode/products.tsx`
- New: `$businessCode/agents/$agentType.tsx`

TanStack Router plugin regenerates `routeTree.gen.ts` from the new structure. Import paths inside files unchanged. `navigate()` targets in sidebar and elsewhere unchanged (path strings stay the same).

## Agent Dashboard Route

`app/src/routes/$businessCode/agents/$agentType.tsx`.

Loader:

- Fetch businesses, resolve current.
- Validate `agentType` against a known set (`'support'` for now). Unknown → redirect to inbox.
- Load initial data for the active tab only (based on search param) to keep the loader fast.

Search params (validated via `validateSearch`):

```ts
{ tab: 'dashboard' | 'runs' | 'budget' }  // default 'dashboard'
```

Page structure:

```
BusinessStrip | Sidebar | Main
Main:
  Header (agent name + colored dot + Pause/Run stubs)
  TabBar (Dashboard / Runs / Budget)
  TabContent (based on ?tab=...)
```

Sidebar wiring: the existing Support Agent entry navigates to `/$businessCode/agents/support`. When the current route is an agent route, highlight the matching agent row in the sidebar (border/accent background).

## Tab 1 — Dashboard

Server fn: `fetchAgentStats({ businessId, agentType, rangeDays })` returns:

```ts
{
  latestRun: AgentAction | null,
  totals: { total, pending, approved, rejected, autoSent },
  autoSendRate: number,       // autoSent / total
  approvalRate: number,       // approved / (approved + rejected)
  avgConfidence: number,
  runActivity: { date: string, count: number }[],                    // last 14 days
  statusBreakdown: { date: string, pending, approved, rejected, autoSent }[],
  confidenceDistribution: { bucket: string, count: number }[],       // 5 buckets
  successRate: { date: string, rate: number }[],                     // (approved + autoSent) / total per day
}
```

Layout:

- Latest Run card (customer message snippet, status badge, timestamp, confidence).
- Four stat cards: Total runs, Auto-send rate, Approval rate, Avg confidence.
- Four chart cards in a 2×2 grid: Run Activity, Status Breakdown, Confidence Distribution, Success Rate.
- Recent Runs table (last 10). Clicking a row switches to the Runs tab with that action selected (`?tab=runs&actionId=...`).

Charts reuse the CSS-based bar/line primitives in `app/src/components/dashboard/charts.tsx`. Extend that file with a stacked-bar variant for Status Breakdown and a line-chart variant for Success Rate if they don't already exist. No new chart library.

## Tab 2 — Runs

Server fn: `fetchAgentRuns({ businessId, agentType, status?, limit, cursor? })` returns paginated actions for that agent, newest first, default limit 50, all statuses unless filtered.

Layout mirrors inbox split view:

- Left pane: filter pills (All / Pending / Approved / Rejected / Auto-sent) + `RunListItem` rows. Each row: relative timestamp, 1-line customer message snippet, status badge, confidence. Selected row shown with accent border.
- Right pane: detail panel. Reuse `ActionDetailPanel` with a new `readOnly` mode when the selected action's status is not `PENDING`. Read-only mode hides approve/edit/reject buttons and shows `finalReply` + final status instead of the draft controls.
- "Load more" button at list bottom; `cursor` = last loaded action id.
- URL reflects selection (`?tab=runs&actionId=...`) so the Dashboard tab's "Recent Runs" link works.

New component: `app/src/components/agents/run-list-item.tsx` — simpler than `ActionListItem`, no agent grouping.

## Tab 3 — Budget

### Schema change

`app/prisma/schema.prisma`, `AgentAction` model:

```prisma
inputTokens   Int?
outputTokens  Int?
cachedTokens  Int?
costUsd       Decimal? @db.Decimal(10, 6)
```

All nullable. Existing rows have no token data; new rows will once the Python agent is updated (follow-up).

Migration: `pnpm prisma migrate dev --name agent_action_tokens`.

### Server fn

`fetchAgentBudget({ businessId, agentType, rangeDays })`:

```ts
{
  totals: { inputTokens, outputTokens, cachedTokens, totalCostUsd },
  rows: { id, createdAt, inputTokens, outputTokens, costUsd }[],  // paginated, newest first
}
```

Layout (matches Costs reference):

- Four stat cards: Input tokens, Output tokens, Cached tokens, Total cost.
- Range selector: 7d / 30d / all.
- Table: Date | Run ID (short, first 8 chars) | Input | Output | Cost. Null token/cost values render as `—`. Row click → `?tab=runs&actionId=...`.

## Components

New:

- `app/src/components/agents/agent-page-header.tsx` — name, dot, Pause/Run stubs.
- `app/src/components/agents/agent-tab-bar.tsx` — three-tab bar bound to search param.
- `app/src/components/agents/dashboard-tab.tsx`
- `app/src/components/agents/runs-tab.tsx`
- `app/src/components/agents/budget-tab.tsx`
- `app/src/components/agents/run-list-item.tsx`
- `app/src/components/agents/agent-stat-card.tsx` (or reuse `dashboard/stat-card.tsx` if shape matches).

Modified:

- `app/src/components/inbox/action-detail-panel.tsx` — add `readOnly` prop; hide action buttons, show `finalReply` + final status.
- `app/src/components/sidebar.tsx` — make Support Agent button navigate to its agent route; active highlight when route matches.
- `app/src/components/dashboard/charts.tsx` — add stacked-bar + line chart variants if needed.
- `app/src/lib/inbox-server-fns.ts` — AUTO_SENT exclusions.

## Data Flow Summary

1. User clicks Support Agent in sidebar → navigates to `/$businessCode/agents/support?tab=dashboard`.
2. Loader validates agentType, loads initial stats.
3. Tab switch updates search param, fetches that tab's data client-side.
4. Run row click in any tab → `?tab=runs&actionId=...`.
5. Approve/Edit/Reject in Runs tab (for PENDING rows) reuses existing server fns from `inbox-server-fns.ts`.

## Error Handling

- Unknown `agentType`: redirect to inbox.
- `fetchAgentStats` on empty data: return zeros, empty arrays — UI renders zero-state cards, not errors.
- Token/cost cols null: render `—` in Budget table, skip in totals sum.
- Non-owner access: existing `requireBusinessOwner` guard reused in every new server fn.

## Testing

- `app/src/__tests__/agent-stats.test.ts` — pure helpers that compute `autoSendRate`, `approvalRate`, `avgConfidence`, daily buckets, confidence distribution from a fixture array of AgentAction rows.
- Server fn auth guards covered by existing pattern (same as inbox).
- No UI snapshot tests.

## Out of Scope / Follow-ups

1. Python LangGraph agent writes `inputTokens`, `outputTokens`, `cachedTokens`, `costUsd` on action insert. Until done, Budget tab shows `—` for new rows.
2. Instructions / Skills / Configuration tabs.
3. Pause/Run agent control (header buttons are visual stubs).
4. Multi-agent support beyond `'support'` — schema allows it (`agentType` is a string), but sidebar + loader whitelist is currently single-entry.

## Summary of File Changes

New:
- `app/src/routes/$businessCode/agents/$agentType.tsx`
- `app/src/lib/agent-server-fns.ts`
- `app/src/lib/agent-stats.ts` (pure helpers, tested)
- `app/src/components/agents/*` (7 files listed above)
- `app/src/__tests__/agent-stats.test.ts`
- Prisma migration folder for token/cost cols

Moved (rename, content may need minor import adjustments):
- `app/src/routes/$businessCode.dashboard.tsx` → `app/src/routes/$businessCode/dashboard.tsx`
- `app/src/routes/$businessCode.inbox.tsx` → `app/src/routes/$businessCode/inbox.tsx`
- `app/src/routes/$businessCode.products.tsx` → `app/src/routes/$businessCode/products.tsx`

Modified:
- `app/prisma/schema.prisma`
- `app/src/lib/inbox-server-fns.ts`
- `app/src/components/inbox/action-detail-panel.tsx`
- `app/src/components/sidebar.tsx`
- `app/src/components/dashboard/charts.tsx` (if variants needed)
- `app/src/routeTree.gen.ts` (auto-regen)
