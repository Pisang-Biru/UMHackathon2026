import React from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchBusinesses } from '#/lib/business-server-fns'
import { fetchSidebarAgents } from '#/lib/sidebar-server-fns'
import {
  disconnectWhatsapp,
  fetchWhatsappStatus,
  startWhatsappPairing,
} from '#/lib/whatsapp-server-fns'
import { BusinessStrip } from '#/components/business-strip'
import { Sidebar } from '#/components/sidebar'
import { Button } from '#/components/ui/button'

export const Route = createFileRoute('/$businessCode/whatsapp')({
  loader: async ({ params }) => {
    const businesses = await fetchBusinesses()
    const current = businesses.find((b) => b.code === params.businessCode)
    if (!current) {
      if (businesses.length > 0) {
        throw redirect({
          to: '/$businessCode/whatsapp',
          params: { businessCode: businesses[0].code },
        })
      }
      throw redirect({ to: '/' })
    }
    const [sidebarAgents, initialStatus] = await Promise.all([
      fetchSidebarAgents({ data: { businessId: current.id } }),
      fetchWhatsappStatus({ data: { businessId: current.id } }),
    ])
    return { businesses, current, sidebarAgents, initialStatus }
  },
  component: WhatsappPage,
})

function StatusCard({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div
      className="rounded-xl p-6 border"
      style={{ background: '#0c0c0f', borderColor: '#2e2e35' }}
    >
      <p
        className="text-[10px] uppercase tracking-[0.14em] mb-2"
        style={{ color: '#666', fontFamily: 'var(--font-mono)' }}
      >
        {title}
      </p>
      {children}
    </div>
  )
}

function WhatsappPage() {
  const { businesses, current, sidebarAgents, initialStatus } = Route.useLoaderData()
  const queryClient = useQueryClient()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const statusQuery = useQuery({
    queryKey: ['whatsapp-status', current.id],
    queryFn: () => fetchWhatsappStatus({ data: { businessId: current.id } }),
    initialData: initialStatus,
    refetchInterval: 3000,
  })

  const status = statusQuery.data

  async function handleConnect() {
    setBusy(true)
    setError(null)
    try {
      await startWhatsappPairing({ data: { businessId: current.id } })
      await queryClient.invalidateQueries({ queryKey: ['whatsapp-status', current.id] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start pairing')
    } finally {
      setBusy(false)
    }
  }

  async function handleDisconnect() {
    setBusy(true)
    setError(null)
    try {
      await disconnectWhatsapp({ data: { businessId: current.id } })
      await queryClient.invalidateQueries({ queryKey: ['whatsapp-status', current.id] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0a0a0c' }}>
      <BusinessStrip businesses={businesses} />
      <Sidebar business={current} agents={sidebarAgents} />

      <main className="flex-1 overflow-auto" style={{ background: '#111113' }}>
        <div className="px-8 pt-6 pb-5 border-b" style={{ borderColor: '#1a1a1e' }}>
          <p
            className="text-[9px] uppercase tracking-[0.2em] mb-1"
            style={{ color: '#444', fontFamily: 'var(--font-mono)' }}
          >
            Channel
          </p>
          <h1
            className="text-[22px] font-bold tracking-tight"
            style={{ color: '#f0ede8', fontFamily: 'var(--font-display)' }}
          >
            WhatsApp
          </h1>
        </div>

        <div className="px-8 py-6 max-w-3xl flex flex-col gap-5">
          <StatusCard title="Connection Status">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p
                  className="text-[18px] font-semibold"
                  style={{ color: '#f0ede8', fontFamily: 'var(--font-display)' }}
                >
                  {status.status === 'connected'
                    ? 'Connected'
                    : status.status === 'pairing'
                      ? 'Pairing'
                      : status.status === 'error'
                        ? 'Error'
                        : 'Disconnected'}
                </p>
                <p className="text-[12px]" style={{ color: '#777' }}>
                  {status.status === 'connected'
                    ? `Business WhatsApp linked${status.connectedPhone ? ` as ${status.connectedPhone}` : ''}.`
                    : status.status === 'pairing'
                      ? 'Scan the QR code below with your business WhatsApp app.'
                      : status.status === 'error'
                        ? status.detail ?? 'The bridge hit an error while connecting.'
                        : 'Connect your business WhatsApp account to enable agent replies.'}
                </p>
              </div>

              {status.status === 'connected' ? (
                <Button onClick={handleDisconnect} disabled={busy} variant="outline">
                  {busy ? 'Disconnecting...' : 'Disconnect'}
                </Button>
              ) : (
                <Button onClick={handleConnect} disabled={busy} style={{ background: '#3b7ef8', color: '#fff' }}>
                  {busy ? 'Starting...' : 'Connect WhatsApp'}
                </Button>
              )}
            </div>
          </StatusCard>

          {status.status === 'pairing' && status.qrDataUrl && (
            <StatusCard title="Scan QR">
              <div className="flex flex-col items-start gap-3">
                <img
                  src={status.qrDataUrl}
                  alt="WhatsApp QR code"
                  className="rounded-lg bg-white p-3"
                  style={{ width: 260, height: 260 }}
                />
                <p className="text-[12px]" style={{ color: '#777' }}>
                  Open WhatsApp on your phone, scan this QR, then keep this page open until it shows connected.
                </p>
              </div>
            </StatusCard>
          )}

          {error && (
            <p className="text-[12px]" style={{ color: '#ef4444' }}>
              {error}
            </p>
          )}
        </div>
      </main>
    </div>
  )
}
