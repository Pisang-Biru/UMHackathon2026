import React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '#/components/ui/dialog'
import { Button } from '#/components/ui/button'
import { deleteGoal } from '#/lib/goals-server-fns'

interface Props {
  goalId: string | null
  onClose: () => void
  onDeleted: () => void
}

export function DeleteGoalDialog({ goalId, onClose, onDeleted }: Props) {
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (goalId) {
      setBusy(false)
      setError(null)
    }
  }, [goalId])

  async function handleConfirm() {
    if (!goalId) return
    setBusy(true)
    setError(null)
    try {
      await deleteGoal({ data: { id: goalId } })
      onDeleted()
      onClose()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to delete goal')
      setBusy(false)
    }
  }

  return (
    <Dialog open={goalId != null} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this goal?</DialogTitle>
        </DialogHeader>
        <p className="text-[12px]" style={{ color: '#888' }}>
          You can&rsquo;t undo this from the UI.
        </p>
        {error && <p className="text-[11px]" style={{ color: '#ff5c5c' }}>{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
