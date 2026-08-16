// lib/sampledAggregate.ts
// Sampled twins of the /aggregate scalar ops (Brief C, PERFORMANCE_REVIEW.md §7).
// Above the 50K cap the exact crosstab_counts / group_numeric_stats /
// date_series_stats / count_field_values / numeric_field_stats RPCs are O(N)
// jsonb scans that 57014 at ~1M rows. Each here keyset-pages the deterministic
// 50K sample (sql/191 stratified blocks, the *_blocks twins — the SAME sample the bulk rows
// route serves and sampled_signal_counts counts over) so charts agree with the
// client-side tiles, then:
//   * scales COUNTS by total/scanned (an estimate of the full-dataset count)
//   * reports means / medians / stddev UNSCALED (a uniform sample's mean/quantile
//     is a direct estimate of the population value — scaling them is wrong)
// Each returns the SAME row shape as its exact RPC so the aggregate route
// reshapes both paths through one code path. p_row_ids narrows the numerators
// (a filtered above-cap view) without touching the sample-walk denominator.
//
// Mirrors lib/sampledSignalCounts.ts (shared keyset-page loop, 5000-row pages
// to stay under the 8s statement timeout).

import type { SupabaseClient } from '@supabase/supabase-js'
import { scaleSampledCount, SIGNAL_SAMPLE_CAP, SAMPLE_BLOCKS } from '@/lib/sampledSignalCounts'

/** Sampling cap — the platform-wide 50K, shared with the bulk rows route. */
export const AGG_SAMPLE_CAP = SIGNAL_SAMPLE_CAP
export { SAMPLE_BLOCKS }

const PAGE_SIZE = 5000

export interface PageBase { n_scanned?: number; last_row_index?: number | null }

/**
 * Shared keyset pager. Calls `rpc` with the cursor + page limit + row-id
 * filter, hands each parsed page to `onPage`, returns the total rows scanned
 * (the scaling denominator). Throws on any RPC error — including PGRST202 when
 * the twin hasn't reached the target DB yet — so the route falls back to the
 * exact RPC (pre-sql/169 behavior). Shared with lib/sampledTaxonomy.ts and
 * lib/sampledThemeExtras.ts — `staticArgs` carries the op-specific params
 * (incl. p_field_key for the tax twins).
 *
 * sql/191: pages the STRATIFIED BLOCK sample (`<name>_blocks`), not the hash
 * sample. One `row_index` cursor replaces the (hash, id) pair — the block set
 * is walked in row_index order, so a single scalar is a complete cursor. The
 * caller passes the already-suffixed rpc name; both families exist in the DB
 * during the deploy window, and they select DIFFERENT ROWS, so a caller must
 * never mix them within one screen.
 */
export async function pageSample(
  service: SupabaseClient,
  datasetId: string,
  rpc: string,
  staticArgs: Record<string, unknown>,
  rowIds: number[] | null,
  onPage: (page: PageBase & Record<string, unknown>) => void,
  cap: number,
): Promise<number> {
  let scanned = 0
  let afterRowIndex = -1        // -1 starts before row_index 0
  while (scanned < cap) {
    const { data, error } = await service.rpc(rpc, {
      p_dataset_id: datasetId,
      ...staticArgs,
      p_after_row_index: afterRowIndex,
      p_limit: Math.min(PAGE_SIZE, cap - scanned),
      p_cap: cap,
      p_blocks: SAMPLE_BLOCKS,
      // Only send p_row_ids when filtering — twins that don't take it (the
      // theme-extras pagers, sql/173) would otherwise fail the overload lookup;
      // the sql/169/171 twins default it to NULL, so omitting when null is equivalent.
      ...(rowIds != null ? { p_row_ids: rowIds } : null),
    })
    if (error) throw new Error(rpc + ' failed for ' + datasetId + ': ' + error.message)
    const page = data as (PageBase & Record<string, unknown>) | null
    const n = Number(page?.n_scanned) || 0
    if (!page || n === 0) break // fewer rows than the cap — scanned them all
    scanned += n
    onPage(page)
    if (page.last_row_index == null) break
    const next = Number(page.last_row_index)
    if (next <= afterRowIndex) break   // no forward progress — never spin
    afterRowIndex = next
  }
  return scanned
}

export function median(sorted: number[]): number | null {
  const n = sorted.length
  if (!n) return null
  const m = Math.floor(n / 2)
  return n % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2
}

/** Linear-interpolated percentile over a sorted array (percentile_cont parity). */
export function percentileCont(sorted: number[], p: number): number | null {
  const n = sorted.length
  if (!n) return null
  if (n === 1) return sorted[0]
  const rank = p * (n - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo)
}

/** Sample standard deviation (stddev_samp parity) — NULL when n < 2. */
export function stddevSamp(vals: number[]): number | null {
  const n = vals.length
  if (n < 2) return null
  const mean = vals.reduce((a, b) => a + b, 0) / n
  const ss = vals.reduce((a, b) => a + (b - mean) * (b - mean), 0)
  return Math.sqrt(ss / (n - 1))
}

// ── Row shapes matching the exact RPCs (so the route reshapes one way) ──
export interface CrosstabRow { row_val: string; col_val: string | null; cnt: number }
export interface GroupStatsRow { group_val: string; n: number; avg_val: number; median_val: number; min_val: number; max_val: number; stddev_val: number | null }
export interface DateSeriesRow { bucket_date: string; n: number; avg_val: number | null }
export interface FieldCountRow { value: string; count: number }
export interface NumericStatsRow { n: number; min_val: number | null; max_val: number | null; avg_val: number | null; median_val: number | null; stddev_val: number | null }

export interface Sampled<T> { rows: T; scanned: number }

// 1. crosstab ---------------------------------------------------------------
export async function sampledCrosstabCounts(
  service: SupabaseClient, datasetId: string, rowField: string, colField: string,
  limit: number, total: number, rowIds: number[] | null, cap = AGG_SAMPLE_CAP,
): Promise<Sampled<CrosstabRow[]>> {
  const cells = new Map<string, number>() // key = row_val \u0000 col_val
  const scanned = await pageSample(service, datasetId, 'sampled_crosstab_counts_blocks',
    { p_row_field: rowField, p_col_field: colField }, rowIds,
    page => {
      for (const g of (page.groups as [string, string, number][] | undefined) || []) {
        const k = g[0] + '\u0000' + g[1]
        cells.set(k, (cells.get(k) || 0) + Number(g[2]))
      }
    }, cap)
  const pairs = Array.from(cells, ([k, n]) => {
    const i = k.indexOf('\u0000')
    return { row_val: k.slice(0, i), col_val: k.slice(i + 1), cnt: scaleSampledCount(n, total, scanned) }
  })
  pairs.sort((a, b) => b.cnt - a.cnt)
  return { rows: pairs.slice(0, limit * limit), scanned }
}

// 2. group numeric stats ----------------------------------------------------
export async function sampledGroupNumericStats(
  service: SupabaseClient, datasetId: string, groupField: string, valueField: string,
  total: number, rowIds: number[] | null, cap = AGG_SAMPLE_CAP,
): Promise<Sampled<GroupStatsRow[]>> {
  const byGroup = new Map<string, number[]>()
  const scanned = await pageSample(service, datasetId, 'sampled_group_numeric_stats_blocks',
    { p_group_field: groupField, p_value_field: valueField }, rowIds,
    page => {
      for (const v of (page.vals as [string, number][] | undefined) || []) {
        const arr = byGroup.get(v[0]) || byGroup.set(v[0], []).get(v[0])!
        arr.push(Number(v[1]))
      }
    }, cap)
  const rows: GroupStatsRow[] = Array.from(byGroup, ([g, vals]) => {
    const sorted = vals.slice().sort((a, b) => a - b)
    return {
      group_val: g,
      n: scaleSampledCount(vals.length, total, scanned),
      avg_val: vals.reduce((a, b) => a + b, 0) / vals.length,
      median_val: median(sorted) as number,
      min_val: sorted[0],
      max_val: sorted[sorted.length - 1],
      stddev_val: stddevSamp(vals),
      _rawN: vals.length,
    } as GroupStatsRow & { _rawN: number }
  })
  rows.sort((a, b) => (b as GroupStatsRow & { _rawN: number })._rawN - (a as GroupStatsRow & { _rawN: number })._rawN)
  rows.forEach(r => { delete (r as GroupStatsRow & { _rawN?: number })._rawN })
  return { rows, scanned }
}

// 3. date series ------------------------------------------------------------
export async function sampledDateSeriesStats(
  service: SupabaseClient, datasetId: string, dateField: string, metricField: string | null, bucket: string,
  total: number, rowIds: number[] | null, cap = AGG_SAMPLE_CAP,
): Promise<Sampled<DateSeriesRow[]>> {
  const byBucket = new Map<string, { n: number; msum: number; mn: number }>()
  const scanned = await pageSample(service, datasetId, 'sampled_date_series_stats_blocks',
    { p_date_field: dateField, p_metric_field: metricField, p_bucket: bucket }, rowIds,
    page => {
      for (const b of (page.buckets as [string, number, number | null, number][] | undefined) || []) {
        const acc = byBucket.get(b[0]) || { n: 0, msum: 0, mn: 0 }
        acc.n += Number(b[1])
        acc.msum += Number(b[2]) || 0
        acc.mn += Number(b[3]) || 0
        byBucket.set(b[0], acc)
      }
    }, cap)
  const rows: DateSeriesRow[] = Array.from(byBucket, ([bkt, a]) => ({
    bucket_date: bkt,
    n: scaleSampledCount(a.n, total, scanned),
    avg_val: a.mn > 0 ? a.msum / a.mn : null,
  }))
  rows.sort((a, b) => (a.bucket_date < b.bucket_date ? -1 : a.bucket_date > b.bucket_date ? 1 : 0))
  return { rows, scanned }
}

// 4. field counts -----------------------------------------------------------
export async function sampledCountFieldValues(
  service: SupabaseClient, datasetId: string, field: string,
  limit: number, total: number, rowIds: number[] | null, cap = AGG_SAMPLE_CAP,
): Promise<Sampled<FieldCountRow[]>> {
  const byValue = new Map<string, number>()
  const scanned = await pageSample(service, datasetId, 'sampled_count_field_values_blocks',
    { p_field_key: field }, rowIds,
    page => {
      for (const g of (page.groups as [string, number][] | undefined) || []) {
        byValue.set(g[0], (byValue.get(g[0]) || 0) + Number(g[1]))
      }
    }, cap)
  const rows = Array.from(byValue, ([value, n]) => ({ value, count: scaleSampledCount(n, total, scanned) }))
  rows.sort((a, b) => b.count - a.count)
  return { rows: rows.slice(0, limit), scanned }
}

// 5. numeric field stats ----------------------------------------------------
export async function sampledNumericFieldStats(
  service: SupabaseClient, datasetId: string, field: string,
  total: number, rowIds: number[] | null, cap = AGG_SAMPLE_CAP,
): Promise<Sampled<NumericStatsRow | null>> {
  const vals: number[] = []
  const scanned = await pageSample(service, datasetId, 'sampled_numeric_field_values_blocks',
    { p_field_key: field }, rowIds,
    page => { for (const x of (page.vals as number[] | undefined) || []) vals.push(Number(x)) }, cap)
  if (!vals.length) return { rows: null, scanned }
  const sorted = vals.slice().sort((a, b) => a - b)
  return {
    rows: {
      n: scaleSampledCount(vals.length, total, scanned),
      min_val: sorted[0],
      max_val: sorted[sorted.length - 1],
      avg_val: vals.reduce((a, b) => a + b, 0) / vals.length,
      median_val: median(sorted),
      stddev_val: stddevSamp(vals),
    },
    scanned,
  }
}
