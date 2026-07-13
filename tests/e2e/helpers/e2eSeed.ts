// tests/e2e/helpers/e2eSeed.ts
// Self-contained auth + data seeding for the e2e smoke suite.
//
// No human credentials: the suite mints its OWN login from the TEST
// project's service-role key — a dedicated throwaway user
// (e2e-smoke@sentimetrx.test) in a dedicated org, with a fresh random
// password every run. This is what lets the suite run headless in CI
// (the old specs needed E2E_ADMIN_EMAIL/PASSWORD and therefore always
// skipped — the audit's "e2e suite at 0 tests").
//
// Safety: refuses to seed against the production project — the prod ref
// is hardcoded and rejected, so even a mis-set env can't write here.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const PROD_REF = 'foubvgcarhwzjqwaxnod' // www.sentimetrx.ai — NEVER seed here

export const E2E_EMAIL = 'e2e-smoke@sentimetrx.test'
export const E2E_ORG_NAME = 'e2e-smoke-org'
export const E2E_DATASET_NAME = '[E2E SMOKE] Diner Feedback'

export interface E2EEnv {
  url: string
  serviceKey: string
  anonKey: string
  ref: string
}

/** Returns the env when the suite can run, or null → specs skip. */
export function e2eEnv(): E2EEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  if (!url.includes('.supabase.co') || serviceKey.length < 40 || anonKey.length < 40) return null
  const ref = new URL(url).hostname.split('.')[0]
  if (ref === PROD_REF) {
    throw new Error('e2e seeding refused: NEXT_PUBLIC_SUPABASE_URL points at the PRODUCTION project')
  }
  return { url, serviceKey, anonKey, ref }
}

const LIKE_TEXTS = [
  'The service was friendly and the food came out fast',
  'Great atmosphere, our server was attentive all night',
  'Delicious pasta, generous portion',
  'The staff remembered our usual order',
  'Fresh bread and quick seating',
]
const IMPROVE_TEXTS = [
  'The chicken was overcooked and dry',
  'Service was slow, we waited forever for refills',
  'Portion size felt small for the price',
  'My order was wrong and the food arrived cold',
  'Too loud in the dining room',
]
const LOCATIONS = ['Boise', 'Meridian', 'Nampa', 'Eagle']

export interface SeededIds {
  orgId: string
  userId: string
  datasetId: string
  password: string
}

/** Find-or-create org + user, (re)seed the smoke dataset. Idempotent. */
export async function seedE2E(env: E2EEnv): Promise<SeededIds> {
  const admin: SupabaseClient = createClient(env.url, env.serviceKey, { auth: { persistSession: false } })

  // Org (find-or-create; analyze must be enabled for /analyze pages). The
  // legacy clients row exists because public.users.client_id mirrors the
  // live signup path (same as the isolation suites' seed).
  const { data: existingOrg } = await admin.from('organizations').select('id').eq('name', E2E_ORG_NAME).maybeSingle()
  let orgId = existingOrg?.id as string | undefined
  if (!orgId) {
    const { error: cliErr } = await admin.from('clients')
      .insert({ name: E2E_ORG_NAME, slug: E2E_ORG_NAME, plan: 'trial' })
    if (cliErr) throw new Error('e2e seed: clients insert failed: ' + cliErr.message)
    const { data: org, error: orgErr } = await admin.from('organizations')
      .insert({
        name: E2E_ORG_NAME, slug: E2E_ORG_NAME,
        features: { analyze: true, surveys: true, bots: true, campaigns: true, recordings: true, townhall: true, social: true },
      }).select('id').single()
    if (orgErr || !org) throw new Error('e2e seed: organizations insert failed: ' + orgErr?.message)
    orgId = org.id
  }
  if (!orgId) throw new Error('e2e seed: org resolution failed')

  // Auth user (find-or-create) + fresh password each run. public.users shares
  // the auth id, so an existing membership row is the cheap lookup — the TEST
  // project holds hundreds of isolation-suite users, so a single listUsers
  // page can miss ours. Paged scan only as a last resort.
  const password = 'e2e-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  let userId: string | undefined =
    (await admin.from('users').select('id').eq('email', E2E_EMAIL).maybeSingle()).data?.id
  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({ email: E2E_EMAIL, password, email_confirm: true })
    if (data?.user) userId = data.user.id
    else if (error?.message?.includes('already been registered')) {
      for (let pg = 1; pg <= 20 && !userId; pg++) {
        const { data: list } = await admin.auth.admin.listUsers({ page: pg, perPage: 200 })
        userId = list?.users?.find(u => u.email === E2E_EMAIL)?.id
        if (!list?.users?.length) break
      }
      if (!userId) throw new Error('e2e seed: auth user exists but was not found via listUsers')
    } else {
      throw new Error('e2e seed: createUser failed: ' + error?.message)
    }
  }
  {
    const { error } = await admin.auth.admin.updateUserById(userId, { password })
    if (error) throw new Error('e2e seed: password reset failed: ' + error.message)
  }

  // public.users membership (find-or-create)
  const { data: uRow } = await admin.from('users').select('id, org_id').eq('id', userId).maybeSingle()
  if (!uRow) {
    const { data: cli } = await admin.from('clients').select('id').eq('slug', E2E_ORG_NAME).maybeSingle()
    const { error } = await admin.from('users').insert({
      id: userId, client_id: cli?.id ?? null, org_id: orgId,
      email: E2E_EMAIL, full_name: 'E2E Smoke', role: 'member',
    })
    if (error) throw new Error('e2e seed: users insert failed: ' + error.message)
  } else if (uRow.org_id !== orgId) {
    await admin.from('users').update({ org_id: orgId }).eq('id', userId)
  }

  // Dataset: delete any prior run's copy (crashed teardown safety), reseed fresh
  const { data: stale } = await admin.from('datasets').select('id').eq('org_id', orgId).eq('name', E2E_DATASET_NAME)
  for (const d of stale || []) {
    await admin.from('dataset_rows_flat').delete().eq('dataset_id', d.id)
    await admin.from('dataset_state').delete().eq('dataset_id', d.id)
    await admin.from('datasets').delete().eq('id', d.id)
  }

  const rows = Array.from({ length: 60 }, (_v, i) => ({
    row_index: i,
    data: {
      'What did you like most?': LIKE_TEXTS[i % LIKE_TEXTS.length],
      'What could we improve?': IMPROVE_TEXTS[i % IMPROVE_TEXTS.length],
      'Rating': String(3 + (i % 3)),
      'Location': LOCATIONS[i % LOCATIONS.length],
    },
  }))

  const { data: ds, error: dsErr } = await admin.from('datasets').insert({
    name: E2E_DATASET_NAME, source: 'upload', org_id: orgId, created_by: userId,
    visibility: 'private', status: 'active', row_count: rows.length,
  }).select('id').single()
  if (dsErr || !ds) throw new Error('e2e seed: datasets insert failed: ' + dsErr?.message)
  const datasetId = ds.id as string

  const { error: rowsErr } = await admin.from('dataset_rows_flat')
    .insert(rows.map(r => ({ dataset_id: datasetId, ...r })))
  if (rowsErr) throw new Error('e2e seed: rows insert failed: ' + rowsErr.message)

  const themeModel = {
    themes: [
      { id: 't1', name: 'Food Preparation', description: 'Cooking complaints', keywords: ['overcooked', 'dry', 'cold food'], sentiment: 'negative', count: 0, percentage: 0, relatedThemes: [] },
      { id: 't2', name: 'Service Speed', description: 'Slow service', keywords: ['slow', 'waited', 'refills'], sentiment: 'negative', count: 0, percentage: 0, relatedThemes: [] },
    ],
    summary: 'E2E seed themes.',
    fieldName: 'What could we improve?',
    fieldNames: ['What could we improve?'],
  }
  const { error: stErr } = await admin.from('dataset_state').insert({
    dataset_id: datasetId,
    schema_config: {
      // Types MUST be valid AnaFieldType values ('open-ended'/'numeric'/
      // 'categorical'/…) — an invalid type ('text'/'rating') sends the
      // Statistics page into a "Maximum update depth exceeded" render loop
      // (found by this suite's first run, 2026-07-13).
      fields: [
        { field: 'What did you like most?', type: 'open-ended' },
        { field: 'What could we improve?', type: 'open-ended' },
        { field: 'Rating', type: 'numeric', sqt: 'rating' },
        { field: 'Location', type: 'categorical' },
      ],
      primaryTextField: 'What could we improve?',
      autoDetected: true, version: 1,
    },
    theme_model: themeModel,
    analytics: {},
  })
  if (stErr) throw new Error('e2e seed: dataset_state insert failed: ' + stErr.message)

  return { orgId, userId, datasetId, password }
}

/** Delete the seeded dataset (org + user persist — reused across runs). */
export async function cleanupE2E(env: E2EEnv, ids: Pick<SeededIds, 'orgId' | 'datasetId'>): Promise<void> {
  const admin = createClient(env.url, env.serviceKey, { auth: { persistSession: false } })
  await admin.from('dataset_rows_flat').delete().eq('dataset_id', ids.datasetId)
  await admin.from('dataset_state').delete().eq('dataset_id', ids.datasetId)
  await admin.from('datasets').delete().eq('id', ids.datasetId).eq('org_id', ids.orgId)
}

/** @supabase/ssr cookie(s) for a signed-in session, ready for storageState. */
export async function mintCookies(env: E2EEnv, password: string, domain: string): Promise<{ name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite: 'Lax' }[]> {
  const anon = createClient(env.url, env.anonKey, { auth: { persistSession: false } })
  const { data: signin, error } = await anon.auth.signInWithPassword({ email: E2E_EMAIL, password })
  if (error || !signin.session) throw new Error('e2e: sign-in failed: ' + error?.message)
  const raw = 'base64-' + Buffer.from(JSON.stringify(signin.session)).toString('base64url')
  const name = `sb-${env.ref}-auth-token`
  const MAX = 3180
  const expires = Math.floor(Date.now() / 1000) + 3600
  const base = { domain, path: '/', expires, httpOnly: false, secure: false, sameSite: 'Lax' as const }
  if (raw.length <= MAX) return [{ name, value: raw, ...base }]
  const out = []
  for (let i = 0; i * MAX < raw.length; i++) {
    out.push({ name: `${name}.${i}`, value: raw.slice(i * MAX, (i + 1) * MAX), ...base })
  }
  return out
}
