import { describe, expect, it } from 'vitest'
import {
  ATTRIBUTION_MAX_LEN,
  attributionFromBody,
  attributionFromParams,
  cleanAttributionValue,
  hasAttribution,
} from '@/lib/attribution'

/** Build a searchParams-style getter from a plain object. */
function getter(q: Record<string, string>) {
  return (k: string) => (k in q ? q[k] : null)
}

describe('cleanAttributionValue', () => {
  it('trims and keeps ordinary values', () => {
    expect(cleanAttributionValue('  postcard  ')).toBe('postcard')
  })

  it('rejects non-strings and empties', () => {
    expect(cleanAttributionValue(undefined)).toBeNull()
    expect(cleanAttributionValue(null)).toBeNull()
    expect(cleanAttributionValue(42)).toBeNull()
    expect(cleanAttributionValue({})).toBeNull()
    expect(cleanAttributionValue('')).toBeNull()
    expect(cleanAttributionValue('   ')).toBeNull()
  })

  it('caps length so a hostile URL cannot bloat the row', () => {
    const long = 'x'.repeat(500)
    expect(cleanAttributionValue(long)).toHaveLength(ATTRIBUTION_MAX_LEN)
  })
})

describe('attributionFromParams', () => {
  it('reads the bare param names', () => {
    const a = attributionFromParams(getter({ source: 'postcard', medium: 'qr', campaign: 'sr436' }))
    expect(a).toEqual({ source: 'postcard', medium: 'qr', campaign: 'sr436' })
  })

  it('falls back to utm_* aliases so campaign-tool links work unchanged', () => {
    const a = attributionFromParams(getter({ utm_source: 'email', utm_medium: 'newsletter', utm_campaign: 'spring' }))
    expect(a).toEqual({ source: 'email', medium: 'newsletter', campaign: 'spring' })
  })

  it('prefers the bare name when both are present', () => {
    const a = attributionFromParams(getter({ source: 'placard', utm_source: 'email' }))
    expect(a.source).toBe('placard')
  })

  it('omits absent keys entirely rather than emitting undefined values', () => {
    const a = attributionFromParams(getter({ source: 'postcard' }))
    expect(a).toEqual({ source: 'postcard' })
    expect('medium' in a).toBe(false)
    expect('campaign' in a).toBe(false)
  })

  it('returns an empty object for a bare URL', () => {
    const a = attributionFromParams(getter({}))
    expect(a).toEqual({})
    expect(hasAttribution(a)).toBe(false)
  })
})

describe('attributionFromBody', () => {
  it('re-cleans client-supplied values (the endpoint is public — never trust them)', () => {
    const a = attributionFromBody({ source: '  qr  ', medium: 'x'.repeat(500), campaign: '' })
    expect(a.source).toBe('qr')
    expect(a.medium).toHaveLength(ATTRIBUTION_MAX_LEN)
    expect('campaign' in a).toBe(false)
  })

  it('ignores non-string junk posted directly at the API', () => {
    const a = attributionFromBody({ source: { $ne: null }, medium: ['a'], campaign: 7 })
    expect(a).toEqual({})
    expect(hasAttribution(a)).toBe(false)
  })
})

describe('hasAttribution', () => {
  it('is true when any single field survived', () => {
    expect(hasAttribution({ campaign: 'sr436' })).toBe(true)
    expect(hasAttribution({})).toBe(false)
  })
})
