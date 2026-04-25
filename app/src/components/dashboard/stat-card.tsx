import type { LucideIcon } from 'lucide-react'

interface StatCardProps {
  label: string
  value: string
  sub: string
  icon: LucideIcon
  color: string
  loading?: boolean
}

export function StatCard({ label, value, sub, icon: Icon, color, loading }: StatCardProps) {
  return (
    <div
      className="rounded-xl p-3.5"
      style={{ background: '#161618', border: '1px solid #1e1e24' }}
    >
      <div className="flex items-start justify-between mb-2.5">
        <p className="text-[10px]" style={{ color: '#444', fontFamily: 'var(--font-mono)' }}>
          {label}
        </p>
        <div
          className="w-[22px] h-[22px] rounded-[5px] flex items-center justify-center"
          style={{ background: color + '18' }}
        >
          <Icon size={11} style={{ color }} />
        </div>
      </div>
      {loading ? (
        <div
          className="h-[22px] w-12 mb-1.5 rounded"
          style={{ background: '#1e1e24', animation: 'pulse-skeleton 1.4s ease-in-out infinite' }}
        />
      ) : (
        <p className="text-[22px] font-bold mb-0.5" style={{ color: '#f0ede8', fontFamily: 'var(--font-display)', letterSpacing: '-0.03em' }}>
          {value}
        </p>
      )}
      {loading ? (
        <div
          className="h-[10px] w-20 rounded"
          style={{ background: '#1a1a1e', animation: 'pulse-skeleton 1.4s ease-in-out infinite' }}
        />
      ) : (
        <p className="text-[10px]" style={{ color: '#444', fontFamily: 'var(--font-mono)' }}>
          {sub}
        </p>
      )}
    </div>
  )
}
