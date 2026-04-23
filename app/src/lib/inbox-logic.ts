export type AgentActionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'AUTO_SENT'
export type InboxTab = 'mine' | 'recent' | 'unread'

export interface InboxAction {
  id: string
  businessId: string
  customerMsg: string
  draftReply: string
  finalReply: string | null
  confidence: number
  reasoning: string
  status: AgentActionStatus
  viewedAt: Date | null
  agentType: string
  createdAt: Date
  updatedAt: Date
}

export interface AgentGroup {
  agentType: string
  actions: InboxAction[]
}

export function groupByAgent(actions: InboxAction[]): AgentGroup[] {
  const map = new Map<string, InboxAction[]>()
  for (const action of actions) {
    const existing = map.get(action.agentType)
    if (existing) {
      existing.push(action)
    } else {
      map.set(action.agentType, [action])
    }
  }
  return Array.from(map.entries()).map(([agentType, actions]) => ({ agentType, actions }))
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export function matchesTab(action: InboxAction, tab: InboxTab, now: Date = new Date()): boolean {
  switch (tab) {
    case 'mine':
      return action.status === 'PENDING'
    case 'recent':
      return (
        action.status !== 'AUTO_SENT' &&
        now.getTime() - action.createdAt.getTime() <= SEVEN_DAYS_MS
      )
    case 'unread':
      return action.viewedAt === null && action.status !== 'AUTO_SENT'
  }
}
