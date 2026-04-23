import type { AgentCardData } from '#/components/dashboard/agent-card'

const AGENT_COLORS = ['#3b7ef8', '#00c97a', '#a78bfa', '#f59e0b', '#ef4444']

export function bucketActivity(dates: Date[], now: Date = new Date()): number[] {
  const buckets = Array(14).fill(0)
  const todayMs = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  for (const d of dates) {
    const dayMs = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
    const diff = Math.floor((todayMs - dayMs) / 86400000)
    if (diff >= 0 && diff < 14) {
      buckets[13 - diff]++
    }
  }
  return buckets
}

export function computeSuccessRate(
  statusCounts: { status: string; _count: { _all: number } }[]
): number {
  const approved = statusCounts.find((s) => s.status === 'APPROVED')?._count._all ?? 0
  const rejected = statusCounts.find((s) => s.status === 'REJECTED')?._count._all ?? 0
  const total = approved + rejected
  return total === 0 ? 0 : Math.round((approved / total) * 100)
}

type DbActionStatus = 'PENDING' | 'AUTO_SENT' | 'APPROVED' | 'REJECTED' | null

export function mapAgentStatus(
  latestStatus: DbActionStatus
): 'live' | 'running' | 'finished' | 'idle' {
  if (latestStatus === 'PENDING') return 'live'
  if (latestStatus === 'AUTO_SENT') return 'running'
  if (latestStatus === 'APPROVED' || latestStatus === 'REJECTED') return 'finished'
  return 'idle'
}

export function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const diff = now.getTime() - date.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function buildAgentCards(
  actions: { agentType: string; status: DbActionStatus; customerMsg: string; createdAt: Date }[],
  now: Date = new Date()
): AgentCardData[] {
  const sorted = [...actions].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  const latestByAgent = new Map<string, (typeof sorted)[0]>()
  for (const action of sorted) {
    if (!latestByAgent.has(action.agentType)) {
      latestByAgent.set(action.agentType, action)
    }
  }

  return Array.from(latestByAgent.entries()).map(([agentType, latest], i) => ({
    id: agentType,
    name: agentType,
    status: mapAgentStatus(latest.status),
    task:
      latest.customerMsg.length > 60
        ? latest.customerMsg.slice(0, 60) + '…'
        : latest.customerMsg,
    lastActive: formatRelativeTime(latest.createdAt, now),
    avatar: agentType.slice(0, 2).toUpperCase(),
    color: AGENT_COLORS[i % AGENT_COLORS.length],
  }))
}
