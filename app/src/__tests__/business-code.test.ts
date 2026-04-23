import { describe, it, expect } from 'vitest'
import { deriveCode } from '#/lib/business-code'

describe('deriveCode', () => {
  it('takes first 3 uppercase alpha chars', () => {
    expect(deriveCode('Pisang Biru', 3)).toBe('PIS')
  })

  it('strips non-alpha before slicing', () => {
    expect(deriveCode('123 Corp', 3)).toBe('COR')
  })

  it('handles length > 3', () => {
    expect(deriveCode('Pisang Biru', 4)).toBe('PISA')
  })

  it('returns full stripped name if length >= name length', () => {
    expect(deriveCode('AB', 5)).toBe('AB')
  })

  it('works with all-caps input', () => {
    expect(deriveCode('ACME CORP', 3)).toBe('ACM')
  })

  it('ignores numbers mixed with letters', () => {
    expect(deriveCode('Web3 Studio', 3)).toBe('WEB')
  })
})
