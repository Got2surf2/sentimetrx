// lib/sampledFilterOptions.ts
// Filter-modal options over the deterministic 50K sample (sql/168) for the
// filter-options route — where the exact per-field aggregates
// (count_field_values / numeric_field_stats / count_nonempty_rows / the date
// .order probes) are full scans that exceed the DB's 8s statement timeout past
// ~500K rows (the modal never opened on large datasets — perf review §7 Brief B).
//
// One keyset-paged pass over the SAME deterministic sample the bulk rows route
// serves (sql/191 stratified contiguous row_index blocks) returns, per
// field, in a single heap visit per row: non-empty count, distinct values with
// counts (merged across pages, capped 500), numeric min/max, date text min/max.
// Below the 50K cap the walk reaches every row = EXACT; above it callers scale
// the non-empty count to total and label the result sampled (ARCHITECTURE.md D6).

import type { SupabaseClient } from '@supabase/supabase-js'

/** The platform-wide sampling cap — matches the bulk rows route / RowsContext. */
export const FILTER_SAMPLE_CAP = 50000

/** Distinct categorical/open-ended values surfaced per field (matches the
 *  analyzeTypes SchemaFieldConfig.values contract: "up to 500"). */
export const VALUE_LIST_CAP = 500

const PAGE_SIZE = 5000

export interface FilterFieldOption {
  field: string
  type: string
  /** non-empty rows in the sample (unscaled — caller scales when sampled) */
  nonempty: number
  /** numeric min/max over the sample (null for non-numeric or all-blank) */
  min: number | null
  max: number | null
  /** date (text) min/max over the sample (null for non-date or all-blank) */
  dateMin: string | null
  dateMax: string | null
  /** categorical/open-ended distinct values, top-500 by count then a→z; null otherwise */
  values: string[] | null
  /** true when the field's distinct count exceeded 500 (list truncated) */
  valuesCapped: boolean
}

export interface SampledFilterOptions {
  options: Record<string, FilterFieldOption>
  /** rows actually scanned — the scaling denominator (≤ cap) */
  scanned: number
}

interface PageField {
  ord: number
  nonempty: number
  num_min: number | null
  num_max: number | null
  date_min: string | null
  date_max: string | null
  values: { v: string; c: number }[]
  distinct_n: number
}
interface PageResult {
  n_scanned: number
  fields: PageField[]
  last_row_index: number | null
}

interface FieldAcc {
  field: string
  type: string
  nonempty: number
  numMin: number | null
  numMax: number | null
  dateMin: string | null
  dateMax: string | null
  // value -> merged count; only for categorical/open-ended
  valueCounts: Map<string, number> | null
}

/**
 * Page sampled_filter_options (sql/168) up to `cap` rows and accumulate.
 * Throws on any RPC error (including PGRST202 when the function hasn't reached
 * the target database yet) — the route catches and falls back to the legacy
 * per-field path.
 */
export async function sampledFilterOptions(
  service: SupabaseClient,
  datasetId: string,
  fields: { field: string; type: string }[],
  cap: number = FILTER_SAMPLE_CAP,
): Promise<SampledFilterOptions> {
  const acc: FieldAcc[] = fields.map(f => ({
    field: f.field,
    type: f.type,
    nonempty: 0,
    numMin: null,
    numMax: null,
    dateMin: null,
    dateMax: null,
    // Only categorical fields are value-filterable in the modal (open-ended is
    // never a checkbox list) — the RPC only value-counts categorical, so only
    // categorical accumulates a value map.
    valueCounts: f.type === 'categorical' ? new Map<string, number>() : null,
  }))
  // Wire shape the RPC reads: [{field, type}] — ord = index + 1.
  const fieldsPayload = fields.map(f => ({ field: f.field, type: f.type }))

  let scanned = 0
  let afterRowIndex = -1
  while (scanned < cap) {
    const { data, error } = await service.rpc('sampled_filter_options_blocks', {
      p_dataset_id: datasetId,
      p_fields: fieldsPayload,
      p_after_row_index: afterRowIndex,
      p_limit: Math.min(PAGE_SIZE, cap - scanned),
    })
    if (error) throw new Error('sampled_filter_options_blocks failed for ' + datasetId + ': ' + error.message)
    const page = data as PageResult | null
    const n = Number(page?.n_scanned) || 0
    if (!page || n === 0) break // fewer rows than the cap — scanned them all
    scanned += n
    for (const pf of page.fields) {
      const a = acc[pf.ord - 1]
      if (!a) continue
      a.nonempty += Number(pf.nonempty) || 0
      if (pf.num_min != null) a.numMin = a.numMin == null ? Number(pf.num_min) : Math.min(a.numMin, Number(pf.num_min))
      if (pf.num_max != null) a.numMax = a.numMax == null ? Number(pf.num_max) : Math.max(a.numMax, Number(pf.num_max))
      // lexical min/max on ISO date strings
      if (pf.date_min != null) a.dateMin = a.dateMin == null || pf.date_min < a.dateMin ? pf.date_min : a.dateMin
      if (pf.date_max != null) a.dateMax = a.dateMax == null || pf.date_max > a.dateMax ? pf.date_max : a.dateMax
      if (a.valueCounts && Array.isArray(pf.values)) {
        for (const { v, c } of pf.values) {
          a.valueCounts.set(v, (a.valueCounts.get(v) || 0) + (Number(c) || 0))
        }
      }
    }
    if (page.last_row_index == null) break
    const nextRowIndex = Number(page.last_row_index)
    if (nextRowIndex <= afterRowIndex) break   // no forward progress
    afterRowIndex = nextRowIndex
  }

  const options: Record<string, FilterFieldOption> = {}
  for (const a of acc) {
    let values: string[] | null = null
    let valuesCapped = false
    if (a.valueCounts) {
      const distinct = a.valueCounts.size
      valuesCapped = distinct > VALUE_LIST_CAP
      // Keep the top-500 by count (so rare tail is what's dropped), then sort
      // a→z for display — matching the legacy route's `.sort()` on values.
      const entries = Array.from(a.valueCounts.entries())
      const kept = valuesCapped
        ? entries.sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, VALUE_LIST_CAP)
        : entries
      values = kept.map(e => e[0]).sort()
    }
    options[a.field] = {
      field: a.field,
      type: a.type,
      nonempty: a.nonempty,
      min: a.numMin,
      max: a.numMax,
      dateMin: a.dateMin,
      dateMax: a.dateMax,
      values,
      valuesCapped,
    }
  }
  return { options, scanned }
}
