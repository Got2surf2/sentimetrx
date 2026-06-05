// lib/taxonomyClassify.ts
// Persisting keyword-tier classifier — runs the layered dictionary over a
// dataset's rows and upserts the per-row 7-axis result into
// dataset_row_taxonomy. Free (no AI), deterministic, idempotent on
// (dataset_id, row_id). Used by scripts/taxonomy-classify.ts and any future
// ingest hook. Pairs (dataset_id, org_id) on every write per the multi-tenancy
// invariant; caller passes the dataset's verified org_id.

import type { SupabaseClient } from '@supabase/supabase-js'
import { classifyByKeyword } from './taxonomyKeywordMatcher'
import { resolveDictionary, type BrandOverlay } from './taxonomyDictionary'
import type { Assertion } from './taxonomyVocabulary'

// Bump when the closed vocabulary / dictionary changes so stale rows are
// detectable (mirrors the productization plan's taxonomy_version).
export const TAXONOMY_VERSION = 'v2'  // v2: hair + foreign-object cadre in food-safety dict

const AXES = ['touchpoint', 'attribute', 'product', 'beverage', 'ambiance', 'context', 'outcome'] as const
const ALERT_SEVERITIES = new Set(['alert', 'crisis'])
// NUL + C0 control chars (keep tab/newline/CR) - Postgres rejects them in
// and scraped review text occasionally carries control bytes.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF]/g

/** Denormalize assertions into the table's per-axis text[] columns + alert_tags. */
function projectAxes(assertions: Assertion[]) {
  const byAxis: Record<string, Set<string>> = Object.fromEntries(AXES.map(a => [a, new Set<string>()]))
  const alerts = new Set<string>()
  for (const a of assertions) {
    if (byAxis[a.axis]) byAxis[a.axis].add(a.sub)
    if (ALERT_SEVERITIES.has(a.severity)) alerts.add(a.sub)
  }
  return {
    axis_touchpoint: [...byAxis.touchpoint].sort(),
    axis_attribute:  [...byAxis.attribute].sort(),
    axis_product:    [...byAxis.product].sort(),
    axis_beverage:   [...byAxis.beverage].sort(),
    axis_ambiance:   [...byAxis.ambiance].sort(),
    axis_context:    [...byAxis.context].sort(),
    axis_outcome:    [...byAxis.outcome].sort(),
    alert_tags:      [...alerts].sort(),
  }
}

const PAGE = 1000

export interface ClassifyResult {
  classified:  number
  skippedEmpty: number
  total:       number  // rows scanned this run
  nextOffset:  number  // row offset to resume from (for chunked / resumable runs)
  reachedEnd:  boolean // true when the dataset's last row was scanned this run
}

export async function classifyDatasetKeyword(opts: {
  service:    SupabaseClient
  datasetId:  string
  orgId:      string
  brand?:     BrandOverlay
  textField?: string
  limit?:     number   // max rows to scan this run (relative to offset)
  offset?:    number   // row offset to start from (default 0)
  onProgress?: (done: number) => void
}): Promise<ClassifyResult> {
  const { service, datasetId, orgId, brand = 'core', textField = 'review_text', limit, offset = 0, onProgress } = opts
  const dict = resolveDictionary(brand)

  let from = offset, classified = 0, skippedEmpty = 0, total = 0, reachedEnd = false
  for (;;) {
    const remaining = limit !== undefined ? limit - total : Infinity
    if (remaining <= 0) break
    const pageSize = Math.min(PAGE, remaining)
    const { data, error } = await service
      .from('dataset_rows_flat')
      .select('id, data')
      .eq('dataset_id', datasetId)
      .order('row_index', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) { reachedEnd = true; break }

    const upserts: Record<string, unknown>[] = []
    for (const row of data as { id: number; data: Record<string, unknown> }[]) {
      total++
      const text = String(row.data?.[textField] ?? '').replace(CONTROL_CHARS, '').trim()
      if (!text) { skippedEmpty++; continue }
      const { assertions } = classifyByKeyword(text, dict)
      upserts.push({
        org_id: orgId,
        dataset_id: datasetId,
        row_id: row.id,
        ...projectAxes(assertions),
        assertions,
        classified_by: 'keyword',
        model_used: 'keyword-tier',
        prompt_version: TAXONOMY_VERSION,
        updated_at: new Date().toISOString(),
      })
    }
    for (let i = 0; i < upserts.length; i += 500) {
      const { error: e } = await service
        .from('dataset_row_taxonomy')
        .upsert(upserts.slice(i, i + 500), { onConflict: 'dataset_id,row_id' })
      if (e) throw new Error(`dataset_row_taxonomy upsert failed: ${e.message}`)
    }
    classified += upserts.length
    from += data.length
    onProgress?.(classified)

    if (data.length < pageSize) { reachedEnd = true; break }
  }
  return { classified, skippedEmpty, total, nextOffset: from, reachedEnd }
}

// Classify ONLY the rows that still lack a dataset_row_taxonomy entry — the
// auto-classify "safety net". Used after a review sync (lib/reviewSync) so newly
// synced reviews get tagged without a full re-classify. Reads pending rows via
// the dataset_rows_pending_taxonomy RPC (text-bearing + unclassified), classifies
// them with the keyword tier, and upserts. Capped per call (maxRows); leftover
// pending rows are picked up by the next sync — converges. Idempotent: a timeout
// mid-run just leaves the already-upserted rows classified.
export async function classifyPendingRows(opts: {
  service:    SupabaseClient
  datasetId:  string
  orgId:      string
  textField?: string
  brand?:     BrandOverlay
  maxRows?:   number
}): Promise<{ classified: number; hasMore: boolean }> {
  const { service, datasetId, orgId, textField = 'review_text', brand = 'core', maxRows = 10000 } = opts
  const dict = resolveDictionary(brand)
  let classified = 0
  let hasMore = false

  while (classified < maxRows) {
    const pageSize = Math.min(PAGE, maxRows - classified)
    const { data, error } = await service.rpc('dataset_rows_pending_taxonomy', {
      p_dataset_id: datasetId, p_text_field: textField, p_limit: pageSize,
    })
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as { id: number; data: Record<string, unknown> }[]
    if (rows.length === 0) break

    const upserts: Record<string, unknown>[] = []
    for (const row of rows) {
      const text = String(row.data?.[textField] ?? '').replace(CONTROL_CHARS, '').trim()
      if (!text) continue  // RPC already excludes these, but guard anyway
      const { assertions } = classifyByKeyword(text, dict)
      upserts.push({
        org_id: orgId, dataset_id: datasetId, row_id: row.id,
        ...projectAxes(assertions), assertions,
        classified_by: 'keyword', model_used: 'keyword-tier',
        prompt_version: TAXONOMY_VERSION, updated_at: new Date().toISOString(),
      })
    }
    for (let i = 0; i < upserts.length; i += 500) {
      const { error: e } = await service
        .from('dataset_row_taxonomy')
        .upsert(upserts.slice(i, i + 500), { onConflict: 'dataset_id,row_id' })
      if (e) throw new Error(`dataset_row_taxonomy upsert failed: ${e.message}`)
    }
    classified += rows.length

    if (rows.length < pageSize) break          // drained the pending queue
    if (classified >= maxRows) { hasMore = true; break }  // hit the cap; more remain
  }
  return { classified, hasMore }
}
