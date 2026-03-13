// lib/datasetUtils.ts
// Data pipeline helpers for the Analyze module

import type { SchemaConfig, SchemaFieldConfig, AnaFieldType, DatasetRowBatch, ProcessedRow } from './analyzeTypes'
import type { SurveyPayload, StudyConfig } from './types'

export function sanitizeColumnName(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
}

export function mergeRowBatches(batches: DatasetRowBatch[]): Record<string, unknown>[] {
  const sorted = [...batches].sort(function(a, b) { return a.batch_index - b.batch_index })
  const merged: Record<string, unknown>[] = []
  for (const batch of sorted) {
    for (const row of batch.rows) {
      merged.push(row)
    }
  }
  return merged
}

export function applySchema(
  rows: Record<string, unknown>[],
  schema: SchemaConfig
): ProcessedRow[] {
  const fieldMap: Record<string, SchemaFieldConfig> = {}
  for (const f of schema.fields) {
    fieldMap[f.field] = f
  }
  return rows.map(function(row) {
    const out: ProcessedRow = {}
    for (const [key, val] of Object.entries(row)) {
      const cfg = fieldMap[key]
      if (cfg?.hidden) continue
      if (cfg?.type === 'ignore') continue
      let processed: unknown = val
      if (cfg?.remapping && typeof val === 'string' && val in cfg.remapping) {
        processed = cfg.remapping[val]
      } else if (cfg?.type === 'numeric' && typeof val === 'string') {
        const n = parseFloat(val)
        processed = isNaN(n) ? null : n
      } else if (cfg?.type === 'date' && typeof val === 'string') {
        processed = val || null
      }
      const outputKey = cfg?.label ? sanitizeColumnName(cfg.label) : key
      out[outputKey] = processed
    }
    return out
  })
}

// -- Per-field stats (mirrors Ana's computeFieldStats) ------------

function isDateLike(vals: string[]): boolean {
  const sample  = vals.slice(0, 20)
  const pattern = /^\d{4}[-/]\d{1,2}([-/]\d{1,2})?|^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/
  const hits    = sample.filter(function(v) { return pattern.test(v.trim()) }).length
  return sample.length > 0 && hits / sample.length >= 0.7
}

export function computeFieldStats(
  fieldName: string,
  values: unknown[]
): Partial<SchemaFieldConfig> & { type: AnaFieldType } {
  const nonNull = values.filter(function(v) { return v !== null && v !== undefined && v !== '' })
  if (!nonNull.length) {
    return { type: 'ignore', nonNullCount: 0, sample: [], values: [] }
  }

  const strVals     = nonNull.map(function(v) { return String(v) })
  const uniqueArr   = Array.from(new Set(strVals))
  const uniqueRatio = uniqueArr.length / nonNull.length
  const avgLen      = strVals.reduce(function(s: number, v) { return s + v.length }, 0) / strVals.length
  const maxLen      = Math.max.apply(null, strVals.map(function(v) { return v.length }))
  const allNum      = nonNull.every(function(v) {
    const s = String(v).trim()
    return s !== '' && !isNaN(Number(s))
  })
  const dateLike  = isDateLike(strVals)
  const avgWords  = strVals.map(function(v) {
    return v.trim().split(/\s+/).length
  }).reduce(function(a: number, b) { return a + b }, 0) / strVals.length

  const lname = fieldName.toLowerCase()
  const isIdField = lname === 'id' || lname === 'key' || lname === 'uuid' || lname === 'rowid' ||
    (allNum && uniqueRatio === 1 && nonNull.length > 3)

  let detectedType: AnaFieldType
  if (isIdField) detectedType = 'id'
  else if (allNum) detectedType = 'numeric'
  else if (dateLike) detectedType = 'date'
  else if (uniqueArr.length <= 15 && avgWords < 3) detectedType = 'categorical'
  else if (avgWords >= 5 || avgLen >= 30 || maxLen >= 50) detectedType = 'open-ended'
  else if (uniqueArr.length <= 30) detectedType = 'categorical'
  else detectedType = 'open-ended'

  const base: Partial<SchemaFieldConfig> & { type: AnaFieldType } = {
    type:         detectedType,
    nonNullCount: nonNull.length,
    sample:       strVals.slice(0, 5),
    avgLen:       avgLen.toFixed(0),
    avgWords:     avgWords.toFixed(1),
    uniqueRatio:  (uniqueRatio * 100).toFixed(0),
  }

  if (detectedType === 'numeric') {
    const nums = nonNull.map(Number)
    return {
      ...base,
      min: Math.min.apply(null, nums),
      max: Math.max.apply(null, nums),
      avg: (nums.reduce(function(a: number, b) { return a + b }, 0) / nums.length).toFixed(1),
    }
  }
  if (detectedType === 'categorical' || detectedType === 'date') {
    return { ...base, values: uniqueArr.sort() }
  }
  return base
}

export function autoDetectSchema(rows: Record<string, unknown>[]): SchemaConfig {
  if (rows.length === 0) {
    return { fields: [], autoDetected: true, version: 1 }
  }
  const columns    = Object.keys(rows[0])
  const sampleSize = Math.min(rows.length, 200)
  const sample     = rows.slice(0, sampleSize)

  const fields: SchemaFieldConfig[] = columns.map(function(col) {
    const colValues = sample.map(function(r) { return r[col] })
    const stats     = computeFieldStats(col, colValues)
    const colLower  = col.toLowerCase()
    // Override date by column name pattern
    if (colLower.includes('_at') || colLower.includes('timestamp') ||
        (colLower.includes('date') && stats.type !== 'numeric')) {
      return { field: col, ...stats, type: 'date' as AnaFieldType }
    }
    return { field: col, ...stats }
  })

  const firstOpenEnded = fields.find(function(f) { return f.type === 'open-ended' })
  return { fields, primaryTextField: firstOpenEnded?.field, autoDetected: true, version: 1 }
}

// Enrich a schema built without rows (e.g. study schema) with stats once rows arrive
export function enrichSchemaWithStats(
  schema: SchemaConfig,
  rows: Record<string, unknown>[]
): SchemaConfig {
  const sampleSize = Math.min(rows.length, 200)
  const sample     = rows.slice(0, sampleSize)
  const enriched   = schema.fields.map(function(f) {
    const colValues = sample.map(function(r) { return r[f.field] })
    const stats     = computeFieldStats(f.field, colValues)
    return { ...f, ...stats, type: f.type, sqt: f.sqt }
  })
  return { ...schema, fields: enriched }
}

export function flattenCustomQuestions(
  payload: SurveyPayload,
  config: StudyConfig
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!payload.customAnswers || !config.questions) return out
  for (const question of config.questions) {
    const raw = payload.customAnswers[question.id]
    if (raw == null) continue
    const colName = sanitizeColumnName(question.exportLabel || question.prompt || question.id)
    out[colName] = Array.isArray(raw) ? raw.join(', ') : raw
  }
  return out
}

export function flattenPsychographics(payload: SurveyPayload): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!payload.psychographics) return out
  for (const [key, val] of Object.entries(payload.psychographics)) {
    out['psycho_' + sanitizeColumnName(key)] = val
  }
  return out
}

interface ResponseRow {
  id:               string
  created_at:       string
  nps_score:        number | null
  experience_score: number | null
  sentiment:        string | null
  duration_sec:     number | null
  payload:          SurveyPayload
}

interface StudyForFormat {
  id:     string
  config: StudyConfig
}

export function formatResponsesAsRows(
  responses: ResponseRow[],
  study: StudyForFormat
): Record<string, unknown>[] {
  return responses.map(function(r) {
    return {
      response_id:      r.id,
      submitted_at:     r.created_at,
      nps_score:        r.nps_score        ?? null,
      experience_score: r.experience_score ?? null,
      sentiment:        r.sentiment        ?? null,
      duration_sec:     r.duration_sec     ?? null,
      q3_response:      r.payload?.openEnded?.q3 ?? null,
      q4_response:      r.payload?.openEnded?.q4 ?? null,
      ...flattenCustomQuestions(r.payload, study.config),
      ...flattenPsychographics(r.payload),
    }
  })
}

export function buildStudySchema(config: StudyConfig): SchemaConfig {
  const fields: SchemaFieldConfig[] = [
    { field: 'response_id',      type: 'id' },
    { field: 'submitted_at',     type: 'date' },
    { field: 'nps_score',        type: 'numeric',    sqt: 'nps' },
    { field: 'experience_score', type: 'numeric',    sqt: 'rating' },
    { field: 'sentiment',        type: 'categorical', sqt: 'single-select' },
    { field: 'duration_sec',     type: 'numeric',    sqt: 'numeric-input' },
    { field: 'q3_response',      type: 'open-ended', sqt: 'open-text' },
    { field: 'q4_response',      type: 'open-ended', sqt: 'open-text' },
  ]
  if (config.questions) {
    for (const q of config.questions) {
      const col  = sanitizeColumnName(q.exportLabel || q.prompt || q.id)
      const type: AnaFieldType = (q.type === 'open' || q.type === 'numeric') ? 'open-ended' : 'categorical'
      fields.push({ field: col, type, sqt: type === 'open-ended' ? 'open-text' : 'single-select' })
    }
  }
  if (config.psychographicBank) {
    for (const pq of config.psychographicBank) {
      fields.push({ field: 'psycho_' + sanitizeColumnName(pq.key), type: 'categorical', sqt: 'single-select' })
    }
  }
  return { fields, primaryTextField: 'q3_response', autoDetected: false, version: 1 }
}

export function emptyThemeModel() {
  return { themes: [] as unknown[], aiGenerated: false, version: 1 }
}

export function emptySchemaConfig(): SchemaConfig {
  return { fields: [], autoDetected: true, version: 1 }
}
