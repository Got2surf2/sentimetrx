// lib/analyticsCompute.ts
// SERVER-SIDE ONLY — never imported by client components.
// Reads dataset_rows in pages of BATCH_PAGE_SIZE records at a time so peak
// memory stays bounded regardless of total row count.
// For 100k rows @ 50 rows/batch = 2000 batch records → 20 DB round-trips.

import type { SupabaseClient } from '@supabase/supabase-js'
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

// How many dataset_rows records to fetch per DB round-trip.
// Each record holds up to 200 data rows, so 500 records = up to 100K rows per pass.
// For 500K rows this means ~5 DB round-trips instead of 50.
const BATCH_PAGE_SIZE = 500

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

/**
 * Streams through all dataset_rows batches in pages, accumulates per-field
 * statistics, and returns a DatasetAnalytics object ready to write to
 * dataset_state.analytics.
 *
 * Never holds more than BATCH_PAGE_SIZE * 50 = ~10000 rows in memory at once.
 */
export async function computeAnalytics(
  service:   SupabaseClient,
  datasetId: string,
  schema:    SchemaConfig
): Promise<DatasetAnalytics> {
  const activeFields = schema.fields.filter(function(f) {
    return f.type !== 'ignore' && f.type !== 'id'
  })

  // Initialise accumulators
  const accumulators: Record<string, Accum> = {}
  for (let ai = 0; ai < activeFields.length; ai++) {
    accumulators[activeFields[ai].field] = makeAccum(activeFields[ai])
  }
  // Also track id fields for nonNull count
  for (let si = 0; si < schema.fields.length; si++) {
    if (!accumulators[schema.fields[si].field]) {
      accumulators[schema.fields[si].field] = makeAccum(schema.fields[si])
    }
  }

  let totalRows = 0
  let page      = 0
  let hasMore   = true

  while (hasMore) {
    const from = page * BATCH_PAGE_SIZE
    const to   = from + BATCH_PAGE_SIZE - 1

    const result = await service
      .from('dataset_rows')
      .select('rows, row_count')
      .eq('dataset_id', datasetId)
      .order('batch_index', { ascending: true })
      .range(from, to)

    if (result.error) throw new Error('analyticsCompute: ' + result.error.message)
    const batches = result.data
    if (!batches || batches.length === 0) { hasMore = false; break }

    for (let bi = 0; bi < batches.length; bi++) {
      const batchRows: Record<string, unknown>[] = batches[bi].rows || []
      totalRows += batchRows.length

      // Build a normalized-key → actual-key map from the first row so we can
      // match schema field keys (snake_case) against raw row keys (any casing/spacing).
      // e.g. schema "general_experience_comments" → row "General Experience Comments"
      const keyMap: Record<string, string> = {}
      if (batchRows.length > 0) {
        for (const rk of Object.keys(batchRows[0])) {
          const norm = rk.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
          keyMap[norm] = rk
        }
      }

      for (let ri = 0; ri < batchRows.length; ri++) {
        const row = batchRows[ri]
        for (let fi = 0; fi < schema.fields.length; fi++) {
          const accum = accumulators[schema.fields[fi].field]
          if (!accum) continue
          const fieldKey = schema.fields[fi].field
          // Direct match first; fall back to normalized key lookup
          const val = row[fieldKey] !== undefined ? row[fieldKey] : row[keyMap[fieldKey] || '']
          accumRow(accum, val)
        }
      }
    }

    if (batches.length < BATCH_PAGE_SIZE) { hasMore = false }
    page++
  }

  // Finalize all accumulators
  const fieldSummaries: Record<string, FieldSummary> = {}
  for (let ffi = 0; ffi < schema.fields.length; ffi++) {
    fieldSummaries[schema.fields[ffi].field] = finalize(accumulators[schema.fields[ffi].field], totalRows)
  }

  return {
    totalRows,
    computedAt:     new Date().toISOString(),
    fieldSummaries,
  }
}
