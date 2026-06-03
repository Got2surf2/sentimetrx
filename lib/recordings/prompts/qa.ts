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
  QaSentiment,
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
  instructions?: string            // § 4.11: appended as "USER NOTES" before the transcript
  topicScopedTo?: string           // § 4.11 scope='topic': only emit pairs about this topic
}): { system: string; userPrompt: string } {
  const panel = opts.setup.panel
    .map(p => `  - ${p.name}${p.role ? ` (${p.role})` : ''}`)
    .join('\n')
  const agenda = opts.setup.agenda.map((t, i) => `  ${i + 1}. ${t}`).join('\n')

  const scopedSuffix = opts.topicScopedTo
    ? `

TOPIC-SCOPED RE-EXTRACTION
This is a topic-scoped re-extraction for "${opts.topicScopedTo}". The transcript window below has already been filtered to the time ranges where this topic was discussed (with ±60s padding). Emit pairs that genuinely belong to "${opts.topicScopedTo}". Default new pairs to topic="${opts.topicScopedTo}" unless the content clearly belongs to a sibling agenda topic.`
    : ''

  const system = `You are extracting structured Q&A from a recorded forum or town hall.${scopedSuffix}

CONTEXT
- Panel members (these people may answer questions; their speech does NOT count as audience questions):
${panel || '  (no panel provided)'}
- Agenda topics — OPTIONAL hints only. The meeting may cover anything; do NOT limit what you extract to these:
${agenda || '  (none provided — that is fine)'}

RULES
1. Extract EVERY audience-to-panel question and its answer — comprehensively, regardless of subject. NEVER skip a question because it doesn't match an agenda topic. Filter out only: panel-to-panel exchanges, panel-to-self commentary, and audience side-comments that aren't actual questions.
2. ONE Q→A pair per distinct question. When the same asker chains multiple questions in a single turn ("My question is X. Also, can you address Y?") OR when an answer is followed by a follow-up question and a separate answer ("Q1 → A1 → Q2 → A2"), emit each pair as its OWN extraction in order. Do NOT merge multiple questions into one extraction. (This is the most common miss in the manual baseline.)
3. For each question, classify question_typology: "ask" | "complaint" | "commentary" | "clarification". Only "ask" types should be marked as actionable; the others are kept for the appendix.
4. For "topic", write a short 2-5 word label for this question's subject in your own words (e.g. "Kelly Park Road timeline", "SunRail extension", "Trail routing"). Reuse an agenda hint if one genuinely fits; otherwise label freely. A later pass clusters these, so don't worry about matching other pairs exactly.
5. Quote the question and answer verbatim from the transcript. Do not paraphrase.
6. If the asker self-identifies (e.g. "Hi I'm Maria from Apopka"), capture asker_name.
7. If the panelist who answered is identifiable from the transcript (e.g. "Thanks Maria, this is John responding..."), capture panelist_name.
8. Include start_sec + end_sec timestamps pointing at the question's start in the transcript.
9. Classify "sentiment" — the tone of the exchange from the asker's perspective: "positive" (satisfied / supportive / appreciative), "negative" (frustrated / critical / unresolved concern), "mixed" (both present), or "neutral" (informational, no clear charge). Judge the substance, not politeness.

OUTPUT FORMAT
Respond with a single JSON object — no prose before or after, no markdown fences. Schema:

{
  "extractions": [
    {
      "unit_type": "qa_pair",
      "topic": "<short free-form subject label>",
      "payload": {
        "question": "<verbatim>",
        "asker_name": "<if known, else null>",
        "answer": "<verbatim>",
        "panelist_name": "<if known, else null>",
        "question_typology": "ask" | "complaint" | "commentary" | "clarification",
        "sentiment": "positive" | "neutral" | "negative" | "mixed"
      },
      "start_sec": <int>,
      "end_sec": <int>,
      "confidence": <0.0-1.0, your self-assessment>
    }
  ]
}`

  const notesBlock = opts.instructions?.trim()
    ? `USER NOTES (steer your extraction by these — they override the defaults above when they conflict)
${opts.instructions.trim()}

`
    : ''

  const userPrompt = `${notesBlock}TRANSCRIPT
${formatTranscript(opts.transcript)}`

  return { system, userPrompt }
}

// ── Curator prompt (Sonnet 4.6) ─────────────────────────────────────────────

export function buildQaCuratorPrompt(opts: {
  setup: QaSetupInputs
  transcript: TranscriptSegment[]
  drafts: ExtractionDraft[]
  instructions?: string            // § 4.11: passed through so the curator honors the same steer
}): { system: string; userPrompt: string } {
  const panel = opts.setup.panel
    .map(p => `  - ${p.name}${p.role ? ` (${p.role})` : ''}`)
    .join('\n')

  const agenda = opts.setup.agenda.map((t, i) => `  ${i + 1}. ${t}`).join('\n')

  const system = `You are reviewing AND organizing extracted Q&A pairs from a town hall recording before they go into an official Q&A document.

PANEL MEMBERS (their speech is NOT audience questions):
${panel || '  (no panel provided)'}

AGENDA TOPICS (optional naming hints — NOT a fixed list):
${agenda || '  (none provided)'}

YOUR JOB — do BOTH for every draft:

A) REVIEW. Would you publish this in an official Q&A doc? Set "flag": true if ANY apply:
- The "question" is actually a panel member speaking, not an audience member.
- The "question" is an audience side-comment / heckling / agreement, not a real question.
- The "answer" is missing, off-topic, or really another question.
- The pair is duplicative of an earlier extraction in this batch.
Do NOT flag for: wording/grammar (verbatim quotes), honest "I don't know" answers, or typology nuance.

B) GROUP. Cluster the WHOLE batch into a small set of coherent topics, then label each draft with its cluster. Merge near-duplicates (e.g. "Kelly Park design %" + "Kelly Park timeline" → "Kelly Park Road"). Where a cluster matches an agenda hint, use that name; otherwise name it yourself. Use Title Case and the EXACT SAME topic string for every draft in one cluster. Aim for a handful of topics — not one per pair.

OUTPUT FORMAT
Respond with a single JSON object — no prose, no markdown. Schema:

{
  "reviews": [
    { "draft_index": <int, 0-based>, "flag": <bool>, "reason": "<short string if flag=true, else null>", "topic": "<this draft's cluster topic>" }
  ]
}

Include exactly one review per draft, in order, each with a "topic". Non-flagged drafts get "flag": false, "reason": null.`

  const draftBlock = opts.drafts.map((d, i) => {
    return `[${i}] topic="${d.topic}" typology=${d.payload.question_typology}
    asker: ${d.payload.asker_name ?? '(unknown)'}
    Q: ${d.payload.question}
    panelist: ${d.payload.panelist_name ?? '(unknown)'}
    A: ${d.payload.answer}`
  }).join('\n\n')

  const notesBlock = opts.instructions?.trim()
    ? `USER NOTES (the user asked the extractor to follow these — honor the same intent in your review)
${opts.instructions.trim()}

`
    : ''

  const userPrompt = `${notesBlock}DRAFTS TO REVIEW
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

export const VALID_SENTIMENTS: ReadonlySet<QaSentiment> = new Set<QaSentiment>([
  'positive', 'neutral', 'negative', 'mixed',
])

// ── Synthesis prompt (Sonnet 4.6) — third pass, § 3.5 ───────────────────────
//
// Runs AFTER the curator settles topics. Reads the curated, published (non-
// flagged) pairs and produces the meeting-level narrative the deck needs:
// executive summary, headline, per-topic summaries, decisions, action items.
// The model does NOT count — code fills qa_count + sentiment_breakdown
// deterministically. One Sonnet call (~$0.20-0.30).

export interface SynthesisInputPair {
  topic: string
  typology: QuestionTypology
  sentiment: QaSentiment
  question: string
  answer: string
}

export function buildQaSynthesisPrompt(opts: {
  setup: QaSetupInputs
  pairs: SynthesisInputPair[]
  topics: string[]              // the distinct curated topic strings, for exact-match labels
  instructions?: string
}): { system: string; userPrompt: string } {
  const agenda = opts.setup.agenda.map((t, i) => `  ${i + 1}. ${t}`).join('\n')
  const topicList = opts.topics.map(t => `  - ${t}`).join('\n')

  const system = `You are a neutral minutes-taker producing a factual record of a recorded Q&A session (town hall / public forum). You are given the curated, publishable audience Q&A pairs already grouped into topics. Write the summary layer that sits on top of them.

VOICE — CRITICAL: This document may be shared with the meeting's organizer/client (e.g. the county/agency). Write strictly NEUTRAL, DESCRIPTIVE, FACTUAL prose — like official meeting minutes. NO opinion, NO spin, NO editorializing, NO dramatic or persuasive framing. Do NOT characterize the meeting or any topic with loaded words (avoid "threats", "crisis", "dominates", "looms", "nears", "concerns mount", "frustration", "tensions", "pressed hard"). Simply state what was asked and what was answered. If a sentiment was expressed, attribute it to the speaker factually ("a resident said the road was unsafe") rather than asserting it as the report's own conclusion.

AGENDA (context only):
${agenda || '  (none provided)'}

TOPICS present in the curated set — use these EXACT strings as topic labels, one summary per topic:
${topicList || '  (none)'}

WRITE:
1. executive_summary — 3-5 sentences. Neutrally describe what the meeting covered: the subjects the audience asked about and what the panel said or committed to. Read like minutes, not a press release. No editorializing, no loaded adjectives, no overall "tenor" judgment. Specific and grounded in the pairs; no filler, no invented facts.
2. headline — a NEUTRAL, factual one-line description of the meeting's subject and scope (≤ 14 words). Purely descriptive — state what the meeting was about, NOT a takeaway, opinion, or characterization. No drama words. E.g. "Apopka-area transportation planning: road conditions, project timelines, and funding". NOT "Funding Threats Cloud Broader Plans".
3. topic_summaries — one object PER topic above. summary = 2-4 NEUTRAL, factual sentences stating what was asked under this topic and how the panel responded — no spin or opinion. sentiment = a factual classification of the tone the audience expressed (positive|neutral|negative|mixed) — this is a data label, not editorial prose. representative_pair_indexes = the [index] numbers (from the bracketed list below) of the 1-2 pairs that BEST illustrate this topic — pick the most representative full Q&A exchanges. Use only indexes whose pair is in this topic. (The actual question/answer text is pulled from the data — do not quote it yourself.)
4. decisions — concrete decisions, commitments, or firm answers the panel stated (e.g. "Construction on Kelly Park Rd begins Q3 2026"). State them factually. Empty array if none. Each may carry the topic it belongs to (exact string) or null.
5. action_items — follow-ups / next steps with an owner where one was named ("Staff will publish the traffic study by August"). owner = person/role if stated, else null. due_date = ISO date if stated, else null. related_agenda_item = the topic string or null. Empty array if none.

Ground everything in the provided pairs. Do not invent statistics, names, dates, or commitments that aren't supported.

OUTPUT FORMAT — a single JSON object, no prose, no markdown fences:

{
  "executive_summary": "...",
  "headline": "...",
  "topic_summaries": [
    { "topic": "<exact topic string>", "summary": "...", "sentiment": "positive|neutral|negative|mixed", "representative_pair_indexes": [<int>, <int>] }
  ],
  "decisions": [ { "decision": "...", "topic": "<exact topic string or null>" } ],
  "action_items": [ { "description": "...", "owner": "<or null>", "due_date": "<ISO date or null>", "related_agenda_item": "<topic string or null>" } ]
}`

  const pairBlock = opts.pairs.map((p, i) => {
    return `[${i}] topic="${p.topic}" typology=${p.typology} sentiment=${p.sentiment}
    Q: ${p.question}
    A: ${p.answer}`
  }).join('\n\n')

  const notesBlock = opts.instructions?.trim()
    ? `USER NOTES (honor these — they steer emphasis and framing)
${opts.instructions.trim()}

`
    : ''

  const userPrompt = `${notesBlock}CURATED Q&A PAIRS (grouped by topic)
${pairBlock}`

  return { system, userPrompt }
}

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
- Agenda topics (optional naming hints only):
${agenda || '  (none provided)'}

RULES
1. Honor the user's instructions explicitly when given.
2. If no user instructions are given, infer the most likely correction from the transcript context (e.g. the asker self-identified later, the panelist who answered was named after the fact, the typology is clearly wrong).
3. Question and answer must be verbatim quotes from the transcript window — do not paraphrase or summarize.
4. Keep the existing topic unless the content clearly belongs to a different subject; if you change it, use a short free-form label (reuse an agenda hint if one fits).
5. Typology must be one of: ask | complaint | commentary | clarification. "ask" is the only one that surfaces in the main Q&A summary; the rest go to the appendix.
6. Confidence is your self-assessment of how sure you are about the revised pair (0.0–1.0).

OUTPUT FORMAT
Respond with a single JSON object — no prose before or after, no markdown fences:

{
  "topic": "<short subject label; keep existing unless clearly wrong>",
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
