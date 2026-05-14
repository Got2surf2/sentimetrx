/* eslint-disable */
// One-off: backfill entity catalogs for the existing brand-collections.
//
// entity_catalog has never been populated for anything — discovery was
// manual-trigger only until Phase 6. Phase 6 wires incremental discovery
// (compute route, once per dataset as rows land) and a weekly refresh cron,
// but neither retroactively covers the brand-collections that already exist.
// This script runs discovery once for each of them so their catalogs are
// populated immediately; from then on the cron keeps them fresh.
//
// Cost: ~a few cents per brand of Haiku NER (a ≤300-row sample). Safe to
// re-run — discovery upserts the catalog and is idempotent.
//
// Run with:   node_modules/.bin/tsx scripts/backfill-brand-entities.ts

import { readFileSync } from 'fs'
import path from 'path'

// Load .env.local
const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

import { createClient } from '@supabase/supabase-js'
import { discoverEntities } from '../lib/entityDiscovery'

async function main() {
  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  const { data: brands, error } = await service
    .from('collections')
    .select('id, dataset_id, slug')
    .eq('kind', 'brand')
    .order('created_at', { ascending: true })
  if (error) { console.error('Failed to list brand-collections:', error.message); process.exit(1) }
  if (!brands || brands.length === 0) { console.log('No brand-collections found.'); return }

  console.log(`Found ${brands.length} brand-collection(s). Running discovery...`)

  let totalNew = 0
  let totalCostCents = 0
  for (const b of brands) {
    try {
      const r = await discoverEntities({
        service,
        datasetId: b.dataset_id,
        mode:      'initial',
      })
      totalNew += r.entities_new
      totalCostCents += r.cost_est_cents
      const note = r.error ? ` (error: ${r.error})` : ''
      console.log(
        `  ok ${b.slug}: ${r.entities_new} new / ${r.entities_after} total, ` +
        `sampled ${r.sample_size} rows, ~${r.cost_est_cents}¢${note}`,
      )
    } catch (e: any) {
      console.error(`  x ${b.slug}: ${e?.message || e}`)
    }
  }
  console.log(`Done. ${totalNew} entities discovered, ~${totalCostCents}¢ total.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
