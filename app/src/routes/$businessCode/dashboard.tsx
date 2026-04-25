// app/src/routes/$businessCode.dashboard.tsx
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Users, Play, DollarSign, CheckSquare, Zap, MessageSquare } from 'lucide-react'
import { fetchBusinesses } from '#/lib/business-server-fns'
import { fetchDashboardStats } from '#/lib/dashboard-server-fns'
import { BusinessStrip } from '#/components/business-strip'
import { Sidebar } from '#/components/sidebar'
import { AgentCard } from '#/components/dashboard/agent-card'
import { StatCard } from '#/components/dashboard/stat-card'
import { ActivityChart, BarChart, SuccessRate } from '#/components/dashboard/charts'
import { ActivityFeed } from '#/components/dashboard/activity-feed'
import { EventDrawer } from '#/components/dashboard/event-drawer'
import { ConnectionBanner } from '#/components/dashboard/connection-banner'
import { agentApi } from '#/lib/agent-api'
import { openAgentEventStream } from '#/lib/agent-events-stream'
import { prependEvent } from '#/lib/agent-events-store'
import { agentRowToCard } from '#/lib/agent-row-to-card'

export const Route = createFileRoute('/$businessCode/dashboard')({
  loader: async ({ params }) => {
    const businesses = await fetchBusinesses()
    const current = businesses.find((b) => b.code === params.businessCode)
    if (!current) {
      if (businesses.length > 0) {
        throw redirect({
          to: '/$businessCode/dashboard',
          params: { businessCode: businesses[0].code },
        })
      }
      throw redirect({ to: '/' })
    }
    const dashboardStats = await fetchDashboardStats({ data: { businessId: current.id } })
    return { businesses, current, dashboardStats }
  },
  component: DashboardPage,
})

const SIDEBAR_COLORS = ['#3b7ef8', '#00c97a', '#a78bfa', '#f59e0b', '#ef4444']

function toBarHeights(items: { label: string; count: number; color: string }[]) {
  const max = Math.max(...items.map((i) => i.count), 1)
  return items.map((i) => ({
    label: i.label.slice(0, 6),
    height: Math.max(Math.round((i.count / max) * 100), 4),
    color: i.color,
  }))
}

function normalizeActivity(counts: number[]): number[] {
  const max = Math.max(...counts, 1)
  return counts.map((c) => (c / max) * 100)
}

function DashboardPage() {
  const { businesses, current, dashboardStats } = Route.useLoaderData()
  const { agents: legacyAgents, stats, charts } = dashboardStats

  const businessId = current.id
  const qc = useQueryClient()
  const [fallback, setFallback] = useState(false)
  const [drawerId, setDrawerId] = useState<number | null>(null)

  const { data: registry = [] } = useQuery({
    queryKey: ['registry', businessId],
    queryFn: () => agentApi.registry(businessId),
    refetchInterval: 15_000,
  })

  const { data: kpis } = useQuery({
    queryKey: ['kpis', businessId],
    queryFn: () => agentApi.kpis(businessId),
    refetchInterval: 30_000,
  })

  useEffect(() => {
    let pollTimer: ReturnType<typeof setInterval> | null = null
    const h = openAgentEventStream({
      businessId,
      onConnect: () => {
        setFallback(false)
        if (pollTimer) {
          clearInterval(pollTimer)
          pollTimer = null
        }
      },
      onFallback: () => {
        setFallback(true)
        pollTimer = setInterval(() => {
          qc.invalidateQueries({ queryKey: ['events'] })
          qc.invalidateQueries({ queryKey: ['registry', businessId] })
          qc.invalidateQueries({ queryKey: ['kpis', businessId] })
        }, 5000)
      },
      onEvent: (ev) => {
        prependEvent(qc, { businessId }, ev)
        qc.invalidateQueries({ queryKey: ['kpis', businessId] })
        qc.invalidateQueries({ queryKey: ['registry', businessId] })
      },
    })
    return () => {
      h.close()
      if (pollTimer) clearInterval(pollTimer)
    }
  }, [businessId, qc])

  // Use live registry if available, fall back to legacy agent list
  const displayAgents =
    registry.length > 0
      ? registry.map((row, i) => agentRowToCard(row, i))
      : legacyAgents

  const liveCount = displayAgents.filter(
    (a) => a.status === 'live' || a.status === 'running'
  ).length

  const sidebarAgents = displayAgents.map((a, i) => ({
    id: a.id,
    name: a.name,
    color: SIDEBAR_COLORS[i % SIDEBAR_COLORS.length],
    live: a.status === 'live' || a.status === 'running',
  }))

  const statCards = [
    {
      label: 'Agents Enabled',
      value: registry.length > 0 ? String(registry.length) : String(stats.agentCount),
      sub: `${kpis?.pending_approvals ?? stats.pendingCount} pending approval`,
      icon: Users,
      color: '#3b7ef8',
    },
    {
      label: 'Tasks In Progress',
      value: String(stats.totalCount),
      sub: `${kpis?.pending_approvals ?? stats.pendingCount} pending`,
      icon: Play,
      color: '#00c97a',
    },
    {
      label: 'Month Spend',
      value: '$0.00',
      sub: 'Unlimited budget',
      icon: DollarSign,
      color: '#a78bfa',
    },
    {
      label: 'Pending Approvals',
      value: String(kpis?.pending_approvals ?? stats.pendingCount),
      sub: 'Awaiting review',
      icon: CheckSquare,
      color: '#f59e0b',
    },
    {
      label: 'Active Conversations',
      value: String(kpis?.active_conversations ?? 0),
      sub: 'Right now',
      icon: MessageSquare,
      color: '#22d3ee',
    },
  ]

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0a0a0c' }}>
      <BusinessStrip businesses={businesses} />
      <Sidebar business={current} agents={sidebarAgents} />

      <main className="flex-1 overflow-auto flex flex-col" style={{ background: '#111113' }}>
        <ConnectionBanner fallback={fallback} />

        {/* Header */}
        <div className="px-8 pt-6 pb-5 border-b" style={{ borderColor: '#1a1a1e' }}>
          <div className="flex items-center justify-between">
            <div>
              <p
                className="text-[9px] uppercase tracking-[0.2em] mb-1"
                style={{ color: '#444', fontFamily: 'var(--font-mono)' }}
              >
                Overview
              </p>
              <h1
                className="text-[22px] font-bold tracking-tight"
                style={{ color: '#f0ede8', fontFamily: 'var(--font-display)' }}
              >
                Dashboard
              </h1>
            </div>
            <div className="flex items-center gap-2">
              {liveCount > 0 && (
                <div
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px]"
                  style={{
                    background: 'rgba(0,201,122,0.1)',
                    color: '#00a863',
                    border: '1px solid rgba(0,201,122,0.2)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{
                      background: '#00c97a',
                      animation: 'pulse-dot 1.8s ease-in-out infinite',
                    }}
                  />
                  {liveCount} agent{liveCount > 1 ? 's' : ''} live
                </div>
              )}
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium"
                style={{ background: '#1e1e24', color: '#c8c5c0', border: '1px solid #2a2a32' }}
              >
                <Zap size={12} />
                New task
              </button>
            </div>
          </div>
        </div>

        <div className="px-8 py-5 flex flex-col gap-5">
          {/* Agents */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <p
                className="text-[10px] uppercase tracking-[0.14em] font-semibold"
                style={{ color: '#444', fontFamily: 'var(--font-mono)' }}
              >
                Agents
              </p>
              <button
                className="text-[10px]"
                style={{ color: '#333', fontFamily: 'var(--font-mono)' }}
              >
                View all →
              </button>
            </div>
            {displayAgents.length === 0 ? (
              <div
                className="rounded-xl p-6 text-center"
                style={{
                  background: '#161618',
                  border: '1px solid #1e1e24',
                  color: '#444',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                }}
              >
                No agents active yet
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-2.5">
                {displayAgents.map((agent) => (
                  <AgentCard key={agent.id} agent={agent} />
                ))}
              </div>
            )}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-5 gap-2.5">
            {statCards.map((stat) => (
              <StatCard key={stat.label} {...stat} />
            ))}
          </div>

          {/* Charts */}
          <div className="grid gap-2.5" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr' }}>
            <ActivityChart bars={normalizeActivity(charts.activity)} />
            <BarChart bars={toBarHeights(charts.byStatus)} title="Tasks by Status" />
            <BarChart bars={toBarHeights(charts.byAgent)} title="By Agent" />
            <SuccessRate percent={charts.successRate} />
          </div>

          {/* Activity Feed */}
          <ActivityFeed
            filters={{ businessId }}
            onRowClick={(e) => setDrawerId(e.id)}
          />
        </div>

        {/* Event Drawer */}
        <EventDrawer
          eventId={drawerId}
          businessId={businessId}
          open={drawerId != null}
          onClose={() => setDrawerId(null)}
        />
      </main>
    </div>
  )
}
