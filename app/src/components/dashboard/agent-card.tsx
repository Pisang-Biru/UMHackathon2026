import { Play, Pause, MoreHorizontal } from 'lucide-react'

type AgentStatus = 'live' | 'running' | 'finished' | 'idle'

const STATUS_CONFIG: Record<AgentStatus, { label: string; bg: string; text: string; dot: string; animated: boolean }> = {
  live: { label: 'LIVE', bg: 'rgba(0,201,122,0.1)', text: '#00a863', dot: '#00c97a', animated: true },
  running: { label: 'RUNNING', bg: 'rgba(59,126,248,0.1)', text: '#3b7ef8', dot: '#3b7ef8', animated: true },
  finished: { label: 'FINISHED', bg: 'rgba(107,114,128,0.12)', text: '#555', dot: '#555', animated: false },
  idle: { label: 'IDLE', bg: 'rgba(245,158,11,0.08)', text: '#7a5a1a', dot: '#6a4e18', animated: false },
}

function StatusPill({ status }: { status: AgentStatus }) {
  const c = STATUS_CONFIG[status]
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-semibold tracking-wider"
      style={{ background: c.bg, color: c.text, border: `1px solid ${c.dot}30`, fontFamily: 'var(--font-mono)' }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: c.dot, animation: c.animated ? 'pulse-dot 1.8s ease-in-out infinite' : 'none' }}
      />
      {c.label}
    </span>
  )
}

export interface AgentCardData {
  id: string
  name: string
  status: AgentStatus
  task?: string
  subtask?: string
  lastActive: string
  avatar: string
  color: string
  queuedCount?: number
}

export function AgentCard({ agent, style }: { agent: AgentCardData; style?: React.CSSProperties }) {
  const isActive = agent.status === 'live' || agent.status === 'running'

  return (
    <div
      className="agent-card rounded-xl flex flex-col gap-2.5 p-3.5"
      style={{
        background: '#161618',
        border: '1px solid #1e1e24',
        opacity: agent.status === 'idle' ? 0.45 : 1,
        ...style,
      }}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div
            className="w-[26px] h-[26px] rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
            style={{ background: agent.color + '20', color: agent.color }}
          >
            {agent.avatar}
          </div>
          <p className="text-[12px] font-semibold" style={{ color: '#e8e6e2', fontFamily: 'var(--font-display)' }}>
            {agent.name}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <StatusPill status={agent.status} />
          <button className="transition-colors" style={{ color: '#2a2a32' }}>
            <MoreHorizontal size={13} />
          </button>
        </div>
      </div>

      {isActive && agent.task ? (
        <div className="rounded-lg px-3 py-2" style={{ background: '#0e0e10', border: '1px solid #1e1e24' }}>
          <p className="text-[9px] font-medium mb-1" style={{ color: '#444', fontFamily: 'var(--font-mono)' }}>
            {agent.status === 'live' ? 'LIVE TASK' : 'IN PROGRESS'}
          </p>
          <p className="text-[11px] leading-snug" style={{ color: '#c8c5c0' }}>
            {agent.task}
          </p>
          {agent.subtask && (
            <p className="text-[10px] mt-1 leading-relaxed" style={{ color: '#444' }}>
              {agent.subtask}
            </p>
          )}
        </div>
      ) : agent.task ? (
        <p className="text-[11px] leading-snug" style={{ color: '#444' }}>
          {agent.task}
        </p>
      ) : (
        <p className="text-[11px]" style={{ color: '#333' }}>
          Awaiting tasks
        </p>
      )}

      {agent.queuedCount != null && agent.queuedCount > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          <span className="text-[10px]" style={{ color: '#444', fontFamily: 'var(--font-mono)' }}>
            {agent.queuedCount} queued
          </span>
        </div>
      )}

      <div className="flex items-center justify-between pt-1.5 border-t" style={{ borderColor: '#1e1e24' }}>
        <span className="text-[10px]" style={{ color: '#444', fontFamily: 'var(--font-mono)' }}>
          {agent.lastActive}
        </span>
        <div className="flex gap-1">
          <button className="p-1 rounded transition-colors hover:bg-white/5" style={{ color: '#333' }}>
            <Play size={10} />
          </button>
          <button className="p-1 rounded transition-colors hover:bg-white/5" style={{ color: '#333' }}>
            <Pause size={10} />
          </button>
        </div>
      </div>
    </div>
  )
}
