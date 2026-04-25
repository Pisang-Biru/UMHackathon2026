function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '')
}

export function normalizeWhatsappPhone(raw) {
  const cleaned = String(raw ?? '')
    .replace(/@c\.us$/i, '')
    .replace(/@s\.whatsapp\.net$/i, '')
    .replace(/@lid$/i, '')
    .trim()
  const digits = digitsOnly(cleaned)
  return digits ? `+${digits}` : ''
}

export function deriveCustomerId(businessId, customerPhone) {
  const digits = digitsOnly(customerPhone)
  return `wa:${businessId}:${digits}`
}

export function shouldHandleIncomingMessage(message) {
  if (!message || message.fromMe) return false
  if (message.broadcast || message.isStatus) return false
  if (message.hasMedia) return false
  if (typeof message.body !== 'string' || message.body.trim().length === 0) return false
  if (message.type !== 'chat') return false
  if (typeof message.from !== 'string') return false
  if (message.from.endsWith('@g.us')) return false
  if (message.from.endsWith('@newsletter')) return false
  return true
}

export function shouldSendSupportReply(payload) {
  if (!payload || typeof payload.reply !== 'string' || payload.reply.trim().length === 0) {
    return false
  }
  return payload.status === 'sent' || payload.status === 'auto_send'
}
