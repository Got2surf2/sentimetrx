#!/usr/bin/env tsx
// Seed the Sentimetrx-Test project for local development (`npm run dev`):
// an admin org + the owner's login. Idempotent — re-running skips anything
// that already exists.
//
// Usage:
//   npx tsx scripts/seed-test-dev.ts                 # random password, printed once
//   SEED_PASSWORD=... npx tsx scripts/seed-test-dev.ts
//
// Reads SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_ROLE_KEY from the
// environment (or .env.local via dotenv preload in package scripts).

import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'

function envLocal(name: string): string | null {
  const strip = (v: string) => v.trim().replace(/^["']|["']$/g, '')
  if (process.env[name]) return strip(process.env[name]!)
  try {
    const line = readFileSync('.env.local', 'utf8').split('\n').find(l => l.startsWith(name + '='))
    return line ? strip(line.slice(name.length + 1)) : null
  } catch { return null }
}

const OWNER_EMAIL = 'got2surf2@gmail.com'
const ORG_NAME = 'Sentimetrx Dev (test project)'
const ORG_SLUG = 'sentimetrx-dev'

async function main() {
  const url = envLocal('SUPABASE_TEST_URL')
  const key = envLocal('SUPABASE_TEST_SERVICE_ROLE_KEY')
  if (!url || !key) {
    console.error('SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_ROLE_KEY missing (.env.local)')
    process.exit(1)
  }
  const prodUrl = envLocal('NEXT_PUBLIC_SUPABASE_URL')
  if (prodUrl && url === prodUrl) {
    console.error('Refusing: SUPABASE_TEST_URL is the SAME project as NEXT_PUBLIC_SUPABASE_URL (prod).')
    process.exit(1)
  }
  const admin = createClient(url, key, { auth: { persistSession: false } })

  // Org (admin org, so /admin works on the test project)
  let orgId: string
  const { data: existingOrg } = await admin.from('organizations').select('id').eq('slug', ORG_SLUG).maybeSingle()
  if (existingOrg) {
    orgId = existingOrg.id
    console.log('org exists:', orgId)
  } else {
    const { data: org, error } = await admin.from('organizations')
      .insert({ name: ORG_NAME, slug: ORG_SLUG, is_admin_org: true })
      .select('id').single()
    if (error) throw new Error('organizations: ' + error.message)
    orgId = org!.id
    console.log('org created:', orgId)
  }

  // Legacy clients row (users.client_id NOT NULL)
  let clientId: string
  const { data: existingCli } = await admin.from('clients').select('id').eq('slug', ORG_SLUG).maybeSingle()
  if (existingCli) {
    clientId = existingCli.id
  } else {
    const { data: cli, error } = await admin.from('clients')
      .insert({ name: ORG_NAME, slug: ORG_SLUG, plan: 'trial' })
      .select('id').single()
    if (error) throw new Error('clients: ' + error.message)
    clientId = cli!.id
  }

  // Owner user
  const { data: existingUser } = await admin.from('users').select('id').eq('email', OWNER_EMAIL).maybeSingle()
  if (existingUser) {
    console.log('owner user exists:', existingUser.id)
    console.log('\n✅ Test project already seeded. Log in at localhost with', OWNER_EMAIL)
    console.log('   (magic link works; or reset the password via SEED_PASSWORD + re-run after deleting the user)')
    return
  }

  const password = process.env.SEED_PASSWORD || randomBytes(12).toString('base64url')
  const { data: auth, error: authErr } = await admin.auth.admin.createUser({
    email: OWNER_EMAIL, password, email_confirm: true,
  })
  if (authErr || !auth?.user) throw new Error('createUser: ' + authErr?.message)

  const { error: uErr } = await admin.from('users').insert({
    id: auth.user.id, client_id: clientId, org_id: orgId,
    email: OWNER_EMAIL, full_name: 'Sanjay (dev)', role: 'platform_admin',
  })
  if (uErr) throw new Error('users: ' + uErr.message)

  console.log('\n✅ Test project seeded.')
  console.log('   Login:    ' + OWNER_EMAIL)
  console.log('   Password: ' + password + '   (or use the magic link)')
  console.log('   Org:      ' + ORG_NAME + ' (admin org)')
}

main().catch(e => { console.error(e); process.exit(1) })
