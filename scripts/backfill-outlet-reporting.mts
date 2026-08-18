// scripts/backfill-outlet-reporting.mts
//
// Grandfathers outlet-level reporting (2026-08-18).
//
// Before this date the Leaderboard and Outlet Deep-Dive appeared automatically
// for any `google_reviews` dataset with ≥5 locations — no enable, no way to
// switch them off, and no way for any other dataset to get them. They are now
// an explicit capability: the org `outletReporting` feature OR the dataset's
// `schema_config.outletReporting` toggle.
//
// Without this backfill, deploying that change REMOVES those surfaces from
// every brand that has them today. This sets the per-dataset toggle on exactly
// the datasets that qualified under the old rule, so nothing disappears — and
// unlike the old behaviour it can now be switched off.
//
// Idempotent. Dry-run unless --apply. TEST project unless --prod.
//
//   npx tsx scripts/backfill-outlet-reporting.mts                # dry run, TEST
//   npx tsx scripts/backfill-outlet-reporting.mts --apply        # TEST
//   npx tsx scripts/backfill-outlet-reporting.mts --prod --apply # PRODUCTION
import { readFileSync } from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import type { SchemaConfig } from '../lib/analyzeTypes'

const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const isProd = process.argv.includes('--prod')
const apply = process.argv.includes('--apply')
const url = isProd ? process.env.NEXT_PUBLIC_SUPABASE_URL! : process.env.SUPABASE_TEST_URL!
const key = isProd ? process.env.SUPABASE_SERVICE_ROLE_KEY! : process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!
if (!url || !key) { console.error('Missing credentials for ' + (isProd ? 'PROD' : 'TEST')); process.exit(1) }

console.log((isProd ? '⚠️  PRODUCTION' : 'TEST') + ': ' + url)
console.log(apply ? 'MODE: APPLY (writes)\n' : 'MODE: dry run (no writes) — pass --apply to write\n')

const service = createClient(url, key, { auth: { persistSession: false } })

// The OLD rule, reproduced exactly: google_reviews + ≥5 locations.
const { data: datasets, error } = await service
  .from('datasets').select('id, name, org_id').eq('source', 'google_reviews').eq('status', 'active')
if (error) { console.error('dataset query failed: ' + error.message); process.exit(1) }

let qualified = 0, alreadyOn = 0, wrote = 0, skippedNoState = 0
for (const ds of datasets || []) {
  const { data: src } = await service.from('review_sources').select('id').eq('dataset_id', ds.id).maybeSingle()
  if (!src) continue
  const { count, error: cErr } = await service
    .from('review_source_locations').select('id', { count: 'exact', head: true }).eq('review_source_id', src.id)
  if (cErr) { console.error('  location count failed for ' + ds.id + ': ' + cErr.message); process.exit(1) }
  if ((count || 0) < 5) continue
  qualified++

  const { data: state, error: sErr } = await service
    .from('dataset_state').select('schema_config').eq('dataset_id', ds.id).maybeSingle()
  if (sErr) { console.error('  state read failed for ' + ds.id + ': ' + sErr.message); process.exit(1) }
  if (!state?.schema_config) {
    // No schema blob to attach the flag to — flag it loudly rather than
    // inventing one, since writing a bare {outletReporting:true} would wipe the
    // field list the moment anything merged it.
    skippedNoState++
    console.log('  ⚠️  ' + (ds.name || ds.id) + ' qualifies but has NO schema_config — left alone')
    continue
  }
  const schema = state.schema_config as SchemaConfig
  if (schema.outletReporting === true) { alreadyOn++; continue }

  console.log('  ' + (apply ? 'ENABLING ' : 'would enable ') + (ds.name || ds.id) + '  (' + count + ' locations)')
  if (apply) {
    const { error: uErr } = await service
      .from('dataset_state').update({ schema_config: { ...schema, outletReporting: true } }).eq('dataset_id', ds.id)
    if (uErr) { console.error('  write failed for ' + ds.id + ': ' + uErr.message); process.exit(1) }
    wrote++
  }
}

console.log('\nqualified under the old rule: ' + qualified)
console.log('already enabled:             ' + alreadyOn)
console.log('skipped (no schema_config):  ' + skippedNoState)
console.log(apply ? 'enabled now:                 ' + wrote : 'would enable:                ' + (qualified - alreadyOn - skippedNoState))
console.log(apply ? '\nDone.' : '\nDry run only — re-run with --apply to write.')
