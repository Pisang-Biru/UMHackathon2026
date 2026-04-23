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
    setBudgetRows(res.rows.map((r: any) => ({ ...r, createdAt: new Date(r.createdAt) })))
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
