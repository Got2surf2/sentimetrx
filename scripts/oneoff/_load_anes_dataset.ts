/* eslint-disable */
// One-off: load the full ANES 1984-2024 CSV into an existing dataset.
//
// WHY THIS EXISTS: the production upload path is a foreground browser loop that
// POSTs 50 rows at a time (prod runs 2e4b28b5; the 200-row commit is unpushed).
// At ~8.7s/batch a 125,897-row file is a ~6.1 hour tab that must stay alive. On
// 2026-08-26 it died at batch 1,337 of 2,518 — no error, so the client's rollback
// never fired, and step 3 ("save schema") never ran. The dataset was left with
// 66,850 rows and the untouched creation-default empty schema, which is what
// greys out AI theme mining (TextMine reads open-ended fields off schema.fields).
//
// This script does the same work server-side, in minutes, and VERIFIES the result.
//
// Faithful to the shipped path: the real autoDetectSchema(), the real
// stampRowSubstantive(), and the real row_index contract
// (row_index = batch_index * ROWS_PER_BATCH + offset, batches of ROWS_PER_BATCH,
// so indices come out contiguous and the rollback DELETE span stays valid).
//
// ONE DELIBERATE DIFFERENCE: the UI's parseCSV() toggles on every '"' and never
// emits it, so interior quote marks are silently dropped — it mangles 2,796 of
// this file's 125,897 rows, all of them in the open-ended verbatim fields that
// are the point of this dataset. This script uses an RFC4180 splitter that keeps
// them. Field counts, column counts and every other value are identical.
//
// Run:  DRY_RUN=1 node --max-old-space-size=8192 --import tsx scripts/oneoff/_load_anes_dataset.ts <csv> --dataset <id>
//       node --max-old-space-size=8192 --import tsx scripts/oneoff/_load_anes_dataset.ts <csv> --dataset <id> --prod --replace
// Exits non-zero if the loaded result does not verify.

import { readFileSync } from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import { autoDetectSchema } from '../../lib/datasetUtils'
import { stampRowSubstantive } from '../../lib/usefulness'
import { ROWS_PER_BATCH } from '../../lib/constants'

const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const mm = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (mm && !process.env[mm[1]]) process.env[mm[1]] = mm[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '')
}

const argv      = process.argv.slice(2)
const csvPath   = argv.find(function(a) { return !a.startsWith('--') })
const dsIdx     = argv.indexOf('--dataset')
const datasetId = dsIdx >= 0 ? argv[dsIdx + 1] : ''
const IS_PROD   = argv.includes('--prod')
const REPLACE   = argv.includes('--replace')
const DRY_RUN   = process.env.DRY_RUN === '1'

if (!csvPath || !datasetId) {
  console.error('usage: _load_anes_dataset.ts <csv> --dataset <uuid> [--prod] [--replace]')
  process.exit(2)
}

// HTTP request size. Stays a multiple of ROWS_PER_BATCH so each request covers
// whole logical batches and row_index stays contiguous.
const ROWS_PER_POST = ROWS_PER_BATCH * 5   // 1,000 rows ~ 1 MB on this file

// -- RFC4180 field splitter: "" is a literal quote, not a toggle-and-drop -----
function splitFields(line: string): string[] {
  const vals: string[] = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++ }
      else inQ = !inQ
    } else if (ch === ',' && !inQ) { vals.push(cur); cur = '' }
    else cur += ch
  }
  vals.push(cur)
  return vals.map(function(v) { return v.trim() })   // .trim() matches the UI
}

function parseCsv(text: string): { headers: string[]; rows: Record<string, unknown>[] } {
  const lines = text.trim().split('\n').filter(function(l) { return l.trim() })
  const headers = splitFields(lines[0])
  const rows: Record<string, unknown>[] = new Array(lines.length - 1)
  for (let i = 1; i < lines.length; i++) {
    const vals = splitFields(lines[i])
    const row: Record<string, unknown> = {}
    for (let k = 0; k < headers.length; k++) row[headers[k]] = vals[k] ?? ''
    rows[i - 1] = row
  }
  return { headers, rows }
}

async function main() {
  console.log('==> Reading ' + csvPath)
  const text = readFileSync(csvPath as string, 'utf-8').replace(/^﻿/, '')
  const { headers, rows } = parseCsv(text)
  console.log('    columns: ' + headers.length)
  console.log('    rows:    ' + rows.length.toLocaleString())

  // Guard: a ragged parse means the splitter disagreed with the file.
  let ragged = 0
  for (let i = 0; i < rows.length; i++) if (Object.keys(rows[i]).length !== headers.length) ragged++
  if (ragged > 0) { console.error('FAIL: ' + ragged + ' rows did not yield ' + headers.length + ' columns'); process.exit(1) }

  console.log('==> autoDetectSchema() over all ' + rows.length.toLocaleString() + ' rows')
  const schema = autoDetectSchema(rows)

  // -- Cardinality correction --------------------------------------------------
  // autoDetectSchema types a column open-ended when it reads as prose
  // (avgWords >= 4, lib/datasetUtils.ts:215). ANES stores full codebook labels
  // ("3. 12 grades, diploma or equivalency", "2. No, no one in household belongs
  // to a labor union"), so nine single-choice demographic columns clear that bar
  // despite having only 2-8 distinct values — and would then be offered as
  // theme-mining targets. The detector's own categorical rule one line earlier is
  // `uniqueArr.length <= 15 && avgWords < 3`: same cardinality test, plus a word-
  // count gate these labels fail. Re-apply the cardinality half alone, and give
  // the flipped fields the `values` list a categorical field is expected to carry.
  const CATEGORICAL_MAX_DISTINCT = 15
  const corrected: string[] = []
  schema.fields.forEach(function(f) {
    if (f.type !== 'open-ended') return
    const seen = new Set<string>()
    for (let i = 0; i < rows.length; i++) {
      const v = String(rows[i][f.field] ?? '').trim()
      if (v) seen.add(v)
      if (seen.size > CATEGORICAL_MAX_DISTINCT) return   // genuine free text
    }
    if (seen.size === 0) return
    f.type = 'categorical'
    ;(f as any).values = Array.from(seen).sort()
    corrected.push(f.field + ' (' + seen.size + ' distinct)')
  })
  if (corrected.length > 0) {
    console.log('    corrected open-ended -> categorical (<= ' + CATEGORICAL_MAX_DISTINCT + ' distinct):')
    corrected.forEach(function(c) { console.log('      - ' + c) })
    const firstOpen = schema.fields.find(function(f) { return f.type === 'open-ended' })
    schema.primaryTextField = firstOpen ? firstOpen.field : undefined
  }

  const byType: Record<string, string[]> = {}
  schema.fields.forEach(function(f) { (byType[f.type] = byType[f.type] || []).push(f.field) })
  Object.keys(byType).sort().forEach(function(t) {
    console.log('    ' + t.padEnd(12) + ' (' + byType[t].length + '): ' + byType[t].join(', '))
  })
  console.log('    primaryTextField: ' + (schema.primaryTextField || '(none)'))
  const openEnded = schema.fields.filter(function(f) { return f.type === 'open-ended' })
  if (openEnded.length === 0) { console.error('FAIL: no open-ended field detected — theme mining would still be disabled'); process.exit(1) }

  if (DRY_RUN) { console.log('\nDRY_RUN=1 — nothing written.'); return }
  if (!IS_PROD) { console.log('\nRefusing to write without --prod.'); process.exit(2) }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    { auth: { persistSession: false } },
  )

  const { data: ds, error: dsErr } = await supabase
    .from('datasets').select('id, name, org_id, row_count').eq('id', datasetId).single()
  if (dsErr || !ds) { console.error('FAIL: dataset not found: ' + (dsErr && dsErr.message)); process.exit(1) }
  console.log('\n==> Target: "' + ds.name + '" (' + ds.id + ') — currently ' + (ds.row_count || 0).toLocaleString() + ' rows')

  if (REPLACE) {
    // A single unbounded DELETE over the whole dataset exceeds PostgREST's
    // statement timeout (observed on the 66,850-row partial). Walk row_index in
    // windows instead — bounded work per statement, and the window is the same
    // span the route's own rollback DELETE uses.
    const { data: maxBefore } = await supabase.from('dataset_rows_flat')
      .select('row_index').eq('dataset_id', datasetId).order('row_index', { ascending: false }).limit(1)
    const upper = maxBefore && maxBefore[0] ? maxBefore[0].row_index : -1
    const WINDOW = ROWS_PER_BATCH * 50   // 10,000 index slots per statement
    console.log('==> Deleting existing rows (row_index 0..' + upper + ', ' + WINDOW + ' per statement)')
    for (let start = 0; start <= upper; start += WINDOW) {
      let ok = false
      for (let attempt = 1; attempt <= 4 && !ok; attempt++) {
        const { error } = await supabase.from('dataset_rows_flat').delete()
          .eq('dataset_id', datasetId).gte('row_index', start).lt('row_index', start + WINDOW)
        if (!error) { ok = true; break }
        console.warn('    delete @' + start + ' attempt ' + attempt + ': ' + error.message)
        if (attempt === 4) { console.error('FAIL: delete @' + start + ': ' + error.message); process.exit(1) }
        await new Promise(function(r) { setTimeout(r, 500 * attempt * attempt) })
      }
    }
    const { count } = await supabase.from('dataset_rows_flat')
      .select('id', { count: 'exact', head: true }).eq('dataset_id', datasetId)
    if ((count || 0) !== 0) { console.error('FAIL: ' + count + ' rows survived the delete'); process.exit(1) }
    console.log('    cleared')
  }

  console.log('==> Inserting ' + rows.length.toLocaleString() + ' rows (' + ROWS_PER_POST + '/request)')
  const started = Date.now()
  for (let off = 0; off < rows.length; off += ROWS_PER_POST) {
    const slice = rows.slice(off, off + ROWS_PER_POST)
    const flat = slice.map(function(r, i) {
      const globalIndex = off + i
      const batchIndex  = Math.floor(globalIndex / ROWS_PER_BATCH)
      return stampRowSubstantive({
        dataset_id: datasetId,
        row_index:  batchIndex * ROWS_PER_BATCH + (globalIndex % ROWS_PER_BATCH),
        data:       r,
      })
    })
    let ok = false
    for (let attempt = 1; attempt <= 4 && !ok; attempt++) {
      const { error } = await supabase.from('dataset_rows_flat').insert(flat)
      if (!error) { ok = true; break }
      const transient = /fetch failed|timeout|ECONN|socket|network|503|502/i.test(error.message || '')
      console.warn('    batch @' + off + ' attempt ' + attempt + ' failed: ' + error.message)
      if (!transient || attempt === 4) { console.error('FAIL: insert @' + off + ': ' + error.message); process.exit(1) }
      await new Promise(function(r) { setTimeout(r, 500 * attempt * attempt) })
    }
    const done = off + slice.length
    if (done % 20000 === 0 || done === rows.length) {
      const el = (Date.now() - started) / 1000
      const eta = Math.round(el / done * (rows.length - done))
      console.log('    ' + done.toLocaleString() + '/' + rows.length.toLocaleString() +
                  '  ' + Math.round(el) + 's elapsed' + (done < rows.length ? ', ~' + eta + 's left' : ''))
    }
  }

  console.log('==> Writing schema_config + row_count')
  const { error: stErr } = await supabase.from('dataset_state')
    .update({ schema_config: schema, updated_at: new Date().toISOString() })
    .eq('dataset_id', datasetId)
  if (stErr) { console.error('FAIL: state update: ' + stErr.message); process.exit(1) }

  const { error: rcErr } = await supabase.from('datasets')
    .update({ row_count: rows.length, updated_at: new Date().toISOString() }).eq('id', datasetId)
  if (rcErr) { console.error('FAIL: row_count update: ' + rcErr.message); process.exit(1) }

  // -- VERIFY ------------------------------------------------------------------
  console.log('\n==> VERIFY')
  let failures = 0
  function check(label: string, pass: boolean, detail: string) {
    console.log('    ' + (pass ? 'PASS' : 'FAIL') + '  ' + label + ' — ' + detail)
    if (!pass) failures++
  }

  const { count: stored } = await supabase.from('dataset_rows_flat')
    .select('id', { count: 'exact', head: true }).eq('dataset_id', datasetId)
  check('row count', (stored || 0) === rows.length, (stored || 0).toLocaleString() + ' stored vs ' + rows.length.toLocaleString() + ' in file')

  const { data: maxR } = await supabase.from('dataset_rows_flat')
    .select('row_index').eq('dataset_id', datasetId).order('row_index', { ascending: false }).limit(1)
  const { data: minR } = await supabase.from('dataset_rows_flat')
    .select('row_index').eq('dataset_id', datasetId).order('row_index', { ascending: true }).limit(1)
  const maxIdx = maxR && maxR[0] ? maxR[0].row_index : -1
  const minIdx = minR && minR[0] ? minR[0].row_index : -1
  check('row_index contiguous', minIdx === 0 && maxIdx === rows.length - 1,
        'min ' + minIdx + ', max ' + maxIdx + ' (expected 0..' + (rows.length - 1) + ')')

  const { data: st } = await supabase.from('dataset_state')
    .select('schema_config').eq('dataset_id', datasetId).single()
  const savedFields = (st && (st.schema_config as any)?.fields) || []
  const savedOpen = savedFields.filter(function(f: any) { return f.type === 'open-ended' })
  check('schema saved', savedFields.length === headers.length, savedFields.length + ' fields (expected ' + headers.length + ')')
  check('theme mining unlocked', savedOpen.length > 0, savedOpen.length + ' open-ended field(s): ' + savedOpen.map(function(f: any) { return f.field }).join(', '))

  const { data: dsAfter } = await supabase.from('datasets').select('row_count').eq('id', datasetId).single()
  check('datasets.row_count', (dsAfter?.row_count || 0) === rows.length, String(dsAfter?.row_count))

  // Spot-check real values round-tripped, first / middle / last.
  const probes = [0, Math.floor(rows.length / 2), rows.length - 1]
  for (const p of probes) {
    const { data: got } = await supabase.from('dataset_rows_flat')
      .select('data').eq('dataset_id', datasetId).eq('row_index', p).single()
    const src = rows[p]
    const mismatched = headers.filter(function(h) { return String((got?.data as any)?.[h] ?? '') !== String(src[h] ?? '') })
    check('row ' + p.toLocaleString() + ' round-trip', mismatched.length === 0,
          mismatched.length === 0 ? 'all ' + headers.length + ' fields match' : 'mismatched: ' + mismatched.slice(0, 5).join(', '))
  }

  console.log('')
  if (failures > 0) { console.error('VERIFY FAILED — ' + failures + ' check(s) did not pass.'); process.exit(1) }
  console.log('All checks passed. "' + ds.name + '" is fully loaded.')
}

main().catch(function(e) { console.error(e); process.exit(1) })
