#!/usr/bin/env tsx
// Clone a production org into the Sentimetrx-Test project — "data flows
// down" (docs/ARCHITECTURE.md D-block on prod/test isolation; devlog W27).
//
//   npx tsx scripts/clone-org-to-test.ts <org-id>            # latest S3 snapshot
//   npx tsx scripts/clone-org-to-test.ts <org-id> --fresh    # snapshot prod NOW, then restore
//   npx tsx scripts/clone-org-to-test.ts <org-id> --key org-snapshots/...  # specific snapshot
//
// Default source is the NIGHTLY S3 BACKUP — every routine clone therefore
// proves the backup chain restores (a rolling DR drill). --fresh takes an
// on-demand snapshot through the same dumpOrgSnapshot code path when
// yesterday's data isn't fresh enough.
//
// Safety:
//   - target creds come from SUPABASE_TEST_* in .env.local; the script
//     refuses to run if they match the prod URL (never restores INTO prod —
//     that path stays behind the admin route's requireAdmin + audit log).
//   - the restored org is renamed "[CLONE] <name> — <date>" so cloned
//     client data is never mistaken for a test fixture.
//   - cleanup: delete the clone with the org-delete sweep (admin UI on the
//     test project) when done.
//
// Reads from prod are snapshot reads only (S3 GetObject or the same
// read-only dump the nightly backup performs). auth.users are NOT cloned
// (not part of the snapshot) — log into the test project with the seeded
// dev admin (scripts/seed-test-dev.ts), which can see every org.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import type { OrgSnapshot } from '@/lib/orgSnapshot'

function envLocal(name: string): string | null {
  const strip = (v: string) => v.trim().replace(/^["']|["']$/g, '')
  if (process.env[name]) return strip(process.env[name]!)
  try {
    const line = readFileSync('.env.local', 'utf8').split('\n').find(l => l.startsWith(name + '='))
    return line ? strip(line.slice(name.length + 1)) : null
  } catch { return null }
}

async function main() {
  const args = process.argv.slice(2)
  const orgId = args.find(a => !a.startsWith('--'))
  const fresh = args.includes('--fresh')
  const keyFlagIdx = args.indexOf('--key')
  const explicitKey = keyFlagIdx >= 0 ? args[keyFlagIdx + 1] : null
  if (!orgId || !/^[0-9a-f-]{36}$/i.test(orgId)) {
    console.error('Usage: tsx scripts/clone-org-to-test.ts <org-uuid> [--fresh | --key <s3-key>]')
    process.exit(2)
  }

  const testUrl = envLocal('SUPABASE_TEST_URL')
  const testKey = envLocal('SUPABASE_TEST_SERVICE_ROLE_KEY')
  const prodUrl = envLocal('NEXT_PUBLIC_SUPABASE_URL')
  if (!testUrl || !testKey) { console.error('SUPABASE_TEST_* missing from .env.local'); process.exit(1) }
  if (prodUrl && testUrl === prodUrl) { console.error('Refusing: SUPABASE_TEST_URL equals the prod URL.'); process.exit(1) }

  // Lazy imports AFTER env checks — these pull in server-only modules.
  const { downloadOrgSnapshot, listOrgSnapshots } = await import('@/lib/backupS3')
  const { restoreOrgSnapshot } = await import('@/lib/orgRestore')

  // 1. Obtain the snapshot.
  let snapshot: OrgSnapshot
  if (fresh) {
    console.log('==> --fresh: taking an on-demand snapshot of prod org ' + orgId)
    const { dumpOrgSnapshot } = await import('@/lib/orgSnapshot')
    snapshot = await dumpOrgSnapshot(orgId)
  } else {
    let key = explicitKey
    if (!key) {
      const list = await listOrgSnapshots(orgId, 5)
      if (!list.length) {
        console.error('No S3 snapshots found for org ' + orgId + ' — run with --fresh, or wait for the nightly backup.')
        process.exit(1)
      }
      key = list[0].key
      console.log('==> Using latest S3 snapshot: ' + key)
    }
    snapshot = await downloadOrgSnapshot(key!) as OrgSnapshot
  }
  if (!snapshot?.meta || snapshot.meta.org_id !== orgId) {
    console.error('Snapshot meta missing or org mismatch — refusing.')
    process.exit(1)
  }
  const tableCount = Object.keys(snapshot.tables).length
  const rowCount = Object.values(snapshot.tables).reduce((s: number, rows) => s + ((rows as unknown[])?.length || 0), 0)
  console.log(`==> Snapshot: ${tableCount} tables, ${rowCount} rows (taken ${snapshot.meta.taken_at})`)

  // 2. Stub users on the TEST project. Two layers of FK to satisfy:
  //    - public.users.id → auth.users(id): every cloned users row needs a
  //      GoTrue-shaped auth stub (no password — clones cannot log in).
  //    - created_by / user_id columns can reference users OUTSIDE the org
  //      (e.g. the platform owner who set the org up) — those aren't in the
  //      snapshot's users table at all, so they get BOTH an auth stub and a
  //      minimal public.users stub inside the clone org.
  const test = createClient(testUrl, testKey, { auth: { persistSession: false } })
  const testDbUrl = envLocal('TEST_DB_URL')
  const userRows = (snapshot.tables.users || []) as { id: string; email?: string | null }[]
  const knownUserIds = new Set(userRows.map(u => u?.id).filter(Boolean))
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const referencedUserIds = new Set<string>()
  for (const rows of Object.values(snapshot.tables) as Record<string, unknown>[][]) {
    if (!Array.isArray(rows)) continue
    for (const row of rows) {
      for (const [k, v] of Object.entries(row || {})) {
        if ((k === 'created_by' || k.endsWith('user_id') || k === 'initiated_by') && typeof v === 'string' && UUID_RE.test(v)) {
          referencedUserIds.add(v)
        }
      }
    }
  }
  const externalIds = [...referencedUserIds].filter(id => !knownUserIds.has(id))
  const allAuthStubs = [
    ...userRows.filter(u => u?.id).map(u => ({ id: u.id, email: String(u.email || u.id + '@clone.invalid') })),
    ...externalIds.map(id => ({ id, email: id.slice(0, 8) + '@clone.invalid' })),
  ]
  if (allAuthStubs.length > 0 && testDbUrl) {
    const { execFileSync } = await import('node:child_process')
    const values = allAuthStubs
      .map(u => `('00000000-0000-0000-0000-000000000000','${u.id}','authenticated','authenticated','${u.email.replace(/'/g, "''")}','',now(),now(),now(),'{"provider":"email","providers":["email"]}','{}')`)
      .join(',')
    const sql = `INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) VALUES ${values} ON CONFLICT (id) DO NOTHING;`
    execFileSync('psql', [testDbUrl, '-v', 'ON_ERROR_STOP=1', '-c', sql], { stdio: ['ignore', 'ignore', 'inherit'] })
    console.log(`==> Stubbed ${allAuthStubs.length} auth.users on test (${externalIds.length} external creators; no passwords)`)
  } else if (allAuthStubs.length > 0) {
    console.warn('⚠ TEST_DB_URL missing — cannot stub auth.users; user-linked tables will FK-fail.')
  }

  // External creators also need a public.users row. That row needs the org
  // + clients rows to exist first — restore those two tables ahead of the
  // stubs, then the full restore below re-upserts them harmlessly.
  if (externalIds.length > 0) {
    await restoreOrgSnapshot(test, snapshot, { mode: 'merge', tables: ['clients', 'organizations'] })
    const clientId = (snapshot.tables.clients?.[0] as { id?: string } | undefined)?.id ?? null
    for (const id of externalIds) {
      const { error } = await test.from('users').upsert({
        id, org_id: orgId, client_id: clientId,
        email: id.slice(0, 8) + '@clone.invalid', full_name: '[external creator stub]', role: 'member',
      }, { onConflict: 'id' })
      if (error) console.warn('⚠ external user stub ' + id.slice(0, 8) + ': ' + error.message)
    }
  }

  // 3. Restore into the TEST project.
  const { reports, totals } = await restoreOrgSnapshot(test, snapshot, { mode: 'merge' })

  // 4. Mark the clone unmistakably.
  const cloneName = '[CLONE] ' + (snapshot.tables.organizations?.[0] as { name?: string } | undefined)?.name
    + ' — ' + new Date().toISOString().slice(0, 10)
  await test.from('organizations').update({ name: cloneName }).eq('id', orgId)

  console.log('\n==> Restore report (errors only):')
  for (const r of reports) if (r.errors > 0) console.log(`   ${r.table}: ${r.errors}/${r.attempted} errors — ${r.first_error}`)
  console.log(`\n✅ Cloned into TEST as "${cloneName}"`)
  console.log(`   upserted=${totals.upserted} errors=${totals.errors} across ${reports.length} tables`)
  console.log('   Log in via the seeded dev admin (npm run dev) to browse it.')
  console.log('   Cleanup when done: delete the org from /admin on the test project (full sweep).')
  if (totals.errors > 0) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
