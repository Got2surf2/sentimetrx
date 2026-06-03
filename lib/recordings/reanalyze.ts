// lib/recordings/reanalyze.ts
//
// § 4.11 — re-extract pairs from the stored transcript with optional user
// instructions. Two scopes:
//
//   scope='all'    full meeting. Delete every recording_extractions row +
//                  its mirrored dataset_rows_flat row, then run the full
//                  Opus + Sonnet pass against the entire transcript.
//
//   scope='topic'  one section only. Compute the topic-scoped transcript
//                  span (union of existing extractions' [start − 60s,
//                  end + 60s] ranges, merged), delete extractions with
//                  topic = X + their mirror rows, run Opus + Sonnet on
//                  the scoped slice with topicScopedTo=X. Other topics'
//                  pairs are untouched.
//
// instructions is free-text passed through both Opus and Sonnet prompts so
// the curator honors the same steer. No ASR is re-run — this re-uses the
// stored recording_transcripts.segments.

import 'server-only'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { analyzeRecording } from '@/lib/recordings/analyze'
import { mirrorExtractionsToDataset } from '@/lib/recordings/mirror'
import { computeCoverage } from '@/lib/recordings/coverage'
import type {
  CoverageReport,
  RecordingExtractionRow,
  RecordingRow,
  TranscriptSegment,
} from '@/lib/recordings/types'

const TOPIC_SCOPE_PAD_SEC = 60

export type ReanalyzeScope = 'all' | 'topic'

export interface ReanalyzeInput {
  recording_id: string
  org_id: string
  scope: ReanalyzeScope
  topic?: string                   // required when scope='topic'
  instructions?: string
}

export interface ReanalyzeResult {
  scope: ReanalyzeScope
  extractions_count: number        // new total for 'all', new pairs added for 'topic'
  replaced: number                 // how many existing rows were deleted
  coverage_report: CoverageReport
  cost_delta_cents: number
}

export async function reanalyzeRecording(input: ReanalyzeInput): Promise<ReanalyzeResult> {
  if (input.scope === 'topic' && !input.topic) {
    throw new Error('scope="topic" requires a topic')
  }
  const service = createServiceRoleClient()

  // 1. Load recording + transcript.
  const { data: recRow, error: rErr } = await service
    .from('recordings')
    .select('id, org_id, name, created_by, session_type, setup_inputs, status, cost_cents, source_duration_sec, dataset_id')
    .eq('id', input.recording_id)
    .eq('org_id', input.org_id)
    .single()
  if (rErr || !recRow) throw new Error('recording not found')
  const recording = recRow as unknown as Pick<RecordingRow, 'id' | 'org_id' | 'name' | 'created_by' | 'session_type' | 'setup_inputs' | 'status' | 'cost_cents' | 'source_duration_sec' | 'dataset_id'>
  if (recording.session_type !== 'qa') {
    throw new Error(`reanalyze v1 only supports session_type='qa' (got '${recording.session_type}')`)
  }
  if (recording.status !== 'complete') {
    throw new Error(`recording must be status='complete' to reanalyze (currently '${recording.status}')`)
  }

  const { data: txRow, error: txErr } = await service
    .from('recording_transcripts')
    .select('segments')
    .eq('recording_id', input.recording_id)
    .eq('org_id', input.org_id)
    .maybeSingle()
  if (txErr || !txRow) throw new Error('transcript not found — cannot reanalyze without it')
  const allSegments = (txRow.segments ?? []) as TranscriptSegment[]

  // 2. Delete the rows that the new pass will replace (and their mirrors).
  let toDeleteIds: string[] = []
  let scopedTranscript: TranscriptSegment[] = allSegments
  if (input.scope === 'all') {
    const { data: existingIds } = await service
      .from('recording_extractions')
      .select('id')
      .eq('recording_id', input.recording_id)
      .eq('org_id', input.org_id)
    toDeleteIds = ((existingIds ?? []) as Array<{ id: string }>).map(r => r.id)
  } else {
    // scope='topic'
    const { data: topicRows } = await service
      .from('recording_extractions')
      .select('id, start_sec, end_sec')
      .eq('recording_id', input.recording_id)
      .eq('org_id', input.org_id)
      .eq('topic', input.topic as string)
    const rows = (topicRows ?? []) as Array<{ id: string; start_sec: number | null; end_sec: number | null }>
    if (rows.length === 0) {
      throw new Error(`no existing pairs found with topic="${input.topic}"`)
    }
    toDeleteIds = rows.map(r => r.id)

    const ranges = rows
      .filter(r => r.start_sec != null && r.end_sec != null)
      .map(r => [Math.max(0, (r.start_sec as number) - TOPIC_SCOPE_PAD_SEC), (r.end_sec as number) + TOPIC_SCOPE_PAD_SEC] as [number, number])
    const merged = mergeRanges(ranges)
    scopedTranscript = sliceByRanges(allSegments, merged)
    if (scopedTranscript.length === 0) {
      throw new Error('topic-scoped transcript window is empty — every existing extraction may be missing start_sec/end_sec')
    }
  }

  await deleteExtractionsAndMirror(service, input.recording_id, input.org_id, recording.dataset_id, toDeleteIds)

  // 3. Run the new Opus + Sonnet pass.
  const analysis = await analyzeRecording({
    recording_id: input.recording_id,
    org_id: input.org_id,
    session_type: recording.session_type,
    setup_inputs: recording.setup_inputs,
    transcript: scopedTranscript,
    instructions: input.instructions,
    topicScopedTo: input.scope === 'topic' ? input.topic : undefined,
  })

  // 4. Mirror new extractions into the dataset (appends).
  await mirrorExtractionsToDataset({
    recording_id: input.recording_id,
    org_id: input.org_id,
    recording_name: recording.name,
    created_by: recording.created_by,
    extractions: analysis.extractions,
  })

  // 5. Recompute coverage from the full extraction set.
  const { data: allEx } = await service
    .from('recording_extractions')
    .select('topic, confidence, start_sec, end_sec, flagged_for_review, payload, unit_type, sort_order, source_file, flag_reason')
    .eq('recording_id', input.recording_id)
    .eq('org_id', input.org_id)
  const allExRows = (allEx ?? []) as unknown as RecordingExtractionRow[]
  const coverage = computeCoverage({
    setup_inputs: recording.setup_inputs,
    extractions: allExRows.map(e => ({
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
    })),
    source_duration_sec: recording.source_duration_sec,
  })

  // 6. Bump cost + write coverage. For 'all', also bump completed_at (spec § 4.11).
  // analysis_summary is whole-meeting, so only refresh it on a full re-extract;
  // a topic-scoped re-run leaves the existing summary intact.
  const patch: Record<string, unknown> = {
    coverage_report: coverage,
    cost_cents: (recording.cost_cents ?? 0) + analysis.total_cost_cents,
  }
  if (input.scope === 'all') {
    patch.completed_at = new Date().toISOString()
    patch.analysis_summary = analysis.analysis_summary
  }
  await service
    .from('recordings')
    .update(patch)
    .eq('id', input.recording_id)
    .eq('org_id', input.org_id)

  return {
    scope: input.scope,
    extractions_count: input.scope === 'all' ? allExRows.length : analysis.extractions.length,
    replaced: toDeleteIds.length,
    coverage_report: coverage,
    cost_delta_cents: analysis.total_cost_cents,
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function deleteExtractionsAndMirror(
  service: ReturnType<typeof createServiceRoleClient>,
  recording_id: string,
  org_id: string,
  dataset_id: string | null,
  extractionIds: string[],
): Promise<void> {
  if (extractionIds.length === 0) return

  // Delete dataset_rows_flat rows whose data.extraction_id matches one of ours.
  if (dataset_id) {
    // Supabase JS doesn't support `data->>extraction_id IN (list)` directly via .in()
    // when the column is JSONB-extracted, so issue per-id deletes in batches.
    const BATCH = 100
    for (let i = 0; i < extractionIds.length; i += BATCH) {
      const batch = extractionIds.slice(i, i + BATCH)
      for (const id of batch) {
        await service
          .from('dataset_rows_flat')
          .delete()
          .eq('dataset_id', dataset_id)
          .filter('data->>extraction_id', 'eq', id)
      }
    }
  }

  await service
    .from('recording_extractions')
    .delete()
    .eq('recording_id', recording_id)
    .eq('org_id', org_id)
    .in('id', extractionIds)
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  if (ranges.length === 0) return []
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  const out: Array<[number, number]> = []
  let [curLo, curHi] = sorted[0]
  for (let i = 1; i < sorted.length; i++) {
    const [lo, hi] = sorted[i]
    if (lo <= curHi) {
      curHi = Math.max(curHi, hi)
    } else {
      out.push([curLo, curHi])
      ;[curLo, curHi] = [lo, hi]
    }
  }
  out.push([curLo, curHi])
  return out
}

function sliceByRanges(segments: TranscriptSegment[], ranges: Array<[number, number]>): TranscriptSegment[] {
  if (ranges.length === 0) return []
  return segments.filter(s => ranges.some(([lo, hi]) => s.end >= lo && s.start <= hi))
}
