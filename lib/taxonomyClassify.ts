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
import { resolveMemberDatasetIds } from './collectionScope'
import { logError } from './log'

export { TAXONOMY_VERSION }

// NUL + C0 control chars (keep tab/newline/CR) - Postgres rejects them in
// and scraped review text occasionally carries control bytes.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF]/g

const PAGE = 1000

/** Embed a batch of field blocks into the rows' data._tx via the RPC (one
 *  UPDATE per batch; the tsv trigger skips the reserved key).
 *
 *  Retries a *transient* failure — chiefly a Postgres statement timeout (57014),
 *  which the 500-row write can cross when the DB is momentarily slow or under
 *  concurrent read load (the whole Dimensions tab fires signal-stats/rows/theme
 *  queries at the same time). apply_taxonomy_verdicts is an idempotent upsert
 *  per (row, fieldKey), so re-applying the same batch is safe — this turns the
 *  user's manual "Try again" into an automatic recovery instead of an HTTP 500. */
async function embedVerdicts(
  service: SupabaseClient,
  datasetId: string,
  fieldKey: string,
  items: { id: number; tx: TaxonomyFieldBlock }[],
): Promise<void> {
  if (!items.length) return
  let lastErr = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await service.rpc('apply_taxonomy_verdicts', {
      p_dataset_id: datasetId, p_field_key: fieldKey, p_items: items,
    })
    if (!error) return
    lastErr = error.message
    const transient = error.code === '57014' || /statement timeout|timeout|connection|ECONNRESET|fetch failed/i.test(error.message)
    if (!transient || attempt === 2) break
    // A statement timeout on a FIXED-size batch tends to repeat — the same
    // 500-row UPDATE is the same statement (Sentry 2026-09-03: ANES classify,
    // 125K rows × very wide blobs, timed out through all three same-size
    // retries). Halve the batch and recurse: two ~4s statements where one
    // ~8s statement died. Idempotent upsert per (row, fieldKey) → safe.
    if (error.code === '57014' || /statement timeout/i.test(error.message)) {
      if (items.length >= 50) {
        const mid = Math.ceil(items.length / 2)
        await embedVerdicts(service, datasetId, fieldKey, items.slice(0, mid))
        await embedVerdicts(service, datasetId, fieldKey, items.slice(mid))
        return
      }
    }
    await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)))
  }
  throw new Error(`apply_taxonomy_verdicts failed: ${lastErr}`)
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
  // A collection owns no rows — classify its MEMBERS' rows, so the verdicts land
  // where the text actually lives. dataset_rows_flat.id is a single global
  // sequence, so the id keyset below spans the members unchanged: one cursor,
  // stable ordering, no per-member bookkeeping for the client to carry.
  const datasetIds = await resolveMemberDatasetIds(service, datasetId)
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
    // A collection pages each member with the SAME `.eq(dataset_id) AND id >
    // cursor` shape and k-way merges the pages here. Widening the predicate to
    // `dataset_id IN (…)` instead loses idx_drf_id_keyset — measured: the
    // planner switched off the keyset index and the page hit the statement
    // timeout on a 15K collection. Merging in JS keeps every query on the index
    // and keeps the cursor a single global id (the ids are one sequence for the
    // whole table), so the route's client contract is unchanged.
    const pages = await Promise.all(datasetIds.map(async id => {
      const { data, error } = await service
        .from('dataset_rows_flat')
        .select('id, dataset_id, data')
        .eq('dataset_id', id)
        .gt('id', cursor)
        .order('id', { ascending: true })
        .limit(pageSize)
      if (error) throw new Error(error.message)
      return (data ?? []) as { id: number; dataset_id: string; data: Record<string, unknown> }[]
    }))
    const merged = pages.length === 1 ? pages[0] : pages.flat().sort((a, b) => a.id - b.id)
    if (merged.length === 0) { reachedEnd = true; break }
    // Anything past the page boundary is simply re-fetched next round — the
    // cursor only ever advances to the last row we actually emitted.
    const truncated = merged.length > pageSize
    const data = truncated ? merged.slice(0, pageSize) : merged
    const membersDrained = pages.every(p => p.length < pageSize)

    // Grouped per member: apply_taxonomy_verdicts writes one dataset at a time.
    const byDataset = new Map<string, { id: number; tx: TaxonomyFieldBlock }[]>()
    let pageItems = 0
    for (const row of data) {
      total++
      // Join multiple fields with ' . ' so a phrase can't span a field boundary.
      const text = fields.map(function(f) { return String(row.data?.[f] ?? '') }).join(' . ').replace(CONTROL_CHARS, '').trim()
      if (!text) { skippedEmpty++; continue }
      const assertions = dict ? classifyByKeyword(text, dict).assertions : []
      const emotion = detectEmotionAssertions(text)
      const bucket = byDataset.get(row.dataset_id) ?? []
      bucket.push({
        id: row.id,
        tx: buildFieldBlock([...assertions, ...emotion], { version: TAXONOMY_VERSION, by: 'keyword', model: 'keyword-tier' }),
      })
      byDataset.set(row.dataset_id, bucket)
      pageItems++
    }
    for (const [memberId, items] of byDataset) {
      for (let i = 0; i < items.length; i += 500) {
        await embedVerdicts(service, memberId, storedField, items.slice(i, i + 500))
      }
    }
    classified += pageItems
    cursor = data[data.length - 1].id
    onProgress?.(classified)

    // End of the scope only when nothing was held back AND every member's page
    // came up short — otherwise there are rows past this cursor.
    if (!truncated && membersDrained) { reachedEnd = true; break }
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
  // A collection's pending rows are its members' pending rows (the pending RPC
  // takes one dataset id, so drain them member by member).
  const datasetIds = await resolveMemberDatasetIds(service, datasetId)
  let classified = 0
  let hasMore = false

  for (const memberId of datasetIds) {
    // Keyset on id (sql/155): without a cursor every iteration re-evaluates the
    // `_tx ? field` predicate — a blob detoast — on every already-classified row
    // before reaching the pending ones. Safe to skip past fetched rows: every
    // fetched row gets a block embedded below (even empty text → tagless block),
    // so nothing behind the cursor is still pending.
    let afterId: number | null = null
    while (classified < maxRows) {
      const pageSize = Math.min(PAGE, maxRows - classified)
      const { data, error } = await service.rpc('dataset_rows_pending_field_taxonomy', {
        p_dataset_id: memberId, p_field_key: fieldKey, p_fields: fields, p_limit: pageSize,
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
        await embedVerdicts(service, memberId, fieldKey, items.slice(i, i + 500))
      }
      classified += rows.length

      if (rows.length < pageSize) break        // drained this member's pending queue
    }
    // Hit the cap; this member (or a later one) may still have pending rows.
    if (classified >= maxRows) { hasMore = true; break }
  }
  // Queue drained with fresh verdicts → the stored rollup is stale; refresh it.
  // (hasMore → the next call finishes the drain and refreshes then.)
  if (classified > 0 && !hasMore) await refreshRollup(service, datasetId, orgId, fieldKey, fields)
  return { classified, hasMore }
}
