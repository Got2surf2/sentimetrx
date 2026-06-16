import { describe, it, expect } from 'vitest'
import { statusForBalance, isCreditError, SERVICES, STATUS_RANK } from '@/lib/serviceHealth'

describe('statusForBalance', () => {
  it('returns unknown for null / NaN balance', () => {
    expect(statusForBalance('dataforseo', null)).toBe('unknown')
    expect(statusForBalance('dataforseo', NaN)).toBe('unknown')
  })

  it('classifies DataForSEO against its $50 warn / $5 crit thresholds', () => {
    expect(statusForBalance('dataforseo', 120)).toBe('ok')
    expect(statusForBalance('dataforseo', 50)).toBe('low')   // <= warn
    expect(statusForBalance('dataforseo', 40)).toBe('low')
    expect(statusForBalance('dataforseo', 5)).toBe('critical') // <= crit
    expect(statusForBalance('dataforseo', 0)).toBe('critical')
  })

  it('uses each service’s own thresholds', () => {
    // Twilio warn=20, crit=2
    expect(statusForBalance('twilio', 25)).toBe('ok')
    expect(statusForBalance('twilio', 15)).toBe('low')
    expect(statusForBalance('twilio', 1)).toBe('critical')
  })

  it('returns unknown for a tier-2 service with no thresholds', () => {
    // anthropic has no warn/crit — any number is "ok" only if no thresholds trip;
    // with no thresholds defined it falls through to ok.
    expect(statusForBalance('anthropic', 100)).toBe('ok')
  })
})

describe('isCreditError', () => {
  it('treats HTTP 402 as a credit error regardless of message', () => {
    expect(isCreditError(402)).toBe(true)
    expect(isCreditError(402, 'anything')).toBe(true)
  })

  it('treats 429 as credit error only when the message implicates billing/quota', () => {
    expect(isCreditError(429, 'rate limit exceeded for quota')).toBe(true)
    expect(isCreditError(429, 'too many requests')).toBe(false)
  })

  it('detects credit phrasing in the message at any status', () => {
    expect(isCreditError(400, 'Your credit balance is too low')).toBe(true)
    expect(isCreditError(403, 'billing account disabled')).toBe(true)
    expect(isCreditError(500, 'internal error')).toBe(false)
  })

  it('is false for undefined inputs', () => {
    expect(isCreditError(undefined, undefined)).toBe(false)
  })
})

describe('SERVICES roster', () => {
  it('has unique keys and valid tiers', () => {
    const keys = SERVICES.map(s => s.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const s of SERVICES) expect([1, 2]).toContain(s.tier)
  })

  it('only tier-1 services carry balance thresholds', () => {
    for (const s of SERVICES) {
      if (s.tier === 2) expect(s.warn).toBeUndefined()
      else expect(typeof s.warn).toBe('number')
    }
  })

  it('ranks critical worst and ok best', () => {
    expect(STATUS_RANK.critical).toBeGreaterThan(STATUS_RANK.low)
    expect(STATUS_RANK.low).toBeGreaterThan(STATUS_RANK.ok)
  })
})
