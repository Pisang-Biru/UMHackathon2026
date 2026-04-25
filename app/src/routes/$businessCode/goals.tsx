import React from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { fetchBusinesses } from '#/lib/business-server-fns'
import { fetchSidebarAgents } from '#/lib/sidebar-server-fns'
import { fetchGoals } from '#/lib/goals-server-fns'
import { groupGoals, type GoalRow } from '#/lib/goals-logic'
import { BusinessStrip } from '#/components/business-strip'
import { Sidebar } from '#/components/sidebar'
import { Button } from '#/components/ui/button'
import { GoalsList } from '#/components/goals/goals-list'
import { GoalModal } from '#/components/goals/goal-modal'
import { DeleteGoalDialog } from '#/components/goals/delete-goal-dialog'

export const Route = createFileRoute('/$businessCode/goals')({
  loader: async ({ params }) => {
    const businesses = await fetchBusinesses()
    const current = businesses.find((b) => b.code === params.businessCode)
    if (!current) {
      if (businesses.length > 0) {
        throw redirect({
          to: '/$businessCode/goals',
          params: { businessCode: businesses[0].code },
        })
      }
      throw redirect({ to: '/' })
    }
    const [initialGoals, sidebarAgents] = await Promise.all([
      fetchGoals({ data: { businessId: current.id } }),
      fetchSidebarAgents({ data: { businessId: current.id } }),
    ])
    return { businesses, current, initialGoals, sidebarAgents }
  },
  component: GoalsPage,
})

function GoalsPage() {
  const { businesses, current, initialGoals, sidebarAgents } = Route.useLoaderData()

  const { data: goals = initialGoals, refetch } = useQuery({
    queryKey: ['goals', current.id],
    queryFn: () => fetchGoals({ data: { businessId: current.id } }),
    initialData: initialGoals,
    staleTime: 10_000,
  })

  // Server returns ISO-serialized dates; coerce to Date for groupGoals.
  const rows: GoalRow[] = React.useMemo(
    () => goals.map((g) => ({
      ...g,
      createdAt: g.createdAt instanceof Date ? g.createdAt : new Date(g.createdAt as any),
      updatedAt: g.updatedAt instanceof Date ? g.updatedAt : new Date(g.updatedAt as any),
    })),
    [goals],
  )
  const groups = React.useMemo(() => groupGoals(rows), [rows])
  const isEmpty = rows.length === 0

  const [modalMode, setModalMode] = React.useState<'create' | 'edit' | null>(null)
  const [editing, setEditing] = React.useState<GoalRow | null>(null)
  const [deletingId, setDeletingId] = React.useState<string | null>(null)

  function openCreate() {
    setEditing(null)
    setModalMode('create')
  }
  function openEdit(goal: GoalRow) {
    setEditing(goal)
    setModalMode('edit')
  }
  function closeModal() {
    setModalMode(null)
    setEditing(null)
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0a0a0c' }}>
      <BusinessStrip businesses={businesses} />
      <Sidebar business={current} agents={sidebarAgents} />
      <main className="flex-1 overflow-auto">
        <div className="max-w-[760px] mx-auto px-8 py-10">
          <header className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-[22px] font-semibold" style={{ color: '#e8e6e2', fontFamily: 'var(--font-display)' }}>
                Goals
              </h1>
              <p className="text-[12px] mt-1" style={{ color: '#666' }}>
                Active goals are shown to every agent for {current.name}.
              </p>
            </div>
            <Button onClick={openCreate}>
              <Plus size={14} className="mr-1" />
              Add goal
            </Button>
          </header>

          {isEmpty ? (
            <div
              className="flex flex-col items-center justify-center py-16 rounded-lg"
              style={{ background: '#0f0f12', border: '1px dashed #1a1a1e' }}
            >
              <p className="text-[13px] mb-3" style={{ color: '#888' }}>
                No goals yet.
              </p>
              <Button onClick={openCreate}>
                <Plus size={14} className="mr-1" />
                Add your first goal
              </Button>
            </div>
          ) : (
            <GoalsList
              groups={groups}
              onEdit={openEdit}
              onDelete={setDeletingId}
              onChanged={() => { refetch() }}
            />
          )}
        </div>
      </main>

      <GoalModal
        mode={modalMode ?? 'create'}
        initial={editing ? { id: editing.id, text: editing.text } : undefined}
        businessId={current.id}
        open={modalMode != null}
        onClose={closeModal}
        onSaved={() => { refetch() }}
      />
      <DeleteGoalDialog
        goalId={deletingId}
        onClose={() => setDeletingId(null)}
        onDeleted={() => { refetch() }}
      />
    </div>
  )
}
