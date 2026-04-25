import type { GoalGroups, GoalRow as GoalRowType } from '#/lib/goals-logic'
import { GoalRow } from './goal-row'

interface Props {
  groups: GoalGroups
  onEdit: (goal: GoalRowType) => void
  onDelete: (goalId: string) => void
  onChanged: () => void
}

export function GoalsList({ groups, onEdit, onDelete, onChanged }: Props) {
  const sections: Array<{ key: string; label: string; rows: GoalRowType[] }> = [
    { key: 'active',    label: 'Active',    rows: groups.active },
    { key: 'completed', label: 'Completed', rows: groups.completed },
    { key: 'archived',  label: 'Archived',  rows: groups.archived },
  ]

  return (
    <div className="flex flex-col gap-6">
      {sections.map((section) => section.rows.length === 0 ? null : (
        <section key={section.key}>
          <h2
            className="text-[10px] uppercase tracking-[0.14em] mb-2 flex items-center gap-2"
            style={{ color: '#666', fontFamily: 'var(--font-mono)' }}
          >
            <span>{section.label}</span>
            <span style={{ color: '#333' }}>{section.rows.length}</span>
          </h2>
          <div className="flex flex-col gap-2">
            {section.rows.map((goal) => (
              <GoalRow
                key={goal.id}
                goal={goal}
                onEdit={onEdit}
                onDelete={onDelete}
                onChanged={onChanged}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
