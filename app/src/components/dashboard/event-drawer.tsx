import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { agentApi } from '#/lib/agent-api'

type Tab = 'timeline' | 'reasoning' | 'trace'

export function EventDrawer({
  eventId,
  businessId,
  open,
  onClose,
}: {
  eventId: number | null
  businessId: string
  open: boolean
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('timeline')
  useEffect(() => {
    if (open) setTab('timeline')
  }, [open, eventId])

  const { data: ev } = useQuery({
    queryKey: ['event-detail', eventId, businessId],
    queryFn: () => (eventId == null ? null : agentApi.event(eventId, businessId)),
    enabled: open && eventId != null,
  })
  const { data: siblings } = useQuery({
    queryKey: ['event-siblings', ev?.conversation_id, businessId],
    queryFn: () =>
      agentApi.events({
        businessId,
        conversationId: ev!.conversation_id!,
        limit: 50,
      }),
    enabled: open && !!ev?.conversation_id,
  })

  const hasTrace = !!ev && ev.trace !== null && ev.trace !== undefined

  return (
    <div
      aria-hidden={!open}
      className={`fixed inset-y-0 right-0 z-50 w-full max-w-[480px] transform transition-transform duration-200 ${
        open ? 'translate-x-0' : 'translate-x-full pointer-events-none'
      }`}
      style={{ background: '#0e0e10', borderLeft: '1px solid #1e1e24' }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: '#1e1e24' }}>
        <div>
          <p className="text-[10px] uppercase tracking-wider" style={{ color: '#555', fontFamily: 'var(--font-mono)' }}>
            Event #{eventId}
          </p>
          <p className="text-[13px] font-semibold" style={{ color: '#e8e6e2' }}>
            {ev ? `${ev.agent_id} · ${ev.node ?? ev.kind}` : 'Loading…'}
          </p>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-white/5" style={{ color: '#777' }}>
          <X size={16} />
        </button>
      </div>

      {ev && (
        <>
          <div className="flex border-b" style={{ borderColor: '#1e1e24' }}>
            {(['timeline', 'reasoning', ...(hasTrace ? (['trace'] as Tab[]) : [])] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="px-4 py-2 text-[11px] uppercase tracking-wider"
                style={{
                  color: tab === t ? '#e8e6e2' : '#555',
                  borderBottom: tab === t ? '1px solid #00c97a' : '1px solid transparent',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="px-4 py-4 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 96px)' }}>
            {tab === 'timeline' && (
              <ol className="space-y-1 text-[11px]">
                {(siblings?.items ?? [])
                  .slice()
                  .sort((a, b) => a.id - b.id)
                  .map((s) => (
                    <li
                      key={s.id}
                      className="leading-snug"
                      style={{ color: s.id === ev.id ? '#00c97a' : '#c8c5c0' }}
                    >
                      <span style={{ color: '#555', fontFamily: 'var(--font-mono)' }}>
                        {new Date(s.ts).toLocaleTimeString()} ·{' '}
                      </span>
                      {s.kind}
                      {s.node ? ` ${s.node}` : ''} — {s.summary ?? ''}
                    </li>
                  ))}
              </ol>
            )}
            {tab === 'reasoning' && (
              <pre className="whitespace-pre-wrap text-[12px]" style={{ color: '#c8c5c0' }}>
                {ev.reasoning ?? ev.summary ?? '(none)'}
              </pre>
            )}
            {tab === 'trace' && hasTrace && (
              <pre className="overflow-x-auto text-[11px]" style={{ color: '#c8c5c0' }}>
                {JSON.stringify(ev.trace, null, 2)}
              </pre>
            )}
          </div>
        </>
      )}
    </div>
  )
}
