// app/src/components/inbox/iteration-trail.tsx
import React from 'react'
import { fetchIterations } from '#/lib/inbox-server-fns'

interface TrailEntry {
  stage: string
  draft?: { reply?: string } | null
  verdict?: { verdict?: string; reason?: string } | null
  gate_results?: Record<string, unknown>
  latency_ms?: number | null
}

interface IterationTrailProps {
  actionId: string
}

export function IterationTrail({ actionId }: IterationTrailProps) {
  const [entries, setEntries] = React.useState<TrailEntry[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let active = true
    fetchIterations(actionId)
      .then((raw) => {
        if (active) setEntries(raw as TrailEntry[])
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e))
      })
    return () => { active = false }
  }, [actionId])

  if (error) return <p className="text-[11px]" style={{ color: '#ef4444' }}>{error}</p>
  if (!entries) return <p className="text-[11px]" style={{ color: '#555', fontFamily: 'var(--font-mono)' }}>loading…</p>
  if (entries.length === 0) return <p className="text-[11px]" style={{ color: '#555', fontFamily: 'var(--font-mono)' }}>no iterations</p>

  return (
    <div className="flex flex-col gap-3 mt-2 text-[11px]" style={{ fontFamily: 'var(--font-mono)', color: '#888' }}>
      {entries.map((e, i) => (
        <div key={i} className="border-l-2 pl-3" style={{ borderColor: '#2a2a32' }}>
          <div className="flex items-center gap-2">
            <span style={{ color: '#c8c5c0' }}>[{e.stage}]</span>
            {e.verdict?.verdict && (
              <span style={{ color: verdictColor(e.verdict.verdict) }}>{e.verdict.verdict}</span>
            )}
            {typeof e.latency_ms === 'number' && (
              <span style={{ color: '#555' }}>{e.latency_ms}ms</span>
            )}
          </div>
          {e.verdict?.reason && <div style={{ color: '#888' }}>{e.verdict.reason}</div>}
          {e.draft?.reply && (
            <div className="mt-1" style={{ color: '#aaa' }}>
              {e.draft.reply.length > 200 ? e.draft.reply.slice(0, 200) + '…' : e.draft.reply}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function verdictColor(v: string): string {
  switch (v) {
    case 'pass': return '#00c97a'
    case 'revise': return '#e8c07d'
    case 'rewrite': return '#e8c07d'
    case 'escalate': return '#ef4444'
    default: return '#888'
  }
}
