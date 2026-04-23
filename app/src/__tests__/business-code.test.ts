import { describe, it, expect } from 'vitest'
import { deriveCode, generateUniqueCode } from '#/lib/business-code'

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

describe('generateUniqueCode', () => {
  it('returns 3-char code when not taken', async () => {
    const code = await generateUniqueCode('Pisang Biru', async () => false)
    expect(code).toBe('PIS')
  })

  it('increments length on collision', async () => {
    const taken = new Set(['PIS'])
    const code = await generateUniqueCode('Pisang Biru', async (c) => taken.has(c))
    expect(code).toBe('PISA')
  })

  it('throws when name has no letters', async () => {
    await expect(generateUniqueCode('123 456', async () => false)).rejects.toThrow(
      'Business name must contain letters',
    )
  })

  it('handles short names (< 3 letters) correctly', async () => {
    const code = await generateUniqueCode('AI', async () => false)
    expect(code).toBe('AI')
  })
})
