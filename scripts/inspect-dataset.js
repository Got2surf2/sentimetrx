// scripts/inspect-dataset.js
// Diagnostic — prints schema field state, row count, and the top distinct
// values in `dataset_rows_flat` for a dataset matched by name. Read-only.
//
// Use this whenever you need to verify whether refresh-schema actually grew
// the schema's f.values, or to see why a filter is dropping more rows than
// expected. No need to ask the user to click around — run this directly.
//
// Usage:
//   node scripts/inspect-dataset.js "Bareburger"
//   node scripts/inspect-dataset.js "Bareburger" author       # dump distinct counts for one field
//   node scripts/inspect-dataset.js --id <uuid>
//
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.

const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

const envPath = path.join(__dirname, '..', '.env.local')
if (!fs.existsSync(envPath)) {
  console.error('No .env.local at ' + envPath)
  process.exit(1)
}
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i)
  if (!m) continue
  const key = m[1]
  let val = m[2]
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1)
  }
  if (!process.env[key]) process.env[key] = val
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Missing Supabase env vars'); process.exit(1) }

const sb = createClient(url, key, { auth: { persistSession: false } })

async function main() {
  const args = process.argv.slice(2)
  let datasetId = null
  let nameQuery = null
  let fieldFocus = null

  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--id') { datasetId = args[++i]; continue }
    if (!nameQuery) { nameQuery = a; continue }
    if (!fieldFocus) { fieldFocus = a; continue }
  }

  let dataset
  if (datasetId) {
    const { data, error } = await sb.from('datasets').select('id, name, source, row_count').eq('id', datasetId).single()
    if (error || !data) { console.error('Dataset not found:', datasetId); process.exit(1) }
    dataset = data
  } else if (nameQuery) {
    const { data, error } = await sb.from('datasets').select('id, name, source, row_count').ilike('name', '%' + nameQuery + '%').order('updated_at', { ascending: false }).limit(20)
    if (error || !data || data.length === 0) { console.error('No dataset matched:', nameQuery); process.exit(1) }
    if (data.length > 1) {
      console.log('Multiple matches:')
      for (const d of data) console.log('  ' + d.id + '  ' + d.source.padEnd(16) + '  ' + d.row_count.toString().padStart(8) + '  ' + d.name)
      console.log('\nRe-run with --id <uuid> to pick one.')
      process.exit(0)
    }
    dataset = data[0]
  } else {
    console.error('Usage: node scripts/inspect-dataset.js "<name fragment>" [field]')
    console.error('       node scripts/inspect-dataset.js --id <uuid> [field]')
    process.exit(1)
  }

  console.log('Dataset: ' + dataset.name)
  console.log('  id      : ' + dataset.id)
  console.log('  source  : ' + dataset.source)
  console.log('  rows    : ' + (dataset.row_count || 0).toLocaleString())

  const { data: state } = await sb.from('dataset_state').select('schema_config, analytics').eq('dataset_id', dataset.id).single()
  const schema = state?.schema_config
  if (!schema?.fields?.length) { console.log('\n(no schema)'); return }

  console.log('\nSchema fields (values list size in [..]):')
  for (const f of schema.fields) {
    const vSize = Array.isArray(f.values) ? f.values.length : 0
    const flag = (f.type === 'categorical' || f.type === 'date') ? '  [' + vSize.toString().padStart(3) + ']' : ''
    const lbl = f.label && f.label !== f.field ? ' (' + f.label + ')' : ''
    console.log('  ' + f.type.padEnd(12) + '  ' + f.field.padEnd(28) + flag + lbl)
  }

  // For collections, walk member rows for distinct-value counts. For others,
  // scan dataset_rows_flat directly.
  let memberIds = []
  if (dataset.source === 'collection') {
    const { data: col } = await sb.from('collections').select('id').eq('dataset_id', dataset.id).single()
    if (col) {
      const { data: members } = await sb.from('collection_members').select('dataset_id, label').eq('collection_id', col.id)
      memberIds = (members || []).map(m => m.dataset_id)
      console.log('\nCollection has ' + memberIds.length + ' members')
    }
  }

  // Build flat-row-source list — for collections, pull from members.
  const rowSourceIds = memberIds.length > 0 ? memberIds : [dataset.id]

  // If a field was specified, dump its distinct value counts.
  if (fieldFocus) {
    console.log('\nDistinct values for ' + fieldFocus + ' (top 30):')
    const counts = {}
    let scanned = 0
    for (const rsid of rowSourceIds) {
      let off = 0
      while (true) {
        const { data, error } = await sb.from('dataset_rows_flat').select('data').eq('dataset_id', rsid).order('row_index').range(off, off + 999)
        if (error) { console.error(error.message); process.exit(1) }
        if (!data || data.length === 0) break
        for (const r of data) {
          scanned++
          const v = r.data?.[fieldFocus]
          const k = v == null || String(v).trim() === '' ? '(blank)' : String(v)
          counts[k] = (counts[k] || 0) + 1
        }
        if (data.length < 1000) break
        off += 1000
      }
    }
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
    for (const [v, c] of sorted.slice(0, 30)) {
      const pct = (c / scanned * 100).toFixed(1)
      console.log('  ' + c.toString().padStart(7) + '  (' + pct.padStart(5) + '%)  ' + v)
    }
    console.log('  ' + scanned.toLocaleString() + ' rows scanned · ' + sorted.length.toLocaleString() + ' distinct values')
  }
}

main().catch(e => { console.error(e); process.exit(1) })
