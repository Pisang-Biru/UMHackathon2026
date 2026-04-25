import { describe, expect, it } from 'vitest'
import { getAgentMeta } from '#/lib/agent-meta'

describe('getAgentMeta fallback', () => {
  it('titlecases snake_case ids', () => {
    expect(getAgentMeta('customer_support').name).toBe('Customer Support')
    expect(getAgentMeta('manager').name).toBe('Manager')
  })

  it('handles dash and space separators', () => {
    expect(getAgentMeta('billing-bot').name).toBe('Billing Bot')
    expect(getAgentMeta('finance ops').name).toBe('Finance Ops')
  })

  it('returns a non-empty fallback color', () => {
    expect(getAgentMeta('whatever').color).toMatch(/^#[0-9a-f]{3,6}$/i)
  })
})
