/* eslint-disable */
// One-off: backfill merged schemas for existing brand-collections.
//
// The 060-062 brand-collection work + the 061 backfill created brand-
// collections but never gave them a dataset_state schema, so Charts/Stats
// silently did nothing on them. Migration 066 seeded an empty dataset_state
// for each; this script fills in the real merged schema from current members.
// Going forward the compute route rebuilds it lazily on every compute, so
// this only needs to run once.
//
// Run with:   node_modules/.bin/tsx scripts/backfill-brand-schemas.ts

import { readFileSync } from 'fs'
import path from 'path'

// Load .env.local
const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

import { createClient } from '@supabase/supabase-js'
import { buildMergedCollectionSchema } from '../lib/collectionSchema'

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
  if (error) { console.error('Failed to list brand-collections:', error.message); process.exit(1) }
  if (!brands || brands.length === 0) { console.log('No brand-collections found.'); return }

  console.log(`Found ${brands.length} brand-collection(s).`)

  for (const b of brands) {
    const { data: members } = await service
      .from('collection_members').select('dataset_id').eq('collection_id', b.id)
    const memberIds = (members || []).map((m: any) => m.dataset_id as string)
    const merged = await buildMergedCollectionSchema(service, memberIds)
    const { error: upErr } = await service
      .from('dataset_state')
      .upsert({ dataset_id: b.dataset_id, schema_config: merged }, { onConflict: 'dataset_id' })
    if (upErr) {
      console.error(`  x ${b.slug}: ${upErr.message}`)
    } else {
      console.log(`  ok ${b.slug}: ${memberIds.length} member(s), ${merged.fields.length} field(s)`)
    }
  }
  console.log('Done.')
}

main().catch((e) => { console.error(e); process.exit(1) })
