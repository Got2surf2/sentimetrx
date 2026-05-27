/* eslint-disable */
// Ruth's Chris taxonomy pilot — classifier driver.
//
// Reads dataset_rows_flat for the pilot dataset, runs classifyReview() from
// lib/taxonomyExtractor.ts on each unclassified row, and upserts the result
// into dataset_row_taxonomy.
//
// Run: node_modules/.bin/tsx scripts/pilot-rc-classify.ts [--limit 50] [--concurrency 4] [--dataset-id <uuid>]
//
// Defaults:
//   --limit 50          (sane starter so first invocation is ~$0.30, not ~$240)
//   --concurrency 4     (Haiku is fast enough at 4x parallel without rate-limiting)
//   --dataset-id        defaults to the "Ruth's Chris (pilot) — Google Reviews 2024-2025"
//                       dataset under the Datanautix admin org
//
// Idempotent: rows already present in dataset_row_taxonomy are skipped (a
// UNIQUE constraint on (dataset_id, row_id) prevents dupes anyway, but the
// skip avoids burning model spend on already-classified rows).

import { readFileSync } from 'fs'
import path from 'path'

const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '')
}

import { createClient } from '@supabase/supabase-js'
import {
  buildSystemPrompt,
  buildUserMessage,
  parseExtractorOutput,
} from '../lib/taxonomyExtractor'
import { mapLegacyLabels } from '../lib/taxonomyMapping'

const MODEL = 'claude-haiku-4-5-20251001'

async function callAnthropic(system: string, userMsg: string): Promise<{ text: string; model: string; stopReason: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content: userMsg }],
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const text = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
  return { text, model: data.model || MODEL, stopReason: data.stop_reason || 'end_turn' }
}

const ADMIN_ORG_ID = 'b72e9ee6-0466-459a-8440-988a8bd6d3c5'
const DEFAULT_DATASET_NAME = "Ruth's Chris (pilot) — Google Reviews 2024-2025"

const args = process.argv.slice(2)
function getFlag(name: string): string | undefined {
  const idx = args.indexOf(name)
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1]
  return undefined
}
const limit = parseInt(getFlag('--limit') ?? '50', 10)
const concurrency = parseInt(getFlag('--concurrency') ?? '4', 10)
const datasetIdArg = getFlag('--dataset-id')
const force = args.includes('--force')

interface FlatRow {
  id: number
  row_index: number
  data: {
    description?: string
    review_rating?: number | null
    legacy_classification?: string
    legacy_tags?: string[]
  }
}

async function main() {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Missing SUPABASE env vars')
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Missing ANTHROPIC_API_KEY')
  const service = createClient(SUPABASE_URL, SUPABASE_KEY)

  // Resolve dataset id
  let datasetId = datasetIdArg
  if (!datasetId) {
    const { data: ds, error: dsErr } = await service
      .from('datasets')
      .select('id, row_count')
      .eq('org_id', ADMIN_ORG_ID)
      .eq('name', DEFAULT_DATASET_NAME)
      .limit(1)
    if (dsErr) throw dsErr
    if (!ds || ds.length === 0) throw new Error(`Dataset "${DEFAULT_DATASET_NAME}" not found. Run pilot-rc-ingest.ts first.`)
    datasetId = ds[0].id
    console.log(`Resolved dataset: ${datasetId} (row_count=${ds[0].row_count})`)
  }

  // Find already-classified row ids (skip unless --force)
  let done = new Set<number>()
  if (!force) {
    const { data: existingRows, error: exErr } = await service
      .from('dataset_row_taxonomy')
      .select('row_id')
      .eq('dataset_id', datasetId)
      .eq('org_id', ADMIN_ORG_ID)
    if (exErr) throw exErr
    done = new Set<number>((existingRows ?? []).map((r: any) => r.row_id))
    console.log(`Already classified: ${done.size} rows (skip with --force to re-classify)`)
  } else {
    console.log(`--force: ignoring existing rows; will overwrite via upsert`)
  }

  // Pull next batch of unclassified rows
  const { data: rows, error: rowErr } = await service
    .from('dataset_rows_flat')
    .select('id, row_index, data')
    .eq('dataset_id', datasetId)
    .order('row_index', { ascending: true })
    .limit(limit + done.size + 100)  // overfetch so we can skip done rows
  if (rowErr) throw rowErr

  const todo: FlatRow[] = ((rows ?? []) as any[])
    .filter(r => !done.has(r.id))
    .slice(0, limit)
  console.log(`Classifying ${todo.length} rows (concurrency=${concurrency})...`)

  let processed = 0
  let failed = 0
  const startTime = Date.now()

  async function classifyOne(row: FlatRow): Promise<void> {
    const text = row.data?.description ?? ''
    if (!text.trim()) {
      // Empty review — write a no-op row so we don't keep retrying it
      const legacy = mapLegacyLabels(row.data?.legacy_tags ?? [])
      await service.from('dataset_row_taxonomy').upsert({
        org_id:           ADMIN_ORG_ID,
        dataset_id:       datasetId,
        row_id:           row.id,
        axis_touchpoint:  [],
        axis_attribute:   [],
        axis_product:     [],
        axis_beverage:    [],
        axis_ambiance:    [],
        axis_context:     [],
        axis_outcome:     [],
        alert_tags:       [],
        assertions:       [],
        raw_legacy_tags:  legacy.canonical,
        classified_by:    'skip:empty-review',
        prompt_version:   null,
      }, { onConflict: 'dataset_id,row_id' })
      processed++
      return
    }

    try {
      const system = buildSystemPrompt()
      const userMsg = buildUserMessage({
        review_text: text,
        review_rating: row.data?.review_rating ?? null,
        legacy_tags: row.data?.legacy_tags ?? [],
      })
      const ai = await callAnthropic(system, userMsg)
      const result = parseExtractorOutput(ai.text, ai.model)
      if (ai.stopReason === 'max_tokens') {
        console.warn(`  row ${row.id}: TRUNCATED at max_tokens — review ${text.length} chars, ${result.assertions.length} assertions parsed`)
      } else if (result.assertions.length === 0 && text.trim().length > 50) {
        console.warn(`  row ${row.id}: 0 assertions on ${text.length}-char review (parse OK, stop=${ai.stopReason}). First 200 chars of model output: ${ai.text.slice(0, 200)}`)
      }

      const legacy = mapLegacyLabels(row.data?.legacy_tags ?? [])

      await service.from('dataset_row_taxonomy').upsert({
        org_id:           ADMIN_ORG_ID,
        dataset_id:       datasetId,
        row_id:           row.id,
        axis_touchpoint:  result.axis_touchpoint,
        axis_attribute:   result.axis_attribute,
        axis_product:     result.axis_product,
        axis_beverage:    result.axis_beverage,
        axis_ambiance:    result.axis_ambiance,
        axis_context:     result.axis_context,
        axis_outcome:     result.axis_outcome,
        alert_tags:       result.alert_tags,
        assertions:       result.assertions,
        raw_legacy_tags:  legacy.canonical,
        classified_by:    `llm:${result.model_used}`,
        model_used:       result.model_used,
        prompt_version:   result.prompt_version,
      }, { onConflict: 'dataset_id,row_id' })

      processed++
      if (processed % 10 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
        console.log(`  ${processed}/${todo.length}  (${elapsed}s, ${failed} failed)`)
      }
    } catch (e: any) {
      failed++
      console.error(`Row ${row.id} failed: ${e.message ?? e}`)
    }
  }

  // Concurrency pool
  let cursor = 0
  async function worker() {
    while (cursor < todo.length) {
      const myIdx = cursor++
      await classifyOne(todo[myIdx])
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\nDone. ${processed} classified, ${failed} failed in ${elapsed}s.`)
}

main().catch(e => { console.error(e); process.exit(1) })
