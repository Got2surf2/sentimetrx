// lib/datasetUtils.ts
// Data pipeline helpers for the Analyze module

import type { SchemaConfig, SchemaFieldConfig, AnaFieldType, DatasetRowBatch, ProcessedRow } from './analyzeTypes'
import type { SurveyPayload, StudyConfig } from './types'

// -- Column name sanitizer -----------------------------------------

export function sanitizeColumnName(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
}

// -- Merge row batches into flat array ----------------------------

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

// -- Apply schema to raw rows -------------------------------------

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

// -- Auto-detect field types from raw rows -------------------------

export function autoDetectSchema(rows: Record<string, unknown>[]): SchemaConfig {
  if (rows.length === 0) {
    return { fields: [], autoDetected: true, version: 1 }
  }

  const columns = Object.keys(rows[0])
  const sampleSize = Math.min(rows.length, 100)
  const sample = rows.slice(0, sampleSize)

  const fields: SchemaFieldConfig[] = columns.map(function(col) {
    const colLower = col.toLowerCase()

    if (colLower === 'id' || colLower.endsWith('_id') || colLower === 'response_id') {
      return { field: col, type: 'id' as AnaFieldType }
    }

    if (
      colLower.includes('date') ||
      colLower.includes('_at') ||
      colLower.includes('timestamp') ||
      colLower.includes('time')
    ) {
      return { field: col, type: 'date' as AnaFieldType }
    }

    const values: unknown[] = sample
      .map(function(r) { return r[col] })
      .filter(function(v) { return v != null && v !== '' })

    if (values.length === 0) return { field: col, type: 'ignore' as AnaFieldType }

    const numericCount = values.filter(function(v) {
      const s = String(v)
      return !isNaN(parseFloat(s)) && isFinite(Number(s))
    }).length

    if (numericCount / values.length >= 0.8) {
      return { field: col, type: 'numeric' as AnaFieldType }
    }

    const avgLen = values.reduce(function(sum: number, v) {
      return sum + String(v).length
    }, 0) / values.length

    const uniqueCount = new Set(values.map(function(v) { return String(v) })).size
    const uniqueRatio = uniqueCount / values.length

    if (avgLen > 40 || (uniqueRatio > 0.7 && avgLen > 15)) {
      return { field: col, type: 'open-ended' as AnaFieldType }
    }

    return { field: col, type: 'categorical' as AnaFieldType }
  })

  const firstOpenEnded = fields.find(function(f) { return f.type === 'open-ended' })

  return {
    fields,
    primaryTextField: firstOpenEnded?.field,
    autoDetected: true,
    version: 1,
  }
}

// -- Flatten custom question answers from payload JSONB -----------

export function flattenCustomQuestions(
  payload: SurveyPayload,
  config: StudyConfig
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!payload.customAnswers || !config.questions) return out

  for (const question of config.questions) {
    const raw = payload.customAnswers[question.id]
    if (raw == null) continue
    const colName = sanitizeColumnName(
      question.exportLabel || question.prompt || question.id
    )
    out[colName] = Array.isArray(raw) ? raw.join(', ') : raw
  }
  return out
}

// -- Flatten psychographic answers --------------------------------

export function flattenPsychographics(payload: SurveyPayload): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!payload.psychographics) return out
  for (const [key, val] of Object.entries(payload.psychographics)) {
    out['psycho_' + sanitizeColumnName(key)] = val
  }
  return out
}

// -- Format study responses as flat rows for dataset storage -------

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

// -- Build auto-schema for a study-linked dataset ------------------

export function buildStudySchema(config: StudyConfig): SchemaConfig {
  const fields: SchemaFieldConfig[] = [
    { field: 'response_id',      type: 'id' },
    { field: 'submitted_at',     type: 'date' },
    { field: 'nps_score',        type: 'numeric' },
    { field: 'experience_score', type: 'numeric' },
    { field: 'sentiment',        type: 'categorical' },
    { field: 'duration_sec',     type: 'numeric' },
    { field: 'q3_response',      type: 'open-ended' },
    { field: 'q4_response',      type: 'open-ended' },
  ]

  if (config.questions) {
    for (const q of config.questions) {
      const col = sanitizeColumnName(q.exportLabel || q.prompt || q.id)
      const type: AnaFieldType = (q.type === 'open' || q.type === 'numeric') ? 'open-ended' : 'categorical'
      fields.push({ field: col, type })
    }
  }

  if (config.psychographicBank) {
    for (const pq of config.psychographicBank) {
      fields.push({ field: 'psycho_' + sanitizeColumnName(pq.key), type: 'categorical' })
    }
  }

  return {
    fields,
    primaryTextField: 'q3_response',
    autoDetected: false,
    version: 1,
  }
}

// -- Empty defaults for new dataset_state -------------------------

export function emptyThemeModel() {
  return { themes: [] as unknown[], aiGenerated: false, version: 1 }
}

export function emptySchemaConfig(): SchemaConfig {
  return { fields: [], autoDetected: true, version: 1 }
}
