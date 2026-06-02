/* eslint-disable */
// Classify the Chuy's dataset with the shared core dictionary + the mined
// Chuy's Tex-Mex overlay, and print the Level-1 / Level-2 taxonomy roll-up.
// Keyword tier only (free). Demonstrates the casual classifier end to end.
//
// Run: node_modules/.bin/tsx scripts/chuys-classify.ts

import { readFileSync } from 'fs'; import path from 'path'
const env = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const l of env.split('\n')) { const m = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g,'').replace(/\\n$/,'') }
import { createClient } from '@supabase/supabase-js'
import { classifyByKeyword } from '../lib/taxonomyKeywordMatcher'
import { KEYWORD_DICTIONARY } from '../lib/taxonomyKeywords'
import { LEARNED_KEYWORD_DICTIONARY as CHUYS_DICT } from '../lib/taxonomyKeywordsChuys'
import { AXES } from '../lib/taxonomyVocabulary'

const DATASET_NAME = "Chuy's — Google Reviews (last 30d)"
// Core (generic service/sentiment/ambiance/outcome) + the Chuy's overlay.
const DICT = [...KEYWORD_DICTIONARY, ...CHUYS_DICT as any]

async function main() {
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: ds } = await s.from('datasets').select('id,row_count').eq('name', DATASET_NAME).order('row_count', { ascending: false }).limit(1)
  if (!ds?.length) throw new Error('dataset not found')
  let reviews = 0
  const axisRev: Record<string, number> = {}, subRev: Record<string, number> = {}, subPos: Record<string, number> = {}, subNeg: Record<string, number> = {}
  let from = 0
  for (;;) {
    const { data } = await s.from('dataset_rows_flat').select('data').eq('dataset_id', ds[0].id).range(from, from + 999)
    if (!data?.length) break
    for (const row of data) {
      const text = (row.data?.review_text ?? '').trim(); if (!text) continue
      reviews++
      const a = classifyByKeyword(text, DICT).assertions
      const ax = new Set<string>(), su = new Set<string>()
      for (const x of a) {
        ax.add(x.axis); const sk = `${x.axis}:${x.sub}`; su.add(sk)
        if (x.polarity === 'pos') subPos[sk] = (subPos[sk] ?? 0) + 1
        if (x.polarity === 'neg') subNeg[sk] = (subNeg[sk] ?? 0) + 1
      }
      for (const a2 of ax) axisRev[a2] = (axisRev[a2] ?? 0) + 1
      for (const sk of su) subRev[sk] = (subRev[sk] ?? 0) + 1
    }
    from += 1000; if (data.length < 1000) break
  }
  const pct = (n: number) => (100 * n / Math.max(1, reviews)).toFixed(1) + '%'
  const sent = (sk: string) => { const p = subPos[sk] ?? 0, n = subNeg[sk] ?? 0; return p + n === 0 ? '—' : Math.round(100 * p / (p + n)) + '% pos' }
  console.log(`\nCHUY'S — taxonomy roll-up (${reviews} reviews, keyword tier)\n${'='.repeat(60)}`)
  console.log(`\nLEVEL 1 — by axis (mention rate)`)
  for (const ax of AXES) console.log(`  ${ax.padEnd(12)} ${pct(axisRev[ax] ?? 0).padStart(7)}`)
  console.log(`\nLEVEL 2 — top sub-buckets`)
  for (const ax of AXES) {
    const subs = Object.keys(subRev).filter(k => k.startsWith(ax + ':')).sort((a, b) => subRev[b] - subRev[a]).slice(0, 6)
    if (!subs.length) continue
    console.log(`  ${ax}:`)
    for (const sk of subs) console.log(`     ${sk.split(':')[1].padEnd(20)} ${pct(subRev[sk]).padStart(7)}   ${sent(sk)}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
