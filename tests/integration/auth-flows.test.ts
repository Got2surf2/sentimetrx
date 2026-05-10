/**
 * Auth flow integration test — env-gated, self-contained.
 *
 * Exercises the real Supabase auth surface that the app's login / signup /
 * reset / magic-link / sign-out paths sit on. Mocking the auth client only
 * proves our wrapper code calls the right method; this proves the actual
 * round-trip works against a real GoTrue.
 *
 * Coverage:
 *  - signInWithPassword: success path returns a valid session whose JWT
 *    resolves back to the same user via getUser
 *  - signInWithPassword: wrong password is rejected (control)
 *  - service-role admin.createUser: how the invite flow creates users;
 *    the new auth user can immediately sign in with the seeded password
 *  - resetPasswordForEmail: the reset call returns no error for an
 *    unknown email (Supabase's anti-enumeration behaviour)
 *  - signInWithOtp: magic-link issuance for a known user returns no error
 *  - signOut: after sign-in, the post-signOut session is gone
 *
 * Same prefix/cleanup conventions as rls-isolation: every row carries an
 * `_authflowtest_<runId>_` marker; afterAll deletes auth + public users.
 *
 * To run:
 *   npm run test:auth-flows
 *
 * Pre-launch this hits the production Supabase project. Test emails use
 * Gmail `+suffix` aliasing on a real mailbox the project owner controls
 * (`got2surf2+authflowtest_<8-hex>_a@gmail.com`). Two of the test cases
 * (resetPasswordForEmail, signInWithOtp) cause Supabase to actually send
 * mail; with a non-existent domain this produced NXDOMAIN bounces back to
 * the project's configured sender. With `+suffix` aliasing the mail
 * delivers to a real inbox the owner can filter and discard. Seeded users
 * are deleted in afterAll. If a run crashes mid-setup, find leftovers by
 * the `+authflowtest_` local-part substring.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { config as loadDotenv } from 'dotenv'

loadDotenv({ path: '.env.local', override: false })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const enabled = process.env.AUTH_FLOWS_TEST === '1'

const skip =
  !enabled ||
  !url ||
  !anonKey ||
  !serviceKey ||
  url === 'http://localhost:54321' ||
  serviceKey === 'test-service-role-key'

const describeMaybe = skip ? describe.skip : describe

const RUN_ID = randomBytes(4).toString('hex')
const PREFIX = '_authflowtest_' + RUN_ID + '_'

// Test emails use Gmail `+suffix` aliasing on a mailbox the project owner
// controls. Mail still delivers (so resetPasswordForEmail / signInWithOtp
// don't bounce); the owner filters by the `+authflowtest_` local-part and
// discards the noise.
const TEST_INBOX_USER = 'got2surf2'
const TEST_INBOX_DOMAIN = 'gmail.com'
const aliasFor = (slot: string) =>
  TEST_INBOX_USER + '+authflowtest_' + RUN_ID + '_' + slot + '@' + TEST_INBOX_DOMAIN

// Two pre-seeded user identities. PRIMARY is created in beforeAll for the
// success-path tests. CREATED_LATER is created inside its own test — that
// test verifies the invite-flow shape (admin.createUser → matching
// public.users insert).
const PRIMARY_EMAIL = aliasFor('a')
const PRIMARY_PASSWORD = randomBytes(16).toString('hex')

const CREATED_LATER_EMAIL = aliasFor('b')
const CREATED_LATER_PASSWORD = randomBytes(16).toString('hex')

let admin: SupabaseClient
const ids: { client: string | null; org: string | null; primaryUser: string | null; createdLaterUser: string | null } = {
  client: null,
  org: null,
  primaryUser: null,
  createdLaterUser: null,
}

describeMaybe('Auth flows (env-gated)', () => {
  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, { auth: { persistSession: false } })

    // Org context — the public.users row needs a real org_id and client_id
    // because of NOT NULL constraints from the legacy schema.
    const cli = await admin.from('clients')
      .insert({ name: PREFIX + 'cli', slug: PREFIX + 'cli', plan: 'trial' })
      .select('id').single()
    if (cli.error) throw new Error('clients: ' + cli.error.message)
    ids.client = cli.data!.id

    const org = await admin.from('organizations')
      .insert({ name: PREFIX + 'org', slug: PREFIX + 'org' })
      .select('id').single()
    if (org.error) throw new Error('organizations: ' + org.error.message)
    ids.org = org.data!.id

    // Primary user: created via the same admin.createUser path the invite
    // flow uses (see /api/invite/register). email_confirm:true so we skip
    // the email-verification step in the test.
    const auth = await admin.auth.admin.createUser({
      email: PRIMARY_EMAIL, password: PRIMARY_PASSWORD, email_confirm: true,
    })
    if (auth.error || !auth.data?.user) throw new Error('createUser: ' + auth.error?.message)
    ids.primaryUser = auth.data.user.id

    const u = await admin.from('users').insert({
      id: ids.primaryUser, client_id: ids.client, org_id: ids.org,
      email: PRIMARY_EMAIL, full_name: PREFIX + 'A', role: 'member',
    })
    if (u.error) throw new Error('users primary: ' + u.error.message)
  }, 30_000)

  afterAll(async () => {
    if (!admin) return
    if (ids.primaryUser)      try { await admin.from('users').delete().eq('id', ids.primaryUser) } catch {}
    if (ids.createdLaterUser) try { await admin.from('users').delete().eq('id', ids.createdLaterUser) } catch {}
    if (ids.org)              try { await admin.from('organizations').delete().eq('id', ids.org) } catch {}
    if (ids.client)           try { await admin.from('clients').delete().eq('id', ids.client) } catch {}
    if (ids.primaryUser)      try { await admin.auth.admin.deleteUser(ids.primaryUser) } catch {}
    if (ids.createdLaterUser) try { await admin.auth.admin.deleteUser(ids.createdLaterUser) } catch {}
  }, 30_000)

  it('signInWithPassword issues a session whose JWT resolves to the same user', async () => {
    const client = createClient(url!, anonKey!, { auth: { persistSession: false } })
    const signIn = await client.auth.signInWithPassword({
      email: PRIMARY_EMAIL, password: PRIMARY_PASSWORD,
    })
    expect(signIn.error, signIn.error?.message).toBeNull()
    expect(signIn.data.session?.access_token).toBeTruthy()
    expect(signIn.data.user?.id).toBe(ids.primaryUser)

    // Round-trip: the JWT we just got back must decode server-side to the
    // same user. This is what /api/auth/log-login and every server-rendered
    // page rely on.
    const me = await client.auth.getUser()
    expect(me.error).toBeNull()
    expect(me.data.user?.id).toBe(ids.primaryUser)
    expect(me.data.user?.email).toBe(PRIMARY_EMAIL)
  })

  it('signInWithPassword rejects a wrong password', async () => {
    const client = createClient(url!, anonKey!, { auth: { persistSession: false } })
    const signIn = await client.auth.signInWithPassword({
      email: PRIMARY_EMAIL, password: 'definitely-not-the-password',
    })
    expect(signIn.error).not.toBeNull()
    expect(signIn.data.session).toBeNull()
    expect(signIn.data.user).toBeNull()
  })

  it('signOut invalidates the session', async () => {
    const client = createClient(url!, anonKey!, { auth: { persistSession: false } })
    const signIn = await client.auth.signInWithPassword({
      email: PRIMARY_EMAIL, password: PRIMARY_PASSWORD,
    })
    expect(signIn.error).toBeNull()

    const signOut = await client.auth.signOut()
    expect(signOut.error).toBeNull()

    const me = await client.auth.getUser()
    expect(me.data.user).toBeNull()
  })

  // Both email-sending tests below tolerate `over_email_send_rate_limit`:
  // when the suite runs back-to-back, Supabase's per-project email throttle
  // can fire on the second send. That's the throttle working as intended,
  // not a wiring failure — a 429 from this code is still proof the SDK
  // call reached the server and was processed.
  const isRateLimit = (err: { code?: string } | null | undefined) =>
    err?.code === 'over_email_send_rate_limit'

  it('resetPasswordForEmail returns no error (anti-enumeration behaviour)', async () => {
    // Supabase intentionally returns success for any email — known-good or
    // unknown — to prevent account enumeration. The flow we want to verify
    // is "the call doesn't blow up" and "no enumeration leak."
    const client = createClient(url!, anonKey!, { auth: { persistSession: false } })
    const realUser = await client.auth.resetPasswordForEmail(PRIMARY_EMAIL)
    expect(realUser.error === null || isRateLimit(realUser.error),
      'unexpected error: ' + realUser.error?.message).toBe(true)

    const unknownUser = await client.auth.resetPasswordForEmail(
      aliasFor('never-existed'),
    )
    expect(unknownUser.error === null || isRateLimit(unknownUser.error),
      'unexpected error: ' + unknownUser.error?.message).toBe(true)
  })

  it('signInWithOtp issues a magic link for a known user', async () => {
    // Note: this project has OTP signups disabled (good — it's invite-only),
    // which means the unknown-user path returns 422 "Signups not allowed for
    // otp" while the known-user path returns success. That's a small
    // enumeration vector but separate from the "magic link works" assertion
    // we're testing here.
    const client = createClient(url!, anonKey!, { auth: { persistSession: false } })
    const realUser = await client.auth.signInWithOtp({
      email: PRIMARY_EMAIL,
      options: { shouldCreateUser: false },
    })
    expect(realUser.error === null || isRateLimit(realUser.error),
      'unexpected error: ' + realUser.error?.message).toBe(true)
  })

  it('admin.createUser creates an auth user that immediately can sign in (invite-flow shape)', async () => {
    // Mirror /api/invite/register: createUser via service role (skip email
    // confirmation), then insert the public.users row with the matching id.
    // This is the canonical signup path in this app — there is no
    // self-serve auth.signUp().
    const created = await admin.auth.admin.createUser({
      email: CREATED_LATER_EMAIL, password: CREATED_LATER_PASSWORD, email_confirm: true,
    })
    expect(created.error, created.error?.message).toBeNull()
    expect(created.data.user?.id).toBeTruthy()
    ids.createdLaterUser = created.data.user!.id

    const inserted = await admin.from('users').insert({
      id: ids.createdLaterUser, client_id: ids.client, org_id: ids.org,
      email: CREATED_LATER_EMAIL, full_name: PREFIX + 'B', role: 'member',
    })
    expect(inserted.error, inserted.error?.message).toBeNull()

    // The user must be able to sign in straight away with the password
    // the invite flow set.
    const client = createClient(url!, anonKey!, { auth: { persistSession: false } })
    const signIn = await client.auth.signInWithPassword({
      email: CREATED_LATER_EMAIL, password: CREATED_LATER_PASSWORD,
    })
    expect(signIn.error, signIn.error?.message).toBeNull()
    expect(signIn.data.user?.id).toBe(ids.createdLaterUser)
  })

})

if (skip) {
  describe('Auth flows (env-gated)', () => {
    it.skip('skipped — set AUTH_FLOWS_TEST=1 (npm run test:auth-flows) to enable; see docs/TESTING.md', () => {})
  })
}
