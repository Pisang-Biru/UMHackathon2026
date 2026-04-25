import React from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { fetchBusinesses } from '#/lib/business-server-fns'
import { fetchSidebarAgents } from '#/lib/sidebar-server-fns'
import { fetchSales } from '#/lib/sales-server-fns'
import { BusinessStrip } from '#/components/business-strip'
import { Sidebar } from '#/components/sidebar'
import { KpiCards } from '#/components/sales/kpi-cards'
import { RangeTabs } from '#/components/sales/range-tabs'
import { SalesCharts } from '#/components/sales/sales-charts'
import { SalesTable, useDisplayedSales } from '#/components/sales/sales-table'
import { ExportCsvButton } from '#/components/sales/export-csv-button'
import type { SalesRange } from '#/lib/sales-logic'

export const Route = createFileRoute('/$businessCode/sales')({
  loader: async ({ params }) => {
    const businesses = await fetchBusinesses()
    const current = businesses.find((b) => b.code === params.businessCode)
    if (!current) {
      if (businesses.length > 0) {
        throw redirect({
          to: '/$businessCode/sales',
          params: { businessCode: businesses[0].code },
        })
      }
      throw redirect({ to: '/' })
    }
    const [initialSales, sidebarAgents] = await Promise.all([
      fetchSales({ data: { businessId: current.id, range: 'all' } }),
      fetchSidebarAgents({ data: { businessId: current.id } }),
    ])
    return { businesses, current, initialSales, sidebarAgents }
  },
  component: SalesPage,
})

function SalesPage() {
  const { businesses, current, initialSales, sidebarAgents } = Route.useLoaderData()

  const [range, setRange] = React.useState<SalesRange>('all')
  const [data, setData] = React.useState(initialSales)
  const [loading, setLoading] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [lossOnly, setLossOnly] = React.useState(false)

  async function handleRangeChange(next: SalesRange) {
    if (next === range || loading) return
    setRange(next)
    setLoading(true)
    try {
      const fresh = await fetchSales({ data: { businessId: current.id, range: next } })
      setData(fresh)
    } finally {
      setLoading(false)
    }
  }

  const visibleOrders = lossOnly
    ? data.orders.filter(o => o.marginStatus === 'LOSS')
    : data.orders

  const displayedRows = useDisplayedSales(visibleOrders, search, 'createdAt', 'desc')

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0a0a0c' }}>
      <BusinessStrip businesses={businesses} />
      <Sidebar business={current} agents={sidebarAgents} />

      <main className="flex-1 overflow-auto" style={{ background: '#111113' }}>
        <div className="px-8 pt-6 pb-5 border-b" style={{ borderColor: '#1a1a1e' }}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[9px] uppercase tracking-[0.2em] mb-1" style={{ color: '#444', fontFamily: 'var(--font-mono)' }}>
                Performance
              </p>
              <h1 className="text-[22px] font-bold tracking-tight" style={{ color: '#f0ede8', fontFamily: 'var(--font-display)' }}>
                Sales
              </h1>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setLossOnly(v => !v)}
                className={lossOnly
                  ? 'px-2 py-1 rounded bg-red-100 text-red-700 text-xs'
                  : 'px-2 py-1 rounded border border-zinc-700 text-xs text-zinc-400'}
              >
                Loss only
              </button>
              <RangeTabs value={range} onChange={handleRangeChange} disabled={loading} />
              <ExportCsvButton rows={displayedRows} businessCode={current.code} />
            </div>
          </div>
        </div>

        <div className="px-8 py-5 space-y-5" style={{ opacity: loading ? 0.6 : 1, transition: 'opacity 150ms' }}>
          <KpiCards kpis={data.kpis} />
          <SalesCharts series={data.series} topProducts={data.topProducts} />
          <SalesTable
            orders={visibleOrders}
            search={search}
            onSearchChange={setSearch}
          />
        </div>
      </main>
    </div>
  )
}
