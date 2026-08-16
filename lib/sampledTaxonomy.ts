// lib/sampledTaxonomy.ts
// Sampled twins of the /aggregate taxonomy ("Dimensions") ops (Brief C Part 3,
// PERFORMANCE_REVIEW.md §7). Above the 50K cap the exact taxonomy_sub_counts /
// group_stats / crosstab / date_series / axis_crosstab RPCs (sql/164) unnest
// `data -> '_tx' -> 'f' -> <field> -> 'a'` over EVERY row and 57014 at ~1M once
// a rollup resolves (measured 8.1s at 1M). Each here keyset-pages the
// deterministic 50K sample (sql/191 stratified blocks, the *_blocks twins — the SAME sample the
// counts twins walk, sql/169) so sampled dimension charts agree with the
// client-side tiles, then:
//   * scales COUNTS by total/scanned (an estimate of the full-dataset count)
//   * reports means / medians / quartiles / stddev UNSCALED (a uniform sample's
//     mean/quantile is a direct estimate of the population value)
// Per-question field resolution (p_field_key → taxonomy_field_or_primary,
// sql/164) rides in via staticArgs so the source-field picker keeps driving
// dimensions. Each returns the SAME row shape as its exact RPC so the aggregate
// route reshapes both paths through one code path. p_row_ids narrows the
// numerators (a filtered above-cap view) without touching the sample-walk
// denominator.
//
// Reuses the keyset pager + stat helpers from lib/sampledAggregate.ts.

import type { SupabaseClient } from '@supabase/supabase-js'
import { scaleSampledCount } from '@/lib/sampledSignalCounts'
import { AGG_SAMPLE_CAP, pageSample, median, percentileCont, stddevSamp, type Sampled } from '@/lib/sampledAggregate'

// ── Row shapes matching the exact taxonomy_* RPCs (sql/164) ──
export interface TaxSubCountRow { value: string; count: number }
export interface TaxGroupStatsRow { group_val: string; n: number; min_val: number; max_val: number; avg_val: number; median_val: number; q1_val: number | null; q3_val: number | null; stddev_val: number | null }
export interface TaxCrosstabRow { sub_val: string; field_val: string; cnt: number }
export interface TaxDateSeriesRow { sub_val: string; bucket_date: string; n: number; avg_val: number | null }
export interface TaxAxisCrosstabRow { axis_val: string; field_val: string; cnt: number }

// 1. tax sub counts ----------------------------------------------------------
export async function sampledTaxonomySubCounts(
  service: SupabaseClient, datasetId: string, axis: string, fieldKey: string | null,
  total: number, rowIds: number[] | null, cap = AGG_SAMPLE_CAP,
): Promise<Sampled<TaxSubCountRow[]>> {
  const bySub = new Map<string, number>()
  const scanned = await pageSample(service, datasetId, 'sampled_taxonomy_sub_counts_blocks',
    { p_axis: axis, p_field_key: fieldKey }, rowIds,
    page => {
      for (const g of (page.groups as [string, number][] | undefined) || []) {
        bySub.set(g[0], (bySub.get(g[0]) || 0) + Number(g[1]))
      }
    }, cap)
  const rows = Array.from(bySub, ([value, n]) => ({ value, count: scaleSampledCount(n, total, scanned) }))
  rows.sort((a, b) => b.count - a.count)
  return { rows, scanned }
}

// 2. tax group stats ---------------------------------------------------------
export async function sampledTaxonomyGroupStats(
  service: SupabaseClient, datasetId: string, axis: string, valueField: string, fieldKey: string | null,
  total: number, rowIds: number[] | null, cap = AGG_SAMPLE_CAP,
): Promise<Sampled<TaxGroupStatsRow[]>> {
  const bySub = new Map<string, number[]>()
  const scanned = await pageSample(service, datasetId, 'sampled_taxonomy_group_stats_blocks',
    { p_axis: axis, p_value_field: valueField, p_field_key: fieldKey }, rowIds,
    page => {
      for (const v of (page.vals as [string, number][] | undefined) || []) {
        const arr = bySub.get(v[0]) || bySub.set(v[0], []).get(v[0])!
        arr.push(Number(v[1]))
      }
    }, cap)
  const rows: (TaxGroupStatsRow & { _rawN: number })[] = Array.from(bySub, ([g, vals]) => {
    const sorted = vals.slice().sort((a, b) => a - b)
    return {
      group_val: g,
      n: scaleSampledCount(vals.length, total, scanned),
      min_val: sorted[0],
      max_val: sorted[sorted.length - 1],
      avg_val: vals.reduce((a, b) => a + b, 0) / vals.length,
      median_val: median(sorted) as number,
      q1_val: percentileCont(sorted, 0.25),
      q3_val: percentileCont(sorted, 0.75),
      stddev_val: stddevSamp(vals),
      _rawN: vals.length,
    }
  })
  rows.sort((a, b) => b._rawN - a._rawN)
  const clean = rows.map(({ _rawN, ...r }) => { void _rawN; return r })
  return { rows: clean, scanned }
}

// 3. tax crosstab ------------------------------------------------------------
export async function sampledTaxonomyCrosstab(
  service: SupabaseClient, datasetId: string, axis: string, field: string, fieldKey: string | null,
  limit: number, total: number, rowIds: number[] | null, cap = AGG_SAMPLE_CAP,
): Promise<Sampled<TaxCrosstabRow[]>> {
  const cells = new Map<string, number>() // key = sub_val \u0000 field_val
  const scanned = await pageSample(service, datasetId, 'sampled_taxonomy_crosstab_blocks',
    { p_axis: axis, p_field: field, p_field_key: fieldKey }, rowIds,
    page => {
      for (const g of (page.groups as [string, string, number][] | undefined) || []) {
        const k = g[0] + '\u0000' + g[1]
        cells.set(k, (cells.get(k) || 0) + Number(g[2]))
      }
    }, cap)
  const rows = Array.from(cells, ([k, n]) => {
    const i = k.indexOf('\u0000')
    return { sub_val: k.slice(0, i), field_val: k.slice(i + 1), cnt: scaleSampledCount(n, total, scanned) }
  })
  rows.sort((a, b) => b.cnt - a.cnt)
  return { rows: rows.slice(0, limit * limit), scanned }
}

// 4. tax date series ---------------------------------------------------------
export async function sampledTaxonomyDateSeries(
  service: SupabaseClient, datasetId: string, axis: string, dateField: string, metricField: string | null, bucket: string, fieldKey: string | null,
  total: number, rowIds: number[] | null, cap = AGG_SAMPLE_CAP,
): Promise<Sampled<TaxDateSeriesRow[]>> {
  const byKey = new Map<string, { sub: string; bkt: string; n: number; msum: number; mn: number }>()
  const scanned = await pageSample(service, datasetId, 'sampled_taxonomy_date_series_blocks',
    { p_axis: axis, p_date_field: dateField, p_metric_field: metricField, p_bucket: bucket, p_field_key: fieldKey }, rowIds,
    page => {
      for (const b of (page.buckets as [string, string, number, number | null, number][] | undefined) || []) {
        const k = b[0] + '\u0000' + b[1]
        const acc = byKey.get(k) || { sub: b[0], bkt: b[1], n: 0, msum: 0, mn: 0 }
        acc.n += Number(b[2])
        acc.msum += Number(b[3]) || 0
        acc.mn += Number(b[4]) || 0
        byKey.set(k, acc)
      }
    }, cap)
  const rows: TaxDateSeriesRow[] = Array.from(byKey.values(), a => ({
    sub_val: a.sub,
    bucket_date: a.bkt,
    n: scaleSampledCount(a.n, total, scanned),
    avg_val: a.mn > 0 ? a.msum / a.mn : null,
  }))
  rows.sort((a, b) => (a.sub_val < b.sub_val ? -1 : a.sub_val > b.sub_val ? 1 : a.bucket_date < b.bucket_date ? -1 : a.bucket_date > b.bucket_date ? 1 : 0))
  return { rows, scanned }
}

// 5. tax axis crosstab -------------------------------------------------------
export async function sampledTaxonomyAxisCrosstab(
  service: SupabaseClient, datasetId: string, field: string, fieldKey: string | null,
  total: number, rowIds: number[] | null, cap = AGG_SAMPLE_CAP,
): Promise<Sampled<TaxAxisCrosstabRow[]>> {
  const cells = new Map<string, number>() // key = axis_val \u0000 field_val
  const scanned = await pageSample(service, datasetId, 'sampled_taxonomy_axis_crosstab_blocks',
    { p_field: field, p_field_key: fieldKey }, rowIds,
    page => {
      for (const g of (page.groups as [string, string, number][] | undefined) || []) {
        const k = g[0] + '\u0000' + g[1]
        cells.set(k, (cells.get(k) || 0) + Number(g[2]))
      }
    }, cap)
  const rows = Array.from(cells, ([k, n]) => {
    const i = k.indexOf('\u0000')
    return { axis_val: k.slice(0, i), field_val: k.slice(i + 1), cnt: scaleSampledCount(n, total, scanned) }
  })
  return { rows, scanned }
}
