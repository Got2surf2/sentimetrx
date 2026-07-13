#!/usr/bin/env tsx
// Clone a production org into the Sentimetrx-Test project — "data flows
// down" (docs/ARCHITECTURE.md D-block on prod/test isolation; devlog W27).
//
//   npx tsx scripts/clone-org-to-test.ts <org-id>            # latest S3 snapshot
//   npx tsx scripts/clone-org-to-test.ts <org-id> --fresh    # snapshot prod NOW, then restore
//   npx tsx scripts/clone-org-to-test.ts <org-id> --key org-snapshots/...  # specific snapshot
//
// Default source is the NIGHTLY S3 BACKUP — every routine clone therefore
// proves the backup chain restores (a rolling DR drill). --fresh streams
// an on-demand v2 snapshot through the same dump code path the nightly
// uses (to S3 when BACKUP_* creds are available locally, else to a scratch
// directory) when yesterday's data isn't fresh enough. Both snapshot
// formats restore: v1 whole-JSON keys and v2 manifest keys (uncapped,
// streamed) — the snapshot is materialized in RAM here (laptop workflow)
// so the identity-remap/stub logic below can scan whole tables.
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
  const { s3SnapshotStore, listOrgSnapshots } = await import('@/lib/backupS3')
  const { openSnapshot, materializeSnapshot, dumpOrgSnapshotV2 } = await import('@/lib/orgSnapshotV2')
  const { restoreOrgSnapshot } = await import('@/lib/orgRestore')

  // 1. Obtain the snapshot.
  let snapshot: OrgSnapshot
  if (fresh) {
    const prodKey = envLocal('SUPABASE_SERVICE_ROLE_KEY')
    if (!prodUrl || !prodKey) { console.error('Prod Supabase creds missing from .env.local — cannot --fresh.'); process.exit(1) }
    const prod = createClient(prodUrl, prodKey, { auth: { persistSession: false } })
    const { hasBackupS3Env, LocalDirSnapshotStore } = await import('@/lib/snapshotStore')
    const os = await import('node:os')
    const path = await import('node:path')
    const store = hasBackupS3Env()
      ? s3SnapshotStore()
      : new LocalDirSnapshotStore(path.join(os.tmpdir(), 'sentimetrx-fresh-snapshots'))
    console.log('==> --fresh: streaming a v2 snapshot of prod org ' + orgId
      + (hasBackupS3Env() ? ' → S3' : ' → ' + path.join(os.tmpdir(), 'sentimetrx-fresh-snapshots') + ' (no BACKUP_* creds locally)'))
    const { manifestKey, meta } = await dumpOrgSnapshotV2(prod, orgId, store)
    if (Object.keys(meta.fetch_errors).length > 0) {
      console.error('⚠ Snapshot INCOMPLETE — fetch errors: ' + JSON.stringify(meta.fetch_errors))
    }
    snapshot = await materializeSnapshot(await openSnapshot(store, manifestKey))
  } else {
    let key = explicitKey
    if (!key) {
      const list = await listOrgSnapshots(orgId, 5)
      if (!list.length) {
        console.error('No S3 snapshots found for org ' + orgId + ' — run with --fresh, or wait for the nightly backup.')
        process.exit(1)
      }
      key = list[0].key
      console.log('==> Using latest S3 snapshot: ' + key + (key.endsWith('manifest.json') ? ' (v2 streamed)' : ' (v1)'))
    }
    snapshot = await materializeSnapshot(await openSnapshot(s3SnapshotStore(), key!))
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
  let userRows = (snapshot.tables.users || []) as { id: string; email?: string | null }[]

  // Identity remap: the same HUMAN can exist in both databases with
  // different ids (e.g. the owner's real account vs the seeded dev admin —
  // emails are unique, so the cloned users row would collide and every
  // created_by chain would cascade into FK failures; this zeroed out an
  // entire clone on 2026-07-03). For each cloned user whose email already
  // exists on test under a different id: drop the cloned row and rewrite
  // every user-reference in the snapshot to the test-side id.
  const cloneEmails = userRows.map(u => u.email).filter(Boolean) as string[]
  const idRemap = new Map<string, string>()
  if (cloneEmails.length > 0) {
    const { data: existing } = await test.from('users').select('id, email').in('email', cloneEmails)
    for (const ex of (existing || []) as { id: string; email: string }[]) {
      const cloned = userRows.find(u => u.email === ex.email)
      if (cloned && cloned.id !== ex.id) idRemap.set(cloned.id, ex.id)
    }
  }
  if (idRemap.size > 0) {
    userRows = userRows.filter(u => !idRemap.has(u.id))
    snapshot.tables.users = userRows
    const USER_REF = /^(created_by|initiated_by|.*user_id)$/
    for (const [tname, rows] of Object.entries(snapshot.tables)) {
      if (!Array.isArray(rows)) continue
      for (const row of rows as Record<string, unknown>[]) {
        for (const [k, v] of Object.entries(row || {})) {
          if (typeof v === 'string' && USER_REF.test(k) && idRemap.has(v)) row[k] = idRemap.get(v)
        }
      }
      void tname
    }
    console.log('==> Remapped ' + idRemap.size + ' colliding user identit' + (idRemap.size === 1 ? 'y' : 'ies') + ' to existing test users (by email)')
  }

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
  const externalIds = [...referencedUserIds].filter(id => !knownUserIds.has(id) && !idRemap.has(id) && ![...idRemap.values()].includes(id))
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

  // The org + any snapshot clients rows go first (parents for everything).
  await restoreOrgSnapshot(test, snapshot, { mode: 'merge', tables: ['clients', 'organizations'] })

  // Legacy `clients` stubs: the snapshot SKIPS the legacy clients table, but
  // studies.client_id (and users.client_id) still FK it — without stubs an
  // org whose studies carry client_id loses its ENTIRE content chain
  // (studies → datasets → rows/collections/campaigns; zeroed a clone on
  // 2026-07-03). Stub any referenced client id that doesn't exist on test.
  const clientIds = new Set<string>()
  for (const rows of Object.values(snapshot.tables) as Record<string, unknown>[][]) {
    if (!Array.isArray(rows)) continue
    for (const row of rows) {
      const v = (row as Record<string, unknown>)?.client_id
      if (typeof v === 'string' && UUID_RE.test(v)) clientIds.add(v)
    }
  }
  if (clientIds.size > 0) {
    const { data: haveClients } = await test.from('clients').select('id').in('id', [...clientIds])
    const haveSet = new Set(((haveClients || []) as { id: string }[]).map(c => c.id))
    for (const cid of [...clientIds].filter(c => !haveSet.has(c))) {
      const { error } = await test.from('clients').upsert({ id: cid, name: '[CLONE stub] client', slug: 'clone-' + cid.slice(0, 8), plan: 'trial' }, { onConflict: 'id' })
      if (error) console.warn('⚠ client stub ' + cid.slice(0, 8) + ': ' + error.message)
    }
  }

  // External agent stubs: pulseiq_sessions.bot_id can reference an agent
  // OUTSIDE the org (Sarina-cohort model / dev artifacts). Stub minimal
  // paused agents for any bot_id not in the snapshot and not on test.
  const snapshotAgentIds = new Set(((snapshot.tables.bots || []) as { id?: string }[]).map(b => b?.id).filter(Boolean) as string[])
  const missingBotIds = new Set<string>()
  for (const row of ((snapshot.tables.pulseiq_sessions || []) as { bot_id?: string | null }[])) {
    const b = row?.bot_id
    if (typeof b === 'string' && UUID_RE.test(b) && !snapshotAgentIds.has(b)) missingBotIds.add(b)
  }
  if (missingBotIds.size > 0) {
    const { data: haveAgents } = await test.from('agents').select('id').in('id', [...missingBotIds])
    const haveA = new Set(((haveAgents || []) as { id: string }[]).map(a => a.id))
    for (const bid of [...missingBotIds].filter(b => !haveA.has(b))) {
      const { error } = await test.from('agents').upsert({
        id: bid, org_id: orgId, name: '[external agent stub]', slug: 'clone-agent-' + bid.slice(0, 8),
        status: 'paused', config: { pulseiq_dedicated: true },
        personality: 'stub', system_prompt: 'stub',
      }, { onConflict: 'id' })
      if (error) console.warn('⚠ agent stub ' + bid.slice(0, 8) + ': ' + error.message)
    }
  }

  // External study stubs: datasets/campaigns can reference studies OUTSIDE
  // the snapshot (org transfers leave datasets pointing at studies in the
  // source org). Without stubs the whole dataset chain cascades away.
  const snapshotStudyIds = new Set(((snapshot.tables.studies || []) as { id?: string }[]).map(r => r?.id).filter(Boolean) as string[])
  const missingStudyIds = new Set<string>()
  for (const t of ['datasets', 'campaigns']) {
    for (const row of ((snapshot.tables[t] || []) as { study_id?: string | null }[])) {
      const v = row?.study_id
      if (typeof v === 'string' && UUID_RE.test(v) && !snapshotStudyIds.has(v)) missingStudyIds.add(v)
    }
  }
  if (missingStudyIds.size > 0) {
    const { data: haveStudies } = await test.from('studies').select('id').in('id', [...missingStudyIds])
    const haveS = new Set(((haveStudies || []) as { id: string }[]).map(x => x.id))
    const stubClient = [...clientIds][0] ?? null
    for (const sid of [...missingStudyIds].filter(x => !haveS.has(x))) {
      const { error } = await test.from('studies').upsert({
        id: sid, org_id: orgId, client_id: stubClient,
        guid: 'clone-' + sid.slice(0, 8), name: '[external study stub]', bot_name: 'stub',
        config: {}, status: 'closed', visibility: 'private',
      }, { onConflict: 'id' })
      if (error) console.warn('⚠ study stub ' + sid.slice(0, 8) + ': ' + error.message)
    }
    console.log('==> Stubbed ' + missingStudyIds.size + ' external studies (org-transfer leftovers)')
  }

  // External creators also need a public.users row (org + clients exist now).
  if (externalIds.length > 0) {
    const clientId = (snapshot.tables.clients?.[0] as { id?: string } | undefined)?.id ?? [...clientIds][0] ?? null
    for (const id of externalIds) {
      const { error } = await test.from('users').upsert({
        id, org_id: orgId, client_id: clientId,
        email: id.slice(0, 8) + '@clone.invalid', full_name: '[external creator stub]', role: 'member',
      }, { onConflict: 'id' })
      if (error) console.warn('⚠ external user stub ' + id.slice(0, 8) + ': ' + error.message)
    }
  }

  // 3. Restore into the TEST project.
  const { reports, totals, ok } = await restoreOrgSnapshot(test, snapshot, { mode: 'merge' })

  // 4. Mark the clone unmistakably.
  const cloneName = '[CLONE] ' + (snapshot.tables.organizations?.[0] as { name?: string } | undefined)?.name
    + ' — ' + new Date().toISOString().slice(0, 10)
  await test.from('organizations').update({ name: cloneName }).eq('id', orgId)

  console.log('\n==> Restore report (problem tables only):')
  for (const r of reports) {
    if (r.errors > 0 || r.missing > 0 || r.skipped_fk > 0 || r.skipped_conflict > 0) {
      console.log(`   ${r.table}: upserted=${r.upserted}/${r.attempted}`
        + (r.errors ? ` errors=${r.errors}` : '')
        + (r.skipped_fk ? ` skipped_fk=${r.skipped_fk}` : '')
        + (r.skipped_conflict ? ` skipped_conflict=${r.skipped_conflict}` : '')
        + (r.missing ? ` MISSING=${r.missing}` : '')
        + (r.first_error ? ` — ${r.first_error}` : ''))
    }
  }
  console.log(`\n${ok ? '✅' : '❌'} Cloned into TEST as "${cloneName}"`)
  console.log(`   upserted=${totals.upserted} errors=${totals.errors} skipped_fk=${totals.skipped_fk}`
    + ` skipped_conflict=${totals.skipped_conflict} missing=${totals.missing} across ${reports.length} tables (verified)`)
  if (totals.skipped_fk > 0) {
    console.log('   ⚠ skipped_fk = referential debt: rows referencing parents outside the snapshot')
    console.log('     (org-transfer leftovers pointing at other orgs\'/deleted rows). NOT restored — by policy.')
  }
  console.log('   Log in via the seeded dev admin (npm run dev) to browse it.')
  console.log('   Cleanup when done: delete the org from /admin on the test project (full sweep).')
  if (!ok) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
