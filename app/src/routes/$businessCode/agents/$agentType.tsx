import React from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { fetchBusinesses } from '#/lib/business-server-fns'
import { fetchAgentRuns, fetchAgentBudget, fetchAgentDashboard } from '#/lib/agent-server-fns'
import { approveAction, rejectAction } from '#/lib/inbox-server-fns'
import { fetchAgentSales } from '#/lib/order-server-fns'
import { fetchSidebarAgents } from '#/lib/sidebar-server-fns'
import { BusinessStrip } from '#/components/business-strip'
import { Sidebar } from '#/components/sidebar'
import { AgentPageHeader } from '#/components/agents/agent-page-header'
import { AgentTabBar, type AgentTab } from '#/components/agents/agent-tab-bar'
import { DashboardTab } from '#/components/agents/dashboard-tab'
import { RunsTab } from '#/components/agents/runs-tab'
import { BudgetTab } from '#/components/agents/budget-tab'
import { SalesTab } from '#/components/agents/sales-tab'
import type { InboxAction, AgentActionStatus } from '#/lib/inbox-logic'
import { getAgentMeta } from '#/lib/agent-meta'

type FilterStatus = 'ALL' | AgentActionStatus

export const Route = createFileRoute('/$businessCode/agents/$agentType')({
  validateSearch: (search: Record<string, unknown>) => {
    const tab = search.tab
    const actionId = search.actionId
    return {
      tab: (tab === 'dashboard' || tab === 'runs' || tab === 'budget' || tab === 'sales' ? tab : 'dashboard') as AgentTab,
      actionId: typeof actionId === 'string' ? actionId : undefined,
    }
  },
  loader: async ({ params }) => {
    const businesses = await fetchBusinesses()
    const current = businesses.find((b) => b.code === params.businessCode)
    if (!current) {
      if (businesses.length > 0) {
        throw redirect({ to: '/$businessCode/dashboard', params: { businessCode: businesses[0].code } })
      }
      throw redirect({ to: '/' })
    }
    const [dashboard, sidebarAgents] = await Promise.all([
      fetchAgentDashboard({ data: { businessId: current.id, agentType: params.agentType, rangeDays: 14 } }),
      fetchSidebarAgents({ data: { businessId: current.id } }),
    ])
    return { businesses, current, agentType: params.agentType, dashboard, sidebarAgents }
  },
  component: AgentPage,
})

function normalize(raw: any): InboxAction {
  return {
    ...raw,
    createdAt: new Date(raw.createdAt),
    updatedAt: new Date(raw.updatedAt),
    viewedAt: raw.viewedAt ? new Date(raw.viewedAt) : null,
    bestDraft: raw.bestDraft ?? null,
    escalationSummary: raw.escalationSummary ?? null,
  }
}

function AgentPage() {
  const { businesses, current, agentType, dashboard, sidebarAgents } = Route.useLoaderData()

  const panelMods = import.meta.glob('/src/components/agents/panels/*.tsx', { eager: true }) as Record<string, { default: React.ComponentType<{ businessId: string; agentType: string }> }>
  const Panel = panelMods[`/src/components/agents/panels/${agentType}.tsx`]?.default
  const search = Route.useSearch()
  const navigate = useNavigate()
  // Prefer the registry-sourced row from the sidebar (matches what the
  // sidebar shows). Fall back to the local titlecase helper if the agent
  // isn't in the registry yet (e.g., dev mode before boot upsert ran).
  const fromSidebar = sidebarAgents.find((a) => a.id === agentType)
  const meta = fromSidebar
    ? { name: fromSidebar.name, color: fromSidebar.color }
    : getAgentMeta(agentType)

  const [runsRows, setRunsRows] = React.useState<InboxAction[]>([])
  const [runsCursor, setRunsCursor] = React.useState<string | null>(null)
  const [runsFilter, setRunsFilter] = React.useState<FilterStatus>('ALL')
  const [runsLoaded, setRunsLoaded] = React.useState(false)

  const [budgetRows, setBudgetRows] = React.useState<any[]>([])
  const [budgetTotals, setBudgetTotals] = React.useState({ inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalCostUsd: 0 })
  const [budgetRange, setBudgetRange] = React.useState(30)
  const [budgetLoaded, setBudgetLoaded] = React.useState(false)

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
    setBudgetRows(res.rows.map((r: any) => ({ ...r, createdAt: new Date(r.createdAt) })))
    setBudgetTotals(res.totals)
    setBudgetLoaded(true)
  }

  React.useEffect(() => {
    if (search.tab === 'runs' && !runsLoaded) loadRuns(runsFilter)
    if (search.tab === 'budget' && !budgetLoaded) loadBudget(budgetRange)
    if (search.tab === 'sales' && !salesLoaded) loadSales(salesRange)
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

  async function handleApprove(action: InboxAction, reply: string) {
    const updated = await approveAction({ data: { actionId: action.id, reply } })
    const u = normalize(updated)
    setRunsRows((prev) => prev.map((r) => (r.id === u.id ? u : r)))
  }
  async function handleReject(action: InboxAction) {
    const updated = await rejectAction({ data: { actionId: action.id } })
    const u = normalize(updated)
    setRunsRows((prev) => prev.map((r) => (r.id === u.id ? u : r)))
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0a0a0c' }}>
      <BusinessStrip businesses={businesses} />
      <Sidebar business={current} agents={sidebarAgents} activeAgentType={agentType} />
      <main className="flex-1 flex flex-col overflow-hidden" style={{ background: '#111113' }}>
        <AgentPageHeader name={meta.name} color={meta.color} />
        <AgentTabBar active={search.tab} onChange={setTab} />
        {search.tab === 'dashboard' && (
          <DashboardTab
            latestRun={dashboard.latestRun}
            totals={dashboard.totals}
            cost={dashboard.cost}
            activity={dashboard.activity}
            statusBreakdown={dashboard.statusBreakdown}
            avgDurationMs={dashboard.avgDurationMs}
            recent={dashboard.recent}
            customPanel={Panel ? <Panel businessId={current.id} agentType={agentType} /> : null}
            onSelectRun={(refTable, refId) => {
              if (refTable === 'agent_action' || refTable === 'agent_action_manager') {
                navigate({
                  to: '/$businessCode/agents/$agentType',
                  params: { businessCode: current.code, agentType },
                  search: { tab: 'runs', actionId: refId },
                } as any)
              }
            }}
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
      </main>
    </div>
  )
}
