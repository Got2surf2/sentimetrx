// AGENT_TIERS Phase 1 — Super Agent abuse backstop (lib/featureFlags).
// Super turns are UNLIMITED by default (flat monthly pricing). Only an
// org_features row with an explicit monthly ceiling can block, and only once
// this month's 'chat_super' usage reaches it. A counting error fails OPEN.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = {
  quota: null as number | null,       // org_features.quota_per_month (null = no ceiling)
  hasRow: false,                       // whether an org_features row exists
  count: 0,                            // this month's chat_super usage rows
  countError: null as { message: string } | null,
}

function service() {
  return {
    from(table: string) {
      if (table === 'org_features') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: store.hasRow ? { quota_per_month: store.quota } : null }) }) }) }),
        }
      }
      // usage_logs count query: .select('id',{count,head}).eq().eq().gte()
      const chain = {
        eq: () => chain,
        gte: async () => ({ count: store.count, error: store.countError }),
      }
      return { select: () => chain }
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({ createServiceRoleClient: () => service() }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))

import { assertSuperTurnAllowed } from '@/lib/featureFlags'

beforeEach(() => {
  store.quota = null
  store.hasRow = false
  store.count = 0
  store.countError = null
})

describe('assertSuperTurnAllowed', () => {
  it('allows (unlimited) when no org_features row exists — the default', async () => {
    const r = await assertSuperTurnAllowed('o1')
    expect(r).toEqual({ allowed: true, quota: null })
  })

  it('allows (unlimited) when a row exists but quota_per_month is null', async () => {
    store.hasRow = true
    store.quota = null
    const r = await assertSuperTurnAllowed('o1')
    expect(r).toEqual({ allowed: true, quota: null })
  })

  it('allows when usage is below the configured ceiling', async () => {
    store.hasRow = true
    store.quota = 1000
    store.count = 999
    const r = await assertSuperTurnAllowed('o1')
    expect(r).toMatchObject({ allowed: true, quota: 1000, used: 999 })
  })

  it('blocks once usage reaches the ceiling', async () => {
    store.hasRow = true
    store.quota = 1000
    store.count = 1000
    const r = await assertSuperTurnAllowed('o1')
    expect(r).toEqual({ allowed: false, reason: 'quota_exceeded', quota: 1000, used: 1000 })
  })

  it('fails OPEN (allowed) when the usage count query errors', async () => {
    store.hasRow = true
    store.quota = 10
    store.countError = { message: 'boom' }
    const r = await assertSuperTurnAllowed('o1')
    expect(r).toMatchObject({ allowed: true, quota: 10 })
  })
})
