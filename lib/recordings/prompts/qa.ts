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
2. For each question, classify question_typology: "ask" | "complaint" | "commentary" | "clarification". Only "ask" types should be marked as actionable; the others are kept for the appendix.
3. Use ONLY the agenda topics above as section headers. If a Q/A genuinely doesn't fit any agenda topic, put it under "Other" — do NOT invent new section names.
4. Quote the question and answer verbatim from the transcript. Do not paraphrase.
5. If the asker self-identifies (e.g. "Hi I'm Maria from Apopka"), capture asker_name.
6. If the panelist who answered is identifiable from the transcript (e.g. "Thanks Maria, this is John responding..."), capture panelist_name.
7. Include start_sec + end_sec timestamps pointing at the question's start in the transcript.

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
