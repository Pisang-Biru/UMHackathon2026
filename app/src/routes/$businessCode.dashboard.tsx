import { createFileRoute, notFound } from '@tanstack/react-router'
import { Users, Play, DollarSign, CheckSquare, Zap } from 'lucide-react'
import { fetchBusinesses } from '#/lib/business-server-fns'
import { BusinessStrip } from '#/components/business-strip'
import { Sidebar } from '#/components/sidebar'
import { AgentCard, type AgentCardData } from '#/components/dashboard/agent-card'
import { StatCard } from '#/components/dashboard/stat-card'
import { ActivityChart, BarChart, SuccessRate } from '#/components/dashboard/charts'

export const Route = createFileRoute('/$businessCode/dashboard')({
  loader: async ({ params }) => {
    const businesses = await fetchBusinesses()
    const current = businesses.find((b) => b.code === params.businessCode)
    if (!current) throw notFound()
    return { businesses, current }
  },
  component: DashboardPage,
})

// --- Static mock data ---

const MOCK_AGENTS: AgentCardData[] = [
  { id: 'cto-1', name: 'CTO', status: 'live', task: 'PIS-13 · Hardware prototype', lastActive: '4m ago', avatar: 'CT', color: '#3b7ef8', queuedCount: 1 },
  { id: 'cto-2', name: 'CTO', status: 'running', task: 'PIS-20 · Build and bench-test first sensor node', subtask: 'Continuation wake — plan exists, determining next steps...', lastActive: '2m ago', avatar: 'CT', color: '#3b7ef8' },
  { id: 'farming', name: 'Farming Researcher', status: 'finished', task: 'PIS-24 · Validate product design from farming domain', lastActive: '9m ago', avatar: 'FR', color: '#00c97a' },
  { id: 'cio', name: 'CIO', status: 'idle', lastActive: '—', avatar: 'CI', color: '#a78bfa' },
]

const MOCK_STATS = [
  { label: 'Agents Enabled', value: '4', sub: '1 running, 2 paused, 1 error', icon: Users, color: '#3b7ef8' },
  { label: 'Tasks In Progress', value: '1', sub: '18 open, 3 blocked', icon: Play, color: '#00c97a' },
  { label: 'Month Spend', value: '$0.00', sub: 'Unlimited budget', icon: DollarSign, color: '#a78bfa' },
  { label: 'Pending Approvals', value: '0', sub: 'Awaiting board review', icon: CheckSquare, color: '#f59e0b' },
]

const PRIORITY_BARS = [
  { label: 'Urgent', height: 72, color: '#ef4444' },
  { label: 'High', height: 48, color: '#f59e0b' },
  { label: 'Medium', height: 88, color: '#3b7ef8' },
  { label: 'Low', height: 32, color: '#555' },
]

const STATUS_BARS = [
  { label: 'Todo', height: 60, color: '#555' },
  { label: 'In Prog', height: 40, color: '#3b7ef8' },
  { label: 'Done', height: 92, color: '#00c97a' },
  { label: 'Blocked', height: 24, color: '#ef4444' },
]

const ACTIVITY_BARS = [16, 28, 20, 44, 36, 52, 40, 68, 56, 48, 72, 60, 44, 80]

const MOCK_SIDEBAR_AGENTS = [
  { id: 'ceo', name: 'CEO', color: '#f59e0b', live: false },
  { id: 'cto', name: 'CTO', color: '#3b7ef8', live: true },
  { id: 'farming', name: 'Farming Researcher', color: '#00c97a', live: false },
]

// --- Page component ---

function DashboardPage() {
  const { businesses, current } = Route.useLoaderData()
  const liveCount = MOCK_AGENTS.filter((a) => a.status === 'live' || a.status === 'running').length

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0a0a0c' }}>
      <BusinessStrip businesses={businesses} />
      <Sidebar business={current} agents={MOCK_SIDEBAR_AGENTS} />

      <main className="flex-1 overflow-auto" style={{ background: '#111113' }}>
        {/* Header */}
        <div className="px-8 pt-6 pb-5 border-b" style={{ borderColor: '#1a1a1e' }}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[9px] uppercase tracking-[0.2em] mb-1" style={{ color: '#444', fontFamily: 'var(--font-mono)' }}>
                Overview
              </p>
              <h1 className="text-[22px] font-bold tracking-tight" style={{ color: '#f0ede8', fontFamily: 'var(--font-display)' }}>
                Dashboard
              </h1>
            </div>
            <div className="flex items-center gap-2">
              {liveCount > 0 && (
                <div
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px]"
                  style={{ background: 'rgba(0,201,122,0.1)', color: '#00a863', border: '1px solid rgba(0,201,122,0.2)', fontFamily: 'var(--font-mono)' }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#00c97a', animation: 'pulse-dot 1.8s ease-in-out infinite' }} />
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
              <p className="text-[10px] uppercase tracking-[0.14em] font-semibold" style={{ color: '#444', fontFamily: 'var(--font-mono)' }}>
                Agents
              </p>
              <button className="text-[10px]" style={{ color: '#333', fontFamily: 'var(--font-mono)' }}>
                View all →
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2.5">
              {MOCK_AGENTS.map((agent) => (
                <AgentCard key={agent.id} agent={agent} />
              ))}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-4 gap-2.5">
            {MOCK_STATS.map((stat) => (
              <StatCard key={stat.label} {...stat} />
            ))}
          </div>

          {/* Charts */}
          <div className="grid gap-2.5" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr' }}>
            <ActivityChart bars={ACTIVITY_BARS} />
            <BarChart bars={PRIORITY_BARS} title="Tasks by Priority" />
            <BarChart bars={STATUS_BARS} title="Tasks by Status" />
            <SuccessRate percent={87} />
          </div>
        </div>
      </main>
    </div>
  )
}
