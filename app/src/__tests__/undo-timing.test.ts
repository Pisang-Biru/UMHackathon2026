// app/src/__tests__/undo-timing.test.ts
import { describe, it, expect, vi } from 'vitest'

describe('undo fetch', () => {
  it('calls POST /unsend with correct path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' })
    ;(globalThis as any).fetch = fetchMock
    const { unsendAction } = await import('#/lib/inbox-server-fns')
    await unsendAction('a1')
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/agent/actions/a1/unsend'), expect.objectContaining({ method: 'POST' }))
  })

  it('throws on non-OK response', async () => {
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({ ok: false, status: 409, text: async () => 'expired' })
    const { unsendAction } = await import('#/lib/inbox-server-fns')
    await expect(unsendAction('a1')).rejects.toThrow(/409/)
  })
})
