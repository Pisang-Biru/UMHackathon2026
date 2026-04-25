export type WhatsappConnectionState =
  | 'disconnected'
  | 'pairing'
  | 'connected'
  | 'error'

export interface WhatsappStatus {
  status: WhatsappConnectionState
  connectedPhone: string | null
  qrDataUrl: string | null
  detail: string | null
}

export function coerceWhatsappStatus(input: unknown): WhatsappStatus {
  const raw = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const status = raw.status
  const safeStatus: WhatsappConnectionState =
    status === 'disconnected' || status === 'pairing' || status === 'connected' || status === 'error'
      ? status
      : 'disconnected'

  return {
    status: safeStatus,
    connectedPhone: typeof raw.connectedPhone === 'string' ? raw.connectedPhone : null,
    qrDataUrl: typeof raw.qrDataUrl === 'string' ? raw.qrDataUrl : null,
    detail: typeof raw.detail === 'string' ? raw.detail : null,
  }
}
