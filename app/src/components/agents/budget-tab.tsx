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
