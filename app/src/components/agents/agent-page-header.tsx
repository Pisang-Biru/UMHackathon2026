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
