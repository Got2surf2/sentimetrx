// lib/recordings/analyze.ts
//
// Multi-pass Claude analysis for a transcribed recording.
//
//   Pass 1 — Opus 4.7 primary extraction (claude-opus-4-7). Best structured
//            reasoning we have for the "is this an audience question vs panel
//            commentary" judgment that bit the PM-1 pilot.
//   Pass 2 — Sonnet 4.6 curator (claude-sonnet-4-6). Reviews drafts and flags
//            any that shouldn't be published. Productized substitute for the
//            PDF-as-ground-truth feedback loop.
//   Pass 3 — Sonnet 4.6 synthesis. Meeting-level narrative (exec summary,
//            per-topic summaries, decisions, action items) → analysis_summary.
//   Pass 4 — Sonnet 4.6 polish. Faithful public-shareable cleanup of each
//            verbatim Q&A pair → payload.polished_question/polished_answer.
//
// v1 supports session_type='qa' only. Other types deferred per spec § 3.5.

import 'server-only'
import { callAI } from '@/lib/ai'
import {
  buildQaExtractionPrompt,
  buildQaCuratorPrompt,
  buildQaSynthesisPrompt,
  buildQaPolishPrompt,
  VALID_TYPOLOGIES,
  VALID_SENTIMENTS,
  type ExtractionDraft,
  type SynthesisInputPair,
} from '@/lib/recordings/prompts/qa'
import type {
  NewExtraction,
  TranscriptSegment,
  SessionType,
  SetupInputs,
  QaSetupInputs,
  QaPairPayload,
  QuestionTypology,
  QaSentiment,
  FlagReason,
  ActionItemPayload,
  RecordingAnalysisSummary,
  RecordingTopicSummary,
  RecordingTopicExchange,
  EntityMap,
  MeetingObjectives,
} from '@/lib/recordings/types'
import { glossaryFromEntities } from '@/lib/recordings/entities'
import { tightenSpansFromTranscript } from '@/lib/recordings/transcriptRoles'

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
  /** § 4.11: free-text guidance, appended to both Opus + Sonnet prompts. */
  instructions?: string
  /** § 4.11 scope='topic': narrow the extraction to a single agenda topic. */
  topicScopedTo?: string
  /** §3.5b confirmed entity map — its canonicals seed the polish glossary. */
  entity_map?: EntityMap | null
  /** §2.8 meeting objectives — steer the synthesis pass to answer them. */
  objectives?: MeetingObjectives | null
}

export interface AnalyzeResult {
  extractions: NewExtraction[]
  total_cost_cents: number   // Opus + Sonnet token cost; recorded onto recordings.cost_cents alongside ASR
  // Meeting-level synthesis (exec summary + per-topic + decisions). null when
  // the synthesis pass fails or there are no publishable pairs — the pipeline
  // still completes with the Q&A pairs (graceful degrade). Persisted onto
  // recordings.analysis_summary by the caller.
  analysis_summary: RecordingAnalysisSummary | null
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
    instructions: input.instructions,
    topicScopedTo: input.topicScopedTo,
  })

  const opusResp = await callAI({
    tier: 'advanced',
    modelOverride: OPUS_MODEL,
    maxTokens: 8000,
    // callAI defaults to a 15s timeout (fine for chat). Opus extracting Q&A
    // from a full transcript with up to 8000 output tokens takes minutes.
    timeoutMs: 600000,   // 10 min
    system: [{ type: 'text', text: extractSystem, cache: true }],
    messages: [{ role: 'user', content: extractUser }],
    usage: {
      org_id: input.org_id,
      resource_type: 'recording',
      resource_id: input.recording_id,
      event_type: 'recording_extract',
    },
  })

  const drafts = parseQaExtractions(opusResp.text)

  // ── Pass 2: Sonnet curator — reviews (flag) AND groups (emergent topic) ────
  let curatorReviews = new Map<number, CuratorReview>()
  if (drafts.length > 0) {
    const { system: curatorSystem, userPrompt: curatorUser } = buildQaCuratorPrompt({
      setup,
      transcript: input.transcript,
      drafts,
      instructions: input.instructions,
    })

    const sonnetResp = await callAI({
      tier: 'advanced',
      modelOverride: SONNET_MODEL,
      maxTokens: 4000,
      timeoutMs: 300000,   // 5 min — curator pass over the full draft set
      system: [{ type: 'text', text: curatorSystem, cache: true }],
      messages: [{ role: 'user', content: curatorUser }],
      usage: {
        org_id: input.org_id,
        resource_type: 'recording',
        resource_id: input.recording_id,
        event_type: 'recording_curate',
      },
    })
    curatorReviews = parseCuratorReviews(sonnetResp.text)
  }

  // ── Merge + assemble final extractions ────────────────────────────────────
  const extractions: NewExtraction[] = drafts.map((d, i) => {
    const lowConfidence = d.confidence < LOW_CONFIDENCE_THRESHOLD
    const review = curatorReviews.get(i)
    let flagged_for_review = false
    let flag_reason: FlagReason | null = null
    if (review?.flag) {
      flagged_for_review = true
      flag_reason = 'curator_questioned'
    } else if (lowConfidence) {
      flagged_for_review = true
      flag_reason = 'low_confidence'
    }

    return {
      unit_type: 'qa_pair',
      // Emergent topic from the grouping pass; fall back to the extractor's
      // free-form label, then 'Other' if the curator didn't run.
      topic: review?.topic || d.topic || 'Other',
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

  // Tighten each pair's span to the REAL transcript timestamps of the segments
  // it matches. Opus' start/end estimates overlap for back-to-back exchanges;
  // anchoring to the ASR de-overlaps the timeline + keeps the click-to-transcript
  // modal from pulling a neighbour's segments. Deterministic; per-pair fallback
  // to the estimate when nothing matches. (docs/RECORDINGS.md §3.6 issue 2)
  if (input.transcript.length > 0) {
    const tightened = tightenSpansFromTranscript(input.transcript, extractions)
    extractions.forEach((e, i) => {
      const t = tightened[i]
      if (t) { e.start_sec = t.start_sec; e.end_sec = t.end_sec }
    })
  }

  // ── Pass 3: synthesis — exec summary, per-topic, decisions, action items ───
  // Runs over ALL Q&A pairs (including flagged-for-review ones) so the deck's
  // headline numbers reconcile 1:1 with the report page, which shows + counts
  // flagged pairs too (just marked). Counting only non-flagged here was the
  // source of the "deck shows 18, page shows 19" mismatch.
  // Failure is non-fatal: the recording still completes with its Q&A pairs.
  // Skip synthesis on a topic-scoped re-extract — analysis_summary + action
  // items are whole-meeting artifacts and reanalyze(scope='topic') discards
  // them anyway; running it here would only burn a call and append topic-only
  // action items.
  const qaPairs = extractions.filter(e => e.unit_type === 'qa_pair')
  let analysis_summary: RecordingAnalysisSummary | null = null
  let synthesisCents = 0
  if (qaPairs.length > 0 && !input.topicScopedTo) {
    const syn = await synthesizeQa(input, setup, qaPairs)
    analysis_summary = syn.summary
    synthesisCents = syn.cents
    // Append model-proposed action items as their own extraction rows so they
    // stay queryable + mirror into the dataset like everything else.
    let order = extractions.length
    for (const ai of syn.actionItems) {
      extractions.push({
        unit_type: 'action_item',
        topic: ai.related_agenda_item || 'Action Items',
        payload: ai,
        start_sec: null,
        end_sec: null,
        source_file: null,
        confidence: null,
        flagged_for_review: false,
        flag_reason: null,
        sort_order: order++,
      })
    }
  }

  // ── Pass 4: polish — public-shareable cleanup of each Q&A pair ─────────────
  // Faithful cleanup of the verbatim quotes into readable Question/Response text
  // for public distribution. ADDITIVE: payload.question/answer stay the record
  // of truth; this writes payload.polished_question/polished_answer in place
  // (qaPairs holds the same payload refs as `extractions`). Non-fatal — on
  // failure the fields are left unset and surfaces fall back to verbatim. Runs
  // over all pairs, including topic-scoped re-extracts.
  let polishCents = 0
  if (qaPairs.length > 0) {
    const { polished, cents } = await polishQaPairs(
      qaPairs.map(e => { const qa = e.payload as QaPairPayload; return { question: qa.question, answer: qa.answer } }),
      { org_id: input.org_id, recording_id: input.recording_id, glossary: glossaryFromEntities(input.entity_map ?? null, setup.glossary) },
    )
    polishCents = cents
    qaPairs.forEach((e, i) => {
      const p = polished[i]
      if (!p) return
      const qa = e.payload as QaPairPayload
      qa.polished_question = p.question
      qa.polished_answer = p.answer
    })
  }

  const total_cost_cents =
    centsFromUsage(opusResp.usage) +
    centsFromUsageMaybe(curatorReviews.size > 0) +
    synthesisCents +
    polishCents

  return { extractions, total_cost_cents, analysis_summary }
}

// ── Pass 4 polish ──────────────────────────────────────────────────────────
//
// Faithful editorial cleanup of verbatim Q&A into public-shareable text. One
// Sonnet call over all pairs. Returns one polished {question,answer} per input
// index (null for any index the model dropped or garbled → caller keeps the
// verbatim version). Exported + reused by the single-pair regenerate path so a
// regenerated pair also gets a polished version. `glossary` (optional) =
// canonical entity spellings to normalize against (future entity-normalization).
export async function polishQaPairs(
  pairs: Array<{ question: string; answer: string }>,
  ctx: { org_id: string; recording_id: string; glossary?: string[] },
): Promise<{ polished: Array<{ question: string; answer: string } | null>; cents: number }> {
  const out: Array<{ question: string; answer: string } | null> = pairs.map(() => null)
  if (pairs.length === 0) return { polished: out, cents: 0 }

  let cents = 0
  try {
    const { system, userPrompt } = buildQaPolishPrompt({ pairs, glossary: ctx.glossary })
    const resp = await callAI({
      tier: 'advanced',
      modelOverride: SONNET_MODEL,
      maxTokens: 8000,
      timeoutMs: 300000,
      system: [{ type: 'text', text: system, cache: true }],
      messages: [{ role: 'user', content: userPrompt }],
      usage: {
        org_id: ctx.org_id,
        resource_type: 'recording',
        resource_id: ctx.recording_id,
        event_type: 'recording_polish',
      },
    })
    cents = 25
    const obj = parseJsonObject(resp.text)
    const arr = (obj?.polished ?? []) as unknown[]
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue
      const it = item as Record<string, unknown>
      const idx = Number(it.index)
      if (!Number.isInteger(idx) || idx < 0 || idx >= pairs.length) continue
      const q = String(it.question ?? '').trim()
      const a = String(it.answer ?? '').trim()
      if (!q || !a) continue
      out[idx] = { question: q, answer: a }
    }
  } catch {
    // Non-fatal — leave nulls; surfaces fall back to the verbatim text.
  }
  return { polished: out, cents }
}

// ── Pass 3 synthesis ──────────────────────────────────────────────────────────
//
// One Sonnet call. The model writes narrative (exec summary, per-topic prose,
// decisions, action items); COUNTS are computed here deterministically so the
// deck's numbers always reconcile to the pairs. Returns null summary on any
// parse/call failure — the caller treats that as graceful degrade.
async function synthesizeQa(
  input: AnalyzeInput,
  setup: QaSetupInputs,
  qaPairs: NewExtraction[],
): Promise<{ summary: RecordingAnalysisSummary | null; actionItems: ActionItemPayload[]; cents: number }> {
  const pairs: SynthesisInputPair[] = qaPairs.map(e => {
    const qa = e.payload as QaPairPayload
    return {
      topic: e.topic || 'Other',
      typology: qa.question_typology,
      sentiment: qa.sentiment ?? 'neutral',
      question: qa.question,
      answer: qa.answer,
    }
  })
  // Distinct topics, in first-seen order, for exact-match labels.
  const topics: string[] = []
  for (const p of pairs) if (!topics.includes(p.topic)) topics.push(p.topic)

  // Deterministic aggregates — never trust the model to count.
  const sentiment_breakdown = { positive: 0, neutral: 0, negative: 0, mixed: 0 }
  for (const p of pairs) sentiment_breakdown[p.sentiment]++
  const qaCountByTopic = new Map<string, number>()
  for (const p of pairs) qaCountByTopic.set(p.topic, (qaCountByTopic.get(p.topic) ?? 0) + 1)

  let resp
  try {
    const { system, userPrompt } = buildQaSynthesisPrompt({ setup, pairs, topics, instructions: input.instructions, objectives: input.objectives })
    resp = await callAI({
      tier: 'advanced',
      modelOverride: SONNET_MODEL,
      maxTokens: 4000,
      timeoutMs: 300000,
      system: [{ type: 'text', text: system, cache: true }],
      messages: [{ role: 'user', content: userPrompt }],
      usage: {
        org_id: input.org_id,
        resource_type: 'recording',
        resource_id: input.recording_id,
        event_type: 'recording_synthesize',
      },
    })
  } catch (e) {
    console.error({ at: 'recordings.synthesize', msg: 'synthesis call failed', err: (e as Error)?.message })
    return { summary: null, actionItems: [], cents: 0 }
  }

  const obj = parseJsonObject(resp.text)
  if (!obj) {
    console.error({ at: 'recordings.synthesize', msg: 'synthesis JSON unparseable' })
    return { summary: null, actionItems: [], cents: 20 }
  }

  const execSummary = String(obj.executive_summary ?? '').trim()
  const headline = String(obj.headline ?? '').trim()
  // Code owns counts + sentiment; model owns prose. Build topic_summaries off
  // the deterministic topic list so every topic is represented even if the
  // model dropped one, and counts always match the pairs.
  const modelTopics = new Map<string, Record<string, unknown>>()
  for (const t of (obj.topic_summaries as unknown[] ?? [])) {
    if (t && typeof t === 'object') {
      const tt = t as Record<string, unknown>
      const key = String(tt.topic ?? '').trim()
      if (key) modelTopics.set(key, tt)
    }
  }
  // The model picks WHICH pairs illustrate a topic (by index); the verbatim
  // text + party names come from the actual pairs — never hallucinated.
  const exchangeFrom = (i: number): RecordingTopicExchange => {
    const qa = qaPairs[i].payload as QaPairPayload
    return { question: qa.question, answer: qa.answer, asker: qa.asker_name ?? null, panelist: qa.panelist_name ?? null }
  }
  const topic_summaries: RecordingTopicSummary[] = topics.map(topic => {
    const m = modelTopics.get(topic)
    const sRaw = (m?.sentiment as QaSentiment)
    const rawIdx = Array.isArray(m?.representative_pair_indexes) ? (m!.representative_pair_indexes as unknown[]) : []
    const exchanges: RecordingTopicExchange[] = []
    const seen = new Set<number>()
    for (const raw of rawIdx) {
      const i = Number(raw)
      if (!Number.isInteger(i) || i < 0 || i >= qaPairs.length || seen.has(i)) continue
      if ((qaPairs[i].topic || 'Other') !== topic) continue   // index must belong to this topic
      exchanges.push(exchangeFrom(i)); seen.add(i)
      if (exchanges.length >= 2) break
    }
    // Fallback: show the first real pair of the topic if the model gave none usable.
    if (exchanges.length === 0) {
      const firstIdx = qaPairs.findIndex(e => (e.topic || 'Other') === topic)
      if (firstIdx >= 0) exchanges.push(exchangeFrom(firstIdx))
    }
    return {
      topic,
      qa_count: qaCountByTopic.get(topic) ?? 0,
      summary: m ? String(m.summary ?? '').trim() : '',
      sentiment: VALID_SENTIMENTS.has(sRaw) ? sRaw : 'neutral',
      representative_exchanges: exchanges,
    }
  })

  const decisions: Array<{ decision: string; topic: string | null }> = []
  for (const d of (Array.isArray(obj.decisions) ? obj.decisions : [])) {
    const dd = (d ?? {}) as Record<string, unknown>
    const decision = String(dd.decision ?? '').trim()
    if (!decision) continue
    decisions.push({ decision, topic: dd.topic ? String(dd.topic).trim() : null })
  }

  const actionItems: ActionItemPayload[] = []
  for (const a of (Array.isArray(obj.action_items) ? obj.action_items : [])) {
    const aa = (a ?? {}) as Record<string, unknown>
    const description = String(aa.description ?? '').trim()
    if (!description) continue
    actionItems.push({
      description,
      owner: aa.owner ? String(aa.owner).trim() : null,
      due_date: aa.due_date ? String(aa.due_date).trim() : null,
      related_agenda_item: aa.related_agenda_item ? String(aa.related_agenda_item).trim() : null,
    })
  }

  const summary: RecordingAnalysisSummary = {
    executive_summary: execSummary,
    headline,
    sentiment_overall: overallSentiment(sentiment_breakdown),
    sentiment_breakdown,
    topic_summaries,
    decisions,
    generated_at: new Date().toISOString(),
    model: SONNET_MODEL,
  }
  return { summary, actionItems, cents: 25 }
}

// Majority tone across pairs. Ties or a meaningful pos+neg split → 'mixed'.
// Exported for unit testing — deterministic, no I/O.
export function overallSentiment(b: { positive: number; neutral: number; negative: number; mixed: number }): QaSentiment {
  const total = b.positive + b.neutral + b.negative + b.mixed
  if (total === 0) return 'neutral'
  if (b.mixed > total / 2) return 'mixed'
  // Both clear positive and clear negative presence → mixed read.
  if (b.positive > 0 && b.negative > 0 && Math.abs(b.positive - b.negative) <= total * 0.2) return 'mixed'
  const max = Math.max(b.positive, b.neutral, b.negative)
  if (max === b.negative) return 'negative'
  if (max === b.positive) return 'positive'
  return 'neutral'
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
    const sentimentRaw = payload.sentiment as QaSentiment
    const sentiment = VALID_SENTIMENTS.has(sentimentRaw) ? sentimentRaw : 'neutral'
    const qaPayload: QaPairPayload = {
      question,
      asker_name: payload.asker_name ? String(payload.asker_name) : null,
      answer,
      panelist_name: payload.panelist_name ? String(payload.panelist_name) : null,
      question_typology: typology,
      sentiment,
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

interface CuratorReview { flag: boolean; reason: string | null; topic: string | null }

// The curator returns one review per draft: a publish/flag decision AND the
// emergent cluster topic (grouping is done holistically across the batch, not
// from a pre-supplied agenda). topic may be null if the model omitted it.
function parseCuratorReviews(text: string): Map<number, CuratorReview> {
  const out = new Map<number, CuratorReview>()
  const obj = parseJsonObject(text)
  const arr = (obj?.reviews ?? []) as unknown[]
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const it = item as Record<string, unknown>
    const idx = Number(it.draft_index)
    if (!Number.isFinite(idx) || idx < 0) continue
    const flag = it.flag === true
    const reason = flag ? (it.reason ? String(it.reason).trim() : 'curator_questioned') : null
    const topicRaw = it.topic ? String(it.topic).trim() : ''
    out.set(idx, { flag, reason, topic: topicRaw || null })
  }
  return out
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
