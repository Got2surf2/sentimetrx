import { describe, it, expect, vi, beforeEach } from 'vitest'

// Force the RPC path to fail so we exercise the in-memory fallback, which
// is the deterministic, network-free behavior we want to test here.
vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: () => ({
    rpc: () => Promise.resolve({ data: null, error: { message: 'rpc unavailable' } }),
  }),
}))

import { checkRateLimit } from '@/lib/rateLimit'

describe('checkRateLimit (in-memory fallback)', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('allows requests up to the limit then blocks', async () => {
    const key = 'test:bucket-exhaustion:' + Math.random()
    const r1 = await checkRateLimit(key, 3, 60_000)
    const r2 = await checkRateLimit(key, 3, 60_000)
    const r3 = await checkRateLimit(key, 3, 60_000)
    const r4 = await checkRateLimit(key, 3, 60_000)

    expect(r1.limited).toBe(false)
    expect(r1.remaining).toBe(2)
    expect(r2.limited).toBe(false)
    expect(r3.limited).toBe(false)
    expect(r3.remaining).toBe(0)
    expect(r4.limited).toBe(true)
    expect(r4.remaining).toBe(0)
  })

  it('keys are independent — exhausting one does not affect another', async () => {
    const a = 'test:key-a:' + Math.random()
    const b = 'test:key-b:' + Math.random()
    await checkRateLimit(a, 1, 60_000)
    const aBlocked = await checkRateLimit(a, 1, 60_000)
    const bAllowed = await checkRateLimit(b, 1, 60_000)
    expect(aBlocked.limited).toBe(true)
    expect(bAllowed.limited).toBe(false)
  })

  it('resets after the window expires', async () => {
    const key = 'test:reset:' + Math.random()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

    await checkRateLimit(key, 1, 1000)
    const blocked = await checkRateLimit(key, 1, 1000)
    expect(blocked.limited).toBe(true)

    vi.setSystemTime(new Date('2026-01-01T00:00:02Z'))
    const allowedAgain = await checkRateLimit(key, 1, 1000)
    expect(allowedAgain.limited).toBe(false)
    expect(allowedAgain.remaining).toBe(0)
  })
})
