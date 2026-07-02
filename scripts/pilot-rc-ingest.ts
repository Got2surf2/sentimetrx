 
// Ruth's Chris taxonomy pilot — CSV ingest.
//
// Reads /Users/sanjaypatel/Downloads/RC Verbatims 15-months ending 093025.csv
// and ingests into a new dataset on the Datanautix admin org. Preserves the
// prospect's original Classification column as `legacy_classification` on
// each row so the side-by-side viewer can render legacy-vs-new comparison.
//
// Run: node_modules/.bin/tsx scripts/pilot-rc-ingest.ts
//
// Flags:
//   --dataset-name "Custom Name"   override the default dataset name
//   --limit 100                    cap rows ingested (handy for dev smoke tests)
//   --recreate                     drop+recreate the dataset if a name match exists
//
// Idempotent by default: if a dataset with the same name already exists on
// the admin org, the script prints the dataset id and exits without writing.

import { readFileSync } from 'fs'
import path from 'path'

const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '')
}

import { createClient } from '@supabase/supabase-js'

const ADMIN_ORG_ID = 'b72e9ee6-0466-459a-8440-988a8bd6d3c5'  // Datanautix
const ADMIN_USER_ID = '99c52954-36a5-4137-b511-a0a336c220ea'  // got2surf2@gmail.com
const CSV_PATH = '/Users/sanjaypatel/Downloads/RC Verbatims 15-months ending 093025.csv'
const DEFAULT_DATASET_NAME = "Ruth's Chris (pilot) — Google Reviews 2024-2025"
const BATCH_SIZE = 500

const args = process.argv.slice(2)
function getFlag(name: string): string | undefined {
  const idx = args.indexOf(name)
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1]
  return undefined
}
const datasetName = getFlag('--dataset-name') ?? DEFAULT_DATASET_NAME
const limitArg = getFlag('--limit')
const limit = limitArg ? Math.max(1, parseInt(limitArg, 10)) : null
const recreate = args.includes('--recreate')

// ── RFC4180 streaming parser ────────────────────────────────────────────────
// Handles quoted fields, embedded commas, embedded newlines, and "" escapes.
function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else { inQuotes = false }
      } else {
        field += c
      }
    } else {
      if (c === '"') { inQuotes = true }
      else if (c === ',') { row.push(field); field = '' }
      else if (c === '\r') { /* swallow */ }
      else if (c === '\n') {
        row.push(field); rows.push(row); row = []; field = ''
      } else {
        field += c
      }
    }
  }
  // Tail row if file doesn't end with newline
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

function splitLegacyTags(classification: string): string[] {
  if (!classification) return []
  return classification
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

async function main() {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Missing SUPABASE env vars')
  }
  const service = createClient(SUPABASE_URL, SUPABASE_KEY)

  console.log(`Reading ${CSV_PATH}...`)
  const raw = readFileSync(CSV_PATH, 'utf-8')
  const allRows = parseCSV(raw)
  console.log(`Parsed ${allRows.length} CSV rows (including header)`)

  if (allRows.length < 2) throw new Error('CSV has no data rows')
  const header = allRows[0]
  const dataRows = allRows.slice(1).filter(r => r.length > 1 && r.some(c => c && c.trim()))
  console.log(`Found ${dataRows.length} data rows`)

  // Column index lookup
  const col = (name: string) => {
    const idx = header.indexOf(name)
    if (idx < 0) throw new Error(`Missing column: ${name}`)
    return idx
  }
  const idx = {
    reviewSource:        col('ReviewSource'),
    brandName:           col('BrandName'),
    brandGenerated:      col('BrandGenerated'),
    reviewRating:        col('ReviewRating'),
    systemEnterDate:     col('SystemEnterDate'),
    systemPublishedDate: col('SystemPublishedDate'),
    author:              col('Author'),
    unitName:            col('UnitName'),
    address:             col('Address'),
    city:                col('City'),
    state:               col('State'),
    zipCode:             col('ZipCode'),
    description:         col('Description'),
    classification:      col('Classification'),
  }

  // Check for existing dataset
  const { data: existing, error: exErr } = await service
    .from('datasets')
    .select('id, row_count, name')
    .eq('org_id', ADMIN_ORG_ID)
    .eq('name', datasetName)
    .limit(1)
  if (exErr) throw exErr

  let datasetId: string
  if (existing && existing.length > 0) {
    if (!recreate) {
      console.log(`Dataset already exists: ${existing[0].id} (row_count=${existing[0].row_count}). Pass --recreate to drop+rebuild.`)
      return
    }
    console.log(`--recreate: deleting existing dataset ${existing[0].id}...`)
    const { error: delErr } = await service.from('datasets').delete().eq('id', existing[0].id).eq('org_id', ADMIN_ORG_ID)
    if (delErr) throw delErr
  }

  // Create dataset
  const { data: created, error: createErr } = await service
    .from('datasets')
    .insert({
      org_id: ADMIN_ORG_ID,
      name: datasetName,
      created_by: ADMIN_USER_ID,
      source: 'google_reviews',
      row_count: 0,
      description: JSON.stringify({
        pilot: 'ruths_chris_taxonomy_2026_05_27',
        csv_source: path.basename(CSV_PATH),
        ingested_at: new Date().toISOString(),
      }),
      brand_tag: "Ruth's Chris Steak House",
    })
    .select('id')
    .single()
  if (createErr) throw createErr
  datasetId = created.id
  console.log(`Created dataset: ${datasetId}`)

  // Build flat rows
  const flatRows: { dataset_id: string; row_index: number; data: Record<string, unknown> }[] = []
  const rowsToProcess = limit ? dataRows.slice(0, limit) : dataRows
  for (let i = 0; i < rowsToProcess.length; i++) {
    const r = rowsToProcess[i]
    const ratingRaw = r[idx.reviewRating]
    const rating = ratingRaw && /^\d+$/.test(ratingRaw.trim()) ? parseInt(ratingRaw.trim(), 10) : null
    flatRows.push({
      dataset_id: datasetId,
      row_index: i,
      data: {
        review_source:        r[idx.reviewSource] ?? '',
        brand_name:           r[idx.brandName] ?? '',
        brand_generated:      r[idx.brandGenerated] ?? '',
        review_rating:        rating,
        system_enter_date:    r[idx.systemEnterDate] ?? '',
        system_published_date: r[idx.systemPublishedDate] ?? '',
        author:               r[idx.author] ?? '',
        unit_name:            r[idx.unitName] ?? '',
        address:              r[idx.address] ?? '',
        city:                 r[idx.city] ?? '',
        state:                r[idx.state] ?? '',
        zip_code:             r[idx.zipCode] ?? '',
        description:          r[idx.description] ?? '',
        legacy_classification: r[idx.classification] ?? '',
        legacy_tags:          splitLegacyTags(r[idx.classification] ?? ''),
      },
    })
  }
  console.log(`Prepared ${flatRows.length} rows for insert`)

  // Insert in batches
  let inserted = 0
  for (let i = 0; i < flatRows.length; i += BATCH_SIZE) {
    const batch = flatRows.slice(i, i + BATCH_SIZE)
    const { error: insErr } = await service.from('dataset_rows_flat').insert(batch)
    if (insErr) {
      console.error(`Batch ${i / BATCH_SIZE} failed:`, insErr.message)
      throw insErr
    }
    inserted += batch.length
    if ((i / BATCH_SIZE) % 5 === 0) console.log(`  ${inserted}/${flatRows.length}`)
  }

  // Update dataset row_count
  await service.from('datasets')
    .update({ row_count: inserted, updated_at: new Date().toISOString() })
    .eq('id', datasetId)
    .eq('org_id', ADMIN_ORG_ID)

  console.log(`Done. Inserted ${inserted} rows into dataset ${datasetId}.`)
}

main().catch(e => { console.error(e); process.exit(1) })
