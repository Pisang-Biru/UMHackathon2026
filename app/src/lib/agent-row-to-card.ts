import type { AgentRow } from '#/lib/agent-api'
import type { AgentCardData } from '#/components/dashboard/agent-card'

const COLORS = ['#3b7ef8', '#00c97a', '#a78bfa', '#f59e0b', '#ef4444', '#22d3ee']

function statusFor(row: AgentRow): AgentCardData['status'] {
  if (row.status === 'error') return 'error'
  if (row.status === 'working') return row.current_task ? 'live' : 'running'
  return 'idle'
}

function avatarFor(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export function agentRowToCard(row: AgentRow, idx: number): AgentCardData {
  return {
    id: row.id,
    name: row.name,
    status: statusFor(row),
    task: row.current_task ?? undefined,
    subtask: undefined,
    lastActive: `${row.stats_24h.events} events · 24h`,
    avatar: avatarFor(row.name),
    color: COLORS[idx % COLORS.length],
    queuedCount: undefined,
  }
}
