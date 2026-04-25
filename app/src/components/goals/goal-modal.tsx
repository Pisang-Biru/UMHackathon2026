import React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '#/components/ui/dialog'
import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'
import { createGoal, updateGoal } from '#/lib/goals-server-fns'

const MAX_LEN = 500

interface GoalModalProps {
  mode: 'create' | 'edit'
  initial?: { id: string; text: string }
  businessId: string
  open: boolean
  onClose: () => void
  onSaved: () => void
}

export function GoalModal({ mode, initial, businessId, open, onClose, onSaved }: GoalModalProps) {
  const [text, setText] = React.useState(initial?.text ?? '')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) {
      setText(initial?.text ?? '')
      setError(null)
      setSaving(false)
    }
  }, [open, initial?.text])

  const trimmed = text.trim()
  const unchanged = mode === 'edit' && initial != null && trimmed === initial.text.trim()
  const canSave = trimmed.length > 0 && trimmed.length <= MAX_LEN && !unchanged && !saving

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      if (mode === 'create') {
        await createGoal({ data: { businessId, text: trimmed } })
      } else if (initial) {
        await updateGoal({ data: { id: initial.id, text: trimmed } })
      }
      onSaved()
      onClose()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save goal')
      setSaving(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Add goal' : 'Edit goal'}</DialogTitle>
        </DialogHeader>
        <Textarea
          autoFocus
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="What should the agents work toward?"
        />
        <div className="flex justify-between text-[11px]" style={{ color: '#555' }}>
          <span>{error ? <span style={{ color: '#ff5c5c' }}>{error}</span> : ' '}</span>
          <span>{trimmed.length}/{MAX_LEN}</span>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
