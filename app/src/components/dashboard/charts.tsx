interface Bar {
  label: string
  height: number
  color: string
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-3.5" style={{ background: '#161618', border: '1px solid #1e1e24' }}>
      <p
        className="text-[9px] font-semibold mb-2.5 tracking-[0.12em] uppercase"
        style={{ color: '#444', fontFamily: 'var(--font-mono)' }}
      >
        {title}
      </p>
      {children}
    </div>
  )
}

export function ActivityChart({ bars }: { bars: number[] }) {
  return (
    <ChartCard title="Run Activity">
      <div className="flex items-end gap-1 h-14">
        {bars.map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-sm"
            style={{ height: `${h}%`, background: 'linear-gradient(to top, #3b7ef8, #3b7ef820)' }}
          />
        ))}
      </div>
      <p className="text-[9px] mt-1.5" style={{ color: '#333', fontFamily: 'var(--font-mono)' }}>
        Last 14 days
      </p>
    </ChartCard>
  )
}

export function BarChart({ bars, title }: { bars: Bar[]; title: string }) {
  return (
    <ChartCard title={title}>
      <div className="flex items-end gap-1.5 h-14">
        {bars.map((bar) => (
          <div key={bar.label} className="flex-1 flex flex-col items-center gap-1 justify-end">
            <div
              className="w-full rounded-sm"
              style={{ height: `${bar.height}%`, background: bar.color, opacity: 0.7 }}
            />
            <span className="text-[8px] text-center" style={{ color: '#444', fontFamily: 'var(--font-mono)' }}>
              {bar.label.slice(0, 3)}
            </span>
          </div>
        ))}
      </div>
    </ChartCard>
  )
}

export function SuccessRate({ percent }: { percent: number }) {
  const r = 24
  const circ = 2 * Math.PI * r
  const filled = circ * (percent / 100)

  return (
    <ChartCard title="Success Rate">
      <div className="flex flex-col items-center justify-center h-14">
        <div className="relative">
          <svg width="52" height="52" viewBox="0 0 60 60">
            <circle cx="30" cy="30" r={r} fill="none" stroke="#1e1e24" strokeWidth="6" />
            <circle
              cx="30" cy="30" r={r}
              fill="none"
              stroke="#00c97a"
              strokeWidth="6"
              strokeDasharray={`${filled} ${circ}`}
              strokeLinecap="round"
              transform="rotate(-90 30 30)"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-[12px] font-bold" style={{ color: '#f0ede8' }}>{percent}%</p>
          </div>
        </div>
      </div>
      <p className="text-[9px] text-center mt-1" style={{ color: '#333', fontFamily: 'var(--font-mono)' }}>
        Last 30 days
      </p>
    </ChartCard>
  )
}
