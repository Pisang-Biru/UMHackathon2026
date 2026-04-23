export type AgentTab = 'dashboard' | 'runs' | 'budget'

interface AgentTabBarProps {
  active: AgentTab
  onChange: (tab: AgentTab) => void
}

const TABS: { id: AgentTab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'runs', label: 'Runs' },
  { id: 'budget', label: 'Budget' },
]

export function AgentTabBar({ active, onChange }: AgentTabBarProps) {
  return (
    <div className="flex gap-4 px-8 border-b" style={{ borderColor: '#1a1a1e' }}>
      {TABS.map((t) => {
        const isActive = t.id === active
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className="py-3 text-[12px] transition-colors"
            style={{
              color: isActive ? '#f0ede8' : '#555',
              borderBottom: isActive ? '1.5px solid #3b7ef8' : '1.5px solid transparent',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
