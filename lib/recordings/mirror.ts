// lib/recordings/mirror.ts
//
// Mirror recording_extractions into dataset_rows_flat against the recording's
// derived dataset. Per docs/RECORDINGS.md § 2.6 + § 3.7.
//
// Idempotent at the call-site level: each call inserts the supplied
// extractions and bumps row_count + row_index. If callers want a full rebuild,
// delete the recording's existing dataset_rows_flat first; this helper
// appends.

import 'server-only'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { buildRecordingSchema, emptyThemeModel } from '@/lib/datasetUtils'
import type {
  NewExtraction,
  RecordingExtractionRow,
  QaPairPayload,
  ActionItemPayload,
} from '@/lib/recordings/types'

export interface MirrorInput {
  recording_id: string
  org_id: string
  recording_name: string
  created_by: string
  extractions: NewExtraction[]
  // §3.5c — when set, stamped on the derived dataset so the sql/062 trigger folds
  // it into the brand collection (the meeting feeds brand-level entity analysis).
  brand_tag?: string | null
}

export interface MirrorResult {
  dataset_id: string
  rows_inserted: number
  extractions_inserted: number
}

/**
 * Create or reuse the recording's dataset, insert the extractions into
 * recording_extractions, then mirror them into dataset_rows_flat.
 *
 * Returns the dataset_id so the caller can update recordings.dataset_id.
 */
export async function mirrorExtractionsToDataset(input: MirrorInput): Promise<MirrorResult> {
  const service = createServiceRoleClient()

  // 1. Ensure the dataset exists and is bound to this recording.
  const datasetId = await ensureRecordingDataset(service, input)

  // 2. Insert extraction rows (DB assigns id + created_at; we set sort_order).
  const extractionInserts = input.extractions.map(e => ({
    org_id: input.org_id,
    recording_id: input.recording_id,
    unit_type: e.unit_type,
    topic: e.topic,
    payload: e.payload,
    start_sec: e.start_sec,
    end_sec: e.end_sec,
    source_file: e.source_file,
    confidence: e.confidence,
    flagged_for_review: e.flagged_for_review,
    flag_reason: e.flag_reason,
    sort_order: e.sort_order,
  }))

  const { data: insertedExtractions, error: extractionErr } = await service
    .from('recording_extractions')
    .insert(extractionInserts)
    .select('id, unit_type, payload, topic, start_sec, source_file, confidence, flagged_for_review, flag_reason')

  if (extractionErr) {
    throw new Error(`Failed to insert recording_extractions: ${extractionErr.message}`)
  }

  // 3. Find next row_index for the dataset (in case mirror is called twice).
  const { data: maxRow } = await service
    .from('dataset_rows_flat')
    .select('row_index')
    .eq('dataset_id', datasetId)
    .order('row_index', { ascending: false })
    .limit(1)
  const startIndex = maxRow && maxRow.length > 0 ? maxRow[0].row_index + 1 : 0

  // 4. Map each extraction to a dataset_rows_flat row per spec § 2.6.
  const flatRows = (insertedExtractions || []).map((ex, i) => ({
    dataset_id: datasetId,
    row_index: startIndex + i,
    data: flatRowDataFromExtraction(ex as Pick<RecordingExtractionRow, 'id' | 'unit_type' | 'payload' | 'topic' | 'start_sec' | 'source_file' | 'confidence' | 'flagged_for_review' | 'flag_reason'>),
  }))

  if (flatRows.length > 0) {
    const { error: flatErr } = await service.from('dataset_rows_flat').insert(flatRows)
    if (flatErr) {
      throw new Error(`Failed to insert dataset_rows_flat: ${flatErr.message}`)
    }
  }

  // 5. Update dataset row_count.
  const newTotal = startIndex + flatRows.length
  await service
    .from('datasets')
    .update({ row_count: newTotal, updated_at: new Date().toISOString() })
    .eq('id', datasetId)

  return {
    dataset_id: datasetId,
    rows_inserted: flatRows.length,
    extractions_inserted: insertedExtractions?.length ?? 0,
  }
}

async function ensureRecordingDataset(
  service: ReturnType<typeof createServiceRoleClient>,
  input: MirrorInput,
): Promise<string> {
  // Already linked? Reuse it.
  const { data: existingRec } = await service
    .from('recordings')
    .select('dataset_id')
    .eq('id', input.recording_id)
    .eq('org_id', input.org_id)
    .single()

  if (existingRec?.dataset_id) return existingRec.dataset_id as string

  // Otherwise create the dataset + dataset_state and link it back.
  const { data: newDataset, error: dsErr } = await service
    .from('datasets')
    .insert({
      name: input.recording_name,
      org_id: input.org_id,
      created_by: input.created_by,
      source: 'recording',
      row_count: 0,
      description: JSON.stringify({ recording_id: input.recording_id }),
      // §3.5c — brand tag (if any) → sql/062 trigger joins the brand collection.
      ...(input.brand_tag ? { brand_tag: input.brand_tag } : {}),
    })
    .select('id')
    .single()

  if (dsErr || !newDataset) {
    throw new Error(`Failed to create dataset for recording: ${dsErr?.message ?? 'unknown'}`)
  }

  await service.from('dataset_state').insert({
    dataset_id: newDataset.id,
    schema_config: buildRecordingSchema(),
    theme_model: emptyThemeModel(),
  })

  await service
    .from('recordings')
    .update({ dataset_id: newDataset.id })
    .eq('id', input.recording_id)
    .eq('org_id', input.org_id)

  return newDataset.id as string
}

function flatRowDataFromExtraction(ex: Pick<RecordingExtractionRow, 'id' | 'unit_type' | 'payload' | 'topic' | 'start_sec' | 'source_file' | 'confidence' | 'flagged_for_review' | 'flag_reason'>): Record<string, unknown> {
  // Action items carry a different payload shape; mirror them with their own
  // text so TextMine doesn't choke on a missing question/answer.
  if (ex.unit_type === 'action_item') {
    const ai = ex.payload as ActionItemPayload
    return {
      extraction_id: ex.id,
      response_text: ai.description,
      question: null,
      answer: null,
      topic: ex.topic ?? 'Action Items',
      typology: 'action_item',
      asker: null,
      panelist: ai.owner ?? null,
      sentiment: 'neutral',
      confidence: ex.confidence,
      flagged: ex.flagged_for_review ? 'yes' : 'no',
      flag_reason: ex.flag_reason ?? null,
      start_sec: ex.start_sec,
      source_file: ex.source_file ?? null,
    }
  }

  const qa = ex.payload as QaPairPayload
  const combined = `${qa.question} → ${qa.answer}`
  return {
    extraction_id: ex.id,
    response_text: combined,
    question: qa.question,
    answer: qa.answer,
    topic: ex.topic ?? 'Other',
    typology: qa.question_typology,
    asker: qa.asker_name ?? null,
    panelist: qa.panelist_name ?? null,
    sentiment: qa.sentiment ?? 'neutral',
    confidence: ex.confidence,
    flagged: ex.flagged_for_review ? 'yes' : 'no',
    flag_reason: ex.flag_reason ?? null,
    start_sec: ex.start_sec,
    source_file: ex.source_file ?? null,
  }
}
