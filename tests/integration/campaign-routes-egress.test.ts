/**
 * Campaign route cross-org egress test — env-gated, self-contained.
 *
 * Where cross-org-egress.test.ts proves the data-layer policies filter
 * cross-tenant reads, this suite proves the next layer up: the
 * service-role-client route handlers gate on the caller's org_id.
 *
 * The two layers fail differently:
 *  - An RLS-protected route silently returns null/empty when the policy
 *    filters; cross-org-egress catches that.
 *  - A service-role route with a missing org_id check happily returns
 *    cross-tenant data — RLS doesn't apply, so cross-org-egress can't
 *    see it. This suite is the safety net for that class of bug.
 *
 * Read-only coverage (POST/DELETE handlers share the same gate code; we
 * deliberately don't exercise destructive cross-tenant writes against the
 * prod-linked DB):
 *  - GET /api/campaigns/[id]/export
 *  - GET /api/campaigns/[id]/respondents
 *  - control: GET /api/campaigns/[id]/export 200s for the owning org
 *    (proves the 404s above are the gate firing, not a seed bug)
 *
 * Strategy: mock @/lib/supabase/server's createClient/createServiceRoleClient
 * to return real supabase-js clients (Org B signed in for createClient,
 * service-role for createServiceRoleClient). The route handlers run in-
 * process and exercise their real `users.org_id` lookup + campaign
 * org_id check.
 *
 * Same prefix/cleanup conventions as cross-org-egress: every row carries a
 * `_camprouttest_<runId>_` marker; afterAll cascades from organizations +
 * clients + auth users.
 *
 * To run:
 *   npm run test:campaign-egress
 *
 * Pre-launch this hits the production Supabase project. Crashed runs leave
 * rows behind under the `_camprouttest_` prefix.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { randomBytes } from 'node:crypto'
import { config as loadDotenv } from 'dotenv'

loadDotenv({ path: '.env.local', override: false })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const enabled = process.env.CAMPAIGN_EGRESS_TEST === '1'

const skip =
  !enabled ||
  !url ||
  !anonKey ||
  !serviceKey ||
  url === 'http://localhost:54321' ||
  serviceKey === 'test-service-role-key'

const describeMaybe = skip ? describe.skip : describe

const RUN_ID = randomBytes(4).toString('hex')
const PREFIX = '_camprouttest_' + RUN_ID + '_'

// Closure refs the mock factory below dereferences at call-time. beforeAll
// populates them once Org B is signed in and the service-role client built.
// Tests that need a different caller (e.g. the owning-org control) swap
// ctx.signedIn temporarily.
const ctx: { signedIn: SupabaseClient | null; admin: SupabaseClient | null } = {
  signedIn: null,
  admin: null,
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ctx.signedIn,
  createServiceRoleClient: () => ctx.admin,
  getAuthUser: async (c: SupabaseClient | null) => {
    if (!c) return null
    const { data } = await c.auth.getUser()
    return data.user ?? null
  },
}))

const ORG_A_PASSWORD = randomBytes(16).toString('hex')
const ORG_B_PASSWORD = randomBytes(16).toString('hex')
const ORG_A_EMAIL = PREFIX + 'a@camprouttest.local'
const ORG_B_EMAIL = PREFIX + 'b@camprouttest.local'

const ids: Record<string, string | null> = {
  clientA: null, clientB: null,
  orgA: null,    orgB: null,
  userA: null,   userB: null,
  studyA: null,
  campaignA: null,
  campaignRespondentA: null,
}

describeMaybe('Campaign route cross-org egress (env-gated)', () => {
  beforeAll(async () => {
    const admin = createSupabaseClient(url!, serviceKey!, { auth: { persistSession: false } })
    ctx.admin = admin

    // ── Two orgs, two users ──
    const cliA = await admin.from('clients').insert({
      name: PREFIX + 'A', slug: PREFIX + 'a', plan: 'trial',
    }).select('id').single()
    if (cliA.error) throw new Error('clients A: ' + cliA.error.message)
    ids.clientA = cliA.data!.id

    const cliB = await admin.from('clients').insert({
      name: PREFIX + 'B', slug: PREFIX + 'b', plan: 'trial',
    }).select('id').single()
    if (cliB.error) throw new Error('clients B: ' + cliB.error.message)
    ids.clientB = cliB.data!.id

    const orgA = await admin.from('organizations').insert({
      name: PREFIX + 'A', slug: PREFIX + 'a',
    }).select('id').single()
    if (orgA.error) throw new Error('organizations A: ' + orgA.error.message)
    ids.orgA = orgA.data!.id

    const orgB = await admin.from('organizations').insert({
      name: PREFIX + 'B', slug: PREFIX + 'b',
    }).select('id').single()
    if (orgB.error) throw new Error('organizations B: ' + orgB.error.message)
    ids.orgB = orgB.data!.id

    const authA = await admin.auth.admin.createUser({
      email: ORG_A_EMAIL, password: ORG_A_PASSWORD, email_confirm: true,
    })
    if (authA.error || !authA.data.user) throw new Error('auth A: ' + authA.error?.message)
    ids.userA = authA.data.user.id

    const authB = await admin.auth.admin.createUser({
      email: ORG_B_EMAIL, password: ORG_B_PASSWORD, email_confirm: true,
    })
    if (authB.error || !authB.data.user) throw new Error('auth B: ' + authB.error?.message)
    ids.userB = authB.data.user.id

    const uA = await admin.from('users').insert({
      id: ids.userA, client_id: ids.clientA, org_id: ids.orgA,
      email: ORG_A_EMAIL, full_name: PREFIX + 'A', role: 'member',
    })
    if (uA.error) throw new Error('users A: ' + uA.error.message)

    const uB = await admin.from('users').insert({
      id: ids.userB, client_id: ids.clientB, org_id: ids.orgB,
      email: ORG_B_EMAIL, full_name: PREFIX + 'B', role: 'member',
    })
    if (uB.error) throw new Error('users B: ' + uB.error.message)

    // ── Org A: study + campaign + one respondent ──
    const study = await admin.from('studies').insert({
      guid: PREFIX + 'study', client_id: ids.clientA, org_id: ids.orgA, created_by: ids.userA,
      name: PREFIX + 'study', bot_name: 'TestBot', status: 'active',
      config: {},
    }).select('id').single()
    if (study.error) throw new Error('studies: ' + study.error.message)
    ids.studyA = study.data!.id

    const camp = await admin.from('campaigns').insert({
      org_id: ids.orgA, study_id: ids.studyA,
      name: PREFIX + 'campaign', study_url: 'https://example.test/' + PREFIX,
      hidden_fields: [], status: 'draft',
    }).select('id').single()
    if (camp.error) throw new Error('campaigns: ' + camp.error.message)
    ids.campaignA = camp.data!.id

    const cr = await admin.from('campaign_respondents').insert({
      campaign_id: ids.campaignA, email: PREFIX + 'r@camprouttest.local',
      recipient_guid: PREFIX + 'rg',
      fields: { secret: 'A-only data' },
    }).select('id').single()
    if (cr.error) throw new Error('campaign_respondents: ' + cr.error.message)
    ids.campaignRespondentA = cr.data!.id

    // ── Sign in Org B's user; this is the default `signedIn` client. ──
    const orgBSession = createSupabaseClient(url!, anonKey!, { auth: { persistSession: false } })
    const signIn = await orgBSession.auth.signInWithPassword({
      email: ORG_B_EMAIL, password: ORG_B_PASSWORD,
    })
    if (signIn.error) throw new Error('sign in B: ' + signIn.error.message)
    ctx.signedIn = orgBSession
  }, 60_000)

  afterAll(async () => {
    const admin = ctx.admin
    if (!admin) return
    if (ids.userA)   try { await admin.from('users').delete().eq('id', ids.userA) } catch {}
    if (ids.userB)   try { await admin.from('users').delete().eq('id', ids.userB) } catch {}
    if (ids.orgA)    try { await admin.from('organizations').delete().eq('id', ids.orgA) } catch {}
    if (ids.orgB)    try { await admin.from('organizations').delete().eq('id', ids.orgB) } catch {}
    if (ids.clientA) try { await admin.from('clients').delete().eq('id', ids.clientA) } catch {}
    if (ids.clientB) try { await admin.from('clients').delete().eq('id', ids.clientB) } catch {}
    if (ids.userA)   try { await admin.auth.admin.deleteUser(ids.userA) } catch {}
    if (ids.userB)   try { await admin.auth.admin.deleteUser(ids.userB) } catch {}
  }, 30_000)

  it('GET /api/campaigns/[id]/export 404s for cross-org caller', async () => {
    const { GET } = await import('@/app/api/campaigns/[id]/export/route')
    const req = new NextRequest(
      'http://test.local/api/campaigns/' + ids.campaignA + '/export',
    )
    const res = await GET(req, { params: Promise.resolve({ id: ids.campaignA! }) })
    expect(res.status).toBe(404)
  })

  it('GET /api/campaigns/[id]/respondents 404s for cross-org caller', async () => {
    const { GET } = await import('@/app/api/campaigns/[id]/respondents/route')
    const req = new NextRequest(
      'http://test.local/api/campaigns/' + ids.campaignA + '/respondents',
    )
    const res = await GET(req, { params: Promise.resolve({ id: ids.campaignA! }) })
    expect(res.status).toBe(404)
  })

  it('GET /api/campaigns/[id]/export returns 200 for the owning org (control)', async () => {
    // Without this, the negative tests above could pass even if the
    // handler 404s for unrelated reasons (seed broke, env wrong, etc.).
    // Sign in as Org A and swap ctx.signedIn for the duration.
    const { GET } = await import('@/app/api/campaigns/[id]/export/route')
    const orgASession = createSupabaseClient(url!, anonKey!, { auth: { persistSession: false } })
    const signIn = await orgASession.auth.signInWithPassword({
      email: ORG_A_EMAIL, password: ORG_A_PASSWORD,
    })
    expect(signIn.error, signIn.error?.message).toBeNull()
    const prev = ctx.signedIn
    ctx.signedIn = orgASession
    try {
      const req = new NextRequest(
        'http://test.local/api/campaigns/' + ids.campaignA + '/export',
      )
      const res = await GET(req, { params: Promise.resolve({ id: ids.campaignA! }) })
      expect(res.status).toBe(200)
    } finally {
      ctx.signedIn = prev
    }
  })
})

if (skip) {
  describe('Campaign route cross-org egress (env-gated)', () => {
    it.skip('skipped — set CAMPAIGN_EGRESS_TEST=1 (npm run test:campaign-egress) to enable; see docs/TESTING.md', () => {})
  })
}
