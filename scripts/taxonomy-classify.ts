/* eslint-disable */
// Generalized taxonomy classifier driver — keyword tier, persists to
// dataset_row_taxonomy for ANY dataset. Replaces the RC/Chuy's one-offs
// (pilot-rc-classify is AI-tier + RC-hardcoded; chuys-classify was console-only).
//
// Run:
//   node_modules/.bin/tsx scripts/taxonomy-classify.ts --dataset-name "Chuy's — Google Reviews (last 30d)" --brand chuys --rollup
//   node_modules/.bin/tsx scripts/taxonomy-classify.ts --dataset-id <uuid> --brand rc --limit 500
//
// Flags: --dataset-id | --dataset-name (one required) · --brand core|rc|chuys (default core)
//        --text-field review_text · --limit N · --rollup (print analytics after)

import { readFileSync } from 'fs'; import path from 'path'
const env = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const l of env.split('\n')) { const m = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '') }
import { createClient } from '@supabase/supabase-js'
import { classifyDatasetKeyword } from '../lib/taxonomyClassify'
import { computeTaxonomyRollup } from '../lib/taxonomyRollup'
import type { BrandOverlay } from '../lib/taxonomyDictionary'

const args = process.argv.slice(2)
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }

async function main() {
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const brand = (flag('--brand') ?? 'core') as BrandOverlay
  const textField = flag('--text-field') ?? 'review_text'
  const limit = flag('--limit') ? parseInt(flag('--limit')!, 10) : undefined

  // Resolve dataset + its org_id (paired on every write).
  let q = s.from('datasets').select('id, name, org_id, row_count')
  const id = flag('--dataset-id'), name = flag('--dataset-name')
  if (id) q = q.eq('id', id)
  else if (name) q = q.eq('name', name)
  else throw new Error('Pass --dataset-id or --dataset-name')
  const { data: ds, error } = await q.order('row_count', { ascending: false }).limit(1)
  if (error) throw error
  if (!ds?.length) throw new Error('dataset not found')
  const dataset = ds[0]

  process.stderr.write(`Classifying "${dataset.name}" (${dataset.row_count} rows) · brand=${brand} · field=${textField}${limit ? ` · limit=${limit}` : ''}\n`)
  const r = await classifyDatasetKeyword({
    service: s, datasetId: dataset.id, orgId: dataset.org_id, brand, textField, limit,
    onProgress: d => process.stderr.write(`  …${d} classified\r`),
  })
  console.log(`\nDone: ${r.classified} classified, ${r.skippedEmpty} empty-text skipped, ${r.total} scanned.`)

  if (args.includes('--rollup')) {
    const ru = await computeTaxonomyRollup({ service: s, datasetId: dataset.id, orgId: dataset.org_id })
    console.log(`\nROLL-UP — ${ru.classifiedRows} rows, ${ru.withSignal} with signal, ${ru.alertRows} with alerts`)
    console.log('\nAxes (mention rate):')
    for (const a of ru.axes) console.log(`  ${a.axis.padEnd(11)} ${String(a.rate).padStart(5)}%  (${a.count})`)
    console.log('\nTop sub-buckets:')
    for (const x of ru.subs.slice(0, 20)) console.log(`  ${(x.axis + ':' + x.sub).padEnd(26)} ${String(x.rate).padStart(5)}%  (${x.count})  ${x.posPct === null ? '—' : x.posPct + '% pos'}`)
    if (ru.alerts.length) { console.log('\nAlert tags:'); for (const a of ru.alerts) console.log(`  ${a.tag.padEnd(20)} ${a.count}`) }
  }
}
main().catch(e => { console.error(e); process.exit(1) })
