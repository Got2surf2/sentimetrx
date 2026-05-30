// lib/recordings/analyze.ts
//
// Two-pass Claude analysis for a transcribed recording.
//
//   Pass 1 — Opus 4.7 primary extraction (claude-opus-4-7). Best structured
//            reasoning we have for the "is this an audience question vs panel
//            commentary" judgment that bit the PM-1 pilot.
//   Pass 2 — Sonnet 4.6 curator (claude-sonnet-4-6). Reviews drafts and flags
//            any that shouldn't be published. Productized substitute for the
//            PDF-as-ground-truth feedback loop.
//
// v1 supports session_type='qa' only. Other types deferred per spec § 3.5.

import 'server-only'
import { callAI } from '@/lib/ai'
import {
  buildQaExtractionPrompt,
  buildQaCuratorPrompt,
  VALID_TYPOLOGIES,
  type ExtractionDraft,
} from '@/lib/recordings/prompts/qa'
import type {
  NewExtraction,
  TranscriptSegment,
  SessionType,
  SetupInputs,
  QaSetupInputs,
  QaPairPayload,
  QuestionTypology,
  FlagReason,
} from '@/lib/recordings/types'

const OPUS_MODEL = 'claude-opus-4-7'
const SONNET_MODEL = 'claude-sonnet-4-6'

// Low-confidence auto-flag threshold. Spec § 3.5 leaves it open ("TBD: threshold")
// to be tuned in Phase 4 calibration; 0.65 is the starting value — Opus tends
// to self-report conservatively on edge cases.
const LOW_CONFIDENCE_THRESHOLD = 0.65

export interface AnalyzeInput {
  recording_id: string
  org_id: string
  session_type: SessionType
  setup_inputs: SetupInputs | Record<string, unknown>
  transcript: TranscriptSegment[]
}

export interface AnalyzeResult {
  extractions: NewExtraction[]
  total_cost_cents: number   // Opus + Sonnet token cost; recorded onto recordings.cost_cents alongside ASR
}

export async function analyzeRecording(input: AnalyzeInput): Promise<AnalyzeResult> {
  if (input.session_type !== 'qa') {
    throw new Error(`Recording analysis for session_type='${input.session_type}' is not implemented in v1`)
  }
  return analyzeQa(input)
}

async function analyzeQa(input: AnalyzeInput): Promise<AnalyzeResult> {
  const setup = input.setup_inputs as QaSetupInputs

  // ── Pass 1: Opus extraction ───────────────────────────────────────────────
  const { system: extractSystem, userPrompt: extractUser } = buildQaExtractionPrompt({
    setup,
    transcript: input.transcript,
  })

  const opusResp = await callAI({
    tier: 'advanced',
    modelOverride: OPUS_MODEL,
    maxTokens: 8000,
    system: [{ type: 'text', text: extractSystem, cache: true }],
    messages: [{ role: 'user', content: extractUser }],
    usage: {
      org_id: input.org_id,
      resource_type: 'dataset',
      resource_id: input.recording_id,
      event_type: 'recording_extract',
    },
  })

  const drafts = parseQaExtractions(opusResp.text)

  // ── Pass 2: Sonnet curator ────────────────────────────────────────────────
  let curatorFlags = new Map<number, string>()
  if (drafts.length > 0) {
    const { system: curatorSystem, userPrompt: curatorUser } = buildQaCuratorPrompt({
      setup,
      transcript: input.transcript,
      drafts,
    })

    const sonnetResp = await callAI({
      tier: 'advanced',
      modelOverride: SONNET_MODEL,
      maxTokens: 4000,
      system: [{ type: 'text', text: curatorSystem, cache: true }],
      messages: [{ role: 'user', content: curatorUser }],
      usage: {
        org_id: input.org_id,
        resource_type: 'dataset',
        resource_id: input.recording_id,
        event_type: 'recording_curate',
      },
    })
    curatorFlags = parseCuratorReviews(sonnetResp.text)
  }

  // ── Merge + assemble final extractions ────────────────────────────────────
  const extractions: NewExtraction[] = drafts.map((d, i) => {
    const lowConfidence = d.confidence < LOW_CONFIDENCE_THRESHOLD
    const curatorReason = curatorFlags.get(i)
    let flagged_for_review = false
    let flag_reason: FlagReason | null = null
    if (curatorReason) {
      flagged_for_review = true
      flag_reason = 'curator_questioned'
    } else if (lowConfidence) {
      flagged_for_review = true
      flag_reason = 'low_confidence'
    }

    return {
      unit_type: 'qa_pair',
      topic: d.topic,
      payload: d.payload,
      start_sec: Math.round(d.start_sec),
      end_sec: Math.round(d.end_sec),
      source_file: null,                   // populated by transcribe.ts if known
      confidence: d.confidence,
      flagged_for_review,
      flag_reason,
      sort_order: i,
    }
  })

  const total_cost_cents =
    centsFromUsage(opusResp.usage) +
    centsFromUsageMaybe(curatorFlags.size > 0)

  return { extractions, total_cost_cents }
}

// ── Parsers ──────────────────────────────────────────────────────────────────

function parseQaExtractions(text: string): ExtractionDraft[] {
  const obj = parseJsonObject(text)
  const arr = (obj?.extractions ?? []) as unknown[]
  const drafts: ExtractionDraft[] = []
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const it = item as Record<string, unknown>
    const payload = it.payload as Record<string, unknown> | undefined
    if (!payload || typeof payload !== 'object') continue
    const typology = payload.question_typology as QuestionTypology
    if (!VALID_TYPOLOGIES.has(typology)) continue
    const question = String(payload.question ?? '').trim()
    const answer = String(payload.answer ?? '').trim()
    if (!question || !answer) continue
    const qaPayload: QaPairPayload = {
      question,
      asker_name: payload.asker_name ? String(payload.asker_name) : null,
      answer,
      panelist_name: payload.panelist_name ? String(payload.panelist_name) : null,
      question_typology: typology,
    }
    drafts.push({
      unit_type: 'qa_pair',
      topic: String(it.topic ?? 'Other'),
      payload: qaPayload,
      start_sec: Number(it.start_sec ?? 0),
      end_sec: Number(it.end_sec ?? 0),
      confidence: clamp01(Number(it.confidence ?? 0.7)),
    })
  }
  return drafts
}

function parseCuratorReviews(text: string): Map<number, string> {
  const flags = new Map<number, string>()
  const obj = parseJsonObject(text)
  const arr = (obj?.reviews ?? []) as unknown[]
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const it = item as Record<string, unknown>
    if (it.flag !== true) continue
    const idx = Number(it.draft_index)
    if (!Number.isFinite(idx) || idx < 0) continue
    const reason = it.reason ? String(it.reason).trim() : 'curator_questioned'
    flags.set(idx, reason)
  }
  return flags
}

/**
 * Tolerant JSON extractor — strips markdown fences if the model wraps the
 * response in them, then attempts JSON.parse. Returns null on failure.
 */
function parseJsonObject(text: string): Record<string, unknown> | null {
  let t = text.trim()
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  }
  const firstBrace = t.indexOf('{')
  const lastBrace = t.lastIndexOf('}')
  if (firstBrace < 0 || lastBrace < firstBrace) return null
  try {
    return JSON.parse(t.slice(firstBrace, lastBrace + 1))
  } catch {
    return null
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

// Token-cost helpers. Whisper/Deepgram costs live with the transcript row;
// this returns Claude-only cents that get summed into recordings.cost_cents.
function centsFromUsage(usage: { input_tokens?: number; output_tokens?: number; model?: string } | undefined): number {
  if (!usage) return 0
  // Direct Opus pricing $15/M input, $75/M output. We don't pull from RATES
  // here because that adds a dynamic import for a constant cost calc; the
  // usage_logs row carries the precise figure for accounting reconciliation.
  const inp = ((usage.input_tokens || 0) / 1_000_000) * 15.00
  const out = ((usage.output_tokens || 0) / 1_000_000) * 75.00
  return Math.ceil((inp + out) * 100)
}

function centsFromUsageMaybe(_didCurate: boolean): number {
  // The curator's per-call cents are already logged in usage_logs by callAI;
  // for the in-row total we conservatively budget ~$0.20 per curator pass
  // (Sonnet 4.6 on ~5k token review). Real reconciliation comes from
  // /admin/usage aggregations, not this field.
  return _didCurate ? 20 : 0
}
