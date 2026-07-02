// lib/recordings/regenerate.ts
//
// Per-card regenerate (§ 4.10). Sonnet 4.6 on a single extraction +
// the ±30s transcript window. Cheap — ~$0.005-$0.02 per call.
//
// Output replaces the row's payload + topic + confidence + flagged state.
// If the topic changes, coverage_report is recomputed; otherwise we leave
// it alone (coverage is unaffected by within-topic content changes).
//
// Span (start_sec / end_sec / unit_type) is NOT edited by this path — span
// changes are a § 4.11 scoped re-extract concern (Opus, full pair structure).

import 'server-only'
import { callAI } from '@/lib/ai'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { buildQaRegeneratePrompt, VALID_TYPOLOGIES } from '@/lib/recordings/prompts/qa'
import { polishQaPairs } from '@/lib/recordings/analyze'
import { glossaryFromEntities } from '@/lib/recordings/entities'
import { computeCoverage } from '@/lib/recordings/coverage'
import { logError } from '@/lib/log'
import type {
  CoverageReport,
  NewExtraction,
  QaPairPayload,
  QaSetupInputs,
  QuestionTypology,
  RecordingExtractionRow,
  RecordingRow,
  RecordingTranscriptRow,
  TranscriptSegment,
} from '@/lib/recordings/types'

const SONNET_MODEL = 'claude-sonnet-4-6'
const TRANSCRIPT_WINDOW_PAD_SEC = 30
const LOW_CONFIDENCE_THRESHOLD = 0.65   // matches lib/recordings/analyze.ts

export interface RegenerateInput {
  recording_id: string
  org_id: string
  extraction_id: string
  instructions?: string
}

export interface RegenerateResult {
  extraction: RecordingExtractionRow
  cost_cents: number
  coverage_report: CoverageReport | null   // populated only when topic changed
}

export async function regenerateExtraction(input: RegenerateInput): Promise<RegenerateResult> {
  const service = createServiceRoleClient()

  // 1. Load extraction + recording + transcript in parallel.
  const [exRes, recRes, txRes] = await Promise.all([
    service
      .from('recording_extractions')
      .select('*')
      .eq('id', input.extraction_id)
      .eq('recording_id', input.recording_id)
      .eq('org_id', input.org_id)
      .single(),
    service
      .from('recordings')
      .select('id, org_id, name, created_by, session_type, setup_inputs, status, cost_cents, source_duration_sec, coverage_report, dataset_id, entity_map')
      .eq('id', input.recording_id)
      .eq('org_id', input.org_id)
      .single(),
    service
      .from('recording_transcripts')
      .select('segments')
      .eq('recording_id', input.recording_id)
      .eq('org_id', input.org_id)
      .maybeSingle(),
  ])

  if (exRes.error || !exRes.data) throw new Error('extraction not found')
  if (recRes.error || !recRes.data) throw new Error('recording not found')
  if (!txRes.data) throw new Error('transcript not found — cannot regenerate without context')

  const existing = exRes.data as unknown as RecordingExtractionRow
  const recording = recRes.data as unknown as Pick<RecordingRow, 'id' | 'org_id' | 'name' | 'created_by' | 'session_type' | 'setup_inputs' | 'status' | 'cost_cents' | 'source_duration_sec' | 'coverage_report' | 'dataset_id' | 'entity_map'>
  if (recording.session_type !== 'qa') {
    throw new Error(`regenerate v1 only supports session_type='qa' (got '${recording.session_type}')`)
  }
  if (recording.status !== 'complete') {
    throw new Error(`recording must be status='complete' to regenerate (currently '${recording.status}')`)
  }

  const allSegments = (txRes.data.segments ?? []) as TranscriptSegment[]
  const window = sliceWindow(allSegments, existing.start_sec, existing.end_sec)

  // 2. Sonnet pass.
  const { system, userPrompt } = buildQaRegeneratePrompt({
    setup: recording.setup_inputs as QaSetupInputs,
    existing: {
      topic: existing.topic,
      payload: existing.payload as QaPairPayload,
      confidence: existing.confidence,
      start_sec: existing.start_sec,
      end_sec: existing.end_sec,
    },
    transcriptWindow: window,
    instructions: input.instructions,
  })

  const resp = await callAI({
    tier: 'advanced',
    modelOverride: SONNET_MODEL,
    maxTokens: 1500,
    timeoutMs: 300000,   // 5 min — callAI's 15s default is far too short here
    system: [{ type: 'text', text: system, cache: true }],
    messages: [{ role: 'user', content: userPrompt }],
    usage: {
      org_id: input.org_id,
      resource_type: 'recording',
      resource_id: input.recording_id,
      event_type: 'recording_regenerate',
    },
  })

  const revised = parseRegenerateResponse(resp.text)
  if (!revised) throw new Error('Sonnet returned an unparseable response')

  // 3. Persist the revised row.
  const newConfidence = clamp01(revised.confidence)
  const newPayload: QaPairPayload = {
    question: revised.question,
    asker_name: revised.asker_name ?? null,
    answer: revised.answer,
    panelist_name: revised.panelist_name ?? null,
    question_typology: revised.question_typology,
  }

  // Re-polish the revised pair so it keeps a public-shareable version (the main
  // pipeline polishes in bulk; without this a regenerated pair would lose its
  // polished text). Non-fatal — falls back to verbatim.
  const polish = await polishQaPairs(
    [{ question: newPayload.question, answer: newPayload.answer }],
    {
      org_id: input.org_id,
      recording_id: input.recording_id,
      glossary: glossaryFromEntities(recording.entity_map ?? null, (recording.setup_inputs as QaSetupInputs).glossary),
    },
  )
  if (polish.polished[0]) {
    newPayload.polished_question = polish.polished[0].question
    newPayload.polished_answer = polish.polished[0].answer
  }

  const newTopic = revised.topic
  const flaggedForReview = newConfidence < LOW_CONFIDENCE_THRESHOLD
  const flagReason = flaggedForReview ? 'low_confidence' : null
  const topicChanged = newTopic !== (existing.topic ?? '')

  const { data: updRow, error: updErr } = await service
    .from('recording_extractions')
    .update({
      topic: newTopic,
      payload: newPayload,
      confidence: newConfidence,
      flagged_for_review: flaggedForReview,
      flag_reason: flagReason,
    })
    .eq('id', input.extraction_id)
    .eq('recording_id', input.recording_id)
    .eq('org_id', input.org_id)
    .select('*')
    .single()
  if (updErr || !updRow) throw new Error(`extraction update failed: ${updErr?.message ?? 'no row returned'}`)
  const updated = updRow as unknown as RecordingExtractionRow

  // 4. Update the mirror row in dataset_rows_flat so /analyze surfaces stay in sync.
  if (recording.dataset_id) {
    await service
      .from('dataset_rows_flat')
      .update({
        data: {
          extraction_id: updated.id,
          response_text: `${newPayload.question} → ${newPayload.answer}`,
          question: newPayload.question,
          answer: newPayload.answer,
          topic: newTopic ?? 'Other',
          typology: newPayload.question_typology,
          asker: newPayload.asker_name ?? null,
          panelist: newPayload.panelist_name ?? null,
          confidence: newConfidence,
          flagged: flaggedForReview ? 'yes' : 'no',
          flag_reason: flagReason,
          start_sec: updated.start_sec,
          source_file: updated.source_file ?? null,
        },
      })
      .eq('dataset_id', recording.dataset_id)
      .filter('data->>extraction_id', 'eq', updated.id)
  }

  // 5. Cost accounting — Sonnet cents (regenerate + polish) added to recordings.cost_cents.
  const sonnetCents = centsFromSonnet(resp.usage) + polish.cents
  await service
    .from('recordings')
    .update({ cost_cents: (recording.cost_cents ?? 0) + sonnetCents })
    .eq('id', input.recording_id)
    .eq('org_id', input.org_id)

  // 6. Recompute coverage only when topic changed.
  let coverage_report: CoverageReport | null = null
  if (topicChanged) {
    // Pull the full extractions list to recompute coverage.
    const { data: allEx, error: allExErr } = await service
      .from('recording_extractions')
      .select('topic, confidence, start_sec, end_sec, flagged_for_review, payload, unit_type, sort_order, source_file, flag_reason')
      .eq('recording_id', input.recording_id)
      .eq('org_id', input.org_id)
    if (allExErr) void logError('regenerate.regenerateExtraction', allExErr, { orgId: input.org_id })
    const newExtractions: NewExtraction[] = ((allEx ?? []) as unknown as RecordingExtractionRow[]).map(e => ({
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
    coverage_report = computeCoverage({
      setup_inputs: recording.setup_inputs,
      extractions: newExtractions,
      source_duration_sec: recording.source_duration_sec,
    })
    await service
      .from('recordings')
      .update({ coverage_report })
      .eq('id', input.recording_id)
      .eq('org_id', input.org_id)
  }

  return { extraction: updated, cost_cents: sonnetCents, coverage_report }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sliceWindow(segments: TranscriptSegment[], startSec: number | null, endSec: number | null): TranscriptSegment[] {
  if (startSec == null || endSec == null) return segments
  const lo = startSec - TRANSCRIPT_WINDOW_PAD_SEC
  const hi = endSec + TRANSCRIPT_WINDOW_PAD_SEC
  return segments.filter(s => s.end >= lo && s.start <= hi)
}

interface RegenerateOutput {
  topic: string
  question_typology: QuestionTypology
  question: string
  asker_name: string | null
  answer: string
  panelist_name: string | null
  confidence: number
}

function parseRegenerateResponse(text: string): RegenerateOutput | null {
  let t = text.trim()
  if (t.startsWith('```')) t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const firstBrace = t.indexOf('{')
  const lastBrace = t.lastIndexOf('}')
  if (firstBrace < 0 || lastBrace < firstBrace) return null
  let parsed: Record<string, unknown>
  try { parsed = JSON.parse(t.slice(firstBrace, lastBrace + 1)) } catch { return null }

  const typology = parsed.question_typology as QuestionTypology
  if (!VALID_TYPOLOGIES.has(typology)) return null
  const question = String(parsed.question ?? '').trim()
  const answer = String(parsed.answer ?? '').trim()
  if (!question || !answer) return null

  return {
    topic: String(parsed.topic ?? 'Other'),
    question_typology: typology,
    question,
    asker_name: parsed.asker_name ? String(parsed.asker_name).trim() || null : null,
    answer,
    panelist_name: parsed.panelist_name ? String(parsed.panelist_name).trim() || null : null,
    confidence: Number(parsed.confidence ?? 0.7),
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

function centsFromSonnet(usage: { input_tokens?: number; output_tokens?: number } | undefined): number {
  if (!usage) return 0
  // Sonnet 4.6: $3/M input, $15/M output. ~$0.01 typical pass.
  const inp = ((usage.input_tokens || 0) / 1_000_000) * 3.0
  const out = ((usage.output_tokens || 0) / 1_000_000) * 15.0
  return Math.max(1, Math.ceil((inp + out) * 100))
}
