/* eslint-disable */
// One-off: change one field's type in a dataset's saved schema_config.
//
// Mirrors what SchemaEditor's handleTypeChange does (components/analyze/
// SchemaEditor.tsx:613) — set type + sqt, clear autoDetected, bump version —
// with one addition: when the target type is categorical, a `values` list is
// written too. The UI leaves `values` alone on a type flip because the settings
// page back-fills it from analytics.fieldSummaries at render time
// (app/analyze/[datasetId]/settings/page.tsx:79-88); a field flipped
// server-side has no such render pass, and Charts/Filters read `values`
// directly, so it is set here explicitly.
//
// Run:  DRY_RUN=1 node --import tsx scripts/oneoff/_set_field_type.ts \
//         --dataset <uuid> --field "Year" --type categorical --values 1984,1986,...
//       (add --prod to write)
// Exits non-zero if the saved schema does not read back as requested.

import { readFileSync } from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const mm = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (mm && !process.env[mm[1]]) process.env[mm[1]] = mm[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '')
}

const argv = process.argv.slice(2)
function arg(name: string): string {
  const i = argv.indexOf('--' + name)
  return i >= 0 ? (argv[i + 1] || '') : ''
}
const datasetId = arg('dataset')
const fieldName = arg('field')
const newType   = arg('type')
const valuesCsv = arg('values')
const IS_PROD   = argv.includes('--prod')
const DRY_RUN   = process.env.DRY_RUN === '1'

if (!datasetId || !fieldName || !newType) {
  console.error('usage: _set_field_type.ts --dataset <uuid> --field <name> --type <type> [--values a,b,c] [--prod]')
  process.exit(2)
}

// Matches the pairing used everywhere a schema is built in lib/datasetUtils.ts.
const SQT: Record<string, string | null> = {
  'categorical': 'single-select',
  'open-ended':  'open-text',
  'numeric':     'rating',
  'date':        null,
  'id':          null,
  'ignore':      null,
}

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    { auth: { persistSession: false } },
  )

  const { data: st, error } = await supabase
    .from('dataset_state').select('schema_config').eq('dataset_id', datasetId).single()
  if (error || !st) { console.error('FAIL: dataset_state not found: ' + (error && error.message)); process.exit(1) }

  const schema = st.schema_config as any
  const field = (schema.fields || []).find(function(f: any) { return f.field === fieldName })
  if (!field) { console.error('FAIL: no field named "' + fieldName + '" in schema'); process.exit(1) }

  console.log('==> ' + fieldName + ': ' + field.type + ' -> ' + newType)
  console.log('    before: ' + JSON.stringify({ type: field.type, sqt: field.sqt, values: field.values ? field.values.length + ' values' : undefined,
                                                min: field.min, max: field.max, avg: field.avg }))

  field.type = newType
  const sqt = SQT[newType]
  if (sqt) field.sqt = sqt; else delete field.sqt

  if (newType === 'categorical') {
    if (valuesCsv) field.values = valuesCsv.split(',').map(function(v) { return v.trim() }).filter(Boolean).sort()
    // A categorical field carries no numeric domain — leaving min/max/avg behind
    // would have Charts offer a range control for a field that no longer has one.
    delete field.min; delete field.max; delete field.avg
  }

  schema.autoDetected = false
  schema.version = (schema.version || 1) + 1

  console.log('    after:  ' + JSON.stringify({ type: field.type, sqt: field.sqt,
                                                values: field.values ? field.values.length + ' values' : undefined }))
  if (field.values) console.log('    values: ' + field.values.join(', '))

  if (DRY_RUN) { console.log('\nDRY_RUN=1 — nothing written.'); return }
  if (!IS_PROD) { console.log('\nRefusing to write without --prod.'); process.exit(2) }

  const { error: upErr } = await supabase.from('dataset_state')
    .update({ schema_config: schema, updated_at: new Date().toISOString() })
    .eq('dataset_id', datasetId)
  if (upErr) { console.error('FAIL: update: ' + upErr.message); process.exit(1) }

  // -- VERIFY: read it back, do not trust the write ----------------------------
  const { data: after } = await supabase
    .from('dataset_state').select('schema_config').eq('dataset_id', datasetId).single()
  const saved = ((after?.schema_config as any)?.fields || []).find(function(f: any) { return f.field === fieldName })
  let failures = 0
  function check(label: string, pass: boolean, detail: string) {
    console.log('    ' + (pass ? 'PASS' : 'FAIL') + '  ' + label + ' — ' + detail)
    if (!pass) failures++
  }
  console.log('\n==> VERIFY')
  check('type', saved?.type === newType, String(saved?.type))
  if (sqt) check('sqt', saved?.sqt === sqt, String(saved?.sqt))
  if (newType === 'categorical' && valuesCsv) {
    check('values', Array.isArray(saved?.values) && saved.values.length === field.values.length,
          (saved?.values?.length ?? 0) + ' saved')
    check('numeric domain cleared', saved?.min === undefined && saved?.max === undefined,
          'min=' + saved?.min + ' max=' + saved?.max)
  }
  check('field count unchanged', ((after?.schema_config as any)?.fields || []).length === (schema.fields || []).length,
        ((after?.schema_config as any)?.fields || []).length + ' fields')

  if (failures > 0) { console.error('\nVERIFY FAILED — ' + failures + ' check(s).'); process.exit(1) }
  console.log('\nSaved.')
}

main().catch(function(e) { console.error(e); process.exit(1) })
