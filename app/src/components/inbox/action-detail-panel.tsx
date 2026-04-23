import React from 'react'
import { Check, X, Pencil } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'
import type { InboxAction } from '#/lib/inbox-logic'

interface ActionDetailPanelProps {
  action: InboxAction | null
  onApprove: (action: InboxAction) => Promise<void>
  onEdit: (action: InboxAction, reply: string) => Promise<void>
  onReject: (action: InboxAction) => Promise<void>
}

export function ActionDetailPanel({ action, onApprove, onEdit, onReject }: ActionDetailPanelProps) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (action) {
      setDraft(action.draftReply)
      setEditing(false)
      setError(null)
    }
  }, [action?.id])

  if (!action) {
    return (
      <div className="w-[480px] shrink-0 flex items-center justify-center" style={{ background: '#0c0c0f', borderLeft: '1px solid #1a1a1e', color: '#444' }}>
        <p className="text-[12px]" style={{ fontFamily: 'var(--font-mono)' }}>Select an item to review</p>
      </div>
    )
  }

  const isPending = action.status === 'PENDING'

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  const label = (t: string) => (
    <span className="text-[10px] uppercase tracking-[0.14em] font-medium" style={{ color: '#555', fontFamily: 'var(--font-mono)' }}>
      {t}
    </span>
  )

  return (
    <aside
      className="w-[480px] shrink-0 flex flex-col h-full overflow-auto"
      style={{ background: '#0c0c0f', borderLeft: '1px solid #1a1a1e' }}
    >
      <div className="px-6 py-5 border-b" style={{ borderColor: '#1a1a1e' }}>
        <p className="text-[9px] uppercase tracking-[0.2em] mb-1" style={{ color: '#444', fontFamily: 'var(--font-mono)' }}>
          Review
        </p>
        <h2 className="text-[15px] font-bold" style={{ color: '#f0ede8', fontFamily: 'var(--font-display)' }}>
          {action.status === 'PENDING' ? 'Needs your approval' : `Status: ${action.status}`}
        </h2>
      </div>

      <div className="px-6 py-5 flex flex-col gap-5">
        <div>
          {label('Customer message')}
          <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: '#e8e6e2' }}>{action.customerMsg}</p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            {label(`Draft reply (conf ${action.confidence.toFixed(2)})`)}
            {isPending && !editing && (
              <button
                onClick={() => setEditing(true)}
                className="text-[11px] flex items-center gap-1"
                style={{ color: '#3b7ef8', fontFamily: 'var(--font-mono)' }}
              >
                <Pencil size={11} /> edit
              </button>
            )}
          </div>
          {editing ? (
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={5}
              style={{ background: '#16161a', borderColor: '#2a2a32', color: '#e8e6e2', resize: 'none' }}
            />
          ) : (
            <p
              className="text-[13px] leading-relaxed p-3 rounded-lg"
              style={{ background: '#16161a', color: '#c8c5c0', border: '1px solid #1a1a1e' }}
            >
              {action.finalReply ?? action.draftReply}
            </p>
          )}
        </div>

        <div>
          {label('Reasoning')}
          <p className="mt-1.5 text-[12px]" style={{ color: '#888' }}>{action.reasoning}</p>
        </div>

        {error && (
          <p className="text-[12px]" style={{ color: '#ef4444' }}>{error}</p>
        )}

        {isPending && (
          <div className="flex gap-2 mt-2">
            {editing ? (
              <>
                <Button
                  onClick={() => run(async () => { await onEdit(action, draft); setEditing(false) })}
                  disabled={busy || !draft.trim()}
                  className="flex-1 flex items-center gap-1.5"
                  style={{ background: '#3b7ef8', color: '#fff' }}
                >
                  <Check size={14} /> Save & approve
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => { setEditing(false); setDraft(action.draftReply) }}
                  disabled={busy}
                  style={{ color: '#666' }}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button
                  onClick={() => run(async () => { await onApprove(action) })}
                  disabled={busy}
                  className="flex-1 flex items-center gap-1.5"
                  style={{ background: '#00c97a', color: '#0a0a0c' }}
                >
                  <Check size={14} /> Approve
                </Button>
                <Button
                  onClick={() => run(async () => { await onReject(action) })}
                  disabled={busy}
                  variant="ghost"
                  className="flex items-center gap-1.5"
                  style={{ color: '#ef4444' }}
                >
                  <X size={14} /> Reject
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
