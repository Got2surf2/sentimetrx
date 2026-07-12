// lib/taxonomyClassify.ts
// Persisting keyword-tier classifier — runs the layered dictionary over a
// dataset's rows and embeds the per-row 7-axis result into the row blob
// (dataset_rows_flat.data._tx, sql/151) via the apply_taxonomy_verdicts RPC.
// Free (no AI), deterministic, idempotent per (row, fieldKey) — a re-run
// overwrites the field's block in place (no version history by design).
// Used by scripts/taxonomy-classify.ts, the self-serve taxonomy route, and the
// reviewSync auto-classify safety net. When a run completes, the per-field
// rollup in dataset_state.analytics.taxonomy is recomputed so dashboards read
// stored aggregates instead of scanning blobs.

import type { SupabaseClient } from '@supabase/supabase-js'
import { classifyByKeyword } from './taxonomyKeywordMatcher'
import { detectEmotionAssertions } from './emotionFlags'
import { resolveDictionary, type BrandOverlay } from './taxonomyDictionary'
import { buildFieldBlock, TAXONOMY_VERSION, type TaxonomyFieldBlock } from './taxonomyEmbed'
import { updateStoredTaxonomyRollup } from './taxonomyRollup'
import { taxonomyFieldKey } from './dimensionFields'
import { logError } from './log'

export { TAXONOMY_VERSION }

// NUL + C0 control chars (keep tab/newline/CR) - Postgres rejects them in
// and scraped review text occasionally carries control bytes.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF]/g

const PAGE = 1000

/** Embed a batch of field blocks into the rows' data._tx via the RPC (one
 *  UPDATE per batch; the tsv trigger skips the reserved key). */
async function embedVerdicts(
  service: SupabaseClient,
  datasetId: string,
  fieldKey: string,
  items: { id: number; tx: TaxonomyFieldBlock }[],
): Promise<void> {
  if (!items.length) return
  const { error } = await service.rpc('apply_taxonomy_verdicts', {
    p_dataset_id: datasetId, p_field_key: fieldKey, p_items: items,
  })
  if (error) throw new Error(`apply_taxonomy_verdicts failed: ${error.message}`)
}

/** Recompute + store the field's rollup after a completed run. Non-fatal: a
 *  rollup hiccup must not fail the classify itself (the verdicts are already
 *  embedded; the next completed run repairs the rollup). */
async function refreshRollup(
  service: SupabaseClient,
  datasetId: string,
  orgId: string,
  fieldKey: string,
  selFields: string[],
): Promise<void> {
  try {
    await updateStoredTaxonomyRollup({ service, datasetId, orgId, field: fieldKey, selFields })
  } catch (e) {
    void logError('taxonomyClassify.refreshRollup', e, { orgId })
  }
}

export interface ClassifyResult {
  classified:  number
  skippedEmpty: number
  total:       number  // rows scanned this run
  nextOffset:  number  // id cursor to resume from (exclusive; for chunked / resumable runs)
  reachedEnd:  boolean // true when the dataset's last row was scanned this run
}

// 'full' = restaurant ABSA dictionary + emotion axis (google-reviews datasets /
// restaurant orgs). 'emotion' = emotion-language axis ONLY — the universal tier
// for every other dataset, where restaurant menu vocabulary would be invented
// taxonomy. Mode is decided SERVER-SIDE by the taxonomy route, never the client.
export type ClassifyMode = 'full' | 'emotion'

export async function classifyDatasetKeyword(opts: {
  service:    SupabaseClient
  datasetId:  string
  orgId:      string
  brand?:     BrandOverlay
  mode?:      ClassifyMode
  textField?:  string
  textFields?: string[]  // classify the concatenation of several fields (e.g. a survey's MOST + LEAST verbatims). Takes precedence over textField.
  limit?:     number   // max rows to scan this run (relative to offset)
  offset?:    number   // id cursor to resume from (exclusive; default 0 = start)
  onProgress?: (done: number) => void
}): Promise<ClassifyResult> {
  const { service, datasetId, orgId, brand = 'core', mode = 'full', textField = 'review_text', textFields, limit, offset = 0, onProgress } = opts
  const dict = mode === 'full' ? resolveDictionary(brand) : null
  const fields = textFields && textFields.length ? textFields : [textField]
  // The fieldKey records which open-ended field(s) these tags came from (the
  // canonical combined key), so the Dimensions view can show per-field results
  // that react to the ANALYZE selection (single or multi-field).
  const storedField = taxonomyFieldKey(fields)

  let cursor = offset, classified = 0, skippedEmpty = 0, total = 0, reachedEnd = false
  for (;;) {
    const remaining = limit !== undefined ? limit - total : Infinity
    if (remaining <= 0) break
    const pageSize = Math.min(PAGE, remaining)
    // Keyset on id (not OFFSET): classify UPDATEs the very table it's paging
    // (the embed write moves tuples), so an OFFSET window can repeat/skip rows
    // mid-run — and each OFFSET page re-skips from row 0. id is immutable, so
    // `id > cursor` pages are stable — and O(page) each ONLY via
    // idx_drf_id_keyset (dataset_id, id), sql/165: without it the planner
    // walked the PK filtering dataset_id per row, which blew the 8s statement
    // timeout past ~1M total rows (Sentry NEXTJS-H, 785K scale test).
    const { data, error } = await service
      .from('dataset_rows_flat')
      .select('id, data')
      .eq('dataset_id', datasetId)
      .gt('id', cursor)
      .order('id', { ascending: true })
      .limit(pageSize)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) { reachedEnd = true; break }

    const items: { id: number; tx: TaxonomyFieldBlock }[] = []
    for (const row of data as { id: number; data: Record<string, unknown> }[]) {
      total++
      // Join multiple fields with ' . ' so a phrase can't span a field boundary.
      const text = fields.map(function(f) { return String(row.data?.[f] ?? '') }).join(' . ').replace(CONTROL_CHARS, '').trim()
      if (!text) { skippedEmpty++; continue }
      const assertions = dict ? classifyByKeyword(text, dict).assertions : []
      const emotion = detectEmotionAssertions(text)
      items.push({
        id: row.id,
        tx: buildFieldBlock([...assertions, ...emotion], { version: TAXONOMY_VERSION, by: 'keyword', model: 'keyword-tier' }),
      })
    }
    for (let i = 0; i < items.length; i += 500) {
      await embedVerdicts(service, datasetId, storedField, items.slice(i, i + 500))
    }
    classified += items.length
    cursor = (data[data.length - 1] as { id: number }).id
    onProgress?.(classified)

    if (data.length < pageSize) { reachedEnd = true; break }
  }
  // A completed pass over the dataset's last row means the embedded verdicts
  // are current end-to-end → refresh the stored rollup dashboards read.
  if (reachedEnd) await refreshRollup(service, datasetId, orgId, storedField, fields)
  return { classified, skippedEmpty, total, nextOffset: cursor, reachedEnd }
}

// Classify ONLY the rows that still lack an embedded verdict for the field key —
// the auto-classify "safety net". Used after a review sync (lib/reviewSync) so
// newly synced reviews get tagged without a full re-classify. Reads pending rows
// via the dataset_rows_pending_field_taxonomy RPC (text-bearing + unclassified),
// classifies them with the keyword tier, and embeds. Capped per call (maxRows);
// leftover pending rows are picked up by the next sync — converges. Idempotent:
// a timeout mid-run just leaves the already-embedded rows classified.
export async function classifyPendingRows(opts: {
  service:    SupabaseClient
  datasetId:  string
  orgId:      string
  textFields: string[]   // the open-ended field(s) being analyzed; combined into one classification
  brand?:     BrandOverlay
  mode?:      ClassifyMode
  maxRows?:   number
}): Promise<{ classified: number; hasMore: boolean }> {
  const { service, datasetId, orgId, textFields, brand = 'core', mode = 'full', maxRows = 10000 } = opts
  const fields = textFields && textFields.length ? textFields : ['review_text']
  const fieldKey = taxonomyFieldKey(fields)   // combined key the blocks are stored under
  const dict = mode === 'full' ? resolveDictionary(brand) : null
  let classified = 0
  let hasMore = false

  // Keyset on id (sql/155): without a cursor every iteration re-evaluates the
  // `_tx ? field` predicate — a blob detoast — on every already-classified row
  // before reaching the pending ones. Safe to skip past fetched rows: every
  // fetched row gets a block embedded below (even empty text → tagless block),
  // so nothing behind the cursor is still pending.
  let afterId: number | null = null
  while (classified < maxRows) {
    const pageSize = Math.min(PAGE, maxRows - classified)
    const { data, error } = await service.rpc('dataset_rows_pending_field_taxonomy', {
      p_dataset_id: datasetId, p_field_key: fieldKey, p_fields: fields, p_limit: pageSize,
      p_after_id: afterId,
    })
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as { id: number; data: Record<string, unknown> }[]
    if (rows.length === 0) break
    afterId = rows[rows.length - 1].id

    const items: { id: number; tx: TaxonomyFieldBlock }[] = []
    for (const row of rows) {
      // Concatenate the selected fields' text (matches classifyDatasetKeyword); ' . '
      // separator keeps a phrase from spanning a field boundary.
      const text = fields.map(function(f) { return String(row.data?.[f] ?? '') }).join(' . ').replace(CONTROL_CHARS, '').trim()
      // NB: do NOT skip empties here. The pending RPC already filtered to rows the
      // SQL considers "has text"; a few may be empty after the classifier's JS
      // strip (unicode whitespace etc.). Skipping them left those rows pending
      // FOREVER (the "N rows aren't tagged" nudge could never clear). Writing a
      // (tagless) block converges: classifyByKeyword('') just returns no assertions.
      const assertions = dict ? classifyByKeyword(text, dict).assertions : []
      const emotion = detectEmotionAssertions(text)
      items.push({
        id: row.id,
        tx: buildFieldBlock([...assertions, ...emotion], { version: TAXONOMY_VERSION, by: 'keyword', model: 'keyword-tier' }),
      })
    }
    for (let i = 0; i < items.length; i += 500) {
      await embedVerdicts(service, datasetId, fieldKey, items.slice(i, i + 500))
    }
    classified += rows.length

    if (rows.length < pageSize) break          // drained the pending queue
    if (classified >= maxRows) { hasMore = true; break }  // hit the cap; more remain
  }
  // Queue drained with fresh verdicts → the stored rollup is stale; refresh it.
  // (hasMore → the next call finishes the drain and refreshes then.)
  if (classified > 0 && !hasMore) await refreshRollup(service, datasetId, orgId, fieldKey, fields)
  return { classified, hasMore }
}
