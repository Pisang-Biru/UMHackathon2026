import assert from 'node:assert/strict'

import {
  normalizeWhatsappPhone,
  deriveCustomerId,
  shouldHandleIncomingMessage,
  shouldSendSupportReply,
} from './bridge-utils.js'

assert.equal(normalizeWhatsappPhone('60123456789@c.us'), '+60123456789')

assert.equal(normalizeWhatsappPhone('+60 12-345 6789'), '+60123456789')

assert.equal(
  deriveCustomerId('dev-biz', '+60123456789'),
  'wa:dev-biz:60123456789',
)

assert.equal(
  shouldHandleIncomingMessage({
    from: '60123456789@c.us',
    fromMe: false,
    type: 'chat',
    hasMedia: false,
    body: 'nak beli 2 pisang hijau',
    isStatus: false,
    broadcast: false,
  }),
  true,
)

assert.equal(
  shouldHandleIncomingMessage({
    from: '80311828381798@lid',
    fromMe: false,
    type: 'chat',
    hasMedia: false,
    body: 'Hi',
    isStatus: false,
    broadcast: false,
  }),
  true,
)

assert.equal(
  shouldHandleIncomingMessage({
    from: '60123456789@s.whatsapp.net',
    fromMe: false,
    type: 'chat',
    hasMedia: false,
    body: 'Hello',
    isStatus: false,
    broadcast: false,
  }),
  true,
)

assert.equal(
  shouldHandleIncomingMessage({
    from: '1203630@g.us',
    fromMe: false,
    type: 'chat',
    hasMedia: false,
    body: 'hello',
    isStatus: false,
    broadcast: false,
  }),
  false,
)

assert.equal(
  shouldHandleIncomingMessage({
    from: 'newsletter@newsletter',
    fromMe: false,
    type: 'chat',
    hasMedia: false,
    body: 'Hello',
    isStatus: false,
    broadcast: false,
  }),
  false,
)

assert.equal(
  shouldHandleIncomingMessage({
    from: 'status@broadcast',
    fromMe: false,
    type: 'chat',
    hasMedia: false,
    body: 'hello',
    isStatus: true,
    broadcast: true,
  }),
  false,
)

assert.equal(
  shouldHandleIncomingMessage({
    from: '60123456789@c.us',
    fromMe: false,
    type: 'image',
    hasMedia: true,
    body: '',
    isStatus: false,
    broadcast: false,
  }),
  false,
)

assert.equal(
  shouldSendSupportReply({ status: 'sent', reply: 'hi' }),
  true,
)
assert.equal(
  shouldSendSupportReply({ status: 'auto_send', reply: 'hi' }),
  true,
)

assert.equal(
  shouldSendSupportReply({ status: 'pending_approval', reply: 'hi' }),
  false,
)
assert.equal(
  shouldSendSupportReply({ status: 'sent', reply: '' }),
  false,
)
