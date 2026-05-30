// lib/datasetUtils.ts
// Data pipeline helpers for the Analyze module

import type { SchemaConfig, SchemaFieldConfig, AnaFieldType, AnaFieldSqt, DatasetRowBatch, ProcessedRow } from './analyzeTypes'
import type { SurveyPayload, StudyConfig } from './types'
import { ratingAliases } from './scaleUtils'

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
  let maxLen = 0
  for (const v of strVals) { if (v.length > maxLen) maxLen = v.length }
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
    // Cap distinct-value list to keep schema JSON bounded. 500 matches the
    // analytics CategoricalSummary cap. Categorical type detection already
    // bounds at uniqueArr.length <= 30, so this cap only fires for date.
    return { ...base, values: uniqueArr.sort().slice(0, 500) }
  }
  return base
}

// All scans below use the full passed-in `rows` array — not a head slice.
// The previous 200-row cap caused the same bias as Insights: on data ordered
// by region/group/member (e.g. collection rows concatenated by member), the
// schema's f.values allowlist captured only the first member's values, which
// then propagated into the Filter UI and any consumer reading f.values.
export function autoDetectSchema(rows: Record<string, unknown>[]): SchemaConfig {
  if (rows.length === 0) {
    return { fields: [], autoDetected: true, version: 1 }
  }
  const columns = Object.keys(rows[0])

  const fields: SchemaFieldConfig[] = columns.map(function(col) {
    const colValues = rows.map(function(r) { return r[col] })
    const stats     = computeFieldStats(col, colValues)
    const colLower  = col.toLowerCase()
    // Override date by column name pattern
    if (colLower.includes('_at') || colLower.includes('timestamp') ||
        (colLower.includes('date') && stats.type !== 'numeric')) {
      return { field: col, ...stats, type: 'date' as AnaFieldType }
    }
    // Tag psychographic, demographic, and URL param fields by prefix
    var section: 'psychographic' | 'demographic' | 'url_param' | undefined = undefined
    if (colLower.startsWith('psycho_')) section = 'psychographic'
    else if (colLower.startsWith('demo_')) section = 'demographic'
    else if (colLower.startsWith('url_')) section = 'url_param'
    return { field: col, ...stats, ...(section ? { section } : {}) }
  })

  const firstOpenEnded = fields.find(function(f) { return f.type === 'open-ended' })
  return { fields, primaryTextField: firstOpenEnded?.field, autoDetected: true, version: 1 }
}

// Enrich a schema built without rows (e.g. study schema) with stats once rows arrive
export function enrichSchemaWithStats(
  schema: SchemaConfig,
  rows: Record<string, unknown>[]
): SchemaConfig {
  const enriched = schema.fields.map(function(f) {
    const colValues = rows.map(function(r) { return r[f.field] })
    const stats     = computeFieldStats(f.field, colValues)
    return { ...f, ...stats, type: f.type, sqt: f.sqt }
  })
  return { ...schema, fields: enriched }
}

// Merge new-batch row stats INTO an existing schema instead of replacing it.
// Use this on incremental syncs (Google Reviews, Reddit, etc.) so categorical
// `values` lists for per-batch fields (location, author, subreddit, ...) grow
// as new batches arrive, instead of being frozen at whatever the first batch
// contained. Numeric min/max widen to cover the new batch; user-set type/sqt/
// label/etc. are preserved.
export function mergeSchemaStats(
  schema: SchemaConfig,
  newRows: Record<string, unknown>[]
): SchemaConfig {
  if (!schema?.fields?.length || newRows.length === 0) return schema
  const merged = schema.fields.map(function(f) {
    const colValues = newRows.map(function(r) { return r[f.field] })
    const newStats  = computeFieldStats(f.field, colValues)
    const out: SchemaFieldConfig = { ...f }

    // Union new distinct values with existing; cap at 500 to bound JSON size.
    if ((f.type === 'categorical' || f.type === 'date') && Array.isArray(newStats.values) && newStats.values.length > 0) {
      const existing = Array.isArray(f.values) ? f.values : []
      const union    = Array.from(new Set([...existing, ...newStats.values])).sort().slice(0, 500)
      out.values = union
    }

    // Widen numeric range to cover the new batch.
    if (f.type === 'numeric') {
      if (typeof newStats.min === 'number') {
        out.min = (typeof f.min === 'number') ? Math.min(f.min, newStats.min) : newStats.min
      }
      if (typeof newStats.max === 'number') {
        out.max = (typeof f.max === 'number') ? Math.max(f.max, newStats.max) : newStats.max
      }
    }

    // Bump nonNullCount so schema diagnostics reflect cumulative rows.
    if (typeof newStats.nonNullCount === 'number' && newStats.nonNullCount > 0) {
      const prev = (typeof f.nonNullCount === 'number') ? f.nonNullCount : 0
      out.nonNullCount = prev + newStats.nonNullCount
    }

    return out
  })
  return { ...schema, fields: merged }
}

export function flattenCustomQuestions(
  payload: SurveyPayload | null | undefined,
  config: StudyConfig | null | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!payload || !payload.customAnswers || !config || !config.questions) return out
  for (const question of config.questions) {
    const raw = payload.customAnswers[question.id]
    if (raw == null) continue
    const colName = sanitizeColumnName(question.exportLabel || question.prompt || question.id)
    out[colName] = Array.isArray(raw) ? raw.join(', ') : raw
  }
  return out
}

export function flattenPsychographics(payload: SurveyPayload | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!payload || !payload.psychographics) return out
  for (const [key, val] of Object.entries(payload.psychographics)) {
    out['psycho_' + sanitizeColumnName(key)] = val
  }
  return out
}

export function flattenDemographics(payload: SurveyPayload | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!payload || !payload.demographics) return out
  for (const [key, val] of Object.entries(payload.demographics)) {
    out['demo_' + sanitizeColumnName(key)] = val
  }
  return out
}

export function flattenUrlParams(payload: SurveyPayload | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!payload || !payload.urlParams) return out
  for (const [key, val] of Object.entries(payload.urlParams)) {
    out['url_' + sanitizeColumnName(key)] = val
  }
  return out
}

interface ResponseRow {
  id:               string
  completed_at:     string | null
  nps_score:        number | null
  experience_score: number | null
  sentiment:        string | null
  duration_sec:     number | null
  payload:          SurveyPayload
  status?:          string | null
}

interface StudyForFormat {
  id:     string
  config: StudyConfig | null
}

export function formatResponsesAsRows(
  responses: ResponseRow[],
  study: StudyForFormat
): Record<string, unknown>[] {
  return responses.map(function(r) {
    const npsOn = !!study.config?.npsEnabled
    const expOn = study.config?.experienceEnabled !== false
    return {
      response_id:      r.id,
      status:           r.status === 'complete' ? 'Complete' : 'Partial',
      submitted_at:     r.completed_at ?? null,
      ...(npsOn ? { nps_score: r.nps_score ?? null } : {}),
      ...(expOn ? { experience_score: r.experience_score ?? null } : {}),
      sentiment:        r.sentiment        ?? null,
      duration_sec:     r.duration_sec     ?? null,
      ...(npsOn ? { nps_followup: r.payload?.openEnded?.q1 ?? null } : {}),
      ...(expOn ? { experience_followup: r.payload?.openEnded?.q2 ?? null } : {}),
      ...(study.config?.q3Enabled !== false ? { q3_response: r.payload?.openEnded?.q3 ?? null } : {}),
      ...(study.config?.q4Enabled !== false ? { q4_response: r.payload?.openEnded?.q4 ?? null } : {}),
      ...(r.payload ? flattenCustomQuestions(r.payload, study.config) : {}),
      ...(r.payload ? flattenPsychographics(r.payload) : {}),
      ...(r.payload ? flattenDemographics(r.payload) : {}),
      ...(r.payload ? flattenUrlParams(r.payload) : {}),
    }
  })
}

export function buildStudySchema(config: StudyConfig): SchemaConfig {
  const npsOn = !!config.npsEnabled
  const expOn = config.experienceEnabled !== false
  const ratingLabel = config.experienceRatingLabel || 'Rating'
  const fields: SchemaFieldConfig[] = [
    { field: 'response_id',      type: 'id' },
    { field: 'status',           type: 'categorical', label: 'Response Status' },
    { field: 'submitted_at',     type: 'date' },
    ...(npsOn ? [{ field: 'nps_score', type: 'numeric' as AnaFieldType, sqt: 'nps' as AnaFieldSqt }] : []),
    ...(expOn ? [{ field: 'experience_score', type: 'numeric' as AnaFieldType, sqt: 'rating' as AnaFieldSqt, label: ratingLabel, valueAliases: ratingAliases(config.ratingType || 'experience') || undefined }] : []),
    { field: 'sentiment',        type: 'categorical', sqt: 'single-select' },
    { field: 'duration_sec',         type: 'numeric',    sqt: 'numeric-input' },
    ...(npsOn ? [{ field: 'nps_followup', type: 'open-ended' as AnaFieldType, sqt: 'open-text' as AnaFieldSqt, label: (config.npsLabel || 'NPS') + ' Follow-up' }] : []),
    ...(expOn ? [{ field: 'experience_followup', type: 'open-ended' as AnaFieldType, sqt: 'open-text' as AnaFieldSqt, label: ratingLabel + ' Follow-up' }] : []),
    ...(config.q3Enabled !== false ? [{ field: 'q3_response', type: 'open-ended' as AnaFieldType, sqt: 'open-text' as AnaFieldSqt, label: config.q3ExportLabel || undefined, prompt: config.q3 || undefined }] : []),
    ...(config.q4Enabled !== false ? [{ field: 'q4_response', type: 'open-ended' as AnaFieldType, sqt: 'open-text' as AnaFieldSqt, label: config.q4ExportLabel || undefined, prompt: config.q4 || undefined }] : []),
  ]
  if (config.questions) {
    for (const q of config.questions) {
      const col  = sanitizeColumnName(q.exportLabel || q.prompt || q.id)
      const type: AnaFieldType = q.type === 'open' ? 'open-ended' : q.type === 'numeric' ? 'numeric' : 'categorical'
      fields.push({ field: col, type, sqt: type === 'open-ended' ? 'open-text' : 'single-select', label: q.exportLabel || undefined, prompt: q.prompt, section: 'custom' as any })
    }
  }
  if (config.psychographicBank) {
    for (const pq of config.psychographicBank) {
      fields.push({ field: 'psycho_' + sanitizeColumnName(pq.key), type: 'categorical', sqt: 'single-select', section: 'psychographic', label: pq.exportLabel || pq.q, prompt: pq.q })
    }
  }
  if (config.demoFields) {
    for (const df of config.demoFields) {
      if (!df.enabled) continue
      fields.push({ field: 'demo_' + sanitizeColumnName(df.key), type: 'categorical', sqt: df.type === 'text' ? 'open-text' : 'single-select', section: 'demographic', label: df.label, prompt: df.label })
    }
  }
  return { fields, primaryTextField: 'q3_response', autoDetected: false, version: 1 }
}

export function buildGoogleReviewsSchema(): SchemaConfig {
  const fields: SchemaFieldConfig[] = [
    { field: 'review_id',        type: 'id' },
    { field: 'author',           type: 'categorical', label: 'Author' },
    { field: 'rating',           type: 'numeric',     sqt: 'rating',    label: 'Star Rating', min: 1, max: 5 },
    { field: 'review_text',      type: 'open-ended',  sqt: 'open-text', label: 'Review' },
    { field: 'review_date',      type: 'date',        label: 'Review Date' },
    { field: 'location',         type: 'categorical', label: 'Location' },
    { field: 'location_name',    type: 'categorical', label: 'Location Name' },
    { field: 'location_address', type: 'ignore',      label: 'Address' },
    { field: 'location_city',    type: 'categorical', label: 'City' },
    { field: 'location_state',   type: 'categorical', label: 'State' },
    { field: 'place_id',         type: 'id' },
    { field: 'owner_response',   type: 'open-ended',  sqt: 'open-text', label: 'Owner Response' },
    { field: 'review_likes',     type: 'numeric',     label: 'Helpful Votes' },
  ]
  return { fields, primaryTextField: 'review_text', autoDetected: false, version: 1 }
}

export function buildRedditSchema(): SchemaConfig {
  const fields: SchemaFieldConfig[] = [
    { field: 'comment_id',      type: 'id' },
    { field: 'author',          type: 'categorical', label: 'Author' },
    { field: 'body',            type: 'open-ended',  sqt: 'open-text', label: 'Comment' },
    { field: 'score',           type: 'numeric',     label: 'Score (net)' },
    { field: 'ups',             type: 'numeric',     label: 'Upvotes' },
    { field: 'downs',           type: 'numeric',     label: 'Downvotes' },
    { field: 'controversiality', type: 'numeric',    label: 'Controversial' },
    { field: 'is_submitter',    type: 'categorical', label: 'Is OP' },
    { field: 'gilded',          type: 'numeric',     label: 'Gilded' },
    { field: 'total_awards',    type: 'numeric',     label: 'Awards' },
    { field: 'post_date',       type: 'date',        label: 'Date' },
    { field: 'subreddit',       type: 'categorical', label: 'Subreddit' },
    { field: 'thread_title',    type: 'categorical', label: 'Thread' },
    { field: 'thread_id',       type: 'id' },
    { field: 'depth',           type: 'numeric',     label: 'Reply Depth' },
    { field: 'permalink',       type: 'ignore',      label: 'Link' },
  ]
  return { fields, primaryTextField: 'body', autoDetected: false, version: 1 }
}

export function buildTownHallSchema(): SchemaConfig {
  const fields: SchemaFieldConfig[] = [
    { field: 'turn_id',          type: 'id' },
    { field: 'participant_id',   type: 'categorical', label: 'Participant' },
    { field: 'turn_number',      type: 'numeric',     label: 'Turn Number' },
    { field: 'bot_message',      type: 'open-ended',  sqt: 'open-text', label: 'Bot Question' },
    { field: 'user_message',     type: 'open-ended',  sqt: 'open-text', label: 'Response' },
    { field: 'topic',            type: 'categorical', label: 'Topic' },
    { field: 'topic_type',       type: 'categorical', label: 'Topic Type' },
    { field: 'source',           type: 'categorical', label: 'Turn Source' },
    { field: 'language',         type: 'categorical', label: 'Language' },
    { field: 'sentiment',        type: 'categorical', label: 'Sentiment' },
    { field: 'sentiment_score',  type: 'numeric',     label: 'Sentiment Score', min: -1, max: 1 },
    { field: 'responded_at',     type: 'date',        label: 'Date' },
  ]
  return { fields, primaryTextField: 'user_message', autoDetected: false, version: 1 }
}

export function buildBotSchema(): SchemaConfig {
  // One row per (assistant question, user response) pair from the bot
  // conversation substrate (legacy bot_conversation_turns or the Phase 3
  // conversation_turns table joined via conversations — both expose
  // session_id, turn_number, role, content, sentiment, etc. in the same
  // shape, so the schema is path-agnostic).
  // Mirrors buildTownHallSchema where it makes sense (sentiment, language,
  // open-ended user_message as primary text) but drops the topic/topic_type
  // fields since per-turn topics aren't tagged for bot conversations.
  //
  // Gap #6 (2026-05-22): the three town_hall_* fields are populated for
  // conversations linked to a town hall via town_hall_conversations. NULL /
  // empty-string for 1:1 widget conversations. Lets Ana filter the bot
  // dataset by town hall slug, name, or 'unlinked' (1:1 widget) to slice
  // multi-event customers (e.g. all Vindman events vs widget visitors).
  const fields: SchemaFieldConfig[] = [
    { field: 'turn_id',          type: 'id' },
    { field: 'session_id',       type: 'categorical', label: 'Conversation' },
    { field: 'turn_number',      type: 'numeric',     label: 'Turn Number' },
    { field: 'bot_message',      type: 'open-ended',  sqt: 'open-text', label: 'Bot Message' },
    { field: 'user_message',     type: 'open-ended',  sqt: 'open-text', label: 'User Message' },
    { field: 'language',         type: 'categorical', label: 'Language' },
    { field: 'sentiment',        type: 'categorical', label: 'Sentiment' },
    { field: 'sentiment_score',  type: 'numeric',     label: 'Sentiment Score', min: -1, max: 1 },
    { field: 'town_hall_slug',   type: 'categorical', label: 'Town Hall (slug)' },
    { field: 'town_hall_name',   type: 'categorical', label: 'Town Hall (name)' },
    { field: 'responded_at',     type: 'date',        label: 'Date' },
  ]
  return { fields, primaryTextField: 'user_message', autoDetected: false, version: 1 }
}

export function buildSubstackSchema(): SchemaConfig {
  const fields: SchemaFieldConfig[] = [
    { field: 'comment_id',      type: 'id' },
    { field: 'author',          type: 'categorical', label: 'Author' },
    { field: 'author_handle',   type: 'categorical', label: 'Handle' },
    { field: 'body',            type: 'open-ended',  sqt: 'open-text', label: 'Comment' },
    { field: 'likes',           type: 'numeric',     label: 'Likes' },
    { field: 'is_author_reply', type: 'categorical', label: 'Author Reply' },
    { field: 'post_title',      type: 'categorical', label: 'Post' },
    { field: 'post_date',       type: 'date',        label: 'Post Date' },
    { field: 'comment_date',    type: 'date',        label: 'Comment Date' },
    { field: 'depth',           type: 'numeric',     label: 'Reply Depth' },
    { field: 'children_count',  type: 'numeric',     label: 'Replies' },
    { field: 'restacks',        type: 'numeric',     label: 'Restacks' },
    { field: 'parent_id',       type: 'id' },
  ]
  return { fields, primaryTextField: 'body', autoDetected: false, version: 1 }
}

export function buildRegulationsSchema(): SchemaConfig {
  const fields: SchemaFieldConfig[] = [
    { field: 'comment_id',      type: 'id' },
    { field: 'comment_text',    type: 'open-ended',  sqt: 'open-text', label: 'Comment' },
    { field: 'commenter_name',  type: 'categorical', label: 'Commenter' },
    { field: 'organization',    type: 'categorical', label: 'Organization' },
    { field: 'city',            type: 'categorical', label: 'City' },
    { field: 'state',           type: 'categorical', label: 'State' },
    { field: 'country',         type: 'categorical', label: 'Country' },
    { field: 'posted_date',     type: 'date',        label: 'Date' },
    { field: 'agency',          type: 'categorical', label: 'Agency' },
    { field: 'docket_id',       type: 'categorical', label: 'Docket' },
    { field: 'document_id',     type: 'id' },
    { field: 'title',           type: 'categorical', label: 'Title' },
    { field: 'tracking_number', type: 'id' },
  ]
  return { fields, primaryTextField: 'comment_text', autoDetected: false, version: 1 }
}

export function buildSocialSchema(): SchemaConfig {
  const fields: SchemaFieldConfig[] = [
    { field: 'comment_id',      type: 'id' },
    { field: 'platform',        type: 'categorical', label: 'Platform' },
    { field: 'author_name',     type: 'categorical', label: 'Author' },
    { field: 'text',            type: 'open-ended',  sqt: 'open-text', label: 'Comment' },
    { field: 'sentiment',       type: 'categorical', label: 'Sentiment' },
    { field: 'sentiment_score', type: 'numeric',     label: 'Sentiment Score', min: -1, max: 1 },
    { field: 'emotion',         type: 'categorical', label: 'Emotion' },
    { field: 'topics',          type: 'categorical', label: 'Topics' },
    { field: 'intents',         type: 'categorical', label: 'Intents' },
    { field: 'is_hidden',       type: 'categorical', label: 'Hidden' },
    { field: 'is_deleted',      type: 'categorical', label: 'Deleted' },
    { field: 'is_reply',        type: 'categorical', label: 'Is Reply' },
    { field: 'post_text',       type: 'open-ended',  sqt: 'open-text', label: 'Post Text' },
    { field: 'comment_date',    type: 'date',        label: 'Date' },
    { field: 'flag_types',      type: 'categorical', label: 'Flag Types' },
    { field: 'max_severity',    type: 'categorical', label: 'Max Severity' },
  ]
  return { fields, primaryTextField: 'text', autoDetected: false, version: 1 }
}

export function buildRecordingSchema(): SchemaConfig {
  // One row per extracted unit from a Q&A recording (focus_group / interview /
  // meeting variants add fields here when those session types ship).
  // primaryTextField = 'response_text' which the analyzer fills with
  // "<question> → <answer>" so TextMine / theme mining work on the combined
  // exchange without further configuration.
  const fields: SchemaFieldConfig[] = [
    { field: 'extraction_id',   type: 'id' },
    { field: 'response_text',   type: 'open-ended',  sqt: 'open-text', label: 'Question → Answer' },
    { field: 'question',        type: 'open-ended',  sqt: 'open-text', label: 'Question' },
    { field: 'answer',          type: 'open-ended',  sqt: 'open-text', label: 'Answer' },
    { field: 'topic',           type: 'categorical', label: 'Topic' },
    { field: 'typology',        type: 'categorical', label: 'Question Type' },
    { field: 'asker',           type: 'categorical', label: 'Asker' },
    { field: 'panelist',        type: 'categorical', label: 'Panelist' },
    { field: 'confidence',      type: 'numeric',     label: 'Confidence', min: 0, max: 1 },
    { field: 'flagged',         type: 'categorical', label: 'Flagged for Review' },
    { field: 'flag_reason',     type: 'categorical', label: 'Flag Reason' },
    { field: 'start_sec',       type: 'numeric',     label: 'Start (sec)' },
    { field: 'source_file',     type: 'categorical', label: 'Source Clip' },
  ]
  return { fields, primaryTextField: 'response_text', autoDetected: false, version: 1 }
}

export function emptyThemeModel() {
  return { themes: [] as unknown[], aiGenerated: false, version: 1 }
}

export function emptySchemaConfig(): SchemaConfig {
  return { fields: [], autoDetected: true, version: 1 }
}
