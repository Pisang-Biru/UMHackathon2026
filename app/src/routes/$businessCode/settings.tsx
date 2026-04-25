import React from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { fetchBusinesses } from '#/lib/business-server-fns'
import { fetchBusinessSettings, updateBusinessSettings } from '#/lib/business-server-fns'
import { fetchSidebarAgents } from '#/lib/sidebar-server-fns'
import { BusinessStrip } from '#/components/business-strip'
import { Sidebar } from '#/components/sidebar'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'

export const Route = createFileRoute('/$businessCode/settings')({
  loader: async ({ params }) => {
    const businesses = await fetchBusinesses()
    const current = businesses.find((b) => b.code === params.businessCode)
    if (!current) {
      if (businesses.length > 0) {
        throw redirect({
          to: '/$businessCode/settings',
          params: { businessCode: businesses[0].code },
        })
      }
      throw redirect({ to: '/' })
    }
    const [settings, sidebarAgents] = await Promise.all([
      fetchBusinessSettings({ data: { businessId: current.id } }),
      fetchSidebarAgents({ data: { businessId: current.id } }),
    ])
    return { businesses, current, settings, sidebarAgents }
  },
  component: SettingsPage,
})

function SettingsPage() {
  const { businesses, current, settings, sidebarAgents } = Route.useLoaderData()

  // platformFeePct stored as 0..1; display as percentage (multiply by 100)
  const [platformFeePct, setPlatformFeePct] = React.useState(
    (settings.platformFeePct * 100).toFixed(2)
  )
  const [defaultTransportCost, setDefaultTransportCost] = React.useState(
    settings.defaultTransportCost.toFixed(2)
  )
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const feePct = parseFloat(platformFeePct)
    const transport = parseFloat(defaultTransportCost)
    if (isNaN(feePct) || feePct < 0 || feePct > 100) {
      return setError('Platform fee must be between 0 and 100')
    }
    if (isNaN(transport) || transport < 0) {
      return setError('Default shipping must be a non-negative number')
    }
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      await updateBusinessSettings({
        data: {
          businessId: current.id,
          platformFeePct: feePct / 100,
          defaultTransportCost: transport,
        },
      })
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  const label = (text: string) => (
    <span
      className="text-[11px] uppercase tracking-[0.12em] font-medium"
      style={{ color: '#666', fontFamily: 'var(--font-mono)' }}
    >
      {text}
    </span>
  )

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0a0a0c' }}>
      <BusinessStrip businesses={businesses} />
      <Sidebar business={current} agents={sidebarAgents} />

      <main className="flex-1 overflow-auto" style={{ background: '#111113' }}>
        {/* Header */}
        <div className="px-8 pt-6 pb-5 border-b" style={{ borderColor: '#1a1a1e' }}>
          <div>
            <p
              className="text-[9px] uppercase tracking-[0.2em] mb-1"
              style={{ color: '#444', fontFamily: 'var(--font-mono)' }}
            >
              Configuration
            </p>
            <h1
              className="text-[22px] font-bold tracking-tight"
              style={{ color: '#f0ede8', fontFamily: 'var(--font-display)' }}
            >
              Business Settings
            </h1>
          </div>
        </div>

        <div className="px-8 py-6 max-w-lg">
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div
              className="rounded-xl p-6 border flex flex-col gap-4"
              style={{ background: '#0c0c0f', borderColor: '#2e2e35' }}
            >
              <h2
                className="text-[13px] font-semibold"
                style={{ color: '#c8c5c0', fontFamily: 'var(--font-display)' }}
              >
                Finance Defaults
              </h2>

              <div className="flex flex-col gap-1.5">
                {label('Platform Fee (%)')}
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={platformFeePct}
                  onChange={(e) => setPlatformFeePct(e.target.value)}
                  placeholder="5.00"
                  style={{ background: '#16161a', borderColor: '#2a2a32', color: '#e8e6e2' }}
                />
                <span className="text-[10px]" style={{ color: '#555' }}>
                  e.g. enter 5 for 5% — stored as 0.05 internally
                </span>
              </div>

              <div className="flex flex-col gap-1.5">
                {label('Default Shipping (RM)')}
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={defaultTransportCost}
                  onChange={(e) => setDefaultTransportCost(e.target.value)}
                  placeholder="0.00"
                  style={{ background: '#16161a', borderColor: '#2a2a32', color: '#e8e6e2' }}
                />
              </div>
            </div>

            {error && (
              <p className="text-[12px]" style={{ color: '#ef4444' }}>
                {error}
              </p>
            )}
            {success && (
              <p className="text-[12px]" style={{ color: '#00c97a' }}>
                Settings saved.
              </p>
            )}

            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={saving}
                style={{ background: '#3b7ef8', color: '#fff' }}
              >
                {saving ? 'Saving...' : 'Save Settings'}
              </Button>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}
