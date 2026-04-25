import React from 'react'
import { MoreHorizontal } from 'lucide-react'
import type { GoalRow as GoalRowType, GoalStatus } from '#/lib/goals-logic'
import { updateGoal } from '#/lib/goals-server-fns'

interface Props {
  goal: GoalRowType
  onEdit: (goal: GoalRowType) => void
  onDelete: (goalId: string) => void
  onChanged: () => void
}

const STATUS_PILL: Record<GoalStatus, { label: string; color: string }> = {
  ACTIVE:    { label: 'Active',    color: '#00c97a' },
  COMPLETED: { label: 'Completed', color: '#3b7ef8' },
  ARCHIVED:  { label: 'Archived',  color: '#555' },
}

export function GoalRow({ goal, onEdit, onDelete, onChanged }: Props) {
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  async function setStatus(status: GoalStatus) {
    if (busy) return
    setBusy(true)
    try {
      await updateGoal({ data: { id: goal.id, status } })
      onChanged()
    } finally {
      setBusy(false)
      setMenuOpen(false)
    }
  }

  const pill = STATUS_PILL[goal.status]

  return (
    <div
      className="flex items-start gap-3 px-3 py-2.5 rounded-lg"
      style={{ background: '#0f0f12', border: '1px solid #1a1a1e' }}
    >
      <p className="flex-1 text-[13px] whitespace-pre-wrap" style={{ color: '#e8e6e2' }}>
        {goal.text}
      </p>
      <span
        className="text-[10px] px-1.5 py-0.5 rounded-full leading-none shrink-0"
        style={{ background: pill.color + '25', color: pill.color, fontFamily: 'var(--font-mono)' }}
      >
        {pill.label}
      </span>
      <div className="relative shrink-0">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="p-1 rounded hover:bg-white/5"
          style={{ color: '#555' }}
          aria-label="Goal actions"
        >
          <MoreHorizontal size={14} />
        </button>
        {menuOpen && (
          <div
            className="absolute right-0 top-full mt-1 z-10 min-w-[160px] py-1 rounded-md"
            style={{ background: '#16161a', border: '1px solid #1e1e24' }}
          >
            <MenuItem label="Edit" onClick={() => { onEdit(goal); setMenuOpen(false) }} />
            {goal.status !== 'ACTIVE'    && <MenuItem label="Reactivate"     onClick={() => setStatus('ACTIVE')} />}
            {goal.status !== 'COMPLETED' && <MenuItem label="Mark Completed" onClick={() => setStatus('COMPLETED')} />}
            {goal.status !== 'ARCHIVED'  && <MenuItem label="Archive"        onClick={() => setStatus('ARCHIVED')} />}
            <MenuItem label="Delete" danger onClick={() => { onDelete(goal.id); setMenuOpen(false) }} />
          </div>
        )}
      </div>
    </div>
  )
}

function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-1.5 text-[12px] hover:bg-white/5"
      style={{ color: danger ? '#ff5c5c' : '#e8e6e2' }}
    >
      {label}
    </button>
  )
}
