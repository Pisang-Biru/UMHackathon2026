import type { InboxAction, AgentActionStatus } from '#/lib/inbox-logic'
import { RunListItem } from '#/components/agents/run-list-item'
import { ActionDetailPanel } from '#/components/inbox/action-detail-panel'

type FilterStatus = 'ALL' | AgentActionStatus

interface RunsTabProps {
  rows: InboxAction[]
  nextCursor: string | null
  selectedId: string | null
  filter: FilterStatus
  onFilterChange: (status: FilterStatus) => void
  onSelect: (action: InboxAction) => void
  onLoadMore: () => Promise<void>
  onApprove: (action: InboxAction) => Promise<void>
  onEdit: (action: InboxAction, reply: string) => Promise<void>
  onReject: (action: InboxAction) => Promise<void>
}

const FILTERS: { id: FilterStatus; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'PENDING', label: 'Pending' },
  { id: 'APPROVED', label: 'Approved' },
  { id: 'REJECTED', label: 'Rejected' },
  { id: 'AUTO_SENT', label: 'Auto-sent' },
]

export function RunsTab(props: RunsTabProps) {
  const selected = props.rows.find((r) => r.id === props.selectedId) ?? null
  const isPending = selected?.status === 'PENDING'

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="flex-1 overflow-auto flex flex-col">
        <div className="flex gap-1.5 px-6 py-3 border-b" style={{ borderColor: '#1a1a1e' }}>
          {FILTERS.map((f) => {
            const active = f.id === props.filter
            return (
              <button
                key={f.id}
                onClick={() => props.onFilterChange(f.id)}
                className="px-2.5 py-1 rounded-full text-[11px]"
                style={{
                  background: active ? '#1a1a1e' : 'transparent',
                  color: active ? '#e8e6e2' : '#666',
                  border: `1px solid ${active ? '#2a2a32' : '#1a1a1e'}`,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {f.label}
              </button>
            )
          })}
        </div>
        <div className="flex-1">
          {props.rows.length === 0 ? (
            <p className="px-6 py-10 text-[12px]" style={{ color: '#444' }}>No runs</p>
          ) : (
            props.rows.map((r) => (
              <RunListItem
                key={r.id}
                action={r}
                selected={r.id === props.selectedId}
                onClick={() => props.onSelect(r)}
              />
            ))
          )}
          {props.nextCursor && (
            <button
              onClick={() => props.onLoadMore()}
              className="w-full py-3 text-[11px]"
              style={{ color: '#3b7ef8', fontFamily: 'var(--font-mono)' }}
            >
              Load more
            </button>
          )}
        </div>
      </div>
      <ActionDetailPanel
        action={selected}
        readOnly={!isPending}
        onApprove={isPending ? props.onApprove : undefined}
        onEdit={isPending ? props.onEdit : undefined}
        onReject={isPending ? props.onReject : undefined}
      />
    </div>
  )
}
