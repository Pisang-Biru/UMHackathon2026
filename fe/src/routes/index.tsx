import { createFileRoute } from '@tanstack/react-router'
import {
  LayoutDashboard,
  CircleDot,
  RefreshCw,
  Target,
  Rocket,
  Users,
  Building2,
  Brain,
  Wheat,
  Plus,
  Settings,
  ChevronDown,
  Zap,
  DollarSign,
  CheckSquare,
  MoreHorizontal,
  Play,
  Pause,
} from 'lucide-react'

export const Route = createFileRoute('/')({ component: Dashboard })

const businesses = [
  { id: 'pisang', label: 'Pisang Biru', initials: 'PB', color: '#3b7ef8', active: true },
  { id: 'agri', label: 'AgriTech Co', initials: 'AG', color: '#00c97a', active: false },
  { id: 'nex', label: 'Nexora Labs', initials: 'NL', color: '#a78bfa', active: false },
]

function BusinessStrip() {
  return (
    <div
      className="w-12 shrink-0 flex flex-col items-center py-3 h-full"
      style={{ background: '#080809', borderRight: '1px solid #1a1a1e' }}
    >
      <div className="flex-1 flex flex-col items-center gap-2 pt-1">
        {businesses.map((biz) => (
          <div key={biz.id} className="relative flex items-center">
            {biz.active && (
              <div
                className="absolute -left-3 w-1 rounded-r-full"
                style={{ background: biz.color, height: '22px' }}
              />
            )}
            <button
              title={biz.label}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold text-white transition-all duration-150 hover:rounded-xl hover:opacity-100"
              style={{
                background: biz.active
                  ? `linear-gradient(135deg, ${biz.color}, ${biz.color}cc)`
                  : '#1e1e22',
                color: biz.active ? '#fff' : '#6b6b75',
                opacity: biz.active ? 1 : 0.7,
                fontFamily: 'var(--font-mono)',
              }}
            >
              {biz.initials}
            </button>
          </div>
        ))}
      </div>

      {/* Add business */}
      <button
        title="Add business"
        className="w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150 hover:rounded-xl mb-1"
        style={{
          border: '1.5px dashed #2e2e35',
          color: '#3d3d45',
        }}
      >
        <Plus size={13} />
      </button>
    </div>
  )
}

const agents = [
  {
    id: 'cto',
    name: 'CTO',
    status: 'live' as const,
    task: 'PIS-13 · Hardware',
    subtask: null as string | null,
    queuedCount: 1,
    lastActive: '4m ago',
    avatar: 'CT',
    color: '#3b7ef8',
  },
  {
    id: 'cto-2',
    name: 'CTO',
    status: 'running' as const,
    task: 'PIS-20 · Build and bench-test first sensor node prototype',
    subtask: 'Continuation wake — PIS-20 still in_progress. Plan exists. Need to determine rdsrmod...',
    queuedCount: 0,
    lastActive: '2m ago',
    avatar: 'CT',
    color: '#3b7ef8',
  },
  {
    id: 'farming',
    name: 'Farming Researcher',
    status: 'finished' as const,
    task: 'PIS-24 · Validate product design and architecture from farming domain...',
    subtask: null as string | null,
    queuedCount: 0,
    lastActive: '9m ago',
    avatar: 'FR',
    color: '#00c97a',
  },
  {
    id: 'cio',
    name: 'CIO',
    status: 'finished' as const,
    task: 'PIS-23 · Farming researcher',
    subtask: null as string | null,
    queuedCount: 0,
    lastActive: '9m ago',
    avatar: 'CI',
    color: '#a78bfa',
  },
]

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', active: true },
  { icon: CircleDot, label: 'Issues', count: 8 },
  { icon: RefreshCw, label: 'Routines' },
  { icon: Target, label: 'Goals' },
  { icon: Rocket, label: 'Onboarding' },
]

const agentNavItems = [
  { icon: Building2, label: 'Org' },
  { icon: Brain, label: 'Skills' },
  { icon: Wheat, label: 'Documentation' },
]

const teamAgents = [
  { label: 'CEO', color: '#f59e0b', live: false },
  { label: 'CMO', color: '#ec4899', live: false },
  { label: 'CTO', color: '#3b7ef8', live: true },
  { label: 'Farming Researcher', color: '#00c97a', live: false },
]

const stats = [
  { label: 'Agents Enabled', value: '4', sub: '1 running, 2 paused, 1 error', icon: Users, color: '#3b7ef8' },
  { label: 'Tasks In Progress', value: '1', sub: '18 open, 3 blocked', icon: Play, color: '#00c97a' },
  { label: 'Month Spend', value: '$0.00', sub: 'Unlimited budget', icon: DollarSign, color: '#a78bfa' },
  { label: 'Pending Approvals', value: '0', sub: 'Awaiting board review', icon: CheckSquare, color: '#f59e0b' },
]

const priorityBars = [
  { label: 'Urgent', height: 72, color: '#ef4444' },
  { label: 'High', height: 48, color: '#f59e0b' },
  { label: 'Medium', height: 88, color: '#3b7ef8' },
  { label: 'Low', height: 32, color: '#6b7280' },
  { label: 'None', height: 20, color: '#d1d5db' },
]

const statusBars = [
  { label: 'Todo', height: 60, color: '#6b7280' },
  { label: 'In Prog', height: 40, color: '#3b7ef8' },
  { label: 'Done', height: 92, color: '#00c97a' },
  { label: 'Blocked', height: 24, color: '#ef4444' },
  { label: 'Cancel', height: 15, color: '#d1d5db' },
]

const activityBars = [16, 28, 20, 44, 36, 52, 40, 68, 56, 48, 72, 60, 44, 80, 64]

function StatusPill({ status }: { status: 'live' | 'running' | 'finished' | 'queued' }) {
  const config = {
    live: { label: 'LIVE', bg: '#edfaf3', text: '#00a863', dot: '#00c97a' },
    running: { label: 'RUNNING', bg: '#eff6ff', text: '#2563eb', dot: '#3b7ef8' },
    finished: { label: 'FINISHED', bg: '#f3f4f6', text: '#6b7280', dot: '#9ca3af' },
    queued: { label: 'QUEUED', bg: '#fffbeb', text: '#d97706', dot: '#f59e0b' },
  }[status]

  const isAnimated = status === 'live' || status === 'running'

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wider"
      style={{ background: config.bg, color: config.text, fontFamily: 'var(--font-mono)' }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{
          background: config.dot,
          animation: isAnimated ? 'pulse-dot 1.8s ease-in-out infinite' : 'none',
        }}
      />
      {config.label}
    </span>
  )
}

function AgentCard({ agent, delay = 0 }: { agent: (typeof agents)[0]; delay?: number }) {
  return (
    <div
      className="agent-card bg-white rounded-xl border flex flex-col gap-3 p-4"
      style={{
        borderColor: '#e8e4dd',
        animation: `slide-up 0.4s ease ${delay}ms forwards`,
        opacity: 0,
      }}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
            style={{ background: agent.color + '20', color: agent.color }}
          >
            {agent.avatar}
          </div>
          <p className="text-[13px] font-semibold" style={{ color: '#0c0c0e', fontFamily: 'var(--font-display)' }}>
            {agent.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill status={agent.status} />
          <button className="text-gray-300 hover:text-gray-500 transition-colors">
            <MoreHorizontal size={14} />
          </button>
        </div>
      </div>

      {agent.status !== 'finished' ? (
        <div className="rounded-lg px-3 py-2.5" style={{ background: '#f8f7f4', border: '1px solid #e8e4dd' }}>
          <p className="text-[11px] font-medium mb-1" style={{ color: '#8a8680', fontFamily: 'var(--font-mono)' }}>
            {agent.status === 'live' ? 'LIVE TASK' : 'IN PROGRESS'}
          </p>
          <p className="text-[12px] leading-snug" style={{ color: '#0c0c0e' }}>
            {agent.task}
          </p>
          {agent.subtask && (
            <p className="text-[11px] mt-1.5 leading-relaxed" style={{ color: '#8a8680' }}>
              {agent.subtask}
            </p>
          )}
        </div>
      ) : (
        <p className="text-[12px] leading-snug" style={{ color: '#8a8680' }}>
          {agent.task}
        </p>
      )}

      {agent.queuedCount > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          <span className="text-[11px]" style={{ color: '#8a8680', fontFamily: 'var(--font-mono)' }}>
            Queued...
          </span>
        </div>
      )}

      <div className="flex items-center justify-between pt-1 border-t" style={{ borderColor: '#e8e4dd' }}>
        <span className="text-[11px]" style={{ color: '#8a8680', fontFamily: 'var(--font-mono)' }}>
          {agent.lastActive}
        </span>
        <div className="flex gap-1">
          <button className="p-1 rounded hover:bg-gray-100 transition-colors text-gray-400">
            <Play size={11} />
          </button>
          <button className="p-1 rounded hover:bg-gray-100 transition-colors text-gray-400">
            <Pause size={11} />
          </button>
        </div>
      </div>
    </div>
  )
}

function BarChart({ bars, label }: { bars: { label: string; height: number; color: string }[]; label: string }) {
  return (
    <div className="bg-white rounded-xl border p-4" style={{ borderColor: '#e8e4dd' }}>
      <p className="text-[11px] font-semibold mb-3 tracking-wider uppercase" style={{ color: '#8a8680', fontFamily: 'var(--font-mono)' }}>
        {label}
      </p>
      <div className="flex items-end gap-1.5 h-20">
        {bars.map((bar) => (
          <div key={bar.label} className="flex-1 flex flex-col items-center gap-1">
            <div
              className="w-full rounded-sm transition-all duration-700"
              style={{ height: `${bar.height}%`, background: bar.color, opacity: 0.85 }}
            />
            <span className="text-[9px] text-center" style={{ color: '#8a8680', fontFamily: 'var(--font-mono)' }}>
              {bar.label.slice(0, 3)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ActivityChart() {
  return (
    <div className="bg-white rounded-xl border p-4" style={{ borderColor: '#e8e4dd' }}>
      <p className="text-[11px] font-semibold mb-3 tracking-wider uppercase" style={{ color: '#8a8680', fontFamily: 'var(--font-mono)' }}>
        Run Activity
      </p>
      <div className="flex items-end gap-1 h-20">
        {activityBars.map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-sm"
            style={{
              height: `${h}%`,
              background: 'linear-gradient(to top, #3b7ef8, #3b7ef840)',
              transitionDelay: `${i * 30}ms`,
            }}
          />
        ))}
      </div>
      <p className="text-[10px] mt-2" style={{ color: '#8a8680', fontFamily: 'var(--font-mono)' }}>
        Last 14 days
      </p>
    </div>
  )
}

function SuccessRate() {
  const pct = 0.87
  const r = 28
  const circ = 2 * Math.PI * r

  return (
    <div className="bg-white rounded-xl border p-4" style={{ borderColor: '#e8e4dd' }}>
      <p className="text-[11px] font-semibold mb-3 tracking-wider uppercase" style={{ color: '#8a8680', fontFamily: 'var(--font-mono)' }}>
        Success Rate
      </p>
      <div className="flex flex-col items-center justify-center h-20">
        <div className="relative">
          <svg width="64" height="64" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r={r} fill="none" stroke="#f0ede8" strokeWidth="6" />
            <circle
              cx="32" cy="32" r={r}
              fill="none"
              stroke="#00c97a"
              strokeWidth="6"
              strokeDasharray={`${circ * pct} ${circ}`}
              strokeLinecap="round"
              transform="rotate(-90 32 32)"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-base font-bold" style={{ color: '#0c0c0e', fontFamily: 'var(--font-display)' }}>87%</p>
          </div>
        </div>
      </div>
      <p className="text-[10px] text-center mt-1" style={{ color: '#8a8680', fontFamily: 'var(--font-mono)' }}>
        Last 30 days
      </p>
    </div>
  )
}

function Dashboard() {
  return (
    <div className="flex h-screen overflow-hidden">
      <BusinessStrip />
      {/* Sidebar */}
      <aside
        className="w-56 shrink-0 flex flex-col h-full"
        style={{ background: '#0c0c0e', borderRight: '1px solid #1e1e22' }}
      >
        {/* Project header */}
        <div className="px-4 py-4 border-b" style={{ borderColor: '#1e1e22' }}>
          <button className="flex items-center gap-2.5 w-full rounded-lg px-2 py-1.5 hover:bg-white/5 transition-colors">
            <div
              className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold text-white shrink-0"
              style={{ background: 'linear-gradient(135deg, #3b7ef8, #00c97a)' }}
            >
              PB
            </div>
            <span className="text-sm font-semibold flex-1 truncate text-left" style={{ color: '#f0ede8', fontFamily: 'var(--font-display)' }}>
              Pisang Biru
            </span>
            <ChevronDown size={12} style={{ color: '#4a4a52' }} />
          </button>
        </div>

        <div className="flex-1 px-3 py-3 overflow-y-auto">
          {/* Nav items */}
          <div className="space-y-0.5 mb-6">
            {navItems.map((item) => (
              <button
                key={item.label}
                className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[13px] transition-colors hover:bg-white/5"
                style={{
                  background: item.active ? 'rgba(255,255,255,0.08)' : 'transparent',
                  color: item.active ? '#f0ede8' : '#6b6b75',
                }}
              >
                <item.icon size={14} />
                <span className="flex-1 text-left">{item.label}</span>
                {item.count && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: '#1e1e22', color: '#555', fontFamily: 'var(--font-mono)' }}>
                    {item.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Agents */}
          <div className="mb-4">
            <p className="text-[10px] uppercase tracking-widest px-2.5 mb-2" style={{ color: '#333338', fontFamily: 'var(--font-mono)' }}>
              Agents
            </p>
            <div className="space-y-0.5">
              {teamAgents.map((agent) => (
                <button
                  key={agent.label}
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[13px] transition-colors hover:bg-white/5"
                  style={{ color: '#6b6b75' }}
                >
                  <div
                    className="w-3.5 h-3.5 rounded-full shrink-0"
                    style={{ background: agent.color + '25', border: `1.5px solid ${agent.color}50` }}
                  />
                  <span className="flex-1 text-left truncate">{agent.label}</span>
                  {agent.live && (
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: '#00c97a', animation: 'pulse-dot 1.8s ease-in-out infinite' }}
                    />
                  )}
                </button>
              ))}
              <button
                className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[13px] transition-colors hover:bg-white/5"
                style={{ color: '#333338' }}
              >
                <Plus size={12} />
                <span>Add agent</span>
              </button>
            </div>
          </div>

          {/* Products */}
          <div>
            <p className="text-[10px] uppercase tracking-widest px-2.5 mb-2" style={{ color: '#333338', fontFamily: 'var(--font-mono)' }}>
              Products
            </p>
            <div className="space-y-0.5">
              {agentNavItems.map((item) => (
                <button
                  key={item.label}
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[13px] transition-colors hover:bg-white/5"
                  style={{ color: '#6b6b75' }}
                >
                  <item.icon size={13} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="px-3 py-3 border-t" style={{ borderColor: '#1e1e22' }}>
          <button
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[13px] transition-colors hover:bg-white/5"
            style={{ color: '#6b6b75' }}
          >
            <Settings size={13} />
            <span>Settings</span>
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto" style={{ background: '#f5f3ef' }}>
        {/* Page header */}
        <div className="px-8 pt-7 pb-5 border-b" style={{ borderColor: '#e8e4dd' }}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] mb-1" style={{ color: '#8a8680', fontFamily: 'var(--font-mono)' }}>
                Overview
              </p>
              <h1 className="text-2xl font-bold tracking-tight" style={{ color: '#0c0c0e', fontFamily: 'var(--font-display)' }}>
                Dashboard
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <div
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px]"
                style={{ background: '#edfaf3', color: '#00a863', fontFamily: 'var(--font-mono)' }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: '#00c97a', animation: 'pulse-dot 1.8s ease-in-out infinite' }}
                />
                1 agent live
              </div>
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-white"
                style={{ background: '#0c0c0e' }}
              >
                <Zap size={12} />
                New task
              </button>
            </div>
          </div>
        </div>

        <div className="px-8 py-6 space-y-6">
          {/* Agent cards */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] uppercase tracking-widest font-semibold" style={{ color: '#8a8680', fontFamily: 'var(--font-mono)' }}>
                Agents
              </p>
              <button className="text-[11px]" style={{ color: '#8a8680', fontFamily: 'var(--font-mono)' }}>
                View all →
              </button>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {agents.map((agent, i) => (
                <AgentCard key={agent.id} agent={agent} delay={i * 60} />
              ))}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-4 gap-3">
            {stats.map((stat, i) => (
              <div
                key={stat.label}
                className="bg-white rounded-xl border p-4"
                style={{
                  borderColor: '#e8e4dd',
                  animation: `slide-up 0.4s ease ${300 + i * 50}ms forwards`,
                  opacity: 0,
                }}
              >
                <div className="flex items-start justify-between mb-3">
                  <p className="text-[11px] font-medium" style={{ color: '#8a8680', fontFamily: 'var(--font-mono)' }}>
                    {stat.label}
                  </p>
                  <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: stat.color + '15' }}>
                    <stat.icon size={12} style={{ color: stat.color }} />
                  </div>
                </div>
                <p className="text-2xl font-bold mb-1" style={{ color: '#0c0c0e', fontFamily: 'var(--font-display)' }}>
                  {stat.value}
                </p>
                <p className="text-[11px]" style={{ color: '#8a8680', fontFamily: 'var(--font-mono)' }}>
                  {stat.sub}
                </p>
              </div>
            ))}
          </div>

          {/* Charts */}
          <div className="grid grid-cols-4 gap-3">
            <ActivityChart />
            <BarChart bars={priorityBars} label="Tasks by Priority" />
            <BarChart bars={statusBars} label="Tasks by Status" />
            <SuccessRate />
          </div>
        </div>
      </main>
    </div>
  )
}
