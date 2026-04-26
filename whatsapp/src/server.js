import cors from 'cors'
import express from 'express'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import QRCode from 'qrcode'

import {
  deriveCustomerId,
  normalizeWhatsappPhone,
  shouldHandleIncomingMessage,
  shouldSendSupportReply,
} from './bridge-utils.js'

const PORT = Number(process.env.PORT ?? '3100')
const AGENTS_BASE_URL = process.env.AGENTS_BASE_URL ?? 'http://localhost:8000'
const APP_ORIGIN = process.env.APP_ORIGIN ?? 'http://localhost:3000'
const SESSION_BASE_DIR = path.resolve(process.cwd(), process.env.WHATSAPP_SESSION_DIR ?? '.wwebjs_auth')

const app = express()
app.use(cors({ origin: APP_ORIGIN, credentials: true }))
app.use(express.json())

const sessions = new Map()
const recentEvents = []

function log(level, message, extra = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    message,
    ...extra,
  }
  recentEvents.push(payload)
  if (recentEvents.length > 200) recentEvents.shift()
  const line = JSON.stringify(payload)
  if (level === 'error' || level === 'warn') {
    console.error(line)
    return
  }
  console.log(line)
}

function sanitizeBusinessId(businessId) {
  return String(businessId ?? '').replace(/[^a-z0-9_-]/gi, '-').toLowerCase()
}

function sessionDirFor(businessId) {
  return path.join(SESSION_BASE_DIR, `session-${sanitizeBusinessId(businessId)}`)
}

async function hasStoredSession(businessId) {
  try {
    await fs.access(sessionDirFor(businessId))
    return true
  } catch {
    return false
  }
}

async function listStoredBusinessIds() {
  try {
    const entries = await fs.readdir(SESSION_BASE_DIR, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('session-'))
      .map((entry) => entry.name.slice('session-'.length))
      .filter(Boolean)
  } catch {
    return []
  }
}

function snapshot(entry) {
  if (!entry) {
    return {
      status: 'disconnected',
      connectedPhone: null,
      qrDataUrl: null,
      detail: null,
    }
  }
  return {
    status: entry.status,
    connectedPhone: entry.connectedPhone,
    qrDataUrl: entry.qrDataUrl,
    detail: entry.detail,
  }
}

async function resolveCustomerPhone(message) {
  try {
    const contact = await message.getContact()
    const candidate = normalizeWhatsappPhone(contact?.number ?? contact?.id?._serialized ?? '')
    if (candidate) return candidate
  } catch {}

  return normalizeWhatsappPhone(message?.from ?? '')
}

async function forwardToSupport(businessId, message) {
  const customerPhone = await resolveCustomerPhone(message)
  const payload = {
    business_id: businessId,
    customer_id: deriveCustomerId(businessId, customerPhone),
    customer_phone: customerPhone,
    message: message.body.trim(),
  }

  log('info', 'support.forward.start', {
    businessId,
    from: message.from,
    customerPhone,
    preview: payload.message.slice(0, 120),
  })

  const response = await fetch(`${AGENTS_BASE_URL}/agent/support/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const detail = await response.text()
    log('error', 'support.forward.http_error', {
      businessId,
      status: response.status,
      detail,
    })
    throw new Error(`support chat failed: ${response.status} ${detail}`)
  }

  const data = await response.json()
  log('info', 'support.forward.done', {
    businessId,
    status: data?.status ?? null,
    hasReply: typeof data?.reply === 'string' && data.reply.trim().length > 0,
    actionId: data?.action_id ?? null,
  })
  return data
}

function bindClientEvents(entry, businessId) {
  entry.client.on('qr', async (qr) => {
    entry.status = 'pairing'
    entry.connectedPhone = null
    entry.detail = null
    entry.qrDataUrl = await QRCode.toDataURL(qr)
    log('info', 'session.qr', { businessId })
  })

  entry.client.on('ready', () => {
    const user = entry.client.info?.wid?.user ?? null
    entry.status = 'connected'
    entry.connectedPhone = user ? `+${String(user).replace(/\D/g, '')}` : null
    entry.qrDataUrl = null
    entry.detail = null
    log('info', 'session.ready', {
      businessId,
      connectedPhone: entry.connectedPhone,
    })
  })

  entry.client.on('auth_failure', (message) => {
    entry.status = 'error'
    entry.detail = typeof message === 'string' ? message : 'Authentication failed'
    entry.qrDataUrl = null
    log('error', 'session.auth_failure', { businessId, detail: entry.detail })
  })

  entry.client.on('disconnected', (reason) => {
    entry.status = 'disconnected'
    entry.detail = typeof reason === 'string' ? reason : 'Disconnected'
    entry.connectedPhone = null
    entry.qrDataUrl = null
    log('warn', 'session.disconnected', { businessId, detail: entry.detail })
  })

  entry.client.on('message', async (message) => {
    log('info', 'message.received', {
      businessId,
      from: message?.from ?? null,
      author: message?.author ?? null,
      type: message?.type ?? null,
      fromMe: Boolean(message?.fromMe),
      hasMedia: Boolean(message?.hasMedia),
      broadcast: Boolean(message?.broadcast),
      isStatus: Boolean(message?.isStatus),
      bodyPreview: typeof message?.body === 'string' ? message.body.slice(0, 120) : null,
    })
    if (!shouldHandleIncomingMessage(message)) {
      log('info', 'message.ignored', {
        businessId,
        from: message?.from ?? null,
        type: message?.type ?? null,
      })
      return
    }
    try {
      const supportPayload = await forwardToSupport(businessId, message)
      if (shouldSendSupportReply(supportPayload)) {
        const replyText = String(supportPayload.reply).trim()
        await entry.client.sendMessage(message.from, replyText)
        log('info', 'message.sent', {
          businessId,
          to: message.from,
          preview: replyText.slice(0, 120),
        })
      } else {
        log('info', 'message.not_sent', {
          businessId,
          reason: supportPayload?.status ?? 'unknown',
          actionId: supportPayload?.action_id ?? null,
        })
      }
    } catch (error) {
      entry.status = 'error'
      entry.detail = error instanceof Error ? error.message : 'Message forwarding failed'
      log('error', 'message.failed', {
        businessId,
        from: message?.from ?? null,
        detail: entry.detail,
      })
    }
  })
}

async function ensureSession(businessId, { restoreOnly = false } = {}) {
  let entry = sessions.get(businessId)
  if (entry) return entry

  if (restoreOnly && !(await hasStoredSession(businessId))) {
    return null
  }

  await fs.mkdir(SESSION_BASE_DIR, { recursive: true })

  const whatsappWeb = await import('whatsapp-web.js')
  const { Client, LocalAuth } = whatsappWeb.default ?? whatsappWeb

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: sanitizeBusinessId(businessId),
      dataPath: SESSION_BASE_DIR,
    }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      ...(process.env.PUPPETEER_EXECUTABLE_PATH
        ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
        : {}),
    },
  })

  entry = {
    businessId,
    client,
    status: 'pairing',
    connectedPhone: null,
    qrDataUrl: null,
    detail: null,
    initializePromise: null,
  }
  sessions.set(businessId, entry)
  bindClientEvents(entry, businessId)

  entry.initializePromise = client.initialize().catch((error) => {
    entry.status = 'error'
    entry.detail = error instanceof Error ? error.message : 'Initialization failed'
    log('error', 'session.initialize_failed', {
      businessId,
      detail: entry.detail,
    })
  })

  return entry
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.get('/debug/events', (_req, res) => {
  res.json({ items: recentEvents.slice(-100) })
})

app.get('/sessions/:businessId/status', async (req, res) => {
  const entry = await ensureSession(req.params.businessId, { restoreOnly: true })
  res.json(snapshot(entry))
})

app.get('/sessions/:businessId/qr', async (req, res) => {
  const entry = await ensureSession(req.params.businessId, { restoreOnly: true })
  const status = snapshot(entry)
  res.json({ status: status.status, qrDataUrl: status.qrDataUrl })
})

app.post('/sessions/:businessId/pair', async (req, res) => {
  const entry = await ensureSession(req.params.businessId)
  res.json(snapshot(entry))
})

app.post('/sessions/:businessId/disconnect', async (req, res) => {
  const entry = sessions.get(req.params.businessId) ?? await ensureSession(req.params.businessId, { restoreOnly: true })
  if (entry) {
    try {
      await entry.client.logout()
    } catch {}
    try {
      await entry.client.destroy()
    } catch {}
    sessions.delete(req.params.businessId)
  }
  res.json({
    status: 'disconnected',
    connectedPhone: null,
    qrDataUrl: null,
    detail: null,
  })
})

app.listen(PORT, () => {
  log('info', 'server.listening', { port: PORT })
})

void (async () => {
  await fs.mkdir(SESSION_BASE_DIR, { recursive: true })
  const businessIds = await listStoredBusinessIds()
  for (const businessId of businessIds) {
    try {
      await ensureSession(businessId, { restoreOnly: true })
      log('info', 'session.restore.started', { businessId })
    } catch (error) {
      log('error', 'session.restore.failed', {
        businessId,
        detail: error instanceof Error ? error.message : 'Restore failed',
      })
    }
  }
})()
