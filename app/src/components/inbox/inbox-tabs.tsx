import type { InboxTab } from '#/lib/inbox-logic'

interface InboxTabsProps {
  active: InboxTab
  counts: { mine: number; recent: number; unread: number; finance?: number }
  onChange: (tab: InboxTab) => void
}

const TABS: { key: InboxTab; label: string }[] = [
  { key: 'mine', label: 'Mine' },
  { key: 'recent', label: 'Recent' },
  { key: 'unread', label: 'Unread' },
  { key: 'finance', label: 'Finance' },
]

export function InboxTabs({ active, counts, onChange }: InboxTabsProps) {
  return (
    <div className="flex items-center gap-1 px-4 py-2 border-b" style={{ borderColor: '#1a1a1e' }}>
      {TABS.map((tab) => {
        const isActive = active === tab.key
        const count = counts[tab.key] ?? 0
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors flex items-center gap-1.5"
            style={{
              background: isActive ? '#1e1e24' : 'transparent',
              color: isActive ? '#f0ede8' : '#666',
            }}
          >
            {tab.label}
            {count > 0 && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded"
                style={{
                  background: isActive ? '#3b7ef8' : '#1a1a1e',
                  color: isActive ? '#fff' : '#555',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
