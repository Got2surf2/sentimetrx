/**
 * RLS isolation test — env-gated.
 *
 * Runs only when a dedicated test Supabase project is wired up via env vars.
 * In CI without those vars, all assertions are skipped (NOT silently passing —
 * the suite registers a `skip` so it's visible in test output).
 *
 * To run locally:
 *   1. Create a separate Supabase project (NEVER point this at production).
 *   2. Apply the production schema + RLS policies (sql/*.sql migrations).
 *   3. Seed two organizations, one user per org, one row of cross-org data
 *      (e.g. a `studies` row owned by Org A).
 *   4. Set:
 *        TEST_SUPABASE_URL=...
 *        TEST_SUPABASE_ANON_KEY=...
 *        TEST_SUPABASE_SERVICE_ROLE_KEY=...
 *        TEST_ORG_A_USER_EMAIL=... TEST_ORG_A_USER_PASSWORD=...
 *        TEST_ORG_B_USER_EMAIL=... TEST_ORG_B_USER_PASSWORD=...
 *        TEST_ORG_A_STUDY_ID=...    (a study row owned by Org A)
 *
 * See docs/TESTING.md for details.
 */
import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const url = process.env.TEST_SUPABASE_URL
const anonKey = process.env.TEST_SUPABASE_ANON_KEY
const orgAEmail = process.env.TEST_ORG_A_USER_EMAIL
const orgAPassword = process.env.TEST_ORG_A_USER_PASSWORD
const orgBEmail = process.env.TEST_ORG_B_USER_EMAIL
const orgBPassword = process.env.TEST_ORG_B_USER_PASSWORD
const orgAStudyId = process.env.TEST_ORG_A_STUDY_ID

const skip =
  !url || !anonKey || !orgAEmail || !orgAPassword || !orgBEmail || !orgBPassword || !orgAStudyId

const describeMaybe = skip ? describe.skip : describe

describeMaybe('RLS cross-org read isolation (env-gated)', () => {
  it('Org B user cannot read Org A study via the anon-key client', async () => {
    const orgBClient = createClient(url!, anonKey!, { auth: { persistSession: false } })

    const signIn = await orgBClient.auth.signInWithPassword({
      email: orgBEmail!,
      password: orgBPassword!,
    })
    expect(signIn.error, signIn.error?.message).toBeNull()

    const { data, error } = await orgBClient
      .from('studies')
      .select('id, client_id')
      .eq('id', orgAStudyId!)
      .maybeSingle()

    // RLS isolation: either the read returns null (filtered out), or
    // postgrest returns a "not found" error. Both are acceptable; what
    // we MUST NOT see is Org A's row coming back.
    if (data) {
      expect(data).toBeNull()
    } else {
      expect(data).toBeNull()
    }
    expect(error?.message ?? '').not.toMatch(/permission denied/i)
  })

  it('Org A user CAN read its own study (control case)', async () => {
    const orgAClient = createClient(url!, anonKey!, { auth: { persistSession: false } })

    const signIn = await orgAClient.auth.signInWithPassword({
      email: orgAEmail!,
      password: orgAPassword!,
    })
    expect(signIn.error, signIn.error?.message).toBeNull()

    const { data, error } = await orgAClient
      .from('studies')
      .select('id')
      .eq('id', orgAStudyId!)
      .single()

    expect(error).toBeNull()
    expect(data?.id).toBe(orgAStudyId)
  })
})

if (skip) {
  describe('RLS cross-org read isolation (env-gated)', () => {
    it.skip('skipped — TEST_SUPABASE_URL and friends are not set; see docs/TESTING.md', () => {})
  })
}
