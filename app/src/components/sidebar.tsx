import React from 'react'
import {
  LayoutDashboard, CircleDot, RefreshCw, Target,
  Building2, Brain, Wheat, Settings, ChevronDown, Plus, LogOut, ShoppingBag, Inbox, TrendingUp,
} from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ScrollArea } from '#/components/ui/scroll-area'
import { Separator } from '#/components/ui/separator'
import { authClient } from '#/lib/auth-client'
import { fetchTabCounts } from '#/lib/inbox-server-fns'

interface Agent {
  id: string
  name: string
  color: string
  live?: boolean
}

interface Business {
  id: string
  name: string
  code: string
}

interface SidebarProps {
  business: Business
  agents?: Agent[]
  activeAgentType?: string
}

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: 'Dashboard', route: 'dashboard' },
  { icon: Inbox, label: 'Inbox', route: 'inbox' },
  { icon: ShoppingBag, label: 'Products', route: 'products' },
  { icon: TrendingUp, label: 'Sales', route: 'sales' },
  { icon: CircleDot, label: 'Issues', count: 8 },
  { icon: RefreshCw, label: 'Routines' },
  { icon: Target, label: 'Goals', route: 'goals' },
]

const PRODUCT_ITEMS = [
  { icon: Building2, label: 'Org' },
  { icon: Brain, label: 'Skills' },
  { icon: Wheat, label: 'Documentation' },
]

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}

export function Sidebar({ business, agents = [], activeAgentType }: SidebarProps) {
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = React.useState(false)

  const { data: tabCounts } = useQuery({
    queryKey: ['inbox-tab-counts', business.id],
    queryFn: () => fetchTabCounts({ data: { businessId: business.id } }),
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  })
  const unread = tabCounts?.unread ?? 0

  async function handleSignOut() {
    if (signingOut) return
    setSigningOut(true)
    try {
      await authClient.signOut()
    } catch (err) {
      console.error('Sign-out failed', err)
    }
    navigate({ to: '/login' })
  }

  return (
    <aside
      className="w-[210px] shrink-0 flex flex-col h-full"
      style={{ background: '#0c0c0f', borderRight: '1px solid #1a1a1e' }}
    >
      {/* Business selector */}
      <div className="px-3 py-3 border-b" style={{ borderColor: '#1a1a1e' }}>
        <button className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors">
          <div
            className="w-[22px] h-[22px] rounded-[5px] flex items-center justify-center text-[8px] font-bold text-white shrink-0"
            style={{ background: 'linear-gradient(135deg, #3b7ef8, #00c97a)', fontFamily: 'var(--font-mono)' }}
          >
            {initials(business.name)}
          </div>
          <span className="flex-1 text-left text-[13px] font-semibold truncate" style={{ color: '#e8e6e2', fontFamily: 'var(--font-display)' }}>
            {business.name}
          </span>
          <ChevronDown size={11} style={{ color: '#333338' }} />
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-2 py-2">
          {/* Main nav */}
          <div className="space-y-0.5 mb-4">
            {NAV_ITEMS.map((item) => {
              const isInbox = 'route' in item && item.route === 'inbox'
              const showUnread = isInbox && unread > 0
              return (
                <button
                  key={item.label}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] transition-colors hover:bg-white/5 relative"
                  onClick={() => {
                    if ('route' in item && item.route) {
                      navigate({ to: '/$businessCode/' + item.route as any, params: { businessCode: business.code } } as any)
                    }
                  }}
                  style={{
                    color: showUnread ? '#e8e6e2' : '#555',
                  }}
                >
                  <span className="relative inline-flex">
                    <item.icon size={13} />
                    {showUnread && (
                      <span
                        className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full"
                        style={{
                          background: '#ff3b5c',
                          boxShadow: '0 0 0 2px #0c0c0f, 0 0 8px rgba(255,59,92,0.7)',
                          animation: 'pulse-dot 1.6s ease-in-out infinite',
                        }}
                      />
                    )}
                  </span>
                  <span className="flex-1 text-left">{item.label}</span>
                  {showUnread && (
                    <span
                      className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full leading-none tabular-nums"
                      style={{
                        background: 'linear-gradient(135deg, #ff3b5c 0%, #ff6b35 100%)',
                        color: '#fff',
                        fontFamily: 'var(--font-mono)',
                        letterSpacing: '0.02em',
                        boxShadow: '0 0 12px rgba(255,59,92,0.35), inset 0 1px 0 rgba(255,255,255,0.18)',
                        minWidth: '16px',
                        textAlign: 'center',
                      }}
                    >
                      {unread > 99 ? '99+' : unread}
                    </span>
                  )}
                  {!showUnread && item.count != null && (
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded-full"
                      style={{ background: '#1a1a1f', color: '#444', fontFamily: 'var(--font-mono)' }}
                    >
                      {item.count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          <Separator style={{ background: '#1a1a1e' }} className="my-2" />

          {/* Agents section */}
          <p
            className="text-[9px] uppercase tracking-[0.14em] px-2.5 mb-1.5"
            style={{ color: '#252530', fontFamily: 'var(--font-mono)' }}
          >
            Agents
          </p>
          <div className="space-y-0.5 mb-4">
            {agents.map((agent) => {
              const active = agent.id === activeAgentType
              return (
                <button
                  key={agent.id}
                  onClick={() => navigate({
                    to: '/$businessCode/agents/$agentType',
                    params: { businessCode: business.code, agentType: agent.id },
                  } as any)}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] transition-colors hover:bg-white/5"
                  style={{
                    color: active ? '#e8e6e2' : '#555',
                    background: active ? '#16161a' : 'transparent',
                    border: active ? '1px solid #1e1e24' : '1px solid transparent',
                  }}
                >
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ background: agent.color + '25', border: `1.5px solid ${agent.color}50` }}
                  />
                  <span className="flex-1 text-left truncate">{agent.name}</span>
                  {agent.live && (
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: '#00c97a', animation: 'pulse-dot 1.8s ease-in-out infinite' }}
                    />
                  )}
                </button>
              )
            })}
            <button
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] transition-colors hover:bg-white/5"
              style={{ color: '#2a2a32' }}
            >
              <Plus size={11} />
              <span>Add agent</span>
            </button>
          </div>

          <Separator style={{ background: '#1a1a1e' }} className="my-2" />

          {/* Products section */}
          <p
            className="text-[9px] uppercase tracking-[0.14em] px-2.5 mb-1.5"
            style={{ color: '#252530', fontFamily: 'var(--font-mono)' }}
          >
            Products
          </p>
          <div className="space-y-0.5">
            {PRODUCT_ITEMS.map((item) => (
              <button
                key={item.label}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] transition-colors hover:bg-white/5"
                style={{ color: '#555' }}
              >
                <item.icon size={13} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      </ScrollArea>

      <div className="px-2 py-2 border-t flex flex-col gap-0.5" style={{ borderColor: '#1a1a1e' }}>
        <button
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] transition-colors hover:bg-white/5"
          style={{ color: '#555' }}
        >
          <Settings size={13} />
          <span>Settings</span>
        </button>
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] transition-colors hover:bg-white/5 disabled:opacity-50"
          style={{ color: '#555' }}
        >
          <LogOut size={13} />
          <span>{signingOut ? 'Signing out…' : 'Sign out'}</span>
        </button>
      </div>
    </aside>
  )
}
