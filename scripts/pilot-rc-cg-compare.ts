/* eslint-disable */
// Competitive head-to-head: Ruth's Chris vs Capital Grille on the shared
// 7-axis taxonomy, two levels (axis = L1, sub = L2). Keyword tier only (free).
// Computes per-brand mention rates + sentiment and the over/under-index deltas.
//
// Run: node_modules/.bin/tsx scripts/pilot-rc-cg-compare.ts

import { readFileSync } from 'fs'; import path from 'path'
const env = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const l of env.split('\n')) { const m = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g,'').replace(/\\n$/,'') }
import { createClient } from '@supabase/supabase-js'
import { classifyByKeyword } from '../lib/taxonomyKeywordMatcher'
import { AXES } from '../lib/taxonomyVocabulary'

const TARGETS = [
  { label: "Ruth's Chris", name: 'Ruths Chris Reviews' },
  { label: 'Capital Grille', name: 'Capital Grille Reviews' },
]

interface Tally { reviews: number; axisRev: Record<string, number>; subRev: Record<string, number>; subPos: Record<string, number>; subNeg: Record<string, number> }
const blank = (): Tally => ({ reviews: 0, axisRev: {}, subRev: {}, subPos: {}, subNeg: {} })

async function classifyDataset(s: any, datasetId: string): Promise<Tally> {
  const t = blank()
  let from = 0; const page = 1000
  for (;;) {
    const { data, error } = await s.from('dataset_rows_flat').select('data').eq('dataset_id', datasetId).range(from, from + page - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const row of data) {
      const text = (row.data?.review_text ?? row.data?.description ?? '').trim()
      if (!text) continue
      t.reviews++
      const a = classifyByKeyword(text).assertions
      const axesSeen = new Set<string>(), subsSeen = new Set<string>()
      for (const x of a) {
        axesSeen.add(x.axis)
        const sk = `${x.axis}:${x.sub}`
        subsSeen.add(sk)
        if (x.polarity === 'pos') t.subPos[sk] = (t.subPos[sk] ?? 0) + 1
        if (x.polarity === 'neg') t.subNeg[sk] = (t.subNeg[sk] ?? 0) + 1
      }
      for (const ax of axesSeen) t.axisRev[ax] = (t.axisRev[ax] ?? 0) + 1
      for (const sk of subsSeen) t.subRev[sk] = (t.subRev[sk] ?? 0) + 1
    }
    from += page
    if (data.length < page) break
  }
  return t
}

async function main() {
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const tallies: Record<string, Tally> = {}
  for (const t of TARGETS) {
    const { data: ds } = await s.from('datasets').select('id,row_count').eq('name', t.name).order('row_count', { ascending: false }).limit(1)
    if (!ds || !ds.length) { console.error(`dataset not found: ${t.name}`); process.exit(1) }
    process.stderr.write(`Classifying ${t.label} (${ds[0].row_count} rows)...\n`)
    tallies[t.label] = await classifyDataset(s, ds[0].id)
  }
  const [A, B] = TARGETS.map(t => t.label)
  const rate = (t: Tally, k: string, map: 'axisRev' | 'subRev') => 100 * ((t as any)[map][k] ?? 0) / Math.max(1, t.reviews)
  const posPct = (t: Tally, sk: string) => { const p = t.subPos[sk] ?? 0, n = t.subNeg[sk] ?? 0; return p + n === 0 ? null : Math.round(100 * p / (p + n)) }

  console.log(`\n${'='.repeat(74)}`)
  console.log(`COMPETITIVE COMPARE — ${A} vs ${B}  (mention rate = % of reviews touching it)`)
  console.log(`${A}: ${tallies[A].reviews} reviews   ·   ${B}: ${tallies[B].reviews} reviews`)
  console.log('='.repeat(74))

  console.log(`\nLEVEL 1 — by axis      ${A.padStart(14)}        ${B.padStart(14)}     index`)
  for (const ax of AXES) {
    const ra = rate(tallies[A], ax, 'axisRev'), rb = rate(tallies[B], ax, 'axisRev')
    const idx = rb === 0 ? '—' : (ra / rb).toFixed(2) + 'x'
    console.log(`  ${ax.padEnd(12)}  ${ra.toFixed(1).padStart(6)}%               ${rb.toFixed(1).padStart(6)}%        ${idx}`)
  }

  // L2: biggest over/under-index subs
  const allSubs = new Set<string>([...Object.keys(tallies[A].subRev), ...Object.keys(tallies[B].subRev)])
  const rows = [...allSubs].map(sk => {
    const ra = rate(tallies[A], sk, 'subRev'), rb = rate(tallies[B], sk, 'subRev')
    return { sk, ra, rb, delta: ra - rb, aPos: posPct(tallies[A], sk), bPos: posPct(tallies[B], sk) }
  }).filter(r => r.ra + r.rb > 1)  // drop ultra-rare

  console.log(`\nLEVEL 2 — where ${A} OVER-indexes vs ${B} (sub mention rate, +sentiment)`)
  rows.sort((x, y) => y.delta - x.delta).slice(0, 10).forEach(r =>
    console.log(`  ${r.sk.padEnd(26)} ${r.ra.toFixed(1).padStart(5)}% vs ${r.rb.toFixed(1).padStart(5)}%   (+${r.delta.toFixed(1)})   sent ${A}:${r.aPos ?? '—'}% ${B}:${r.bPos ?? '—'}%`))

  console.log(`\nLEVEL 2 — where ${B} OVER-indexes vs ${A}`)
  rows.sort((x, y) => x.delta - y.delta).slice(0, 10).forEach(r =>
    console.log(`  ${r.sk.padEnd(26)} ${r.rb.toFixed(1).padStart(5)}% vs ${r.ra.toFixed(1).padStart(5)}%   (+${(-r.delta).toFixed(1)})   sent ${A}:${r.aPos ?? '—'}% ${B}:${r.bPos ?? '—'}%`))
}
main().catch(e => { console.error(e); process.exit(1) })
