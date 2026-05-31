// lib/recordings/prompts/qa.ts
//
// Q&A session extraction + curator prompts. Per docs/RECORDINGS.md § 3.5.
//
// Two prompts:
//   buildQaExtractionPrompt() — for Opus 4.7 primary pass; produces structured
//     Q&A pairs against the agenda topics.
//   buildQaCuratorPrompt() — for Sonnet 4.6 second-pass review; flags pairs the
//     curator would not publish in an official Q&A doc.
//
// The transcript blob is intentionally appended as the last block so prompt
// caching works for the static instructions + setup context on repeat
// processing (re-runs after curator iteration during calibration).

import type {
  QaSetupInputs,
  TranscriptSegment,
  QaPairPayload,
  QuestionTypology,
} from '@/lib/recordings/types'

export interface ExtractionDraft {
  unit_type: 'qa_pair'
  topic: string
  payload: QaPairPayload
  start_sec: number
  end_sec: number
  confidence: number
}

// ── Extraction prompt (Opus 4.7) ────────────────────────────────────────────

export function buildQaExtractionPrompt(opts: {
  setup: QaSetupInputs
  transcript: TranscriptSegment[]
}): { system: string; userPrompt: string } {
  const panel = opts.setup.panel
    .map(p => `  - ${p.name}${p.role ? ` (${p.role})` : ''}`)
    .join('\n')
  const agenda = opts.setup.agenda.map((t, i) => `  ${i + 1}. ${t}`).join('\n')

  const system = `You are extracting structured Q&A from a recorded forum or town hall.

CONTEXT
- Panel members (these people may answer questions; their speech does NOT count as audience questions):
${panel || '  (no panel provided)'}
- Agenda topics (use these as section headers; do not invent new topics):
${agenda || '  (no agenda provided)'}

RULES
1. Extract ONLY audience-to-panel questions and their answers. Filter out panel-to-panel exchanges, panel-to-self commentary, and audience side-comments that are not actual questions.
2. ONE Q→A pair per distinct question. When the same asker chains multiple questions in a single turn ("My question is X. Also, can you address Y?") OR when an answer is followed by a follow-up question and a separate answer ("Q1 → A1 → Q2 → A2"), emit each pair as its OWN extraction in order. Do NOT merge multiple questions into one extraction. (This is the most common miss in the manual baseline.)
3. For each question, classify question_typology: "ask" | "complaint" | "commentary" | "clarification". Only "ask" types should be marked as actionable; the others are kept for the appendix.
4. Use ONLY the agenda topics above as section headers. If a Q/A genuinely doesn't fit any agenda topic, put it under "Other" — do NOT invent new section names.
5. Quote the question and answer verbatim from the transcript. Do not paraphrase.
6. If the asker self-identifies (e.g. "Hi I'm Maria from Apopka"), capture asker_name.
7. If the panelist who answered is identifiable from the transcript (e.g. "Thanks Maria, this is John responding..."), capture panelist_name.
8. Include start_sec + end_sec timestamps pointing at the question's start in the transcript.

OUTPUT FORMAT
Respond with a single JSON object — no prose before or after, no markdown fences. Schema:

{
  "extractions": [
    {
      "unit_type": "qa_pair",
      "topic": "<one of the agenda topics or 'Other'>",
      "payload": {
        "question": "<verbatim>",
        "asker_name": "<if known, else null>",
        "answer": "<verbatim>",
        "panelist_name": "<if known, else null>",
        "question_typology": "ask" | "complaint" | "commentary" | "clarification"
      },
      "start_sec": <int>,
      "end_sec": <int>,
      "confidence": <0.0-1.0, your self-assessment>
    }
  ]
}`

  const userPrompt = `TRANSCRIPT
${formatTranscript(opts.transcript)}`

  return { system, userPrompt }
}

// ── Curator prompt (Sonnet 4.6) ─────────────────────────────────────────────

export function buildQaCuratorPrompt(opts: {
  setup: QaSetupInputs
  transcript: TranscriptSegment[]
  drafts: ExtractionDraft[]
}): { system: string; userPrompt: string } {
  const panel = opts.setup.panel
    .map(p => `  - ${p.name}${p.role ? ` (${p.role})` : ''}`)
    .join('\n')

  const system = `You are reviewing extracted Q&A pairs from a town hall recording before they go into an official Q&A document.

PANEL MEMBERS (their speech is NOT audience questions):
${panel || '  (no panel provided)'}

YOUR JOB
For each draft extraction, decide: would you publish this in an official Q&A doc?

FLAG (set "flag": true) if ANY of these apply:
- The "question" is actually a panel member speaking, not an audience member.
- The "question" is an audience side-comment / heckling / agreement, not a real question.
- The "answer" is missing, off-topic, or really another question.
- The pair is duplicative of an earlier extraction in this batch.
- The topic assignment is clearly wrong given the question content.

DO NOT FLAG:
- Wording style or grammar — these are verbatim transcript quotes.
- Honest "I don't know" or non-committal answers — those are still valid Q&A.
- Imperfect typology classification (ask vs complaint vs commentary) — that's a separate concern.

OUTPUT FORMAT
Respond with a single JSON object — no prose, no markdown. Schema:

{
  "reviews": [
    { "draft_index": <int, 0-based>, "flag": <bool>, "reason": "<short string if flag=true, else null>" }
  ]
}

You MUST include one review per draft, in order. Drafts you wouldn't flag get "flag": false, "reason": null.`

  const draftBlock = opts.drafts.map((d, i) => {
    return `[${i}] topic="${d.topic}" typology=${d.payload.question_typology}
    asker: ${d.payload.asker_name ?? '(unknown)'}
    Q: ${d.payload.question}
    panelist: ${d.payload.panelist_name ?? '(unknown)'}
    A: ${d.payload.answer}`
  }).join('\n\n')

  const userPrompt = `DRAFTS TO REVIEW
${draftBlock}

TRANSCRIPT (for cross-reference)
${formatTranscript(opts.transcript)}`

  return { system, userPrompt }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTranscript(segments: TranscriptSegment[]): string {
  return segments
    .map(s => {
      const ts = `[${formatTime(s.start)}]`
      const sp = s.speaker ? `${s.speaker}: ` : ''
      return `${ts} ${sp}${s.text}`
    })
    .join('\n')
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export const VALID_TYPOLOGIES: ReadonlySet<QuestionTypology> = new Set<QuestionTypology>([
  'ask', 'complaint', 'commentary', 'clarification',
])

// ── Regenerate prompt (Sonnet 4.6) — per-card fix (§ 4.10) ──────────────────

export function buildQaRegeneratePrompt(opts: {
  setup: QaSetupInputs
  existing: {
    topic: string | null
    payload: QaPairPayload
    confidence: number | null
    start_sec: number | null
    end_sec: number | null
  }
  transcriptWindow: TranscriptSegment[]
  instructions?: string
}): { system: string; userPrompt: string } {
  const panel = opts.setup.panel
    .map(p => `  - ${p.name}${p.role ? ` (${p.role})` : ''}`)
    .join('\n')
  const agenda = opts.setup.agenda.map((t, i) => `  ${i + 1}. ${t}`).join('\n')

  const system = `You are revising a single Q&A pair previously extracted from a town hall transcript. Output a revised version of the same pair — same time window, possibly corrected wording, asker, panelist, topic, or typology.

CONTEXT
- Panel members (their speech does NOT count as audience questions):
${panel || '  (no panel provided)'}
- Agenda topics (use these as the topic value; do not invent new ones — "Other" is the fallback):
${agenda || '  (no agenda provided)'}

RULES
1. Honor the user's instructions explicitly when given.
2. If no user instructions are given, infer the most likely correction from the transcript context (e.g. the asker self-identified later, the panelist who answered was named after the fact, the typology is clearly wrong).
3. Question and answer must be verbatim quotes from the transcript window — do not paraphrase or summarize.
4. Topic must be one of the agenda topics above, or "Other" if it genuinely doesn't fit.
5. Typology must be one of: ask | complaint | commentary | clarification. "ask" is the only one that surfaces in the main Q&A summary; the rest go to the appendix.
6. Confidence is your self-assessment of how sure you are about the revised pair (0.0–1.0).

OUTPUT FORMAT
Respond with a single JSON object — no prose before or after, no markdown fences:

{
  "topic": "<one of the agenda topics or 'Other'>",
  "question_typology": "ask" | "complaint" | "commentary" | "clarification",
  "question": "<verbatim from the transcript window>",
  "asker_name": "<if known, else null>",
  "answer": "<verbatim from the transcript window>",
  "panelist_name": "<if known, else null>",
  "confidence": <0.0-1.0>
}`

  const userInstructionsBlock = opts.instructions?.trim()
    ? `USER INSTRUCTIONS\n${opts.instructions.trim()}\n`
    : `USER INSTRUCTIONS\n(none — infer the best correction from transcript context)\n`

  const existingBlock = `EXISTING EXTRACTION
topic:     ${opts.existing.topic ?? '(none)'}
typology:  ${opts.existing.payload.question_typology}
question:  ${opts.existing.payload.question}
asker:     ${opts.existing.payload.asker_name ?? '(unknown)'}
panelist:  ${opts.existing.payload.panelist_name ?? '(unknown)'}
answer:    ${opts.existing.payload.answer}
confidence: ${opts.existing.confidence ?? '(none)'}
time:      ${formatTimestamp(opts.existing.start_sec)}-${formatTimestamp(opts.existing.end_sec)}`

  const userPrompt = `${userInstructionsBlock}
${existingBlock}

TRANSCRIPT WINDOW (the ~60s of speech surrounding this pair, ±30s for context)
${formatTranscript(opts.transcriptWindow)}`

  return { system, userPrompt }
}

function formatTimestamp(sec: number | null): string {
  if (sec == null) return '?'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
