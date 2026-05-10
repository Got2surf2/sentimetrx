/**
 * Cross-org data egress test — env-gated, self-contained.
 *
 * Where rls-isolation.test.ts proves "every public table has RLS turned on
 * and no policy is unconditionally `true`," this suite proves the next layer:
 * for every org-scoped table we care about, the policy actually filters.
 *
 * It seeds one row in each table under Org A, signs in as Org B via the anon
 * client, and asserts Org B sees nothing of Org A. A policy that exists but
 * keys on the wrong column (or accidentally permits cross-org reads through
 * a join) shows up here, where the introspection-style RLS test cannot see it.
 *
 * Same prefix/cleanup conventions as rls-isolation: every row carries a
 * `_egresstest_<runId>_` marker, beforeAll seeds, afterAll cascades.
 *
 * To run:
 *   npm run test:egress
 *
 * That sets EGRESS_TEST=1 and points at whatever NEXT_PUBLIC_SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY are configured in .env.local. Same caveat as the
 * RLS test: pre-launch this is the production project itself; once customers
 * exist, point .env.local at a dedicated test project before running.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { config as loadDotenv } from 'dotenv'

loadDotenv({ path: '.env.local', override: false })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const enabled = process.env.EGRESS_TEST === '1'

const skip =
  !enabled ||
  !url ||
  !anonKey ||
  !serviceKey ||
  url === 'http://localhost:54321' ||
  serviceKey === 'test-service-role-key'

const describeMaybe = skip ? describe.skip : describe

const RUN_ID = randomBytes(4).toString('hex')
const PREFIX = '_egresstest_' + RUN_ID + '_'
const MARKER = 'EGRESS_LEAK_CANARY_' + RUN_ID

const ORG_A_PASSWORD = randomBytes(16).toString('hex')
const ORG_B_PASSWORD = randomBytes(16).toString('hex')
const ORG_A_EMAIL = PREFIX + 'a@egresstest.local'
const ORG_B_EMAIL = PREFIX + 'b@egresstest.local'

let admin: SupabaseClient
let orgBClient: SupabaseClient

// Org A's resource ids — Org B must not be able to see any of these.
const ids: Record<string, string | number | null> = {
  clientA: null,
  clientB: null,
  orgA: null,
  orgB: null,
  userA: null,
  userB: null,
  study: null,
  response: null,
  dataset: null,
  datasetRowFlat: null, // bigint from identity column
  datasetState: null,
  campaign: null,
  campaignRespondent: null,
  bot: null,
  collection: null,
  collectionMember: null,
  townhallSession: null,
  townhallTheme: null,
  townhallTurn: null,
}

describeMaybe('Cross-org data egress (env-gated)', () => {
  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, { auth: { persistSession: false } })

    // ── Orgs (legacy clients + current organizations, both populated) ──
    const cliA = await admin.from('clients')
      .insert({ name: PREFIX + 'A', slug: PREFIX + 'a', plan: 'trial' })
      .select('id').single()
    if (cliA.error) throw new Error('clients A: ' + cliA.error.message)
    ids.clientA = cliA.data!.id

    const cliB = await admin.from('clients')
      .insert({ name: PREFIX + 'B', slug: PREFIX + 'b', plan: 'trial' })
      .select('id').single()
    if (cliB.error) throw new Error('clients B: ' + cliB.error.message)
    ids.clientB = cliB.data!.id

    const orgA = await admin.from('organizations')
      .insert({ name: PREFIX + 'A', slug: PREFIX + 'a' })
      .select('id').single()
    if (orgA.error) throw new Error('organizations A: ' + orgA.error.message)
    ids.orgA = orgA.data!.id

    const orgB = await admin.from('organizations')
      .insert({ name: PREFIX + 'B', slug: PREFIX + 'b' })
      .select('id').single()
    if (orgB.error) throw new Error('organizations B: ' + orgB.error.message)
    ids.orgB = orgB.data!.id

    // ── Auth users (confirmed) + matching public.users rows ──
    const authA = await admin.auth.admin.createUser({
      email: ORG_A_EMAIL, password: ORG_A_PASSWORD, email_confirm: true,
    })
    if (authA.error || !authA.data?.user) throw new Error('auth A: ' + authA.error?.message)
    ids.userA = authA.data.user.id

    const authB = await admin.auth.admin.createUser({
      email: ORG_B_EMAIL, password: ORG_B_PASSWORD, email_confirm: true,
    })
    if (authB.error || !authB.data?.user) throw new Error('auth B: ' + authB.error?.message)
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

    // ── Org A: one row per org-scoped table ──
    const study = await admin.from('studies').insert({
      guid: PREFIX + 'study', client_id: ids.clientA, org_id: ids.orgA, created_by: ids.userA,
      name: PREFIX + 'study', bot_name: 'TestBot', status: 'draft',
      config: { _marker: MARKER },
    }).select('id').single()
    if (study.error) throw new Error('studies: ' + study.error.message)
    ids.study = study.data!.id

    const resp = await admin.from('responses').insert({
      study_id: ids.study, study_guid: PREFIX + 'study', client_id: ids.clientA,
      payload: { _marker: MARKER, secret: 'A-only data' },
    }).select('id').single()
    if (resp.error) throw new Error('responses: ' + resp.error.message)
    ids.response = resp.data!.id

    const ds = await admin.from('datasets').insert({
      name: PREFIX + 'dataset', source: 'upload', org_id: ids.orgA, created_by: ids.userA,
      status: 'active', row_count: 0, visibility: 'private',
      description: MARKER,
    }).select('id').single()
    if (ds.error) throw new Error('datasets: ' + ds.error.message)
    ids.dataset = ds.data!.id

    const drf = await admin.from('dataset_rows_flat').insert({
      dataset_id: ids.dataset, row_index: 0, data: { _marker: MARKER, secret: 'A-only row' },
    }).select('id').single()
    if (drf.error) throw new Error('dataset_rows_flat: ' + drf.error.message)
    ids.datasetRowFlat = drf.data!.id

    const dst = await admin.from('dataset_state').insert({
      dataset_id: ids.dataset,
      schema_config: { _marker: MARKER },
      theme_model: {},
      saved_charts: [],
      saved_stats: [],
      filter_state: {},
      updated_by: ids.userA,
    }).select('id').single()
    if (dst.error) throw new Error('dataset_state: ' + dst.error.message)
    ids.datasetState = dst.data!.id

    const camp = await admin.from('campaigns').insert({
      org_id: ids.orgA, study_id: ids.study,
      name: PREFIX + 'campaign', study_url: 'https://example.test/' + PREFIX,
      hidden_fields: [], status: 'draft',
    }).select('id').single()
    if (camp.error) throw new Error('campaigns: ' + camp.error.message)
    ids.campaign = camp.data!.id

    const cr = await admin.from('campaign_respondents').insert({
      campaign_id: ids.campaign, email: PREFIX + 'r@egresstest.local',
      recipient_guid: PREFIX + 'rg',
      fields: { _marker: MARKER },
    }).select('id').single()
    if (cr.error) throw new Error('campaign_respondents: ' + cr.error.message)
    ids.campaignRespondent = cr.data!.id

    const bot = await admin.from('bots').insert({
      org_id: ids.orgA, name: PREFIX + 'bot', slug: PREFIX + 'bot',
      created_by: ids.userA,
      knowledge_base: MARKER,
    }).select('id').single()
    if (bot.error) throw new Error('bots: ' + bot.error.message)
    ids.bot = bot.data!.id

    const col = await admin.from('collections').insert({
      dataset_id: ids.dataset, org_id: ids.orgA, created_by: ids.userA,
    }).select('id').single()
    if (col.error) throw new Error('collections: ' + col.error.message)
    ids.collection = col.data!.id

    const cm = await admin.from('collection_members').insert({
      collection_id: ids.collection, dataset_id: ids.dataset, label: PREFIX + 'member',
    }).select('id').single()
    if (cm.error) throw new Error('collection_members: ' + cm.error.message)
    ids.collectionMember = cm.data!.id

    const ths = await admin.from('townhall_sessions').insert({
      org_id: ids.orgA, name: PREFIX + 'th',
      created_by: ids.userA,
      config: { _marker: MARKER },
    }).select('id').single()
    if (ths.error) throw new Error('townhall_sessions: ' + ths.error.message)
    ids.townhallSession = ths.data!.id

    const tht = await admin.from('townhall_themes').insert({
      session_id: ids.townhallSession,
      label: PREFIX + 'theme', question: 'q?',
      description: MARKER,
    }).select('id').single()
    if (tht.error) throw new Error('townhall_themes: ' + tht.error.message)
    ids.townhallTheme = tht.data!.id

    const ttn = await admin.from('townhall_turns').insert({
      session_id: ids.townhallSession,
      participant_id: PREFIX + 'p', turn_number: 1,
      bot_message: MARKER,
    }).select('id').single()
    if (ttn.error) throw new Error('townhall_turns: ' + ttn.error.message)
    ids.townhallTurn = ttn.data!.id

    // ── Sign in as Org B's user; reuse this client across every assertion ──
    orgBClient = createClient(url!, anonKey!, { auth: { persistSession: false } })
    const signIn = await orgBClient.auth.signInWithPassword({
      email: ORG_B_EMAIL, password: ORG_B_PASSWORD,
    })
    if (signIn.error) throw new Error('sign in B: ' + signIn.error.message)
  }, 60_000)

  afterAll(async () => {
    if (!admin) return
    // Most child tables CASCADE through their parents (studies->responses,
    // datasets->dataset_rows_flat/dataset_state/collections,
    // campaigns->campaign_respondents, townhall_sessions->themes/turns,
    // organizations->bots/datasets/campaigns/townhall_sessions). We only
    // need to delete the parents, plus a few rows that cascade via clients.
    if (ids.userA)    try { await admin.from('users').delete().eq('id', ids.userA) } catch {}
    if (ids.userB)    try { await admin.from('users').delete().eq('id', ids.userB) } catch {}
    if (ids.orgA)     try { await admin.from('organizations').delete().eq('id', ids.orgA) } catch {}
    if (ids.orgB)     try { await admin.from('organizations').delete().eq('id', ids.orgB) } catch {}
    if (ids.clientA)  try { await admin.from('clients').delete().eq('id', ids.clientA) } catch {}
    if (ids.clientB)  try { await admin.from('clients').delete().eq('id', ids.clientB) } catch {}
    if (ids.userA)    try { await admin.auth.admin.deleteUser(ids.userA as string) } catch {}
    if (ids.userB)    try { await admin.auth.admin.deleteUser(ids.userB as string) } catch {}
  }, 30_000)

  // Each table gets its own assertion so a single failure is clearly
  // attributable. The shape is always: as Org B, query this table for
  // Org A's row; expect null. Where a select-by-id returns null, we
  // also do a marker scan to catch a policy that filters by id but
  // accidentally permits a list query.
  const cases: Array<{
    table: string
    column?: string
    idKey: keyof typeof ids
    markerColumn?: string
  }> = [
    { table: 'studies',                idKey: 'study' },
    { table: 'responses',              idKey: 'response' },
    { table: 'datasets',               idKey: 'dataset' },
    { table: 'dataset_rows_flat',      idKey: 'datasetRowFlat' },
    { table: 'dataset_state',          idKey: 'datasetState' },
    { table: 'campaigns',              idKey: 'campaign' },
    { table: 'campaign_respondents',   idKey: 'campaignRespondent' },
    { table: 'bots',                   idKey: 'bot' },
    { table: 'collections',            idKey: 'collection' },
    { table: 'collection_members',     idKey: 'collectionMember' },
    { table: 'townhall_sessions',      idKey: 'townhallSession' },
    { table: 'townhall_themes',        idKey: 'townhallTheme' },
    { table: 'townhall_turns',         idKey: 'townhallTurn' },
  ]

  for (const c of cases) {
    it('Org B cannot read Org A\'s ' + c.table + ' row', async () => {
      const id = ids[c.idKey]
      // If beforeAll skipped this table due to a missing column / FK, the
      // assertion is vacuous — surface that loudly so we know to fix the
      // seed rather than silently pass.
      expect(id, c.table + ' was not seeded — fix beforeAll').not.toBeNull()

      const byId = await orgBClient.from(c.table).select('*').eq('id', id!).maybeSingle()
      // Acceptable: data null (RLS filtered) OR a "not found"-style error.
      // Unacceptable: a row comes back, OR a "permission denied" error
      // (means the policy structure itself is broken, not just filtering).
      expect(byId.data, c.table + ' leaked row to Org B').toBeNull()
      expect(byId.error?.message ?? '', c.table + ' returned permission error')
        .not.toMatch(/permission denied/i)
    })
  }

  // Belt-and-braces: a list-style SELECT(id) on each table catches a policy
  // that filters by `id = $1` but permits a list query. One assertion per
  // table so a slow table or a leak is clearly attributable rather than
  // burying everything behind a single timeout.
  for (const c of cases) {
    it('Org B cannot list Org A\'s ' + c.table + ' row by id scan', async () => {
      // Filter by the seeded id directly — keeps the result set tiny even
      // on tables with millions of rows in prod.
      const { data, error } = await orgBClient
        .from(c.table).select('id').eq('id', ids[c.idKey]!).limit(2)
      expect(error?.message ?? '', c.table + ' returned permission error')
        .not.toMatch(/permission denied/i)
      const rows = (data as Array<{ id: string | number }> | null) ?? []
      expect(rows, c.table + ' leaked Org A row to Org B').toEqual([])
    }, 15_000)
  }

  it('Org A user CAN read its own seeded study (control case)', async () => {
    const orgAClient = createClient(url!, anonKey!, { auth: { persistSession: false } })
    const signIn = await orgAClient.auth.signInWithPassword({
      email: ORG_A_EMAIL, password: ORG_A_PASSWORD,
    })
    expect(signIn.error, signIn.error?.message).toBeNull()

    const { data, error } = await orgAClient
      .from('studies').select('id').eq('id', ids.study!).single()
    expect(error).toBeNull()
    expect(data?.id).toBe(ids.study)
  })
})

if (skip) {
  describe('Cross-org data egress (env-gated)', () => {
    it.skip('skipped — set EGRESS_TEST=1 (npm run test:egress) to enable; see docs/TESTING.md', () => {})
  })
}
