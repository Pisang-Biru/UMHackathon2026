import React from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  Instagram,
  Sparkles,
  LogOut,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react'
import { fetchBusinesses } from '#/lib/business-server-fns'
import { fetchSidebarAgents } from '#/lib/sidebar-server-fns'
import { BusinessStrip } from '#/components/business-strip'
import { Sidebar } from '#/components/sidebar'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  connectInstagram,
  disconnectInstagram,
  fetchInstagramStatus,
  type InstagramStatus,
} from '#/lib/instagram-server-fns'
import {
  runMarketingPost,
  type MarketingRunResult,
} from '#/lib/marketing-server-fns'

export const Route = createFileRoute('/$businessCode/channels/instagram')({
  loader: async ({ params }) => {
    const businesses = await fetchBusinesses()
    const current = businesses.find((b) => b.code === params.businessCode)
    if (!current) {
      if (businesses.length > 0) {
        throw redirect({
          to: '/$businessCode/channels/instagram',
          params: { businessCode: businesses[0].code },
        })
      }
      throw redirect({ to: '/' })
    }

    const [sidebarAgents, instagramStatus] = await Promise.all([
      fetchSidebarAgents({ data: { businessId: current.id } }),
      fetchInstagramStatus({ data: { businessId: current.id } }),
    ])

    return { businesses, current, sidebarAgents, instagramStatus }
  },
  component: InstagramChannelPage,
})

function InstagramChannelPage() {
  const { businesses, current, sidebarAgents, instagramStatus } =
    Route.useLoaderData()
  const queryClient = useQueryClient()
  const [status, setStatus] = React.useState<InstagramStatus>(instagramStatus)
  const [username, setUsername] = React.useState(instagramStatus.username ?? '')
  const [password, setPassword] = React.useState('')
  const [connectError, setConnectError] = React.useState<string | null>(null)
  const [connectBusy, setConnectBusy] = React.useState(false)
  const [logoutBusy, setLogoutBusy] = React.useState(false)
  const [prompt, setPrompt] = React.useState(
    'Fresh milk sale poster, Malaysian style, highlight price MYR 10',
  )
  const [slideCount, setSlideCount] = React.useState('3')
  const [marketingBusy, setMarketingBusy] = React.useState(false)
  const [marketingError, setMarketingError] = React.useState<string | null>(
    null,
  )
  const [marketingResult, setMarketingResult] =
    React.useState<MarketingRunResult | null>(null)

  React.useEffect(() => {
    setStatus(instagramStatus)
    setUsername(instagramStatus.username ?? '')
  }, [instagramStatus])

  async function refreshSidebarStatus(nextStatus: InstagramStatus) {
    setStatus(nextStatus)
    await queryClient.invalidateQueries({
      queryKey: ['instagram-status', current.id],
    })
  }

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault()
    setConnectError(null)
    if (!username.trim()) {
      setConnectError('Instagram username is required')
      return
    }
    if (!password) {
      setConnectError('Instagram password is required')
      return
    }

    setConnectBusy(true)
    try {
      const nextStatus = await connectInstagram({
        data: {
          businessId: current.id,
          username: username.trim(),
          password,
        },
      })
      setPassword('')
      await refreshSidebarStatus(nextStatus)
    } catch (err) {
      setConnectError(
        err instanceof Error ? err.message : 'Instagram login failed',
      )
    } finally {
      setConnectBusy(false)
    }
  }

  async function handleLogout() {
    setConnectError(null)
    setLogoutBusy(true)
    try {
      const nextStatus = await disconnectInstagram({
        data: { businessId: current.id },
      })
      await refreshSidebarStatus(nextStatus)
    } catch (err) {
      setConnectError(
        err instanceof Error ? err.message : 'Instagram logout failed',
      )
    } finally {
      setLogoutBusy(false)
    }
  }

  async function handleMarketingPost(e: React.FormEvent) {
    e.preventDefault()
    const count = parseInt(slideCount, 10)
    if (!status.connected) {
      setMarketingError('Connect Instagram first before asking AI to post.')
      return
    }
    if (!Number.isFinite(count) || count < 1 || count > 10) {
      setMarketingError('Slide count must be between 1 and 10')
      return
    }
    if (!prompt.trim()) {
      setMarketingError('Prompt is required')
      return
    }

    setMarketingBusy(true)
    setMarketingError(null)
    setMarketingResult(null)
    try {
      const result = await runMarketingPost({
        data: {
          businessId: current.id,
          prompt: prompt.trim(),
          count,
        },
      })
      setMarketingResult(result)
    } catch (err) {
      setMarketingError(
        err instanceof Error ? err.message : 'Failed to generate and post',
      )
    } finally {
      setMarketingBusy(false)
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
    <div
      className="flex h-screen overflow-hidden"
      style={{ background: '#0a0a0c' }}
    >
      <BusinessStrip businesses={businesses} />
      <Sidebar business={current} agents={sidebarAgents} />

      <main className="flex-1 overflow-auto" style={{ background: '#111113' }}>
        <div
          className="px-8 pt-6 pb-5 border-b"
          style={{ borderColor: '#1a1a1e' }}
        >
          <p
            className="text-[9px] uppercase tracking-[0.2em] mb-1"
            style={{ color: '#444', fontFamily: 'var(--font-mono)' }}
          >
            Channels
          </p>
          <div className="flex items-center gap-3">
            <div
              className="h-9 w-9 rounded-xl flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, #ff4d8d, #ff8a35)',
              }}
            >
              <Instagram size={17} color="#fff" />
            </div>
            <div>
              <h1
                className="text-[22px] font-bold tracking-tight"
                style={{ color: '#f0ede8', fontFamily: 'var(--font-display)' }}
              >
                Instagram
              </h1>
              <p className="text-[12px]" style={{ color: '#666' }}>
                Connect an account, then ask Marketing to generate image slides
                and post them.
              </p>
            </div>
          </div>
        </div>

        <div className="px-8 py-6 max-w-3xl flex flex-col gap-6">
          <section
            className="rounded-2xl border p-6"
            style={{ background: '#0c0c0f', borderColor: '#2e2e35' }}
          >
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <h2
                  className="text-[14px] font-semibold"
                  style={{
                    color: '#d8d5cf',
                    fontFamily: 'var(--font-display)',
                  }}
                >
                  Account Session
                </h2>
                <p className="text-[12px] mt-1" style={{ color: '#666' }}>
                  We save the Instagram session so the user does not need to
                  enter the password every time.
                </p>
              </div>
              <div
                className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px]"
                style={{
                  background: status.connected ? '#063d2a' : '#221a0c',
                  color: status.connected ? '#00c97a' : '#f59e0b',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {status.connected ? (
                  <CheckCircle2 size={12} />
                ) : (
                  <AlertTriangle size={12} />
                )}
                {status.connected ? 'Connected' : 'Not connected'}
              </div>
            </div>

            {status.connected ? (
              <div className="flex flex-col gap-4">
                <div
                  className="rounded-xl border px-4 py-3"
                  style={{ background: '#121216', borderColor: '#26262d' }}
                >
                  <p
                    className="text-[11px] uppercase tracking-[0.12em]"
                    style={{ color: '#555', fontFamily: 'var(--font-mono)' }}
                  >
                    Active account
                  </p>
                  <p className="text-[14px] mt-1" style={{ color: '#e8e6e2' }}>
                    @{status.username ?? (username || 'instagram')}
                  </p>
                  {status.last_login_at && (
                    <p className="text-[11px] mt-1" style={{ color: '#666' }}>
                      Last login: {status.last_login_at}
                    </p>
                  )}
                </div>

                <div className="flex justify-end">
                  <Button
                    type="button"
                    onClick={handleLogout}
                    disabled={logoutBusy}
                    style={{ background: '#2a2a32', color: '#e8e6e2' }}
                  >
                    <LogOut size={14} />
                    {logoutBusy ? 'Logging out...' : 'Logout'}
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleConnect} className="flex flex-col gap-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    {label('Username')}
                    <Input
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="instagram_username"
                      autoComplete="username"
                      style={{
                        background: '#16161a',
                        borderColor: '#2a2a32',
                        color: '#e8e6e2',
                      }}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {label('Password')}
                    <Input
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      type="password"
                      placeholder="Password"
                      autoComplete="current-password"
                      style={{
                        background: '#16161a',
                        borderColor: '#2a2a32',
                        color: '#e8e6e2',
                      }}
                    />
                  </div>
                </div>

                {connectError && (
                  <p className="text-[12px]" style={{ color: '#ef4444' }}>
                    {connectError}
                  </p>
                )}

                <div className="flex justify-end">
                  <Button
                    type="submit"
                    disabled={connectBusy}
                    style={{ background: '#3b7ef8', color: '#fff' }}
                  >
                    {connectBusy ? 'Connecting...' : 'Connect Instagram'}
                  </Button>
                </div>
              </form>
            )}
          </section>

          <section
            className="rounded-2xl border p-6"
            style={{ background: '#0c0c0f', borderColor: '#2e2e35' }}
          >
            <div className="flex items-start gap-3 mb-5">
              <div
                className="h-8 w-8 rounded-xl flex items-center justify-center"
                style={{ background: '#162a46', color: '#73a7ff' }}
              >
                <Sparkles size={15} />
              </div>
              <div>
                <h2
                  className="text-[14px] font-semibold"
                  style={{
                    color: '#d8d5cf',
                    fontFamily: 'var(--font-display)',
                  }}
                >
                  Ask AI To Post
                </h2>
                <p className="text-[12px] mt-1" style={{ color: '#666' }}>
                  This goes through Manager, routes to Marketing, creates image
                  slides, then posts to Instagram.
                </p>
              </div>
            </div>

            <form
              onSubmit={handleMarketingPost}
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-1.5">
                {label('Prompt')}
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={5}
                  placeholder="Example: Make 3 premium fresh milk promo slides for MYR 10..."
                  className="w-full rounded-md border px-3 py-2 text-sm outline-none"
                  style={{
                    background: '#16161a',
                    borderColor: '#2a2a32',
                    color: '#e8e6e2',
                  }}
                />
              </div>

              <div className="flex flex-col gap-1.5 max-w-[180px]">
                {label('Slides')}
                <Input
                  type="number"
                  min="1"
                  max="10"
                  step="1"
                  value={slideCount}
                  onChange={(e) => setSlideCount(e.target.value)}
                  style={{
                    background: '#16161a',
                    borderColor: '#2a2a32',
                    color: '#e8e6e2',
                  }}
                />
              </div>

              {marketingError && (
                <p className="text-[12px]" style={{ color: '#ef4444' }}>
                  {marketingError}
                </p>
              )}

              {marketingResult && (
                <div
                  className="rounded-xl border p-4 flex flex-col gap-2"
                  style={{ background: '#121216', borderColor: '#26262d' }}
                >
                  <p
                    className="text-[12px] font-medium"
                    style={{
                      color:
                        marketingResult.status === 'sent'
                          ? '#00c97a'
                          : '#f59e0b',
                    }}
                  >
                    Status: {marketingResult.status}
                  </p>
                  {marketingResult.actionId && (
                    <p
                      className="text-[12px]"
                      style={{
                        color: '#c8c5c0',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      action_id: {marketingResult.actionId}
                    </p>
                  )}
                  {marketingResult.reply && (
                    <p className="text-[12px]" style={{ color: '#c8c5c0' }}>
                      {marketingResult.reply}
                    </p>
                  )}
                  {marketingResult.escalationSummary && (
                    <p className="text-[12px]" style={{ color: '#f59e0b' }}>
                      {marketingResult.escalationSummary}
                    </p>
                  )}
                </div>
              )}

              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={marketingBusy || !status.connected}
                  style={{
                    background: status.connected ? '#3b7ef8' : '#2a2a32',
                    color: '#fff',
                  }}
                >
                  {marketingBusy ? 'Generating...' : 'Generate & Post'}
                </Button>
              </div>
            </form>
          </section>
        </div>
      </main>
    </div>
  )
}
