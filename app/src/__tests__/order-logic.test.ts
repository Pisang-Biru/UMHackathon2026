import { describe, it, expect } from 'vitest'
import { paymentUrl, formatOrderTotal, isValidBuyerInput } from '#/lib/order-logic'

describe('paymentUrl', () => {
  it('builds a /pay/<id> path from base and orderId', () => {
    expect(paymentUrl('https://app.com', 'abc123')).toBe('https://app.com/pay/abc123')
  })

  it('strips trailing slash from base', () => {
    expect(paymentUrl('https://app.com/', 'abc123')).toBe('https://app.com/pay/abc123')
  })
})

describe('formatOrderTotal', () => {
  it('formats number as RMx.xx', () => {
    expect(formatOrderTotal(12)).toBe('RM12.00')
    expect(formatOrderTotal(3.5)).toBe('RM3.50')
    expect(formatOrderTotal(0)).toBe('RM0.00')
  })
})

describe('isValidBuyerInput', () => {
  it('requires non-empty trimmed name and contact', () => {
    expect(isValidBuyerInput({ name: 'Ali', contact: '012' })).toBe(true)
    expect(isValidBuyerInput({ name: '  ', contact: '012' })).toBe(false)
    expect(isValidBuyerInput({ name: 'Ali', contact: '' })).toBe(false)
    expect(isValidBuyerInput({ name: '', contact: '' })).toBe(false)
  })
})
