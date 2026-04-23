import {
  LayoutDashboard, CircleDot, RefreshCw, Target, Rocket,
  Building2, Brain, Wheat, Settings, ChevronDown, Plus, LogOut,
} from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { ScrollArea } from '#/components/ui/scroll-area'
import { Separator } from '#/components/ui/separator'
import { authClient } from '#/lib/auth-client'

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
}

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: 'Dashboard', active: true },
  { icon: CircleDot, label: 'Issues', count: 8 },
  { icon: RefreshCw, label: 'Routines' },
  { icon: Target, label: 'Goals' },
  { icon: Rocket, label: 'Onboarding' },
]

const PRODUCT_ITEMS = [
  { icon: Building2, label: 'Org' },
  { icon: Brain, label: 'Skills' },
  { icon: Wheat, label: 'Documentation' },
]

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}

export function Sidebar({ business, agents = [] }: SidebarProps) {
  const navigate = useNavigate()

  async function handleSignOut() {
    await authClient.signOut()
    await navigate({ to: '/login' })
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
            {NAV_ITEMS.map((item) => (
              <button
                key={item.label}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] transition-colors hover:bg-white/5"
                style={{
                  background: item.active ? 'rgba(255,255,255,0.07)' : 'transparent',
                  color: item.active ? '#e8e6e2' : '#555',
                }}
              >
                <item.icon size={13} />
                <span className="flex-1 text-left">{item.label}</span>
                {item.count != null && (
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded-full"
                    style={{ background: '#1a1a1f', color: '#444', fontFamily: 'var(--font-mono)' }}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            ))}
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
            {agents.map((agent) => (
              <button
                key={agent.id}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] transition-colors hover:bg-white/5"
                style={{ color: '#555' }}
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
            ))}
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
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] transition-colors hover:bg-white/5"
          style={{ color: '#555' }}
        >
          <LogOut size={13} />
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  )
}
