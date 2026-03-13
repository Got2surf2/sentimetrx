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
// Each record holds up to 50 data rows, so this = up to 5000 rows per pass.
const BATCH_PAGE_SIZE = 100

// -- Running accumulators per field type ---------------------------------

interface CatAccum {
  type:   'categorical'
  counts: Record<string, number>
  nonNull: number
}

interface NumAccum {
  type:    'numeric'
  nonNull: number
  sum:     number
  min:     number
  max:     number
  values:  number[]          // kept for median + stddev (capped at 10k)
}

interface TextAccum {
  type:        'open-ended'
  nonNull:     number
  totalWords:  number
  sample:      string[]      // first 5
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
}

type Accum = CatAccum | NumAccum | TextAccum | DateAccum | IgnoreAccum

function makeAccum(field: SchemaFieldConfig): Accum {
  const t = field.type
  if (t === 'categorical') return { type: 'categorical', counts: {}, nonNull: 0 }
  if (t === 'numeric')     return { type: 'numeric', nonNull: 0, sum: 0, min: Infinity, max: -Infinity, values: [] }
  if (t === 'open-ended')  return { type: 'open-ended', nonNull: 0, totalWords: 0, sample: [] }
  if (t === 'date')        return { type: 'date', nonNull: 0, min: '', max: '', counts: {} }
  return { type: t as 'id' | 'ignore', nonNull: 0 }
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
      if (accum.values.length < 10000) accum.values.push(n)
    }
    return
  }

  if (accum.type === 'open-ended') {
    accum.nonNull++
    accum.totalWords += str.split(/\s+/).filter(Boolean).length
    if (accum.sample.length < 5) accum.sample.push(str)
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
  for (const v of values) {
    const idx = Math.min(Math.floor((v - min) / width), buckets - 1)
    result[idx].count++
  }
  return result
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function stddev(values: number[], avg: number): number {
  if (values.length < 2) return 0
  const variance = values.reduce(function(s, v) { return s + (v - avg) * (v - avg) }, 0) / values.length
  return Math.sqrt(variance)
}

function finalize(accum: Accum): FieldSummary {
  if (accum.type === 'categorical') {
    const sorted = Object.entries(accum.counts).sort(function(a, b) { return b[1] - a[1] })
    const topN   = sorted.slice(0, 20).map(function(e) { return e[0] })
    return {
      type:        'categorical',
      nonNull:     accum.nonNull,
      counts:      Object.fromEntries(sorted),
      topN,
      uniqueCount: sorted.length,
    } satisfies CategoricalSummary
  }

  if (accum.type === 'numeric') {
    const n   = accum.nonNull
    const avg = n > 0 ? accum.sum / n : 0
    const sorted = [...accum.values].sort(function(a, b) { return a - b })
    const min = accum.min === Infinity  ? 0 : accum.min
    const max = accum.max === -Infinity ? 0 : accum.max
    return {
      type:      'numeric',
      nonNull:   n,
      min,
      max,
      avg:       parseFloat(avg.toFixed(4)),
      median:    parseFloat(median(sorted).toFixed(4)),
      stddev:    parseFloat(stddev(accum.values, avg).toFixed(4)),
      histogram: histogram(sorted, min, max, 10),
    } satisfies NumericSummary
  }

  if (accum.type === 'open-ended') {
    return {
      type:         'open-ended',
      nonNull:      accum.nonNull,
      avgWordCount: accum.nonNull > 0 ? parseFloat((accum.totalWords / accum.nonNull).toFixed(1)) : 0,
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
    type:    accum.type,
    nonNull: accum.nonNull,
  } satisfies IgnoredSummary
}

// -- Main export ---------------------------------------------------------

/**
 * Streams through all dataset_rows batches in pages, accumulates per-field
 * statistics, and returns a DatasetAnalytics object ready to write to
 * dataset_state.analytics.
 *
 * Never holds more than BATCH_PAGE_SIZE * 50 = ~5000 rows in memory at once.
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
  for (const f of activeFields) {
    accumulators[f.field] = makeAccum(f)
  }
  // Also track id fields for nonNull count
  for (const f of schema.fields) {
    if (!accumulators[f.field]) accumulators[f.field] = makeAccum(f)
  }

  let totalRows = 0
  let page      = 0
  let hasMore   = true

  while (hasMore) {
    const from = page * BATCH_PAGE_SIZE
    const to   = from + BATCH_PAGE_SIZE - 1

    const { data: batches, error } = await service
      .from('dataset_rows')
      .select('rows, row_count')
      .eq('dataset_id', datasetId)
      .order('batch_index', { ascending: true })
      .range(from, to)

    if (error) throw new Error('analyticsCompute: ' + error.message)
    if (!batches || batches.length === 0) { hasMore = false; break }

    for (const batch of batches) {
      const batchRows: Record<string, unknown>[] = batch.rows || []
      totalRows += batchRows.length

      for (const row of batchRows) {
        for (const f of schema.fields) {
          const accum = accumulators[f.field]
          if (accum) accumRow(accum, row[f.field])
        }
      }
    }

    if (batches.length < BATCH_PAGE_SIZE) { hasMore = false }
    page++
  }

  // Finalize all accumulators
  const fieldSummaries: Record<string, FieldSummary> = {}
  for (const f of schema.fields) {
    fieldSummaries[f.field] = finalize(accumulators[f.field])
  }

  return {
    totalRows,
    computedAt:     new Date().toISOString(),
    fieldSummaries,
  }
}
