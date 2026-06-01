// tests/unit/auth/botPageOrgGate.test.ts
//
// Multi-tenancy invariant for the agent admin pages (app/bots/[id]/{history,
// entities,questions}). The service-role agent lookup must pair `id` with
// `org_id` for non-admins (CLAUDE.md), while admins may load any org's agent.
// The entities page is exercised as the representative — all three are identical.

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ctx is read lazily inside the mock factories (deferred closures), so tests
// can reconfigure it before invoking the page.
const ctx = {
  userData: null as any,
  bot: { data: null as any },
  agentEq: [] as Array<[string, unknown]>,
}

vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error('REDIRECT:' + path) },
}))

vi.mock('@/lib/resolveOrg', () => ({
  resolveOrg: (orgs: unknown) => orgs,
}))

// Don't pull the client component (and its UI deps) into the node test.
vi.mock('@/app/bots/[id]/entities/EntitiesClient', () => ({ default: () => null }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'x@y.z' } } }) },
    from: () => {
      const b: any = { select: () => b, eq: () => b, single: async () => ({ data: ctx.userData }) }
      return b
    },
  }),
  createServiceRoleClient: () => ({
    from: () => {
      const b: any = {
        select: () => b,
        eq: (col: string, val: unknown) => { ctx.agentEq.push([col, val]); return b },
        single: async () => ctx.bot,
      }
      return b
    },
  }),
}))

import Page from '@/app/bots/[id]/entities/page'

beforeEach(() => {
  ctx.agentEq = []
})

describe('bot admin page — org gate', () => {
  it('pairs the agent lookup with org_id for a non-admin', async () => {
    ctx.userData = { org_id: 'orgA', full_name: 'X', organizations: { is_admin_org: false } }
    ctx.bot = { data: { org_id: 'orgA', name: 'Bot', slug: 'bot' } }

    await Page({ params: { id: 'bot_1' } })

    expect(ctx.agentEq).toContainEqual(['id', 'bot_1'])
    expect(ctx.agentEq).toContainEqual(['org_id', 'orgA'])
  })

  it('redirects a non-admin whose org-filtered lookup finds nothing (cross-org)', async () => {
    ctx.userData = { org_id: 'orgA', full_name: 'X', organizations: { is_admin_org: false } }
    ctx.bot = { data: null }   // org filter excluded the other org's bot

    await expect(Page({ params: { id: 'other_org_bot' } })).rejects.toThrow('REDIRECT:/bots')
    expect(ctx.agentEq).toContainEqual(['org_id', 'orgA'])
  })

  it('does not constrain the lookup by org_id for an admin (cross-org by design)', async () => {
    ctx.userData = { org_id: 'orgAdmin', full_name: 'X', organizations: { is_admin_org: true } }
    ctx.bot = { data: { org_id: 'orgB', name: 'Bot', slug: 'bot' } }

    await Page({ params: { id: 'bot_in_orgB' } })

    expect(ctx.agentEq).toContainEqual(['id', 'bot_in_orgB'])
    expect(ctx.agentEq.some(([c]) => c === 'org_id')).toBe(false)
  })
})
