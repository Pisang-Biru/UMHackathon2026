import React from 'react'
import { Check, Pencil, X } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'
import type { InboxAction } from '#/lib/inbox-logic'
import { pickDisplayDraft } from '#/lib/inbox-logic'
import { unsendAction } from '#/lib/inbox-server-fns'
import { IterationTrail } from '#/components/inbox/iteration-trail'

interface ActionDetailPanelProps {
  action: InboxAction | null
  onApprove?: (action: InboxAction, reply: string) => Promise<void>
  onReject?: (action: InboxAction) => Promise<void>
  readOnly?: boolean
}

const UNDO_MS = 5000

export function ActionDetailPanel({ action, onApprove, onReject, readOnly = false }: ActionDetailPanelProps) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [showTrail, setShowTrail] = React.useState(false)
  const [undoState, setUndoState] = React.useState<{ actionId: string; expiresAt: number } | null>(null)
  const [undoRemaining, setUndoRemaining] = React.useState(0)

  React.useEffect(() => {
    if (action) {
      setDraft(pickDisplayDraft(action))
      setEditing(false)
      setError(null)
      setShowTrail(false)
    }
  }, [action?.id])

  // Undo countdown timer
  React.useEffect(() => {
    if (!undoState) return
    const interval = setInterval(() => {
      const remaining = Math.max(0, undoState.expiresAt - Date.now())
      setUndoRemaining(remaining)
      if (remaining <= 0) {
        setUndoState(null)
      }
    }, 100)
    return () => clearInterval(interval)
  }, [undoState])

  if (!action) {
    return (
      <div className="w-[480px] shrink-0 flex items-center justify-center" style={{ background: '#0c0c0f', borderLeft: '1px solid #1a1a1e', color: '#444' }}>
        <p className="text-[12px]" style={{ fontFamily: 'var(--font-mono)' }}>Select an item to review</p>
      </div>
    )
  }

  const canAct = !readOnly && action.status === 'PENDING' && !!onApprove

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

  async function handleSend() {
    if (!action || !onApprove) return
    const reply = (editing ? draft : pickDisplayDraft(action)).trim()
    if (!reply) return
    await onApprove(action, reply)
    setEditing(false)
    setUndoState({ actionId: action.id, expiresAt: Date.now() + UNDO_MS })
    setUndoRemaining(UNDO_MS)
  }

  async function handleUndo() {
    if (!undoState) return
    try {
      await unsendAction(undoState.actionId)
      setUndoState(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Undo failed')
    }
  }

  const label = (t: string) => (
    <span className="text-[10px] uppercase tracking-[0.14em] font-medium" style={{ color: '#555', fontFamily: 'var(--font-mono)' }}>
      {t}
    </span>
  )

  const headerText = action.status === 'PENDING' ? "I need your input on this one" : `Status: ${action.status}`

  return (
    <aside className="w-[480px] shrink-0 flex flex-col h-full overflow-auto" style={{ background: '#0c0c0f', borderLeft: '1px solid #1a1a1e' }}>
      <div className="px-6 py-5 border-b" style={{ borderColor: '#1a1a1e' }}>
        <p className="text-[9px] uppercase tracking-[0.2em] mb-1" style={{ color: '#444', fontFamily: 'var(--font-mono)' }}>
          Review
        </p>
        <h2 className="text-[15px] font-bold" style={{ color: '#f0ede8', fontFamily: 'var(--font-display)' }}>
          {headerText}
        </h2>
        {action.status === 'PENDING' && action.escalationSummary && (
          <p className="mt-2 text-[12px]" style={{ color: '#e8c07d' }}>
            {action.escalationSummary}
          </p>
        )}
      </div>

      <div className="px-6 py-5 flex flex-col gap-5">
        <div>
          {label('Customer message')}
          <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: '#e8e6e2' }}>{action.customerMsg}</p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            {label('Suggested reply')}
            {canAct && !editing && (
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
            <p className="text-[13px] leading-relaxed p-3 rounded-lg" style={{ background: '#16161a', color: '#c8c5c0', border: '1px solid #1a1a1e' }}>
              {action.finalReply ?? pickDisplayDraft(action)}
            </p>
          )}
        </div>

        {error && <p className="text-[12px]" style={{ color: '#ef4444' }}>{error}</p>}

        {canAct && (
          <div className="flex gap-2 mt-2">
            <Button
              onClick={() => run(handleSend)}
              disabled={busy || !(editing ? draft : pickDisplayDraft(action))?.trim()}
              className="flex-1 h-11 flex items-center justify-center gap-1.5"
              style={{ background: '#00c97a', color: '#0a0a0c', fontSize: 14, fontWeight: 600 }}
            >
              <Check size={16} /> Send
            </Button>
            <Button
              onClick={() => onReject && run(() => onReject(action))}
              disabled={busy || !onReject}
              variant="ghost"
              className="flex items-center gap-1.5"
              style={{ color: '#666' }}
            >
              <X size={14} /> Skip
            </Button>
          </div>
        )}

        <button
          onClick={() => setShowTrail((v) => !v)}
          className="text-[11px] mt-6 self-start"
          style={{ color: '#555', fontFamily: 'var(--font-mono)' }}
        >
          {showTrail ? '▾' : '▸'} see AI's thinking
        </button>
        {showTrail && <IterationTrail actionId={action.id} />}
      </div>

      {undoState && undoRemaining > 0 && (
        <div className="fixed bottom-6 right-6 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg"
          style={{ background: '#16161a', border: '1px solid #2a2a32', color: '#e8e6e2' }}>
          <span className="text-[12px]">Reply sent ({Math.ceil(undoRemaining / 1000)}s)</span>
          <button onClick={handleUndo} className="text-[12px] font-semibold" style={{ color: '#3b7ef8' }}>
            Undo
          </button>
        </div>
      )}
    </aside>
  )
}
