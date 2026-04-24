export interface AgentMeta {
  name: string
  color: string
}

const AGENT_META: Record<string, AgentMeta> = {
  support: { name: 'Support Agent', color: '#3b7ef8' },
}

const FALLBACK_COLOR = '#888'

export function getAgentMeta(agentType: string): AgentMeta {
  return AGENT_META[agentType] ?? { name: agentType, color: FALLBACK_COLOR }
}

export function getAgentName(agentType: string): string {
  return getAgentMeta(agentType).name
}

export function getAgentAvatar(agentType: string): string {
  const name = getAgentName(agentType)
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}
