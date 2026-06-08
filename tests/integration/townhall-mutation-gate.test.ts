// tests/integration/townhall-mutation-gate.test.ts
//
// Phase 1 — regression tests for two cross-org write holes found + fixed
// 2026-06-08:
//   - POST /api/townhall/themes/[id]            (CRITICAL: moderate any org's
//     town-hall topics by id with no caller-org check)
//   - POST /api/townhall/sessions/[id]/duplicate (MEDIUM: duplicate any org's
//     session by id with no caller-org check)
//
// Both now gate to the owning org or a platform admin. These tests assert the
// secure contract: cross-org non-admin → 404, admin bypass allowed.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const ctx = {
  authUser: null as any,
  results: {} as Record<string, any>,
}
function reset() { ctx.authUser = null; ctx.results = {} }

function builder(table: string): any {
  const b: any = {}
  for (const m of ['select', 'eq', 'order', 'in', 'limit', 'neq', 'update', 'delete', 'insert']) b[m] = () => b
  b.single = async () => ctx.results[table] ?? { data: null, error: null }
  b.maybeSingle = async () => ctx.results[table] ?? { data: null, error: null }
  b.then = (res: any, rej: any) => Promise.resolve(ctx.results[table] ?? { data: [], error: null }).then(res, rej)
  return b
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: (t: string) => builder(t) }),
  createServiceRoleClient: () => ({ from: (t: string) => builder(t) }),
  getAuthUser: async () => ctx.authUser,
}))

import * as themes from '@/app/api/townhall/themes/[id]/route'
import * as duplicate from '@/app/api/townhall/sessions/[id]/duplicate/route'

const idProps = { params: Promise.resolve({ id: 'x_1' }) } as any
const post = (body: any = {}) => new Request('http://t/x', { method: 'POST', body: JSON.stringify(body) }) as any

const nonAdmin = (org: string) => ({ data: { org_id: org, organizations: { is_admin_org: false } }, error: null })
const admin = { data: { org_id: 'orgZ', organizations: { is_admin_org: true } }, error: null }

beforeEach(reset)

describe('POST /api/townhall/themes/[id] — caller-org gate', () => {
  const approve = () => themes.POST(post({ action: 'approve' }), idProps)

  it('401 unauthenticated', async () => {
    expect((await approve()).status).toBe(401)
  })

  it('401 when the user has no org and is not an admin', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = { data: { org_id: null, organizations: { is_admin_org: false } }, error: null }
    expect((await approve()).status).toBe(401)
  })

  it('404 cross-org for a non-admin (new-substrate topic in another org)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = nonAdmin('orgA')
    ctx.results['town_hall_topics'] = { data: { id: 'x_1', town_hall_id: 'th1', org_id: 'orgB' }, error: null }
    expect((await approve()).status).toBe(404)
  })

  it('404 cross-org for a non-admin (legacy theme via parent session in another org)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = nonAdmin('orgA')
    ctx.results['town_hall_topics'] = { data: null, error: null } // not the new substrate
    ctx.results['townhall_themes'] = { data: { id: 'x_1', townhall_sessions: { org_id: 'orgB' } }, error: null }
    expect((await approve()).status).toBe(404)
  })

  it('allows the owning org (non-admin, same org)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = nonAdmin('orgA')
    ctx.results['town_hall_topics'] = { data: { id: 'x_1', town_hall_id: 'th1', org_id: 'orgA' }, error: null }
    expect((await approve()).status).toBe(200)
  })

  it('allows a platform admin to bypass the org check', async () => {
    ctx.authUser = { id: 'admin' }
    ctx.results['users'] = admin
    ctx.results['town_hall_topics'] = { data: { id: 'x_1', town_hall_id: 'th1', org_id: 'orgB' }, error: null }
    expect((await approve()).status).toBe(200)
  })
})

describe('POST /api/townhall/sessions/[id]/duplicate — caller-org gate', () => {
  const dup = () => duplicate.POST(post(), idProps)

  it('401 unauthenticated', async () => {
    expect((await dup()).status).toBe(401)
  })

  it('404 cross-org for a non-admin', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = nonAdmin('orgA')
    ctx.results['townhall_sessions'] = { data: { name: 'S', config: {}, discussion_guide: null, org_id: 'orgB' }, error: null }
    expect((await dup()).status).toBe(404)
  })

  it('duplicates for the owning org (201)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = nonAdmin('orgA')
    ctx.results['townhall_sessions'] = { data: { name: 'S', config: {}, discussion_guide: null, org_id: 'orgA' }, error: null }
    expect((await dup()).status).toBe(201)
  })

  it('allows a platform admin to bypass the org check (201)', async () => {
    ctx.authUser = { id: 'admin' }
    ctx.results['users'] = admin
    ctx.results['townhall_sessions'] = { data: { name: 'S', config: {}, discussion_guide: null, org_id: 'orgB' }, error: null }
    expect((await dup()).status).toBe(201)
  })
})
