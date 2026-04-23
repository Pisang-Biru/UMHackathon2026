import React from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { fetchBusinesses } from '#/lib/business-server-fns'
import {
  fetchInbox,
  fetchTabCounts,
  markAsViewed,
  approveAction,
  editAction,
  rejectAction,
} from '#/lib/inbox-server-fns'
import { BusinessStrip } from '#/components/business-strip'
import { Sidebar } from '#/components/sidebar'
import { InboxTabs } from '#/components/inbox/inbox-tabs'
import { AgentGroup } from '#/components/inbox/agent-group'
import { ActionDetailPanel } from '#/components/inbox/action-detail-panel'
import { groupByAgent, type InboxAction, type InboxTab } from '#/lib/inbox-logic'

export const Route = createFileRoute('/$businessCode/inbox')({
  loader: async ({ params }) => {
    const businesses = await fetchBusinesses()
    const current = businesses.find((b) => b.code === params.businessCode)
    if (!current) {
      if (businesses.length > 0) {
        throw redirect({ to: '/$businessCode/inbox', params: { businessCode: businesses[0].code } })
      }
      throw redirect({ to: '/' })
    }
    const [initialActions, initialCounts] = await Promise.all([
      fetchInbox({ data: { businessId: current.id, tab: 'mine' } }),
      fetchTabCounts({ data: { businessId: current.id } }),
    ])
    return { businesses, current, initialActions, initialCounts }
  },
  component: InboxPage,
})

function normalize(raw: any): InboxAction {
  return {
    ...raw,
    createdAt: new Date(raw.createdAt),
    updatedAt: new Date(raw.updatedAt),
    viewedAt: raw.viewedAt ? new Date(raw.viewedAt) : null,
  }
}

function InboxPage() {
  const { businesses, current, initialActions, initialCounts } = Route.useLoaderData()
  const [tab, setTab] = React.useState<InboxTab>('mine')
  const [actions, setActions] = React.useState<InboxAction[]>(initialActions.map(normalize))
  const [counts, setCounts] = React.useState(initialCounts)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)

  const selected = actions.find((a) => a.id === selectedId) ?? null
  const groups = groupByAgent(actions)

  async function switchTab(nextTab: InboxTab) {
    setTab(nextTab)
    setSelectedId(null)
    const next = await fetchInbox({ data: { businessId: current.id, tab: nextTab } })
    setActions(next.map(normalize))
  }

  async function refreshCounts() {
    const c = await fetchTabCounts({ data: { businessId: current.id } })
    setCounts(c)
  }

  async function handleSelect(action: InboxAction) {
    setSelectedId(action.id)
    if (!action.viewedAt) {
      try {
        const updated = await markAsViewed({ data: { actionId: action.id } })
        const u = normalize(updated)
        setActions((prev) => prev.map((a) => (a.id === u.id ? u : a)))
        await refreshCounts()
      } catch (err) {
        console.error('Failed to mark as viewed', err)
      }
    }
  }

  async function handleApprove(action: InboxAction) {
    const updated = await approveAction({ data: { actionId: action.id } })
    const u = normalize(updated)
    setActions((prev) => (tab === 'mine' ? prev.filter((a) => a.id !== u.id) : prev.map((a) => (a.id === u.id ? u : a))))
    await refreshCounts()
    setSelectedId(null)
  }

  async function handleEdit(action: InboxAction, reply: string) {
    const updated = await editAction({ data: { actionId: action.id, reply } })
    const u = normalize(updated)
    setActions((prev) => (tab === 'mine' ? prev.filter((a) => a.id !== u.id) : prev.map((a) => (a.id === u.id ? u : a))))
    await refreshCounts()
    setSelectedId(null)
  }

  async function handleReject(action: InboxAction) {
    const updated = await rejectAction({ data: { actionId: action.id } })
    const u = normalize(updated)
    setActions((prev) => (tab === 'mine' ? prev.filter((a) => a.id !== u.id) : prev.map((a) => (a.id === u.id ? u : a))))
    await refreshCounts()
    setSelectedId(null)
  }

  const MOCK_SIDEBAR_AGENTS = [{ id: 'support', name: 'Support Agent', color: '#3b7ef8', live: false }]

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0a0a0c' }}>
      <BusinessStrip businesses={businesses} />
      <Sidebar business={current} agents={MOCK_SIDEBAR_AGENTS} />
      <main className="flex-1 flex flex-col overflow-hidden" style={{ background: '#111113' }}>
        <div className="px-8 pt-6 pb-4 border-b" style={{ borderColor: '#1a1a1e' }}>
          <p className="text-[9px] uppercase tracking-[0.2em] mb-1" style={{ color: '#444', fontFamily: 'var(--font-mono)' }}>
            Review
          </p>
          <h1 className="text-[22px] font-bold tracking-tight" style={{ color: '#f0ede8', fontFamily: 'var(--font-display)' }}>
            Inbox
          </h1>
        </div>
        <InboxTabs active={tab} counts={counts} onChange={switchTab} />
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-auto">
            {groups.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16" style={{ color: '#444' }}>
                <p className="text-[13px]" style={{ fontFamily: 'var(--font-mono)' }}>No items</p>
                <p className="text-[11px] mt-1" style={{ color: '#333' }}>Nothing needs your attention right now</p>
              </div>
            ) : (
              groups.map((g) => (
                <AgentGroup
                  key={g.agentType}
                  agentType={g.agentType}
                  actions={g.actions}
                  selectedId={selectedId}
                  onSelect={handleSelect}
                />
              ))
            )}
          </div>
          <ActionDetailPanel
            action={selected}
            onApprove={handleApprove}
            onEdit={handleEdit}
            onReject={handleReject}
          />
        </div>
      </main>
    </div>
  )
}
