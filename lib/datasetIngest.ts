// lib/datasetIngest.ts
// Server-side dataset ingest (2026-09-02) — replaces the browser-driven batch
// upload for file datasets. The browser now streams the RAW file straight to
// Storage (one transfer at link speed) and this worker does everything else:
// parse (the same lib/csv functions the client preview uses), filter to the
// selected columns, auto-detect the schema, insert rows in large batches, and
// finish with the analytics compute — so the user's tab is no longer
// load-bearing and a 126K-row file is minutes of serial POSTs no more.
//
// State machine lives in dataset_state.analytics.ingest (atomic per-key merge
// via merge_dataset_analytics, sql precedent):
//   { status: running | paused | done | error, rowsDone, rowsTotal, path,
//     filename, format, includedCols, fieldAliases, error?, startedAt,
//     heartbeatAt }
// The worker checkpoints rowsDone after every insert wave; if its time budget
// expires it marks `paused` and the upload page's poller re-POSTs to continue.
// Resume is idempotent even if a previous run died mid-batch: it trusts
// max(row_index) in the table over the checkpoint, so rows are never written
// twice. `error` keeps the dataset + file for a retry; `done` deletes the
// uploaded file from Storage.

import type { SupabaseClient } from '@supabase/supabase-js'
import { parseCSV, parseTSV, parseSurveyMonkeyCSV } from '@/lib/csv'
import { autoDetectSchema } from '@/lib/datasetUtils'
import { stampRowSubstantive } from '@/lib/usefulness'
import { retryTransientResult } from '@/lib/retryTransient'
import { computeAnalyticsSQL } from '@/lib/analyticsCompute'
import { mergeDatasetAnalytics } from '@/lib/datasetAnalytics'
import { logError } from '@/lib/log'

export const UPLOAD_BUCKET = 'dataset-uploads'

export type IngestFormat = 'csv' | 'tsv' | 'json' | 'surveymonkey'

export interface IngestState {
  status: 'running' | 'paused' | 'done' | 'error'
  rowsDone: number
  rowsTotal: number
  path: string
  filename: string
  format: IngestFormat
  includedCols: string[]
  fieldAliases: Record<string, string>
  error?: string
  startedAt: string
  heartbeatAt: string
}

// Rows per INSERT. The legacy client POSTed 200-row chunks over HTTP; a
// service-role insert from the same region tolerates far more. ~1KB/row keeps
// this well under PostgREST body ceilings.
const INSERT_BATCH = 500
// Progress/heartbeat checkpoint cadence, in insert waves.
const CHECKPOINT_EVERY = 4
// A heartbeat older than this means the previous worker invocation is dead
// (function killed, deploy, crash) and a continue may take over.
export const HEARTBEAT_STALE_MS = 45_000

async function mergeIngest(service: SupabaseClient, datasetId: string, patch: Partial<IngestState>): Promise<void> {
  const { error } = await service.rpc('merge_dataset_analytics', {
    p_dataset_id: datasetId,
    p_patch: { ingest: { ...patch, heartbeatAt: new Date().toISOString() } },
  })
  if (error) void logError('datasetIngest.mergeIngest', error, { datasetId })
}

export async function readIngestState(service: SupabaseClient, datasetId: string): Promise<IngestState | null> {
  const { data, error } = await service
    .from('dataset_state').select('ing:analytics->ingest').eq('dataset_id', datasetId).maybeSingle()
  if (error) { void logError('datasetIngest.readIngestState', error, { datasetId }); return null }
  const ing = (data as { ing?: Partial<IngestState> | null } | null)?.ing
  if (!ing || typeof ing !== 'object' || !ing.status) return null
  // merge_dataset_analytics shallow-merges the `ingest` key as a whole, so a
  // stored state is always complete; the cast is the untyped-jsonb boundary.
  return ing as IngestState
}

function parseByFormat(text: string, format: IngestFormat): Record<string, unknown>[] {
  if (format === 'json') {
    const parsed = JSON.parse(text) as unknown
    return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [parsed as Record<string, unknown>]
  }
  if (format === 'tsv') return parseTSV(text)
  if (format === 'surveymonkey') return parseSurveyMonkeyCSV(text).rows
  return parseCSV(text)
}

/** Parse + column-filter, exactly as the legacy client did before POSTing. */
export function parseAndFilter(text: string, format: IngestFormat, includedCols: string[]): Record<string, unknown>[] {
  const rows = parseByFormat(text, format)
  const cols = includedCols.length ? includedCols : Object.keys(rows[0] || {})
  return rows.map((row) => {
    const filtered: Record<string, unknown> = {}
    for (const c of cols) filtered[c] = row[c]
    return filtered
  })
}

/**
 * Run (or resume) the ingest for a dataset until done, error, or the deadline.
 * Returns the terminal-for-this-invocation status.
 */
export async function runIngest(
  service: SupabaseClient,
  datasetId: string,
  userId: string | null,
  deadlineMs: number = 250_000,
): Promise<'done' | 'paused' | 'error'> {
  const startedAt = Date.now()
  const st = await readIngestState(service, datasetId)
  if (!st) return 'error'
  try {
    // 1. File from Storage → text. (Whole-file parse: a 100MB CSV is a fine
    //    Node string; the checkpoint is a row offset, so a resume re-parses —
    //    parsing is seconds, the inserts are the long part.)
    const { data: blob, error: dlErr } = await service.storage.from(UPLOAD_BUCKET).download(st.path)
    if (dlErr || !blob) throw new Error('could not read uploaded file: ' + (dlErr?.message || 'empty'))
    const text = await blob.text()

    const rows = parseAndFilter(text, st.format, st.includedCols)
    if (rows.length === 0) throw new Error('No data rows found in the uploaded file.')

    // 2. First run: write the auto-detected schema (same function + alias
    //    application the client used to do), preserving the state row's other
    //    fields. Detect "first run" from the table, not the checkpoint — the
    //    truth about what's inserted lives in row_index.
    const { data: maxRow } = await service
      .from('dataset_rows_flat').select('row_index').eq('dataset_id', datasetId)
      .order('row_index', { ascending: false }).limit(1)
    let nextRow = maxRow && maxRow.length > 0 ? Number(maxRow[0].row_index) + 1 : 0

    if (nextRow === 0) {
      const schema = autoDetectSchema(rows)
      for (const f of schema.fields) {
        const alias = st.fieldAliases?.[f.field]
        if (alias && alias.trim()) f.label = alias.trim()
      }
      const { error: schemaErr } = await service
        .from('dataset_state')
        .update({ schema_config: schema, updated_at: new Date().toISOString(), ...(userId ? { updated_by: userId } : {}) })
        .eq('dataset_id', datasetId)
      if (schemaErr) throw new Error('schema write failed: ' + schemaErr.message)
    }

    await mergeIngest(service, datasetId, { status: 'running', rowsTotal: rows.length, rowsDone: nextRow })

    // 3. Insert from the resume point in waves, checkpointing as we go.
    let wave = 0
    while (nextRow < rows.length) {
      if (Date.now() - startedAt > deadlineMs) {
        await mergeIngest(service, datasetId, { status: 'paused', rowsDone: nextRow, rowsTotal: rows.length })
        return 'paused'
      }
      const batch = rows.slice(nextRow, nextRow + INSERT_BATCH)
      const flatRows = batch.map((r, i) =>
        stampRowSubstantive({ dataset_id: datasetId, row_index: nextRow + i, data: r }))
      const ins = await retryTransientResult(async () => await service.from('dataset_rows_flat').insert(flatRows))
      if (ins.error) throw new Error('row insert failed at row ' + nextRow + ': ' + ins.error.message)
      nextRow += batch.length
      wave++
      if (wave % CHECKPOINT_EVERY === 0 || nextRow >= rows.length) {
        await mergeIngest(service, datasetId, { status: 'running', rowsDone: nextRow, rowsTotal: rows.length })
        await service.from('datasets')
          .update({ row_count: nextRow, updated_at: new Date().toISOString() })
          .eq('id', datasetId)
      }
    }

    // 4. Finalize: exact row_count, analytics compute (non-fatal, same as the
    //    legacy flow's fire-and-check), then done + file cleanup.
    await service.from('datasets')
      .update({ row_count: rows.length, updated_at: new Date().toISOString() })
      .eq('id', datasetId)
    try {
      const { data: stateRow } = await service
        .from('dataset_state').select('schema_config').eq('dataset_id', datasetId).single()
      const schema = stateRow?.schema_config
      if (schema?.fields?.length) {
        const analytics = await computeAnalyticsSQL(service, datasetId, schema)
        await mergeDatasetAnalytics(service, datasetId, analytics as unknown as Record<string, unknown>)
      }
    } catch (e) {
      // Same posture as the legacy client: compute failure leaves the dataset
      // usable; the user can re-trigger from settings.
      void logError('datasetIngest.compute', e, { datasetId })
    }
    await mergeIngest(service, datasetId, { status: 'done', rowsDone: rows.length, rowsTotal: rows.length })
    try { await service.storage.from(UPLOAD_BUCKET).remove([st.path]) } catch { /* best-effort cleanup */ }
    return 'done'
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    void logError('datasetIngest.run', e, { datasetId })
    await mergeIngest(service, datasetId, { status: 'error', error: msg })
    return 'error'
  }
}
