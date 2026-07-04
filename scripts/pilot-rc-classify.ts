/* eslint-disable */
// Ruth's Chris taxonomy pilot — classifier driver (AI tier).
//
// Reads dataset_rows_flat for the pilot dataset, runs the extractor from
// lib/taxonomyExtractor.ts on each unclassified row, and embeds the result
// into the row blob (data._tx, sql/151) under the 'description' field key.
// (The row's original Classification column stays available as data.legacy_tags
// — the old sidecar's raw_legacy_tags copy was redundant.)
//
// Run: node_modules/.bin/tsx scripts/pilot-rc-classify.ts [--limit 50] [--concurrency 4] [--dataset-id <uuid>]
//
// Defaults:
//   --limit 50          (sane starter so first invocation is ~$0.30, not ~$240)
//   --concurrency 4     (Haiku is fast enough at 4x parallel without rate-limiting)
//   --dataset-id        defaults to the "Ruth's Chris (pilot) — Google Reviews 2024-2025"
//                       dataset under the Datanautix admin org
//
// Idempotent: rows whose blob already carries a 'description' verdict are
// skipped, so a re-run never burns model spend on already-classified rows.

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
  PROMPT_VERSION,
} from '../lib/taxonomyExtractor'
import { classifyByKeyword, mergeAssertions } from '../lib/taxonomyKeywordMatcher'
import { buildFieldBlock } from '../lib/taxonomyEmbed'
import type { Assertion } from '../lib/taxonomyVocabulary'

// The pilot classifies the RC CSV's review column.
const FIELD_KEY = 'description'

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
type Mode = 'keyword' | 'llm' | 'hybrid'
const mode: Mode = (getFlag('--mode') as Mode | undefined) ?? 'hybrid'
if (!['keyword', 'llm', 'hybrid'].includes(mode)) {
  throw new Error(`Unknown --mode '${mode}'. Use: keyword | llm | hybrid (default).`)
}

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

  // Pull rows, skipping already-classified ones (their blob carries a
  // FIELD_KEY verdict) unless --force. Paged so the skip set can't outgrow a
  // single overfetch.
  if (force) console.log(`--force: ignoring existing verdicts; will overwrite in place`)
  const todo: FlatRow[] = []
  {
    const PAGE = 1000
    let from = 0
    while (todo.length < limit) {
      const { data: rows, error: rowErr } = await service
        .from('dataset_rows_flat')
        .select('id, row_index, data')
        .eq('dataset_id', datasetId)
        .order('row_index', { ascending: true })
        .order('id', { ascending: true })   // stable pages while we UPDATE the same table
        .range(from, from + PAGE - 1)
      if (rowErr) throw rowErr
      if (!rows || rows.length === 0) break
      for (const r of rows as any[]) {
        if (!force && r.data?._tx?.f?.[FIELD_KEY]) continue
        todo.push(r)
        if (todo.length >= limit) break
      }
      if (rows.length < PAGE) break
      from += PAGE
    }
  }
  console.log(`Classifying ${todo.length} rows — mode=${mode}, concurrency=${concurrency}...`)

  let processed = 0
  let failed = 0
  const startTime = Date.now()

  async function classifyOne(row: FlatRow): Promise<void> {
    const text = row.data?.description ?? ''
    if (!text.trim()) {
      // Empty review — embed a no-op block so we don't keep retrying it
      const { error } = await service.rpc('apply_taxonomy_verdicts', {
        p_dataset_id: datasetId, p_field_key: FIELD_KEY,
        p_items: [{ id: row.id, tx: buildFieldBlock([], { version: 'none', by: 'skip:empty-review', model: 'none' }) }],
      })
      if (error) { failed++; console.error(`Row ${row.id} embed failed: ${error.message}`); return }
      processed++
      return
    }

    try {
      // Tier 1 — keyword pass (always run; cheap + deterministic)
      const keywordResult = classifyByKeyword(text)

      let merged: Assertion[] = keywordResult.assertions
      let modelUsed = 'keyword-dictionary'
      let promptVersion: string | null = null
      let classifiedBy = 'keyword'

      if (mode === 'llm' || mode === 'hybrid') {
        const system = buildSystemPrompt()
        const userMsg = buildUserMessage({
          review_text: text,
          review_rating: row.data?.review_rating ?? null,
          legacy_tags: row.data?.legacy_tags ?? [],
        })
        const ai = await callAnthropic(system, userMsg)
        const llmResult = parseExtractorOutput(ai.text, ai.model)
        if (ai.stopReason === 'max_tokens') {
          console.warn(`  row ${row.id}: TRUNCATED at max_tokens — review ${text.length} chars, ${llmResult.assertions.length} assertions parsed`)
        } else if (llmResult.assertions.length === 0 && text.trim().length > 50) {
          console.warn(`  row ${row.id}: 0 LLM assertions on ${text.length}-char review (parse OK, stop=${ai.stopReason}). First 200 chars: ${ai.text.slice(0, 200)}`)
        }

        if (mode === 'llm') {
          merged = llmResult.assertions
          classifiedBy = `llm:${llmResult.model_used}`
        } else {
          merged = mergeAssertions(keywordResult.assertions, llmResult.assertions)
          classifiedBy = `hybrid:${llmResult.model_used}`
        }
        modelUsed = llmResult.model_used
        promptVersion = llmResult.prompt_version
      }

      const { error: embedErr } = await service.rpc('apply_taxonomy_verdicts', {
        p_dataset_id: datasetId, p_field_key: FIELD_KEY,
        p_items: [{
          id: row.id,
          tx: buildFieldBlock(merged, {
            version: promptVersion ?? (mode === 'keyword' ? 'keyword.v1' : PROMPT_VERSION),
            by: classifiedBy,
            model: modelUsed,
          }),
        }],
      })
      if (embedErr) throw new Error(`embed failed: ${embedErr.message}`)

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
