// lib/analyticsCompute.ts
// SERVER-SIDE ONLY — never imported by client components.

import type { SupabaseClient } from '@supabase/supabase-js'
import { countNonEmptyRows } from './nonEmptyCount'
import type {
  SchemaConfig,
  SchemaFieldConfig,
  DatasetAnalytics,
  FieldSummary,
  CategoricalSummary,
  NumericSummary,
  OpenEndedSummary,
  DateSummary,
  IgnoredSummary,
  HistogramBucket,
} from './analyzeTypes'

// Row shape returned by the `count_field_values` RPC (field value + its count).
interface FieldValueCountRow {
  value: string
  count: number | string
}

// -- Running accumulators per field type ---------------------------------

interface CatAccum {
  type:   'categorical'
  counts: Record<string, number>
  nonNull: number
}

interface NumAccum {
  type:       'numeric'
  nonNull:    number
  sum:        number
  min:        number
  max:        number
  values:     number[]   // reservoir sample — up to NUMERIC_RESERVOIR_SIZE values
  valuesSeen: number     // total numeric values seen (for reservoir algorithm)
  valueCounts: Record<string, number>  // for discrete numerics (1-5 ratings etc)
}

// Reservoir size for numeric values used in median / stddev / percentile computation.
// At 10k values the statistical error on median is < 0.5% for typical survey distributions.
const NUMERIC_RESERVOIR_SIZE = 50_000

interface TextAccum {
  type:        'open-ended'
  nonNull:     number
  totalWords:  number
  totalChars:  number
  maxLen:      number
  sample:      string[]      // first 10
}

interface DateAccum {
  type:    'date'
  nonNull: number
  min:     string
  max:     string
  counts:  Record<string, number>
}

interface IgnoreAccum {
  type:    'id' | 'ignore'
  nonNull: number
  uniqueSet: Set<string>     // track uniqueness for id detection
  sample:  string[]          // first 5
}

type Accum = CatAccum | NumAccum | TextAccum | DateAccum | IgnoreAccum

function makeAccum(field: SchemaFieldConfig): Accum {
  const t = field.type
  if (t === 'categorical') return { type: 'categorical', counts: {}, nonNull: 0 }
  if (t === 'numeric')     return { type: 'numeric', nonNull: 0, sum: 0, min: Infinity, max: -Infinity, values: [], valuesSeen: 0, valueCounts: {} }
  if (t === 'open-ended')  return { type: 'open-ended', nonNull: 0, totalWords: 0, totalChars: 0, maxLen: 0, sample: [] }
  if (t === 'date')        return { type: 'date', nonNull: 0, min: '', max: '', counts: {} }
  return { type: t as 'id' | 'ignore', nonNull: 0, uniqueSet: new Set(), sample: [] }
}

function accumRow(accum: Accum, raw: unknown): void {
  if (raw === null || raw === undefined || raw === '') return
  const str = String(raw).trim()
  if (!str) return

  if (accum.type === 'categorical') {
    accum.nonNull++
    accum.counts[str] = (accum.counts[str] || 0) + 1
    return
  }

  if (accum.type === 'numeric') {
    const n = Number(raw)
    if (!isNaN(n)) {
      accum.nonNull++
      accum.sum += n
      if (n < accum.min) accum.min = n
      if (n > accum.max) accum.max = n
      // Knuth / Vitter reservoir sampling (Algorithm R):
      // keeps a statistically representative random sample of up to NUMERIC_RESERVOIR_SIZE values.
      // For datasets ≤ reservoir size this is equivalent to keeping every value.
      const seen = accum.valuesSeen
      if (seen < NUMERIC_RESERVOIR_SIZE) {
        accum.values.push(n)
      } else {
        const j = Math.floor(Math.random() * (seen + 1))
        if (j < NUMERIC_RESERVOIR_SIZE) accum.values[j] = n
      }
      accum.valuesSeen++
      // Track value counts for discrete numerics (ratings, scores)
      const vk = String(n)
      accum.valueCounts[vk] = (accum.valueCounts[vk] || 0) + 1
    }
    return
  }

  if (accum.type === 'open-ended') {
    accum.nonNull++
    accum.totalWords += str.split(/\s+/).filter(Boolean).length
    accum.totalChars += str.length
    if (str.length > accum.maxLen) accum.maxLen = str.length
    if (accum.sample.length < 20) accum.sample.push(str)
    return
  }

  if (accum.type === 'date') {
    accum.nonNull++
    // Normalize to YYYY-MM-DD for bucketing
    const d = str.slice(0, 10)
    if (!accum.min || d < accum.min) accum.min = d
    if (!accum.max || d > accum.max) accum.max = d
    accum.counts[d] = (accum.counts[d] || 0) + 1
    return
  }

  // id / ignore
  if (accum.type === 'id' || accum.type === 'ignore') {
    accum.nonNull++
    if (accum.uniqueSet.size < 1000) accum.uniqueSet.add(str)
    if (accum.sample.length < 5) accum.sample.push(str)
  }
}

function histogram(values: number[], min: number, max: number, buckets: number): HistogramBucket[] {
  if (values.length === 0 || min === max) {
    return [{ min, max, count: values.length }]
  }
  const width = (max - min) / buckets
  const result: HistogramBucket[] = []
  for (let i = 0; i < buckets; i++) {
    const lo = min + i * width
    const hi = i === buckets - 1 ? max : min + (i + 1) * width
    result.push({ min: parseFloat(lo.toFixed(4)), max: parseFloat(hi.toFixed(4)), count: 0 })
  }
  for (let vi = 0; vi < values.length; vi++) {
    const idx = Math.min(Math.floor((values[vi] - min) / width), buckets - 1)
    result[idx].count++
  }
  return result
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const k = (sorted.length - 1) * p
  const f = Math.floor(k)
  const c = Math.ceil(k)
  if (f === c) return sorted[f]
  return sorted[f] + (sorted[c] - sorted[f]) * (k - f)
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function stddev(values: number[], avg: number): number {
  if (values.length <= 1) return 0
  const variance = values.reduce(function(s, v) { return s + (v - avg) * (v - avg) }, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

function finalize(accum: Accum, totalRows: number): FieldSummary {
  if (accum.type === 'categorical') {
    const sorted = Object.entries(accum.counts).sort(function(a, b) { return b[1] - a[1] })
    const topN   = sorted.slice(0, 20).map(function(e) { return e[0] })
    // Complete sorted values list (up to 500) for filters and chart axes
    const values = sorted.slice(0, 500).map(function(e) { return e[0] })
    return {
      type:        'categorical',
      nonNull:     accum.nonNull,
      counts:      Object.fromEntries(sorted),
      topN,
      values,
      uniqueCount: sorted.length,
      uniqueRatio: accum.nonNull > 0 ? parseFloat((sorted.length / accum.nonNull).toFixed(4)) : 0,
    } satisfies CategoricalSummary
  }

  if (accum.type === 'numeric') {
    const nn   = accum.nonNull
    const avg = nn > 0 ? accum.sum / nn : 0
    const sortedVals = accum.values.slice().sort(function(a, b) { return a - b })
    const min = accum.min === Infinity  ? 0 : accum.min
    const max = accum.max === -Infinity ? 0 : accum.max
    // Determine if this is a discrete numeric (few unique values like 1-5 rating)
    const uniqueNumCount = Object.keys(accum.valueCounts).length
    const isDiscrete = uniqueNumCount <= 20
    return {
      type:      'numeric',
      nonNull:   nn,
      min,
      max,
      avg:       parseFloat(avg.toFixed(4)),
      median:    parseFloat(median(sortedVals).toFixed(4)),
      stddev:    parseFloat(stddev(accum.values, avg).toFixed(4)),
      p25:       parseFloat(percentile(sortedVals, 0.25).toFixed(4)),
      p75:       parseFloat(percentile(sortedVals, 0.75).toFixed(4)),
      histogram: histogram(sortedVals, min, max, 10),
      // For discrete numerics (ratings), include value counts for chart axes
      valueCounts:    isDiscrete ? accum.valueCounts : undefined,
      uniqueCount:    uniqueNumCount,
      isDiscrete,
    } satisfies NumericSummary
  }

  if (accum.type === 'open-ended') {
    return {
      type:         'open-ended',
      nonNull:      accum.nonNull,
      avgWordCount: accum.nonNull > 0 ? parseFloat((accum.totalWords / accum.nonNull).toFixed(1)) : 0,
      avgCharLen:   accum.nonNull > 0 ? Math.round(accum.totalChars / accum.nonNull) : 0,
      maxCharLen:   accum.maxLen,
      sample:       accum.sample,
    } satisfies OpenEndedSummary
  }

  if (accum.type === 'date') {
    return {
      type:    'date',
      nonNull: accum.nonNull,
      min:     accum.min,
      max:     accum.max,
      counts:  accum.counts,
    } satisfies DateSummary
  }

  return {
    type:        accum.type,
    nonNull:     accum.nonNull,
    uniqueCount: accum.uniqueSet ? accum.uniqueSet.size : 0,
    sample:      accum.sample || [],
  } satisfies IgnoredSummary
}

// -- Main export ---------------------------------------------------------

// -- Incremental analytics accumulator (chunk-streaming callers) --------------
// Same math as computeAnalyticsFromRows, but fed page-by-page so callers never
// hold more than one chunk of rows in memory (collection recompute streams
// member rows in 1000-row pages through this).

export interface AnalyticsAccumulator {
  pushRows(rows: Record<string, unknown>[]): void
  finalize(): DatasetAnalytics
}

export function createAnalyticsAccumulator(schema: SchemaConfig): AnalyticsAccumulator {
  const accumulators: Record<string, Accum> = {}
  for (var i = 0; i < schema.fields.length; i++) {
    accumulators[schema.fields[i].field] = makeAccum(schema.fields[i])
  }
  var totalRows = 0

  return {
    pushRows(rows: Record<string, unknown>[]) {
      totalRows += rows.length
      for (var ri = 0; ri < rows.length; ri++) {
        var row = rows[ri]
        for (var fi = 0; fi < schema.fields.length; fi++) {
          var accum = accumulators[schema.fields[fi].field]
          if (!accum) continue
          accumRow(accum, row[schema.fields[fi].field])
        }
      }
    },
    finalize(): DatasetAnalytics {
      var fieldSummaries: Record<string, FieldSummary> = {}
      for (var ffi = 0; ffi < schema.fields.length; ffi++) {
        fieldSummaries[schema.fields[ffi].field] = finalize(accumulators[schema.fields[ffi].field], totalRows)
      }
      return {
        totalRows:      totalRows,
        computedAt:     new Date().toISOString(),
        fieldSummaries,
      }
    },
  }
}

// -- In-memory analytics from pre-loaded rows (used by collections) ----------

export function computeAnalyticsFromRows(
  rows:   Record<string, unknown>[],
  schema: SchemaConfig
): DatasetAnalytics {
  const acc = createAnalyticsAccumulator(schema)
  acc.pushRows(rows)
  return acc.finalize()
}

// -- SQL-based analytics (flat table) — handles 2M+ rows without JS memory --

// Bounded promise pool — keeps at most `limit` aggregate queries in flight
// (Supabase Micro pooler; unbounded Promise.all would exhaust connections).
async function runPool<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results = new Array<T>(tasks.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const i = next++
      results[i] = await tasks[i]()
    }
  }))
  return results
}

export async function computeAnalyticsSQL(
  service: SupabaseClient,
  datasetId: string,
  schema: SchemaConfig
): Promise<DatasetAnalytics> {
  // Get total row count from flat table
  var countRes = await service.from('dataset_rows_flat').select('id', { count: 'exact', head: true }).eq('dataset_id', datasetId)
  var totalRows = countRes.count || 0

  var activeFields = schema.fields.filter(function(f) { return f.type !== 'ignore' && f.type !== 'id' })
  var fieldSummaries: Record<string, FieldSummary> = {}

  // Get a sample row to detect text fields
  var sampleRes = await service.from('dataset_rows_flat').select('data').eq('dataset_id', datasetId).limit(20)
  var sampleRows = (sampleRes.data || []).map(function(r) { return r.data })

  async function summarizeField(f: SchemaFieldConfig): Promise<FieldSummary> {
    if (f.type === 'ignore') {
      return { type: 'ignore', nonNull: 0, uniqueCount: 0, sample: [] } as IgnoredSummary
    }
    if (f.type === 'id') {
      var idNonNull = 0
      sampleRows.forEach(function(r) { if (r[f.field] != null && String(r[f.field]).trim()) idNonNull++ })
      return { type: 'id', nonNull: totalRows, uniqueCount: totalRows, sample: [] } as IgnoredSummary
    }

    if (f.type === 'categorical') {
      var catRes = await service.rpc('count_field_values', { p_dataset_id: datasetId, p_field_key: f.field, p_limit: 500 })
      var counts: Record<string, number> = {}
      var nonNull = 0
      ;(catRes.data || []).forEach(function(r: FieldValueCountRow) { counts[r.value] = Number(r.count); nonNull += Number(r.count) })
      var sorted = Object.entries(counts).sort(function(a, b) { return b[1] - a[1] })
      return {
        type: 'categorical', nonNull: nonNull,
        counts: Object.fromEntries(sorted),
        topN: sorted.slice(0, 20).map(function(e) { return e[0] }),
        values: sorted.slice(0, 500).map(function(e) { return e[0] }),
        uniqueCount: sorted.length,
        uniqueRatio: nonNull > 0 ? parseFloat((sorted.length / nonNull).toFixed(4)) : 0,
      } satisfies CategoricalSummary
    }

    if (f.type === 'numeric') {
      var numRes = await service.rpc('numeric_field_stats', { p_dataset_id: datasetId, p_field_key: f.field })
      var nr = (numRes.data || [])[0]
      if (!nr || !nr.n) {
        return { type: 'numeric', nonNull: 0, min: 0, max: 0, avg: 0, median: 0, stddev: 0, p25: 0, p75: 0, histogram: [], uniqueCount: 0, isDiscrete: false } as NumericSummary
      }
      // Get value counts for discrete detection + histogram
      var vcRes = await service.rpc('count_field_values', { p_dataset_id: datasetId, p_field_key: f.field, p_limit: 50 })
      var valCounts: Record<string, number> = {}
      ;(vcRes.data || []).forEach(function(r: FieldValueCountRow) { valCounts[r.value] = Number(r.count) })
      var uniqueNumCount = Object.keys(valCounts).length
      var isDiscrete = uniqueNumCount <= 20
      // Build histogram from value counts if discrete, else approximate from stats
      var histBuckets: HistogramBucket[] = []
      var nMin = Number(nr.min_val), nMax = Number(nr.max_val)
      if (isDiscrete) {
        Object.entries(valCounts).sort(function(a, b) { return parseFloat(a[0]) - parseFloat(b[0]) }).forEach(function(e) {
          var v = parseFloat(e[0])
          histBuckets.push({ min: v, max: v, count: e[1] })
        })
      } else {
        var bCount = 10, width = (nMax - nMin) / bCount
        if (width > 0) {
          for (var hi = 0; hi < bCount; hi++) {
            histBuckets.push({ min: parseFloat((nMin + hi * width).toFixed(4)), max: parseFloat((hi === bCount - 1 ? nMax : nMin + (hi + 1) * width).toFixed(4)), count: 0 })
          }
          // Approximate bucket counts from value counts
          Object.entries(valCounts).forEach(function(e) {
            var v = parseFloat(e[0])
            var idx = Math.min(Math.floor((v - nMin) / width), bCount - 1)
            if (idx >= 0 && idx < bCount) histBuckets[idx].count += e[1]
          })
        }
      }
      return {
        type: 'numeric', nonNull: Number(nr.n),
        min: nMin, max: nMax,
        avg: parseFloat(Number(nr.avg_val).toFixed(4)),
        median: parseFloat(Number(nr.median_val).toFixed(4)),
        stddev: parseFloat(Number(nr.stddev_val || 0).toFixed(4)),
        // Real quartiles since sql/199; a pre-199 DB returns no p25_val/p75_val
        // and falls back to the old median approximation (deploy-order safe).
        p25: parseFloat(Number(nr.p25_val ?? nr.median_val).toFixed(4)),
        p75: parseFloat(Number(nr.p75_val ?? nr.median_val).toFixed(4)),
        histogram: histBuckets,
        valueCounts: isDiscrete ? valCounts : undefined,
        uniqueCount: uniqueNumCount, isDiscrete: isDiscrete,
      } satisfies NumericSummary
    }

    if (f.type === 'open-ended') {
      var oeNonNull = 0, totalWords = 0, totalChars = 0, maxLen = 0
      var oeSample: string[] = []
      sampleRows.forEach(function(r) {
        var v = String(r[f.field] || '').trim()
        if (!v) return
        oeNonNull++
        totalWords += v.split(/\s+/).length
        totalChars += v.length
        if (v.length > maxLen) maxLen = v.length
        if (oeSample.length < 20) oeSample.push(v)
      })
      // Get accurate nonNull count from SQL — comma-safe (sql/161): the raw
      // PostgREST filter returned 0 for question-sentence column names,
      // silently falling back to the sampled count below.
      var oeSqlCount = 0
      try { oeSqlCount = await countNonEmptyRows(service, datasetId, f.field) } catch { /* sampled fallback below */ }
      return {
        type: 'open-ended', nonNull: oeSqlCount || oeNonNull,
        avgWordCount: oeNonNull > 0 ? parseFloat((totalWords / oeNonNull).toFixed(1)) : 0,
        avgCharLen: oeNonNull > 0 ? Math.round(totalChars / oeNonNull) : 0,
        maxCharLen: maxLen, sample: oeSample,
      } satisfies OpenEndedSummary
    }

    if (f.type === 'date') {
      var dateCounts: Record<string, number> = {}
      var dateMin = '', dateMax = ''
      var dcRes = await service.rpc('count_field_values', { p_dataset_id: datasetId, p_field_key: f.field, p_limit: 500 })
      var dateNonNull = 0
      ;(dcRes.data || []).forEach(function(r: FieldValueCountRow) {
        dateCounts[r.value] = Number(r.count)
        dateNonNull += Number(r.count)
        if (!dateMin || r.value < dateMin) dateMin = r.value
        if (!dateMax || r.value > dateMax) dateMax = r.value
      })
      return { type: 'date', nonNull: dateNonNull, min: dateMin, max: dateMax, counts: dateCounts } satisfies DateSummary
    }

    // Fallback for any other type
    return { type: f.type as 'id' | 'ignore', nonNull: 0, uniqueCount: 0, sample: [] } as IgnoredSummary
  }

  // Fields are independent — run their aggregate queries with bounded concurrency
  var summaries = await runPool(schema.fields.map(function(f) { return function() { return summarizeField(f) } }), 5)
  schema.fields.forEach(function(f, i) { fieldSummaries[f.field] = summaries[i] })

  return { totalRows: totalRows, computedAt: new Date().toISOString(), fieldSummaries: fieldSummaries }
}
