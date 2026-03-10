// ============================================================
// SENTIMETRX -- Analyze Module Utilities
// lib/datasetUtils.ts
// ============================================================

import type { DatasetRowBatch, SchemaConfig, SchemaFieldConfig, AnaFieldType } from './analyzeTypes'
import type { Study, StudyConfig, SurveyPayload } from './types'

// ── Row merging ──────────────────────────────────────────────

/**
 * Merge multiple dataset_rows batches into a single flat array,
 * ordered by batch_index ascending.
 */
export function mergeRowBatches(batches: DatasetRowBatch[]): Record<string, unknown>[] {
  return batches
    .slice()
    .sort((a, b) => a.batch_index - b.batch_index)
    .flatMap(b => b.rows)
}

// ── Schema auto-detection (Ana heuristics from ana_spec Part 16) ──

function isDateLike(val: string): boolean {
  if (!val || typeof val !== 'string') return false
  const d = new Date(val)
  return !isNaN(d.getTime()) && val.length > 4
}

/**
 * Auto-detect field types from raw rows.
 * Returns a SchemaConfig with autoDetected = true.
 * Users should confirm/adjust in the schema editor.
 */
export function autoDetectSchema(rows: Record<string, unknown>[]): SchemaConfig {
  if (!rows.length) return { fields: [], autoDetected: true, version: 1 }

  const keys = Object.keys(rows[0])
  const fields: SchemaFieldConfig[] = keys.map(field => {
    const values = rows.map(r => r[field]).filter(v => v !== null && v !== undefined && v !== '')
    const total = values.length
    if (total === 0) return { field, type: 'ignore' as AnaFieldType }

    const stringVals = values.map(v => String(v))
    const numericCount = stringVals.filter(v => !isNaN(Number(v)) && v.trim() !== '').length
    const dateCount = stringVals.filter(v => isDateLike(v)).length
    const uniqueRatio = new Set(stringVals).size / total
    const avgLen = stringVals.reduce((s, v) => s + v.length, 0) / total

    // id: very high uniqueness, short values
    if (uniqueRatio > 0.95 && avgLen < 40) return { field, type: 'id' as AnaFieldType }
    // numeric: >=80% parse as numbers
    if (numericCount / total >= 0.8) return { field, type: 'numeric' as AnaFieldType }
    // date: >=80% look like dates
    if (dateCount / total >= 0.8) return { field, type: 'date' as AnaFieldType }
    // open-ended: avg length > 30 chars with high uniqueness
    if (avgLen > 30 && uniqueRatio > 0.5) return { field, type: 'open-ended' as AnaFieldType }
    // categorical: few distinct values
    return { field, type: 'categorical' as AnaFieldType }
  })

  // Pick the first open-ended field as primaryTextField
  const primaryTextField = fields.find(f => f.type === 'open-ended')?.field

  return { fields, primaryTextField, autoDetected: true, version: 1 }
}

/**
 * Apply schema config to raw rows:
 * - Remove hidden fields
 * - Apply numeric type coercions
 * - Apply value remappings
 */
export function applySchema(
  rows: Record<string, unknown>[],
  schema: SchemaConfig
): Record<string, unknown>[] {
  if (!schema.fields.length) return rows

  const visible = schema.fields.filter(f => !f.hidden)
  const visibleKeys = new Set(visible.map(f => f.field))

  return rows.map(row => {
    const out: Record<string, unknown> = {}
    for (const f of visible) {
      if (!(f.field in row)) continue
      let val = row[f.field]
      // apply remapping
      if (f.remapping && typeof val === 'string' && val in f.remapping) {
        val = f.remapping[val]
      }
      // coerce numeric
      if (f.type === 'numeric' && typeof val === 'string') {
        const n = Number(val)
        if (!isNaN(n)) val = n
      }
      out[f.field] = val
    }
    return out
  })
}

// ── Survey response formatter ────────────────────────────────

/**
 * Sanitize a string for use as a JSON object key / column name.
 * Replaces non-alphanumeric chars with underscores, lowercases.
 */
export function sanitizeColumnName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
}

/**
 * Flatten custom question answers from payload.
 * Keys are sanitized from question prompt, prefixed with 'cq_'.
 */
export function flattenCustomQuestions(
  payload: SurveyPayload,
  config: StudyConfig
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!payload.customAnswers || !config.questions) return out

  for (const q of config.questions) {
    const key = 'cq_' + sanitizeColumnName(q.exportLabel || q.prompt)
    const val = payload.customAnswers[q.id]
    if (val !== undefined) {
      out[key] = Array.isArray(val) ? val.join(', ') : val
    }
  }
  return out
}

/**
 * Flatten psychographic answers from payload.
 * Keys are prefixed with 'psych_'.
 */
export function flattenPsychographics(payload: SurveyPayload): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!payload.psychographics) return out
  for (const [key, val] of Object.entries(payload.psychographics)) {
    out['psych_' + sanitizeColumnName(key)] = val
  }
  return out
}

// Response row shape (DB row from responses table)
interface ResponseRow {
  id:               string
  nps_score:        number | null
  experience_score: number | null
  sentiment:        string | null
  duration_sec:     number | null
  created_at:       string
  payload:          SurveyPayload
}

/**
 * Format Sentimetrx response records as flat rows for dataset storage.
 * Produces the companion schema alongside so the dataset is pre-typed.
 */
export function formatResponsesAsRows(
  responses: ResponseRow[],
  study: Study
): { rows: Record<string, unknown>[]; schema: SchemaConfig } {
  const rows = responses.map(r => {
    const base: Record<string, unknown> = {
      response_id:      r.id,
      submitted_at:     r.created_at,
      nps_score:        r.nps_score,
      experience_score: r.experience_score,
      sentiment:        r.sentiment,
      duration_sec:     r.duration_sec,
      q3_response:      r.payload?.openEnded?.q3 ?? null,
      q4_response:      r.payload?.openEnded?.q4 ?? null,
    }
    const custom = flattenCustomQuestions(r.payload, study.config)
    const psycho = flattenPsychographics(r.payload)
    return { ...base, ...custom, ...psycho }
  })

  // Build a known-type schema (no guessing needed for survey data)
  const baseFields: SchemaFieldConfig[] = [
    { field: 'response_id',      type: 'id' },
    { field: 'submitted_at',     type: 'date' },
    { field: 'nps_score',        type: 'numeric' },
    { field: 'experience_score', type: 'numeric' },
    { field: 'sentiment',        type: 'categorical' },
    { field: 'duration_sec',     type: 'numeric' },
    { field: 'q3_response',      type: 'open-ended', label: study.config.q3ExportLabel || 'Q3 Response' },
    { field: 'q4_response',      type: 'open-ended', label: study.config.q4ExportLabel || 'Q4 Response' },
  ]

  // Custom question fields
  const customFields: SchemaFieldConfig[] = (study.config.questions || []).map(q => {
    const field = 'cq_' + sanitizeColumnName(q.exportLabel || q.prompt)
    const type: AnaFieldType = (q.type === 'open') ? 'open-ended' : 'categorical'
    return { field, type, label: q.exportLabel || q.prompt }
  })

  // Psychographic fields
  const psychoFields: SchemaFieldConfig[] = (study.config.psychographicBank || []).map(q => ({
    field: 'psych_' + sanitizeColumnName(q.key),
    type: 'categorical' as AnaFieldType,
    label: q.exportLabel || q.q,
  }))

  const allFields = [...baseFields, ...customFields, ...psychoFields]
  const primaryTextField = 'q3_response'

  const schema: SchemaConfig = {
    fields: allFields,
    primaryTextField,
    autoDetected: false,  // we know the types
    version: 1,
  }

  return { rows, schema }
}
