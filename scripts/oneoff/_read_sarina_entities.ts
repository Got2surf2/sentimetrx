/* eslint-disable */
// Read-only: list entities Sarina has in entity_catalog (if any) for the bot
// scope. Helps decide whether to seed an entity list into the NOWOCATS deck.
//
// Run: node_modules/.bin/tsx scripts/_read_sarina_entities.ts

import { readFileSync } from 'fs'
import path from 'path'

const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

import { createClient } from '@supabase/supabase-js'

const SARINA_BOT_ID = '5c468b90-13fc-46a2-8855-312dc0a1e428'
const ORG_ID = 'b72e9ee6-0466-459a-8440-988a8bd6d3c5'

async function main() {
  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Sarina has scope_type='bot' with scope_id=bot_id (migration 087).
  const { data: byBot, error: errBot } = await service
    .from('entity_catalog')
    .select('id, canonical, slug, category, aliases, sample_count')
    .eq('scope_type', 'bot')
    .eq('scope_id', SARINA_BOT_ID)
    .order('sample_count', { ascending: false })
    .limit(200)
  if (errBot) {
    console.error('bot scope query error:', errBot.message)
    process.exit(1)
  }
  console.log(`Sarina entity_catalog rows: ${byBot?.length || 0}`)
  if (!byBot || !byBot.length) {
    console.log('NONE — entity discovery has not been run for Sarina, OR no entities surfaced.')
    return
  }

  // Group by category
  const byCat: Record<string, typeof byBot> = {}
  byBot.forEach(r => {
    const c = r.category || 'other'
    if (!byCat[c]) byCat[c] = []
    byCat[c].push(r)
  })
  console.log('Categories:', Object.keys(byCat).map(c => `${c}=${byCat[c].length}`).join(', '))
  console.log('---')

  Object.entries(byCat).forEach(([cat, rows]) => {
    console.log(`\n[${cat}]  (${rows.length} entities)`)
    rows.slice(0, 25).forEach(r => {
      const aliasNote = (r.aliases && r.aliases.length) ? `  +${r.aliases.length} aliases` : ''
      console.log(`  ${(r.sample_count ?? 0).toString().padStart(4)}  ${r.canonical}${aliasNote}`)
    })
    if (rows.length > 25) console.log(`  ... and ${rows.length - 25} more`)
  })
}

main().catch(e => { console.error(e); process.exit(1) })
