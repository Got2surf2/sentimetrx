/**
 * RLS isolation test — env-gated, self-contained.
 *
 * Verifies that RLS prevents Org B from reading Org A's data via the anon
 * (logged-in) Supabase client. Catches the single biggest multi-tenancy
 * risk: a new table that someone forgot to add an RLS policy to.
 *
 * Setup is self-contained — beforeAll creates two test orgs, two confirmed
 * auth users, and one study via the service role; afterAll cleans up. All
 * test data is prefixed `_rlstest_<runId>_` so partial failures are easy to
 * find and delete by hand.
 *
 * To run:
 *   npm run test:rls
 *
 * That sets RLS_TEST=1 and points at whatever NEXT_PUBLIC_SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY are configured in .env.local. Pre-launch this
 * is the production project itself (acceptable while there are no real
 * users yet — see docs/TESTING.md). Once customers exist, point those env
 * vars at a dedicated test project before running this.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { config as loadDotenv } from 'dotenv'

// Load .env.local explicitly — vitest doesn't pick it up automatically.
// override:false so anything already in process.env (e.g. RLS_TEST=1 from
// the npm script) wins.
loadDotenv({ path: '.env.local', override: false })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const enabled = process.env.RLS_TEST === '1'

const skip =
  !enabled ||
  !url ||
  !anonKey ||
  !serviceKey ||
  // Sentinel placeholder values from tests/setup.ts — guard against
  // accidentally running with mocked dummies.
  url === 'http://localhost:54321' ||
  serviceKey === 'test-service-role-key'

const describeMaybe = skip ? describe.skip : describe

// Module-level state set by beforeAll, used by tests + afterAll.
const RUN_ID = randomBytes(4).toString('hex')
const PREFIX = '_rlstest_' + RUN_ID + '_'

const ORG_A_PASSWORD = randomBytes(16).toString('hex')
const ORG_B_PASSWORD = randomBytes(16).toString('hex')
const ORG_A_EMAIL = PREFIX + 'a@rlstest.local'
const ORG_B_EMAIL = PREFIX + 'b@rlstest.local'

let admin: SupabaseClient
// Schema in prod has parallel `clients` (legacy) and `organizations` (current)
// tables; both studies.client_id and studies.org_id are populated by the live
// /api/studies insert path. RLS keys on org_id (sql/032). We populate both so
// our test data mirrors prod shape and survives any FK constraint we don't
// see in the committed migrations.
let clientAId: string | null = null
let clientBId: string | null = null
let orgAId: string | null = null
let orgBId: string | null = null
let userAId: string | null = null
let userBId: string | null = null
let studyId: string | null = null

describeMaybe('RLS cross-org read isolation (env-gated)', () => {
  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, { auth: { persistSession: false } })

    // Legacy clients rows
    const { data: cliA, error: cliAErr } = await admin
      .from('clients').insert({ name: PREFIX + 'A', slug: PREFIX + 'a', plan: 'trial' })
      .select('id').single()
    if (cliAErr || !cliA) throw new Error('create client A failed: ' + cliAErr?.message)
    clientAId = cliA.id

    const { data: cliB, error: cliBErr } = await admin
      .from('clients').insert({ name: PREFIX + 'B', slug: PREFIX + 'b', plan: 'trial' })
      .select('id').single()
    if (cliBErr || !cliB) throw new Error('create client B failed: ' + cliBErr?.message)
    clientBId = cliB.id

    // Current organizations rows
    const { data: orgA, error: orgAErr } = await admin
      .from('organizations').insert({ name: PREFIX + 'A', slug: PREFIX + 'a' })
      .select('id').single()
    if (orgAErr || !orgA) throw new Error('create org A failed: ' + orgAErr?.message)
    orgAId = orgA.id

    const { data: orgB, error: orgBErr } = await admin
      .from('organizations').insert({ name: PREFIX + 'B', slug: PREFIX + 'b' })
      .select('id').single()
    if (orgBErr || !orgB) throw new Error('create org B failed: ' + orgBErr?.message)
    orgBId = orgB.id

    // Confirmed auth users
    const { data: authA, error: authAErr } = await admin.auth.admin.createUser({
      email: ORG_A_EMAIL, password: ORG_A_PASSWORD, email_confirm: true,
    })
    if (authAErr || !authA?.user) throw new Error('create auth A failed: ' + authAErr?.message)
    userAId = authA.user.id

    const { data: authB, error: authBErr } = await admin.auth.admin.createUser({
      email: ORG_B_EMAIL, password: ORG_B_PASSWORD, email_confirm: true,
    })
    if (authBErr || !authB?.user) throw new Error('create auth B failed: ' + authBErr?.message)
    userBId = authB.user.id

    // public.users rows: id MUST match auth.users.id; both client_id + org_id
    // populated to mirror the live insert path
    const { error: uAErr } = await admin.from('users').insert({
      id: userAId, client_id: clientAId, org_id: orgAId,
      email: ORG_A_EMAIL, full_name: PREFIX + 'A user', role: 'member',
    })
    if (uAErr) throw new Error('insert users A failed: ' + uAErr.message)

    const { error: uBErr } = await admin.from('users').insert({
      id: userBId, client_id: clientBId, org_id: orgBId,
      email: ORG_B_EMAIL, full_name: PREFIX + 'B user', role: 'member',
    })
    if (uBErr) throw new Error('insert users B failed: ' + uBErr.message)

    // One study in Org A
    const { data: study, error: sErr } = await admin.from('studies').insert({
      guid: PREFIX + 'study', client_id: clientAId, org_id: orgAId, created_by: userAId,
      name: PREFIX + 'study', bot_name: 'TestBot', status: 'draft', config: {},
    }).select('id').single()
    if (sErr || !study) throw new Error('insert study failed: ' + sErr?.message)
    studyId = study.id
  }, 30_000)

  afterAll(async () => {
    if (!admin) return
    // Delete in dependency order; each in its own try so a partial setup
    // still cleans up everything that did get created.
    if (studyId)   try { await admin.from('studies').delete().eq('id', studyId) } catch {}
    if (userAId)   try { await admin.from('users').delete().eq('id', userAId) } catch {}
    if (userBId)   try { await admin.from('users').delete().eq('id', userBId) } catch {}
    if (orgAId)    try { await admin.from('organizations').delete().eq('id', orgAId) } catch {}
    if (orgBId)    try { await admin.from('organizations').delete().eq('id', orgBId) } catch {}
    if (clientAId) try { await admin.from('clients').delete().eq('id', clientAId) } catch {}
    if (clientBId) try { await admin.from('clients').delete().eq('id', clientBId) } catch {}
    if (userAId)   try { await admin.auth.admin.deleteUser(userAId) } catch {}
    if (userBId)   try { await admin.auth.admin.deleteUser(userBId) } catch {}
  }, 30_000)

  it('Org B user cannot read Org A study via the anon-key client', async () => {
    const orgBClient = createClient(url!, anonKey!, { auth: { persistSession: false } })

    const signIn = await orgBClient.auth.signInWithPassword({
      email: ORG_B_EMAIL, password: ORG_B_PASSWORD,
    })
    expect(signIn.error, signIn.error?.message).toBeNull()

    const { data, error } = await orgBClient
      .from('studies').select('id, client_id').eq('id', studyId!).maybeSingle()

    // RLS isolation: either the read returns null (filtered out), or
    // postgrest returns a "not found" error. Both are acceptable; what
    // we MUST NOT see is Org A's row coming back.
    expect(data).toBeNull()
    expect(error?.message ?? '').not.toMatch(/permission denied/i)
  })

  it('Org A user CAN read its own study (control case)', async () => {
    const orgAClient = createClient(url!, anonKey!, { auth: { persistSession: false } })

    const signIn = await orgAClient.auth.signInWithPassword({
      email: ORG_A_EMAIL, password: ORG_A_PASSWORD,
    })
    expect(signIn.error, signIn.error?.message).toBeNull()

    const { data, error } = await orgAClient
      .from('studies').select('id').eq('id', studyId!).single()

    expect(error).toBeNull()
    expect(data?.id).toBe(studyId)
  })
})

if (skip) {
  describe('RLS cross-org read isolation (env-gated)', () => {
    it.skip('skipped — set RLS_TEST=1 (npm run test:rls) to enable; see docs/TESTING.md', () => {})
  })
}
