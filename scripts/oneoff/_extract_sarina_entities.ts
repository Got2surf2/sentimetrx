/* eslint-disable */
// One-off: run entity extraction for Sarina's KB (UPSERT-only, non-destructive
// per lib/botEntityExtraction.ts). Logs the run summary + a top-N preview.
//
// Run: node_modules/.bin/tsx scripts/_extract_sarina_entities.ts

import { readFileSync } from 'fs'
import path from 'path'

const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

import { createClient } from '@supabase/supabase-js'
import { extractBotEntities } from '../../lib/botEntityExtraction'

const SARINA_BOT_ID = '5c468b90-13fc-46a2-8855-312dc0a1e428'
const ORG_ID = 'b72e9ee6-0466-459a-8440-988a8bd6d3c5'

async function main() {
  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  console.log('Starting entity extraction for Sarina ...')
  const t0 = Date.now()
  const res = await extractBotEntities(service as any, {
    botId: SARINA_BOT_ID,
    orgId: ORG_ID,
    triggeredByUser: null,
  })
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  console.log(`  added: ${res.added}`)
  console.log(`  total: ${res.total}`)
  console.log(`  cost:  $${(res.costCents / 100).toFixed(2)}`)
  console.log('---')

  // Preview: top 60 visible rows by sample_count, grouped by category.
  const { data: rows } = await service
    .from('entity_catalog')
    .select('canonical, category, sample_count, aliases, hidden')
    .eq('scope_type', 'bot')
    .eq('scope_id', SARINA_BOT_ID)
    .eq('hidden', false)
    .order('sample_count', { ascending: false })
    .limit(200)

  if (!rows || rows.length === 0) {
    console.log('No visible entities yet (all extracted entities may be hidden=true at sample_count<=1).')
    return
  }

  const byCat: Record<string, typeof rows> = {}
  rows.forEach(r => {
    const c = r.category || 'other'
    if (!byCat[c]) byCat[c] = []
    byCat[c].push(r)
  })
  console.log(`Visible entities: ${rows.length}`)
  console.log('Categories:', Object.keys(byCat).map(c => `${c}=${byCat[c].length}`).join(', '))
  Object.entries(byCat).forEach(([cat, list]) => {
    console.log(`\n[${cat}]`)
    list.slice(0, 25).forEach(r => {
      const alias = (r.aliases && r.aliases.length) ? `  +${r.aliases.length} aliases` : ''
      console.log(`  ${(r.sample_count ?? 0).toString().padStart(4)}  ${r.canonical}${alias}`)
    })
    if (list.length > 25) console.log(`  ... and ${list.length - 25} more`)
  })
}

main().catch(e => { console.error(e); process.exit(1) })
