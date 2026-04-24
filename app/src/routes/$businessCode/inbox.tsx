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
import { acknowledgeOrder } from '#/lib/order-server-fns'
import { fetchSidebarAgents } from '#/lib/sidebar-server-fns'
import { BusinessStrip } from '#/components/business-strip'
import { Sidebar } from '#/components/sidebar'
import { InboxTabs } from '#/components/inbox/inbox-tabs'
import { AgentGroup } from '#/components/inbox/agent-group'
import { ActionDetailPanel } from '#/components/inbox/action-detail-panel'
import { OrderInboxCard } from '#/components/inbox/order-inbox-card'
import { OrderDetailPanel } from '#/components/inbox/order-detail-panel'
import {
  groupByAgent,
  type InboxAction,
  type InboxItem,
  type InboxOrder,
  type InboxTab,
} from '#/lib/inbox-logic'

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
    const [initialItems, initialCounts, sidebarAgents] = await Promise.all([
      fetchInbox({ data: { businessId: current.id, tab: 'mine' } }),
      fetchTabCounts({ data: { businessId: current.id } }),
      fetchSidebarAgents({ data: { businessId: current.id } }),
    ])
    return { businesses, current, initialItems, initialCounts, sidebarAgents }
  },
  component: InboxPage,
})

function normalizeAction(raw: any): InboxAction {
  return {
    ...raw,
    createdAt: new Date(raw.createdAt),
    updatedAt: new Date(raw.updatedAt),
    viewedAt: raw.viewedAt ? new Date(raw.viewedAt) : null,
  }
}

function normalizeOrder(raw: any): InboxOrder {
  return {
    ...raw,
    createdAt: new Date(raw.createdAt),
    paidAt: raw.paidAt ? new Date(raw.paidAt) : null,
    acknowledgedAt: raw.acknowledgedAt ? new Date(raw.acknowledgedAt) : null,
  }
}

function normalizeItem(raw: any): InboxItem {
  return raw.kind === 'order'
    ? { kind: 'order', order: normalizeOrder(raw.order) }
    : { kind: 'action', action: normalizeAction(raw.action) }
}

type Selection = { kind: 'action'; id: string } | { kind: 'order'; id: string } | null

function InboxPage() {
  const { businesses, current, initialItems, initialCounts, sidebarAgents } = Route.useLoaderData()
  const [tab, setTab] = React.useState<InboxTab>('mine')
  const [items, setItems] = React.useState<InboxItem[]>(initialItems.map(normalizeItem))
  const [counts, setCounts] = React.useState(initialCounts)
  const [selected, setSelected] = React.useState<Selection>(null)

  const selectedItem = selected
    ? items.find((it) =>
        it.kind === selected.kind &&
        (it.kind === 'action' ? it.action.id === selected.id : it.order.id === selected.id),
      ) ?? null
    : null

  const actions = items.filter((it): it is Extract<InboxItem, { kind: 'action' }> => it.kind === 'action').map((it) => it.action)
  const orders = items.filter((it): it is Extract<InboxItem, { kind: 'order' }> => it.kind === 'order').map((it) => it.order)
  const agentGroups = groupByAgent(actions)

  async function switchTab(nextTab: InboxTab) {
    setTab(nextTab)
    setSelected(null)
    const next = await fetchInbox({ data: { businessId: current.id, tab: nextTab } })
    setItems(next.map(normalizeItem))
  }

  async function refreshCounts() {
    const c = await fetchTabCounts({ data: { businessId: current.id } })
    setCounts(c)
  }

  async function selectAction(action: InboxAction) {
    setSelected({ kind: 'action', id: action.id })
    if (!action.viewedAt) {
      try {
        const updated = await markAsViewed({ data: { actionId: action.id } })
        const u = normalizeAction(updated)
        setItems((prev) => prev.map((it) => (it.kind === 'action' && it.action.id === u.id ? { kind: 'action', action: u } : it)))
        await refreshCounts()
      } catch (err) {
        console.error('markAsViewed failed', err)
      }
    }
  }

  async function selectOrder(order: InboxOrder) {
    setSelected({ kind: 'order', id: order.id })
    if (!order.acknowledgedAt) {
      try {
        const updated = await acknowledgeOrder({ data: { orderId: order.id } })
        const u = normalizeOrder(updated)
        setItems((prev) => prev.map((it) => (it.kind === 'order' && it.order.id === u.id ? { kind: 'order', order: u } : it)))
        await refreshCounts()
      } catch (err) {
        console.error('acknowledgeOrder failed', err)
      }
    }
  }

  async function handleApprove(action: InboxAction) {
    const updated = await approveAction({ data: { actionId: action.id } })
    const u = normalizeAction(updated)
    setItems((prev) =>
      tab === 'mine'
        ? prev.filter((it) => !(it.kind === 'action' && it.action.id === u.id))
        : prev.map((it) => (it.kind === 'action' && it.action.id === u.id ? { kind: 'action', action: u } : it)),
    )
    await refreshCounts()
    setSelected(null)
  }

  async function handleEdit(action: InboxAction, reply: string) {
    const updated = await editAction({ data: { actionId: action.id, reply } })
    const u = normalizeAction(updated)
    setItems((prev) =>
      tab === 'mine'
        ? prev.filter((it) => !(it.kind === 'action' && it.action.id === u.id))
        : prev.map((it) => (it.kind === 'action' && it.action.id === u.id ? { kind: 'action', action: u } : it)),
    )
    await refreshCounts()
    setSelected(null)
  }

  async function handleReject(action: InboxAction) {
    const updated = await rejectAction({ data: { actionId: action.id } })
    const u = normalizeAction(updated)
    setItems((prev) =>
      tab === 'mine'
        ? prev.filter((it) => !(it.kind === 'action' && it.action.id === u.id))
        : prev.map((it) => (it.kind === 'action' && it.action.id === u.id ? { kind: 'action', action: u } : it)),
    )
    await refreshCounts()
    setSelected(null)
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0a0a0c' }}>
      <BusinessStrip businesses={businesses} />
      <Sidebar business={current} agents={sidebarAgents} />
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
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16" style={{ color: '#444' }}>
                <p className="text-[13px]" style={{ fontFamily: 'var(--font-mono)' }}>No items</p>
                <p className="text-[11px] mt-1" style={{ color: '#333' }}>Nothing needs your attention right now</p>
              </div>
            ) : (
              <>
                {orders.length > 0 && (
                  <div>
                    <div className="px-4 pt-4 pb-2 text-[9px] uppercase tracking-[0.14em]" style={{ color: '#444', fontFamily: 'var(--font-mono)' }}>
                      Sales
                    </div>
                    {orders.map((o) => (
                      <OrderInboxCard
                        key={o.id}
                        order={o}
                        selected={selected?.kind === 'order' && selected.id === o.id}
                        onClick={() => selectOrder(o)}
                      />
                    ))}
                  </div>
                )}
                {agentGroups.map((g) => (
                  <AgentGroup
                    key={g.agentType}
                    agentType={g.agentType}
                    actions={g.actions}
                    selectedId={selected?.kind === 'action' ? selected.id : null}
                    onSelect={selectAction}
                  />
                ))}
              </>
            )}
          </div>
          {selectedItem?.kind === 'order' ? (
            <OrderDetailPanel order={selectedItem.order} />
          ) : (
            <ActionDetailPanel
              action={selectedItem?.kind === 'action' ? selectedItem.action : null}
              onApprove={handleApprove}
              onEdit={handleEdit}
              onReject={handleReject}
            />
          )}
        </div>
      </main>
    </div>
  )
}
