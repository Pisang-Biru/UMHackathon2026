import type { SalesRange } from '#/lib/sales-logic'

const OPTIONS: Array<{ value: SalesRange; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'all', label: 'All' },
]

export function RangeTabs({
  value,
  onChange,
  disabled,
}: {
  value: SalesRange
  onChange: (r: SalesRange) => void
  disabled?: boolean
}) {
  return (
    <div
      className="inline-flex rounded-lg p-0.5"
      style={{ background: '#161618', border: '1px solid #1e1e24' }}
    >
      {OPTIONS.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className="px-3 py-1.5 text-[11px] font-medium rounded-md transition-colors disabled:opacity-50"
            style={{
              background: active ? '#3b7ef8' : 'transparent',
              color: active ? '#fff' : '#888',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
