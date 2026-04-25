export type GoalStatus = 'ACTIVE' | 'COMPLETED' | 'ARCHIVED'

export interface GoalRow {
  id: string
  text: string
  status: GoalStatus
  createdAt: Date
  updatedAt: Date
}

export interface GoalGroups {
  active: GoalRow[]
  completed: GoalRow[]
  archived: GoalRow[]
}

export function groupGoals(rows: GoalRow[]): GoalGroups {
  const active: GoalRow[] = []
  const completed: GoalRow[] = []
  const archived: GoalRow[] = []
  for (const row of rows) {
    if (row.status === 'ACTIVE') active.push(row)
    else if (row.status === 'COMPLETED') completed.push(row)
    else if (row.status === 'ARCHIVED') archived.push(row)
  }
  const byCreatedDesc = (a: GoalRow, b: GoalRow) => b.createdAt.getTime() - a.createdAt.getTime()
  active.sort(byCreatedDesc)
  completed.sort(byCreatedDesc)
  archived.sort(byCreatedDesc)
  return { active, completed, archived }
}
