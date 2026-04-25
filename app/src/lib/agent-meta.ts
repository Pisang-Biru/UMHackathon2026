// Display fallbacks ONLY. The single source of truth for the agent roster is
// the backend `/agent/registry` endpoint (populated at boot from each agent
// module's Python `AGENT_META` constant). To add a new agent: declare
// `AGENT_META = {"id","name","role","icon"}` at the top of your
// `agents/app/agents/<name>.py` — frontend picks it up automatically. Do NOT
// hand-edit this file when adding agents.

export interface AgentMeta {
  name: string
  color: string
}

const FALLBACK_COLOR = '#888'

function titleCase(s: string): string {
  return s
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(' ')
}

export function getAgentMeta(agentType: string): AgentMeta {
  return { name: titleCase(agentType), color: FALLBACK_COLOR }
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
