// lib/anaReportContext.ts
//
// Shared Ana data layer: resolve a dataset (or collection), pull a sampled +
// filtered set of rows, and format them for an LLM context. Extracted verbatim
// from app/api/ask-ana so the streaming Q&A route AND the one-shot ad-hoc report
// route load data identically (single source of truth — no drift on sampling,
// filtering, reddit signal selection, or collection budgeting).

import type { createServiceRoleClient } from '@/lib/supabase/server'
import { DEFAULT_SIGNAL_CUTOFFS } from '@/lib/signalTier'
import { formatRowsForContext } from '@/lib/anaContext'
import { logError } from '@/lib/log'
import { applyFilters, deserializeFilters } from '@/lib/filterUtils'
import { isSubstantiveText } from '@/lib/datasetUtils'
import type { SerializedFilters } from '@/lib/filterUtils'
import { SIGNAL_SAMPLE_CAP } from '@/lib/sampledSignalCounts'

type Service = ReturnType<typeof createServiceRoleClient>

export const ANA_CONTEXT_CAP = 500   // absolute max rows sent to the model
export const ANA_DEFAULT_SAMPLE = 200
const FETCH_CAP    = 2000
const MEMBER_FLOOR = 20
const URL_ONLY_RE  = /^(\s*(https?:\/\/\S+)\s*)+$/i

export interface CollectionMember { dataset_id: string; name: string; row_count: number }

export interface AnaSample {
  rows:             Record<string, unknown>[]   // final filtered + sampled rows
  dataContext:      string                       // formatted for the system prompt
  collectionMembers: CollectionMember[]
  totalDatasetRows: number
  /** Rows matching the active filters WITHIN the deterministic ≤50K sample (Model
   *  A — the sample is the view; NOT scaled to the full dataset). Exact when the
   *  whole sample/dataset was scanned; a budget-limited filtered chat scan
   *  estimates the rate over the sample (see totalFilteredIsEstimate). With no
   *  filters, equals the sample size (min of the full row count and the 50K cap). */
  totalFiltered:    number
  /** True when totalFiltered is a rate estimate over the sample (a filtered scan
   *  that stopped at the row budget rather than covering the whole sample) —
   *  callers prefix the number with "~". Always false for the ad-hoc report,
   *  which scans the whole sample (exactSampleCounts). */
  totalFilteredIsEstimate: boolean
  afterSignalCount: number
  sampled:          boolean
  signalNote:       string
}

// ── Per-member budget computation for collections ─────────────────────────
export function computeMemberBudgets(
  members: CollectionMember[],
  totalBudget: number,
  strategy: 'proportional' | 'equal' | 'floor',
): { dataset_id: string; budget: number }[] {
  const totalRows = members.reduce(function(s, m) { return s + m.row_count }, 0)
  if (totalRows === 0) return members.map(function(m) { return { dataset_id: m.dataset_id, budget: 0 } })

  if (strategy === 'equal') {
    const perMember = Math.floor(totalBudget / members.length)
    return members.map(function(m) { return { dataset_id: m.dataset_id, budget: Math.min(perMember, m.row_count) } })
  }

  if (strategy === 'floor') {
    let remaining = totalBudget
    const floors = members.map(function(m) {
      const f = Math.min(MEMBER_FLOOR, m.row_count)
      remaining -= f
      return f
    })
    if (remaining < 0) remaining = 0
    const nonFloorTotal = members.reduce(function(s, m) { return s + Math.max(0, m.row_count - MEMBER_FLOOR) }, 0)
    return members.map(function(m, i) {
      const extra = nonFloorTotal > 0 ? Math.round(Math.max(0, m.row_count - MEMBER_FLOOR) / nonFloorTotal * remaining) : 0
      return { dataset_id: m.dataset_id, budget: Math.min(floors[i] + extra, m.row_count) }
    })
  }

  // Default: proportional
  return members.map(function(m) {
    return { dataset_id: m.dataset_id, budget: Math.min(Math.max(1, Math.round(m.row_count / totalRows * totalBudget)), m.row_count) }
  })
}

// ── Fetch rows from a single dataset, using RPC sampling for large ones ───
export async function fetchDatasetRows(
  service: Service,
  datasetId: string,
  budget: number,
  totalRows: number,
): Promise<Record<string, unknown>[]> {
  if (totalRows <= budget) {
    const rows: Record<string, unknown>[] = []
    const PAGE = 1000
    let offset = 0
    let fetchMore = true
    while (fetchMore) {
      const { data: flatRows, error } = await service
        .from('dataset_rows_flat')
        .select('data')
        .eq('dataset_id', datasetId)
        .order('row_index', { ascending: true })
        .range(offset, offset + PAGE - 1)
      if (error || !flatRows || flatRows.length === 0) break
      for (let i = 0; i < flatRows.length; i++) rows.push((flatRows[i] as { data: Record<string, unknown> }).data)
      if (flatRows.length < PAGE) fetchMore = false
      offset += PAGE
    }
    return rows
  }
  const { data: sampled, error } = await service.rpc('sample_row_pairs', { p_dataset_id: datasetId, p_fields: [], p_limit: budget })
  if (error || !sampled) return []
  return (sampled as { data: Record<string, unknown> }[]).map(function(r) { return r.data })
}

// ── Filter-aware deterministic sampling (sql/167) ──────────────────────────
// Pages the sample order (idx_drf_sample — the SAME deterministic population
// every other sampled surface uses, D6) with the user's filters applied in
// SQL, so selective filters draw from the whole (sampled) population instead
// of starving a tiny filter-blind prefetch. Datasets at/below the scan cap are
// scanned in full = exact filtering; above it, the scan covers the 50K sample.
// Throws on RPC error (incl. PGRST202 before the migration reaches the DB) —
// the caller falls back to the legacy fetch+Node-filter path.

const FILTER_SCAN_PAGE = 5000  // per-statement scan bound (sql/162 sizing)

interface FilteredFetch {
  rows:      Record<string, unknown>[]  // matching rows, deterministic order
  scanned:   number                      // rows examined
  matched:   number                      // matches among scanned (≥ rows.length)
  exhausted: boolean                     // every row of the dataset was examined
}

async function fetchFilteredSampledRows(
  service: Service,
  datasetId: string,
  budget: number,
  totalRows: number,
  filters: SerializedFilters | undefined,
  forceScanToEnd = false,
): Promise<FilteredFetch> {
  const rows: Record<string, unknown>[] = []
  let scanned = 0
  let matched = 0
  let exhausted = false
  let afterHash = -1
  let afterId = -1
  const scanCap = Math.min(Math.max(totalRows, 1), SIGNAL_SAMPLE_CAP)
  // Datasets at/below the cap: keep scanning (match_limit 0, counts only) even
  // after the row budget fills, so totalFiltered is EXACT — every other surface
  // reports exact numbers under the cap and Ana's denominator must reconcile
  // with them (deck credibility). Above the cap the chat path stops as soon as
  // the budget fills (fast); the ad-hoc REPORT passes forceScanToEnd so it scans
  // the whole 50K sample → EXACT counts OVER THE SAMPLE (Model A — "same 50K
  // sample as the app/decks", owner 2026-07-14).
  const countToEnd = forceScanToEnd || totalRows <= SIGNAL_SAMPLE_CAP
  while (scanned < scanCap && (rows.length < budget || countToEnd)) {
    const scanLimit = Math.min(FILTER_SCAN_PAGE, scanCap - scanned)
    const { data, error } = await service.rpc('sampled_filtered_rows', {
      p_dataset_id:  datasetId,
      p_filters:     filters || {},
      p_after_hash:  afterHash,
      p_after_id:    afterId,
      p_scan_limit:  scanLimit,
      p_match_limit: Math.max(0, budget - rows.length),
    })
    if (error) throw new Error('sampled_filtered_rows failed for ' + datasetId + ': ' + error.message)
    const page = data as { n_scanned?: number; n_matched?: number; rows?: Record<string, unknown>[]; last_hash?: number | null; last_id?: number | null } | null
    const n = Number(page?.n_scanned) || 0
    if (!page || n === 0) { exhausted = true; break }        // no rows past the cursor
    scanned += n
    matched += Number(page.n_matched) || 0
    for (const r of page.rows || []) rows.push(r)
    if (n < scanLimit) { exhausted = true; break }           // short page = dataset ends here
    if (page.last_hash == null || page.last_id == null) { exhausted = true; break }
    afterHash = Number(page.last_hash)
    afterId = Number(page.last_id)
  }
  // Scanning the cap on a dataset no bigger than the cap = examined everything.
  if (!exhausted && scanned >= totalRows) exhausted = true
  return { rows, scanned, matched, exhausted }
}

// ── Resolve a collection's members (empty for a single dataset) ───────────
export async function resolveCollectionMembers(service: Service, dataset: { id: string; source: string }): Promise<CollectionMember[]> {
  if (dataset.source !== 'collection') return []
  const { data: col, error: colErr } = await service.from('collections').select('id').eq('dataset_id', dataset.id).single()
  if (colErr) void logError('anaReportContext.resolveCollectionMembers', colErr)
  if (!col) return []
  const { data: mems, error: memsErr } = await service.from('collection_members').select('dataset_id, label, sort_order').eq('collection_id', (col as { id: string }).id).order('sort_order', { ascending: true })
  if (memsErr) void logError('anaReportContext.resolveCollectionMembers', memsErr)
  if (!mems || mems.length === 0) return []
  const memIds = mems.map(function(m) { return (m as { dataset_id: string }).dataset_id })
  const { data: memDs, error: memDsErr } = await service.from('datasets').select('id, name, row_count').in('id', memIds)
  if (memDsErr) void logError('anaReportContext.resolveCollectionMembers', memDsErr)
  const dsMap: Record<string, { name: string; row_count: number }> = {}
  if (memDs) (memDs as { id: string; name: string; row_count: number }[]).forEach(function(d) { dsMap[d.id] = { name: d.name, row_count: d.row_count || 0 } })
  return (mems as { dataset_id: string; label: string | null }[]).map(function(m) {
    const info = dsMap[m.dataset_id] || { name: m.label || 'Unknown', row_count: 0 }
    return { dataset_id: m.dataset_id, name: m.label || info.name, row_count: info.row_count }
  })
}

/**
 * Load a sampled + filtered + formatted row set for a dataset/collection — the
 * exact pipeline ask-ana uses, so both routes see the same data.
 */
export async function loadAnaSample(opts: {
  service: Service
  dataset: { id: string; name: string; source: string; row_count: number | null }
  sampleSize?: number
  samplingStrategy?: 'proportional' | 'equal' | 'floor'
  filters?: SerializedFilters
  collectionMembers?: CollectionMember[]   // pass if already resolved (avoids a re-query)
  /** Scan the WHOLE 50K sample (not just until the row budget fills) so the
   *  reported denominators are EXACT counts over the deterministic sample —
   *  Model A. Costs ~10 RPC pages on a large dataset, so it's for the one-shot
   *  ad-hoc report, not the interactive chat (which keeps its fast budget scan
   *  but still reports sample-based numbers). */
  exactSampleCounts?: boolean
}): Promise<AnaSample> {
  const { service, dataset, filters } = opts
  const exactSampleCounts = !!opts.exactSampleCounts
  const sampleSize = Math.max(50, Math.min(opts.sampleSize || ANA_DEFAULT_SAMPLE, ANA_CONTEXT_CAP))
  const samplingStrategy = opts.samplingStrategy || 'proportional'
  const collectionMembers = opts.collectionMembers ?? await resolveCollectionMembers(service, dataset)

  const fetchBudget = Math.min(sampleSize * 3, FETCH_CAP)
  const totalDatasetRows = dataset.source === 'collection'
    ? collectionMembers.reduce(function(s, m) { return s + m.row_count }, 0)
    : (dataset.row_count || 0)

  const activeFilters = filters && Object.keys(filters).length > 0 ? filters : undefined

  // Fetch one dataset's MATCHING rows. Small datasets load fully and filter in
  // Node via the canonical applyFilters (exact — and, unlike the pre-sql/167
  // inline filter, honors cat exclude-mode and daterange). Larger ones use the
  // filter-aware sampled RPC so selective filters draw from the whole
  // (deterministically sampled) population instead of starving a filter-blind
  // prefetch; on RPC error (incl. PGRST202 before sql/167 reaches the DB) it
  // falls back to the legacy fetch + Node filter — pre-167 behavior.
  async function fetchMember(dsId: string, budget: number, memberTotal: number): Promise<FilteredFetch> {
    if (memberTotal <= budget) {
      const all = await fetchDatasetRows(service, dsId, budget, memberTotal)
      const kept = activeFilters ? applyFilters(all, deserializeFilters(activeFilters)) : all
      return { rows: kept, scanned: all.length, matched: kept.length, exhausted: true }
    }
    try {
      return await fetchFilteredSampledRows(service, dsId, budget, memberTotal, activeFilters, exactSampleCounts)
    } catch (e) {
      void logError('anaReportContext.filteredSample', e, { datasetId: dsId })
      const fetched = await fetchDatasetRows(service, dsId, budget, memberTotal)
      const kept = activeFilters ? applyFilters(fetched, deserializeFilters(activeFilters)) : fetched
      return { rows: kept, scanned: fetched.length, matched: kept.length, exhausted: false }
    }
  }

  let filteredRows: Record<string, unknown>[] = []
  let scannedSum = 0
  let matchedSum = 0
  let allExhausted = true

  if (dataset.source === 'collection' && collectionMembers.length > 0) {
    const budgets = computeMemberBudgets(collectionMembers, fetchBudget, samplingStrategy)
    for (const b of budgets) {
      if (b.budget <= 0) continue
      const memberInfo = collectionMembers.find(function(m) { return m.dataset_id === b.dataset_id })
      const res = await fetchMember(b.dataset_id, b.budget, memberInfo ? memberInfo.row_count : 0)
      for (let i = 0; i < res.rows.length; i++) filteredRows.push(res.rows[i])
      scannedSum += res.scanned
      matchedSum += res.matched
      if (!res.exhausted) allExhausted = false
    }
  } else {
    const res = await fetchMember(dataset.id, fetchBudget, dataset.row_count || 0)
    filteredRows = res.rows
    scannedSum = res.scanned
    matchedSum = res.matched
    allExhausted = res.exhausted
  }

  // Model A (owner 2026-07-14): the deterministic ≤50K sample IS the view — the
  // report's denominators are counts OVER THAT SAMPLE, never scaled up to the
  // full dataset. sampleBase = the sample size (min of the full row count and
  // the 50K cap); totalDatasetRows stays as full-dataset context in the note.
  // The count is EXACT when the whole sample (or whole small dataset) was
  // scanned; a filtered chat scan that stopped at the row budget estimates the
  // match rate over the sample (flagged "~").
  const sampleBase = totalDatasetRows > 0 ? Math.min(totalDatasetRows, SIGNAL_SAMPLE_CAP) : scannedSum
  const scannedWholeSample = allExhausted || (sampleBase > 0 && scannedSum >= sampleBase)
  const populationFiltered = !activeFilters
    ? sampleBase
    : scannedWholeSample
      ? matchedSum
      : scannedSum > 0 ? Math.round((matchedSum / scannedSum) * sampleBase) : 0
  const totalFilteredIsEstimate = !!activeFilters && !scannedWholeSample

  // Drop URL-only rows for text sources
  if (dataset.source === 'reddit' || dataset.source === 'substack' || dataset.source === 'google_reviews') {
    filteredRows = filteredRows.filter(function(r) {
      const text = String(r.body || r.user_message || r.review_text || '').trim()
      return text && !URL_ONLY_RE.test(text)
    })
  }

  const fetchedFilteredCount = filteredRows.length  // matching rows actually in hand
  let signalNote = ''

  // Reddit: vote-weighted signal selection
  if (dataset.source === 'reddit' && filteredRows.length > 0) {
    const NOISE_CUTOFF = DEFAULT_SIGNAL_CUTOFFS.noise
    const threads: Record<string, { score: number; row: Record<string, unknown> }[]> = {}
    filteredRows.forEach(function(r) {
      const tid = String(r.thread_id || 'unknown')
      if (!threads[tid]) threads[tid] = []
      threads[tid].push({ score: Number(r.score) || 0, row: r })
    })
    const signalRows: Record<string, unknown>[] = []
    Object.values(threads).forEach(function(entries) {
      const sorted = [...entries].sort(function(a, b) { return b.score - a.score })
      const count = sorted.length
      sorted.forEach(function(entry, rank) {
        const percentile = count > 1 ? Math.round((1 - rank / (count - 1)) * 100) : 50
        if (percentile >= NOISE_CUTOFF && entry.score >= 0) signalRows.push(entry.row)
      })
    })
    if (signalRows.length >= 10) {
      filteredRows = signalRows
      signalNote = '\n\nNote: Only mainstream and controversial comments are included (top ' + (100 - NOISE_CUTOFF) + '% by score within each thread). ' + (fetchedFilteredCount - signalRows.length) + ' noise/fringe comments excluded.'
    }
  }

  const afterSignalCount = filteredRows.length
  // Sampled if we truncate here OR the fetch itself drew from a sample of a
  // larger (or larger-than-scanned) population.
  let sampled = !allExhausted || totalDatasetRows > scannedSum
  if (filteredRows.length > sampleSize) {
    const shuffle = function(arr: Record<string, unknown>[]) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp
      }
      return arr
    }
    // Substantive lens: prefer comments carrying usable feedback so Ana reasons
    // over real answers, not "N/A"/"Nothing". Mirrors the stored per-comment flag
    // (isSubstantiveText over the row's fields). Non-substantive rows are a tail,
    // not dropped — a sparse-feedback dataset still fills the sample.
    const isSubstantiveRow = function(r: Record<string, unknown>) {
      for (const k in r) { if (!k.startsWith('_') && isSubstantiveText(String(r[k] ?? ''))) return true }
      return false
    }
    const substantive: Record<string, unknown>[] = []
    const other: Record<string, unknown>[] = []
    for (const r of filteredRows) (isSubstantiveRow(r) ? substantive : other).push(r)
    filteredRows = [...shuffle(substantive), ...shuffle(other)].slice(0, sampleSize)
    if (other.length > 0) {
      signalNote += '\n\nNote: the sample prioritizes substantive comments — ' + substantive.length.toLocaleString() + ' of the ' + afterSignalCount.toLocaleString() + ' matching rows carry real feedback; "N/A"/"Nothing"/one-word non-answers fill in only if space remains.'
    }
    sampled = true
  }

  return {
    rows: filteredRows,
    dataContext: formatRowsForContext(filteredRows, dataset.source),
    collectionMembers,
    totalDatasetRows,
    totalFiltered: populationFiltered,
    totalFilteredIsEstimate,
    afterSignalCount,
    sampled,
    signalNote,
  }
}
