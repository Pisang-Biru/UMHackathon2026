import React from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { InboxAction } from '#/lib/inbox-logic'
import { ActionListItem } from './action-list-item'

interface AgentGroupProps {
  agentType: string
  actions: InboxAction[]
  selectedId: string | null
  onSelect: (action: InboxAction) => void
}

function agentLabel(type: string): string {
  switch (type) {
    case 'support': return 'Support Agent'
    case 'sales': return 'Sales Agent'
    case 'marketing': return 'Marketing Agent'
    default: return type.charAt(0).toUpperCase() + type.slice(1) + ' Agent'
  }
}

export function AgentGroup({ agentType, actions, selectedId, onSelect }: AgentGroupProps) {
  const [open, setOpen] = React.useState(true)
  return (
    <div className="border-b" style={{ borderColor: '#1a1a1e' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-white/5 transition-colors"
      >
        {open ? <ChevronDown size={12} style={{ color: '#555' }} /> : <ChevronRight size={12} style={{ color: '#555' }} />}
        <span
          className="text-[10px] uppercase tracking-[0.14em] font-semibold"
          style={{ color: '#888', fontFamily: 'var(--font-mono)' }}
        >
          {agentLabel(agentType)}
        </span>
        <span
          className="ml-auto text-[10px] px-1.5 py-0.5 rounded"
          style={{ background: '#1e1e24', color: '#666', fontFamily: 'var(--font-mono)' }}
        >
          {actions.length}
        </span>
      </button>
      {open &&
        actions.map((action) => (
          <ActionListItem
            key={action.id}
            action={action}
            selected={action.id === selectedId}
            onClick={() => onSelect(action)}
          />
        ))}
    </div>
  )
}
