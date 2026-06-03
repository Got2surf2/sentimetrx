/* eslint-disable */
// Repair: create the dataset_state row that a script-ingested google_reviews
// dataset is missing (the direct-insert "back door" skips the setup the app's
// review-sources flow does, so /analyze 404s). Builds the canonical Google
// Reviews schema, enriches it with real row stats, and inserts state + an empty
// theme model. Idempotent — skips if state already exists.
//
// Run: node_modules/.bin/tsx scripts/repair-review-dataset-state.ts --dataset-name "Chuy's — Google Reviews (last 30d)"
//      node_modules/.bin/tsx scripts/repair-review-dataset-state.ts --dataset-id <uuid>

import { readFileSync } from 'fs'; import path from 'path'
const env = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const l of env.split('\n')) { const m = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '') }
import { createClient } from '@supabase/supabase-js'
import { buildGoogleReviewsSchema, mergeSchemaStats, emptyThemeModel } from '../lib/datasetUtils'

const args = process.argv.slice(2)
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }

async function main() {
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  let q = s.from('datasets').select('id, name, source, created_by, row_count')
  const id = flag('--dataset-id'), name = flag('--dataset-name')
  if (id) q = q.eq('id', id); else if (name) q = q.eq('name', name); else throw new Error('Pass --dataset-id or --dataset-name')
  const { data: ds, error } = await q.order('row_count', { ascending: false }).limit(1)
  if (error) throw error
  if (!ds?.length) throw new Error('dataset not found')
  const dataset = ds[0]
  if (dataset.source !== 'google_reviews') throw new Error(`expected google_reviews, got source=${dataset.source}`)

  const { data: existing } = await s.from('dataset_state').select('dataset_id').eq('dataset_id', dataset.id).maybeSingle()
  if (existing) { console.log(`dataset_state already exists for "${dataset.name}" — nothing to do.`); return }

  // Enrich the canonical schema with real stats from a row sample.
  const { data: rows } = await s.from('dataset_rows_flat').select('data').eq('dataset_id', dataset.id).order('row_index', { ascending: true }).range(0, 2999)
  const sample = (rows || []).map((r: any) => r.data)
  const schema = mergeSchemaStats(buildGoogleReviewsSchema(), sample)

  const { error: insErr } = await s.from('dataset_state').insert({
    dataset_id:    dataset.id,
    schema_config: schema,
    theme_model:   emptyThemeModel(),
    saved_charts:  [],
    saved_stats:   [],
    filter_state:  {},
    updated_by:    dataset.created_by,
  })
  if (insErr) throw insErr
  console.log(`Created dataset_state for "${dataset.name}" (${dataset.id}) — ${schema.fields.length} fields, enriched from ${sample.length} rows. /analyze should open now.`)
}
main().catch(e => { console.error(e); process.exit(1) })
