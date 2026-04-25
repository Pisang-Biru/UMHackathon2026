import { describe, expect, it } from 'vitest'

import { coerceWhatsappStatus } from '#/lib/whatsapp-status'

describe('coerceWhatsappStatus', () => {
  it('normalizes valid bridge payload', () => {
    expect(
      coerceWhatsappStatus({
        status: 'connected',
        connectedPhone: '60123456789',
        qrDataUrl: 'data:image/png;base64,abc',
      }),
    ).toEqual({
      status: 'connected',
      connectedPhone: '60123456789',
      qrDataUrl: 'data:image/png;base64,abc',
      detail: null,
    })
  })

  it('falls back safely for unknown payloads', () => {
    expect(
      coerceWhatsappStatus({
        status: 'weird',
        connectedPhone: 123,
        qrDataUrl: false,
        detail: 9,
      }),
    ).toEqual({
      status: 'disconnected',
      connectedPhone: null,
      qrDataUrl: null,
      detail: null,
    })
  })
})
