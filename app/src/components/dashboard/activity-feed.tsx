import { useInfiniteQuery } from '@tanstack/react-query'
import { agentApi, type AgentEvent } from '#/lib/agent-api'

const KIND_COLOR: Record<AgentEvent['kind'], string> = {
  'node.start': '#555',
  'node.end': '#00c97a',
  handoff: '#a78bfa',
  'message.in': '#3b7ef8',
  'message.out': '#22d3ee',
  error: '#ef4444',
}

type Filters = {
  businessId: string
  agentId?: string
  conversationId?: string
  kind?: string
}

export function ActivityFeed({
  filters,
  onRowClick,
}: {
  filters: Filters
  onRowClick?: (e: AgentEvent) => void
}) {
  const q = useInfiniteQuery({
    queryKey: ['events', filters],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      agentApi.events({
        ...filters,
        before: pageParam,
        limit: 50,
      }),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
  const items = q.data?.pages.flatMap((p) => p.items) ?? []

  return (
    <section className="flex flex-col gap-2">
      <h2
        className="text-[10px] uppercase tracking-[0.2em]"
        style={{ color: '#555', fontFamily: 'var(--font-mono)' }}
      >
        Recent Activity
      </h2>
      <div
        className="rounded-xl overflow-y-auto"
        style={{
          background: '#0e0e10',
          border: '1px solid #1e1e24',
          maxHeight: 420,
        }}
      >
        {items.length === 0 ? (
          <div className="px-4 py-8 text-center text-[11px]" style={{ color: '#444' }}>
            No activity yet.
          </div>
        ) : (
          items.map((ev) => (
            <button
              key={ev.id}
              onClick={() => onRowClick?.(ev)}
              className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-white/5 border-b"
              style={{ borderColor: '#1e1e24' }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: KIND_COLOR[ev.kind] ?? '#555' }}
              />
              <span
                className="w-24 shrink-0 text-[10px] uppercase tracking-wider"
                style={{ color: '#777', fontFamily: 'var(--font-mono)' }}
              >
                {ev.agent_id}
              </span>
              <span className="flex-1 truncate text-[11px]" style={{ color: '#c8c5c0' }}>
                {ev.summary ?? `${ev.kind}${ev.node ? ' ' + ev.node : ''}`}
              </span>
              <span className="text-[10px]" style={{ color: '#555', fontFamily: 'var(--font-mono)' }}>
                {new Date(ev.ts).toLocaleTimeString()}
              </span>
            </button>
          ))
        )}
        {q.hasNextPage && (
          <button
            onClick={() => q.fetchNextPage()}
            className="w-full px-4 py-2 text-[11px] hover:bg-white/5"
            style={{ color: '#777' }}
            disabled={q.isFetchingNextPage}
          >
            {q.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
    </section>
  )
}
