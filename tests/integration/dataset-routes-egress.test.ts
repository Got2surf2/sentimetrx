/**
 * Dataset / regulations / org route cross-org egress test — env-gated.
 *
 * Locks the gates on service-role routes that fetch a row by bare `.eq('id', ...)`
 * and would otherwise let a cross-org caller mutate it. The W19 audit's
 * "38 bare-id lookups" pattern.
 *
 * Routes under test:
 *  - POST /api/datasets/[datasetId]/sync
 *  - POST /api/datasets/[datasetId]/auto-setup
 *  - POST /api/regulations-sources/download-comments (batch + finalize)
 *  - DELETE /api/org/logo
 *
 * Strategy mirrors campaign-routes-egress.test.ts: mock @/lib/supabase/server
 * to return real supabase-js clients (Org B signed in for createClient,
 * service-role for createServiceRoleClient). The route handlers run in-
 * process and exercise their real `users.org_id` lookup + dataset.org_id
 * cross-org check.
 *
 * Same prefix/cleanup conventions: `_datasetroute_<runId>_` markers on
 * every row; afterAll cascades from organizations + clients + auth users.
 *
 * To run:
 *   npm run test:dataset-egress
 *
 * Pre-launch this hits the production Supabase project. Crashed runs leave
 * rows behind under the `_datasetroute_` prefix.
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
const enabled = process.env.DATASET_EGRESS_TEST === '1'

const skip =
  !enabled ||
  !url ||
  !anonKey ||
  !serviceKey ||
  url === 'http://localhost:54321' ||
  serviceKey === 'test-service-role-key'

const describeMaybe = skip ? describe.skip : describe

const RUN_ID = randomBytes(4).toString('hex')
const PREFIX = '_datasetroute_' + RUN_ID + '_'

// beforeAll populates these; the mock factory reads them at call-time so
// tests can swap ctx.signedIn temporarily (for the owning-org control).
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
const ORG_A_EMAIL = PREFIX + 'a@datasetroute.local'
const ORG_B_EMAIL = PREFIX + 'b@datasetroute.local'

const ids: Record<string, string | null> = {
  clientA: null, clientB: null,
  orgA: null,    orgB: null,
  userA: null,   userB: null,
  studyA: null,
  studyDatasetA: null,
  regDatasetA: null,
}

describeMaybe('Dataset/regulations route cross-org egress (env-gated)', () => {
  beforeAll(async () => {
    const admin = createSupabaseClient(url!, serviceKey!, { auth: { persistSession: false } })
    ctx.admin = admin

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

    // ── Org A: a study + a dataset linked to it (source=study) for the
    //          sync route, plus a regulations-source dataset.
    const study = await admin.from('studies').insert({
      guid: PREFIX + 'study', client_id: ids.clientA, org_id: ids.orgA, created_by: ids.userA,
      name: PREFIX + 'study', bot_name: 'TestBot', status: 'active',
      config: {},
    }).select('id').single()
    if (study.error) throw new Error('studies: ' + study.error.message)
    ids.studyA = study.data!.id

    const studyDs = await admin.from('datasets').insert({
      name: PREFIX + 'study_dataset', source: 'study',
      org_id: ids.orgA, study_id: ids.studyA, created_by: ids.userA,
    }).select('id').single()
    if (studyDs.error) throw new Error('study dataset: ' + studyDs.error.message)
    ids.studyDatasetA = studyDs.data!.id

    const regDs = await admin.from('datasets').insert({
      name: PREFIX + 'reg_dataset', source: 'regulations',
      org_id: ids.orgA, created_by: ids.userA,
      description: JSON.stringify({ download_status: 'in_progress' }),
    }).select('id').single()
    if (regDs.error) throw new Error('reg dataset: ' + regDs.error.message)
    ids.regDatasetA = regDs.data!.id

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
    // Drop seeded datasets explicitly before the org cascade (the
    // datasets→dataset_state FK has CASCADE but study_dataset references
    // studies → cleaner to delete datasets first).
    if (ids.studyDatasetA) try { await admin.from('datasets').delete().eq('id', ids.studyDatasetA) } catch {}
    if (ids.regDatasetA)   try { await admin.from('datasets').delete().eq('id', ids.regDatasetA)   } catch {}
    if (ids.studyA)        try { await admin.from('studies').delete().eq('id', ids.studyA)         } catch {}
    if (ids.userA)         try { await admin.from('users').delete().eq('id', ids.userA)            } catch {}
    if (ids.userB)         try { await admin.from('users').delete().eq('id', ids.userB)            } catch {}
    if (ids.orgA)          try { await admin.from('organizations').delete().eq('id', ids.orgA)     } catch {}
    if (ids.orgB)          try { await admin.from('organizations').delete().eq('id', ids.orgB)     } catch {}
    if (ids.clientA)       try { await admin.from('clients').delete().eq('id', ids.clientA)        } catch {}
    if (ids.clientB)       try { await admin.from('clients').delete().eq('id', ids.clientB)        } catch {}
    if (ids.userA)         try { await admin.auth.admin.deleteUser(ids.userA) } catch {}
    if (ids.userB)         try { await admin.auth.admin.deleteUser(ids.userB) } catch {}
  }, 30_000)

  it('POST /api/datasets/[datasetId]/sync 404s for cross-org caller', async () => {
    const { POST } = await import('@/app/api/datasets/[datasetId]/sync/route')
    const req = new NextRequest(
      'http://test.local/api/datasets/' + ids.studyDatasetA + '/sync',
      { method: 'POST' },
    )
    const res = await POST(req, { params: Promise.resolve({ datasetId: ids.studyDatasetA! }) })
    expect(res.status).toBe(404)
  })

  it('POST /api/datasets/[datasetId]/sync does NOT 404 for the owning org (control)', async () => {
    // Sign in as Org A and swap ctx.signedIn temporarily. The sync may
    // return 200 (no rows to sync — study has no responses) or 400
    // (study not properly configured); we only assert NOT 404, which
    // is what proves the gate is what fires for cross-org, not a
    // missing-resource bug.
    const { POST } = await import('@/app/api/datasets/[datasetId]/sync/route')
    const orgASession = createSupabaseClient(url!, anonKey!, { auth: { persistSession: false } })
    const signIn = await orgASession.auth.signInWithPassword({
      email: ORG_A_EMAIL, password: ORG_A_PASSWORD,
    })
    expect(signIn.error, signIn.error?.message).toBeNull()
    const prev = ctx.signedIn
    ctx.signedIn = orgASession
    try {
      const req = new NextRequest(
        'http://test.local/api/datasets/' + ids.studyDatasetA + '/sync',
        { method: 'POST' },
      )
      const res = await POST(req, { params: Promise.resolve({ datasetId: ids.studyDatasetA! }) })
      expect(res.status).not.toBe(404)
    } finally {
      ctx.signedIn = prev
    }
  })

  it('POST /api/regulations-sources/download-comments 404s for cross-org caller (batch variant)', async () => {
    const { POST } = await import('@/app/api/regulations-sources/download-comments/route')
    const req = new NextRequest(
      'http://test.local/api/regulations-sources/download-comments',
      {
        method: 'POST',
        body: JSON.stringify({ dataset_id: ids.regDatasetA, docket_id: 'FAKE-2024-0001', page: 1 }),
        headers: { 'Content-Type': 'application/json' },
      },
    )
    const res = await POST(req)
    expect(res.status).toBe(404)
  })

  it('POST /api/regulations-sources/download-comments 404s for cross-org caller (finalize variant)', async () => {
    const { POST } = await import('@/app/api/regulations-sources/download-comments/route')
    const req = new NextRequest(
      'http://test.local/api/regulations-sources/download-comments',
      {
        method: 'POST',
        body: JSON.stringify({ dataset_id: ids.regDatasetA, docket_id: 'FAKE-2024-0001', finalize: true }),
        headers: { 'Content-Type': 'application/json' },
      },
    )
    const res = await POST(req)
    expect(res.status).toBe(404)
  })

  it('POST /api/regulations-sources/download-comments does NOT 404 for the owning org on finalize (control)', async () => {
    // Finalize-only path is the safe control: it does no external API
    // calls and just runs analytics-compute over dataset_rows_flat (which
    // is empty for this test dataset → harmless no-op). Owning-org call
    // should NOT 404.
    const { POST } = await import('@/app/api/regulations-sources/download-comments/route')
    const orgASession = createSupabaseClient(url!, anonKey!, { auth: { persistSession: false } })
    const signIn = await orgASession.auth.signInWithPassword({
      email: ORG_A_EMAIL, password: ORG_A_PASSWORD,
    })
    expect(signIn.error, signIn.error?.message).toBeNull()
    const prev = ctx.signedIn
    ctx.signedIn = orgASession
    try {
      const req = new NextRequest(
        'http://test.local/api/regulations-sources/download-comments',
        {
          method: 'POST',
          body: JSON.stringify({ dataset_id: ids.regDatasetA, docket_id: 'FAKE-2024-0001', finalize: true }),
          headers: { 'Content-Type': 'application/json' },
        },
      )
      const res = await POST(req)
      expect(res.status).not.toBe(404)
    } finally {
      ctx.signedIn = prev
    }
  })

  it('POST /api/datasets/[datasetId]/auto-setup 404s for cross-org caller', async () => {
    // Pre-fix this route would happily overwrite Org A's schema + name when
    // called by Org B with Org A's dataset id.
    const { POST } = await import('@/app/api/datasets/[datasetId]/auto-setup/route')
    const req = new NextRequest(
      'http://test.local/api/datasets/' + ids.studyDatasetA + '/auto-setup',
      { method: 'POST' },
    )
    const res = await POST(req, { params: Promise.resolve({ datasetId: ids.studyDatasetA! }) })
    expect(res.status).toBe(404)
  })

  it('POST /api/datasets/[datasetId]/auto-setup does NOT 404 for the owning org (control)', async () => {
    // Owning org may hit a 400 ("Study config not found") because the seed
    // study has an empty config, but it must NOT 404 — that would mean the
    // gate is firing for the wrong reason.
    const { POST } = await import('@/app/api/datasets/[datasetId]/auto-setup/route')
    const orgASession = createSupabaseClient(url!, anonKey!, { auth: { persistSession: false } })
    const signIn = await orgASession.auth.signInWithPassword({
      email: ORG_A_EMAIL, password: ORG_A_PASSWORD,
    })
    expect(signIn.error, signIn.error?.message).toBeNull()
    const prev = ctx.signedIn
    ctx.signedIn = orgASession
    try {
      const req = new NextRequest(
        'http://test.local/api/datasets/' + ids.studyDatasetA + '/auto-setup',
        { method: 'POST' },
      )
      const res = await POST(req, { params: Promise.resolve({ datasetId: ids.studyDatasetA! }) })
      expect(res.status).not.toBe(404)
    } finally {
      ctx.signedIn = prev
    }
  })

  it('DELETE /api/org/logo 403s when caller does not own the target org', async () => {
    // Pre-fix this route would clear any org's logo when called by any
    // authed user with that org's id. POST had the check; DELETE didn't.
    const { DELETE } = await import('@/app/api/org/logo/route')
    const req = new NextRequest('http://test.local/api/org/logo', {
      method: 'DELETE',
      body: JSON.stringify({ org_id: ids.orgA }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await DELETE(req)
    expect(res.status).toBe(403)
  })

  it('DELETE /api/org/logo 200s for the owning org (control)', async () => {
    const { DELETE } = await import('@/app/api/org/logo/route')
    const orgASession = createSupabaseClient(url!, anonKey!, { auth: { persistSession: false } })
    const signIn = await orgASession.auth.signInWithPassword({
      email: ORG_A_EMAIL, password: ORG_A_PASSWORD,
    })
    expect(signIn.error, signIn.error?.message).toBeNull()
    const prev = ctx.signedIn
    ctx.signedIn = orgASession
    try {
      const req = new NextRequest('http://test.local/api/org/logo', {
        method: 'DELETE',
        body: JSON.stringify({ org_id: ids.orgA }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await DELETE(req)
      expect(res.status).toBe(200)
    } finally {
      ctx.signedIn = prev
    }
  })
})

if (skip) {
  describe('Dataset/regulations route cross-org egress (env-gated)', () => {
    it.skip('skipped — set DATASET_EGRESS_TEST=1 (npm run test:dataset-egress) to enable; see docs/TESTING.md', () => {})
  })
}
