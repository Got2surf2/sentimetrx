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

/** Write each classified row to BOTH taxonomy tables:
 *  - legacy single-field `dataset_row_taxonomy` (read by Charts/Stats `__dim_*`
 *    fields, theme-card / Theme-cloud Dimension chips, the Comments dimension
 *    filter, the Datanautix deck, and the admin viewer) — keyed (dataset_id,row_id),
 *    so the last-classified field wins, exactly as before; and
 *  - per-field `dataset_row_field_taxonomy` (the field-reactive Dimensions tab) —
 *    keyed (dataset_id,row_id,field).
 *  Base rows carry no `field`; the per-field copy adds it. Both pair org_id. */
async function dualUpsert(service: SupabaseClient, baseRows: Record<string, unknown>[], field: string): Promise<void> {
  if (!baseRows.length) return
  const { error: eLegacy } = await service
    .from('dataset_row_taxonomy')
    .upsert(baseRows, { onConflict: 'dataset_id,row_id' })
  if (eLegacy) throw new Error(`dataset_row_taxonomy upsert failed: ${eLegacy.message}`)
  const { error: eField } = await service
    .from('dataset_row_field_taxonomy')
    .upsert(baseRows.map(r => ({ ...r, field })), { onConflict: 'dataset_id,row_id,field' })
  if (eField) throw new Error(`dataset_row_field_taxonomy upsert failed: ${eField.message}`)
}

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
  textField?:  string
  textFields?: string[]  // classify the concatenation of several fields (e.g. a survey's MOST + LEAST verbatims). Takes precedence over textField.
  limit?:     number   // max rows to scan this run (relative to offset)
  offset?:    number   // row offset to start from (default 0)
  onProgress?: (done: number) => void
}): Promise<ClassifyResult> {
  const { service, datasetId, orgId, brand = 'core', textField = 'review_text', textFields, limit, offset = 0, onProgress } = opts
  const dict = resolveDictionary(brand)
  const fields = textFields && textFields.length ? textFields : [textField]
  // The `field` column records which open-ended field these tags came from, so the
  // Dimensions view can show per-field results that react to the ANALYZE toggle.
  const storedField = textFields && textFields.length ? textFields.join(' + ') : textField

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
      // Join multiple fields with ' . ' so a phrase can't span a field boundary.
      const text = fields.map(function(f) { return String(row.data?.[f] ?? '') }).join(' . ').replace(CONTROL_CHARS, '').trim()
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
      const slice = upserts.slice(i, i + 500)
      await dualUpsert(service, slice, storedField)
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
    const { data, error } = await service.rpc('dataset_rows_pending_field_taxonomy', {
      p_dataset_id: datasetId, p_field: textField, p_limit: pageSize,
    })
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as { id: number; data: Record<string, unknown> }[]
    if (rows.length === 0) break

    const upserts: Record<string, unknown>[] = []
    for (const row of rows) {
      const text = String(row.data?.[textField] ?? '').replace(CONTROL_CHARS, '').trim()
      // NB: do NOT skip empties here. The pending RPC already filtered to rows the
      // SQL considers "has text"; a few may be empty after the classifier's JS
      // strip (unicode whitespace etc.). Skipping them left those rows pending
      // FOREVER (the "N rows aren't tagged" nudge could never clear). Writing a
      // (tagless) row converges: classifyByKeyword('') just returns no assertions.
      const { assertions } = classifyByKeyword(text, dict)
      upserts.push({
        org_id: orgId, dataset_id: datasetId, row_id: row.id,
        ...projectAxes(assertions), assertions,
        classified_by: 'keyword', model_used: 'keyword-tier',
        prompt_version: TAXONOMY_VERSION, updated_at: new Date().toISOString(),
      })
    }
    for (let i = 0; i < upserts.length; i += 500) {
      await dualUpsert(service, upserts.slice(i, i + 500), textField)
    }
    classified += rows.length

    if (rows.length < pageSize) break          // drained the pending queue
    if (classified >= maxRows) { hasMore = true; break }  // hit the cap; more remain
  }
  return { classified, hasMore }
}
