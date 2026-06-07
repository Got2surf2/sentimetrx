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
  MeetingObjectives,
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
3. For each question, classify question_typology: "ask" (a direct question or request) | "clarification" (a short follow-up question seeking a detail) | "complaint" (a grievance — note it often still contains a question) | "commentary" (a statement or opinion, not really a question). This is a descriptive LABEL only — every extracted pair is retained and shown equally; none are demoted, hidden, or treated as secondary. Do not under-classify genuine questions as commentary.
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

B) GROUP. Cluster the WHOLE batch into a small set of coherent topics, then label each draft with its cluster. Merge near-duplicates (e.g. "Kelly Park design %" + "Kelly Park timeline" → "Kelly Park Road"). When a cluster matches one of the agenda topics above, use that agenda topic's string **verbatim** — copy it character-for-character, do NOT re-case or reword it (so it reconciles to the agenda). Only when you name a NEW topic not on the agenda, use Title Case. Use the EXACT SAME topic string for every draft in one cluster. Aim for a handful of topics — not one per pair.

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
  objectives?: MeetingObjectives | null   // §2.8 — what the client wants this report to answer
}): { system: string; userPrompt: string } {
  const agenda = opts.setup.agenda.map((t, i) => `  ${i + 1}. ${t}`).join('\n')
  const topicList = opts.topics.map(t => `  - ${t}`).join('\n')

  // Objectives steer emphasis only — the model must still ground everything in
  // the pairs and never invent facts to satisfy an objective.
  const objLines = [
    opts.objectives?.summary?.trim() ? `  - ${opts.objectives.summary.trim()}` : null,
    ...(opts.objectives?.questions ?? []).map(q => q.trim()).filter(Boolean).map(q => `  - ${q}`),
  ].filter(Boolean).join('\n')
  const objectivesBlock = objLines
    ? `\n\nANALYSIS OBJECTIVES — what the client wants this report to answer. Address these in the executive_summary and topic summaries WHERE the curated pairs support it. Never invent facts, commitments, or sentiment to satisfy an objective; if the meeting didn't cover one, simply don't claim it did.\n${objLines}`
    : ''

  const system = `You are a neutral minutes-taker producing a factual record of a recorded Q&A session (town hall / public forum). You are given the curated, publishable audience Q&A pairs already grouped into topics. Write the summary layer that sits on top of them.

VOICE — CRITICAL: This document may be shared with the meeting's organizer/client (e.g. the county/agency). Write strictly NEUTRAL, DESCRIPTIVE, FACTUAL prose — like official meeting minutes. NO opinion, NO spin, NO editorializing, NO dramatic or persuasive framing. Do NOT characterize the meeting or any topic with loaded words (avoid "threats", "crisis", "dominates", "looms", "nears", "concerns mount", "frustration", "tensions", "pressed hard"). Simply state what was asked and what was answered. If a sentiment was expressed, attribute it to the speaker factually ("a resident said the road was unsafe") rather than asserting it as the report's own conclusion.

AGENDA (context only):
${agenda || '  (none provided)'}${objectivesBlock}

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

// ── Presentation-scope classification prompt (Sonnet 4.6) — § 3.5e ───────────
//
// Labels each audience question as pertaining to the presentation ('in_scope')
// or outside it ('out_of_scope'), grounded in a summary of what was presented.
export function buildScopeClassifyPrompt(opts: {
  presentationContext: string
  questions: string[]
}): { system: string; userPrompt: string } {
  const system = `You classify each audience question from a town-hall Q&A as pertaining to the PRESENTATION given at the meeting ("in_scope") or outside it ("out_of_scope").

You are given (1) a summary of what was presented and (2) a numbered list of questions.

- in_scope = the question is about a topic, figure, claim, plan, or detail the presentation covered — including follow-ups, challenges, or requests to clarify presented material.
- out_of_scope = the question is about something the presentation did NOT cover: a different agenda item, a general/administrative matter, or an unrelated/off-topic concern.

Judge ONLY against the presentation summary provided. When a question is ambiguous, choose in_scope only if it plausibly relates to presented material; otherwise out_of_scope. Do NOT invent presentation content.

Return ONLY a single JSON object, no prose, no markdown fences:
{ "scopes": [ { "index": <int>, "scope": "in_scope" | "out_of_scope" } ] }
exactly one entry per question, referenced by its [index].`

  const qBlock = opts.questions.map((q, i) => `[${i}] ${q}`).join('\n')
  const userPrompt = `WHAT WAS PRESENTED:\n${opts.presentationContext.trim()}\n\nQUESTIONS:\n${qBlock}`
  return { system, userPrompt }
}

// ── Entity-extraction prompt (Sonnet 4.6) — § 3.5b ──────────────────────────
//
// Runs after transcription. Pulls the proper nouns mentioned in the meeting and
// CLUSTERS the spelling/phonetic variants the transcriber produced under one
// best-guess canonical. The user reviews/corrects the result at the gate; the
// confirmed map feeds the polish glossary + the "Corrected" transcript view.
// Focused on names worth fixing — not every capitalized word.

export function buildEntityExtractionPrompt(opts: {
  transcript: TranscriptSegment[]
  setup?: { panel?: Array<{ name: string; role?: string }>; agenda?: string[] }
  // §3.5c brand-entity convergence: canonical spellings from the brand's curated
  // entity catalog (collection + linked agent). Authoritative — when the
  // transcript mentions one of these (even mis-heard), use the given spelling.
  knownEntities?: Array<{ canonical: string; variants?: string[] }>
}): { system: string; userPrompt: string } {
  const panel = (opts.setup?.panel ?? []).map(p => `  - ${p.name}${p.role ? ` (${p.role})` : ''}`).join('\n')
  const agenda = (opts.setup?.agenda ?? []).map((t, i) => `  ${i + 1}. ${t}`).join('\n')
  const known = (opts.knownEntities ?? [])
    .map(e => {
      const heard = (e.variants ?? []).filter(v => v.toLowerCase() !== e.canonical.toLowerCase())
      return `  - ${e.canonical}${heard.length ? ` (sometimes heard as: ${heard.join(', ')})` : ''}`
    })
    .join('\n')

  const system = `You are reviewing an automatic speech-recognition (ASR) transcript of a recorded meeting. ASR frequently mis-hears proper names PHONETICALLY (e.g. "Babuji" → "Babu G", "NOWOCATS" → "no what cats", "Kelly Park Road" → "Kelly Parke Road"). Your job: list the proper nouns mentioned and, for each, cluster the different spellings that appear in the transcript under one best-guess CANONICAL spelling, so they can be corrected.

WHAT TO EXTRACT — proper nouns worth normalizing:
- person  — people's names
- place   — streets, neighborhoods, cities, venues, landmarks
- org     — companies, agencies, departments, groups
- project — named projects, programs, initiatives, plans
- term    — domain-specific named terms / acronyms

RULES:
- One entry per real-world entity. Put EVERY distinct spelling that appears in the transcript for that entity into its "variants" list (including the canonical itself if it appears that way).
- "canonical" = your best guess at the correct spelling. Prefer a spelling supported by the panel roster / agenda below when one matches. The user will correct it, so a reasonable guess is fine.
- "mentions" = approximate total number of times the entity is referred to (sum across variants).
- Skip common words, generic nouns, and anything that isn't a name. Skip entities mentioned only in passing with no spelling ambiguity if they're clearly common (e.g. "Florida"). Favor names that look mis-heard or are meeting-specific.
- Do NOT invent entities or variants not present in the transcript.

CONTEXT (authoritative spellings — prefer these when a transcript entity matches):
Panel:
${panel || '  (none provided)'}
Agenda:
${agenda || '  (none provided)'}
Known entities for this organization (use these exact canonical spellings whenever the transcript refers to them, even if phonetically mis-heard):
${known || '  (none provided)'}

OUTPUT FORMAT — a single JSON object, no prose, no markdown fences:

{
  "entities": [
    { "canonical": "Kelly Park Road", "variants": ["Kelly Park Road", "Kelly Parke Road", "Kelly Park Rd"], "type": "place", "mentions": 6 }
  ]
}`

  const text = opts.transcript.map(s => s.text).join(' ')
  const userPrompt = `TRANSCRIPT\n${text}`

  return { system, userPrompt }
}

// ── Polish prompt (Sonnet 4.6) — fourth pass, § 3.5 ─────────────────────────
//
// Turns the verbatim transcript quotes into readable, publication-ready
// Question/Response text matching a professional agency "Q&A Forum" document
// (the NOWOCATS vendor sample is the bar). Two different jobs per pair: the
// QUESTION is synthesized into a crisp standalone question that keeps the
// resident's specific concern in "(specifically …)"; the ANSWER is a faithful
// cleanup (no invented facts). Both apply domain terminology rules — road
// designations as numerals with prefix (SR 436 / US 441 / I-4, incl. spoken
// number-words), agency/program acronyms expanded on first use. The verbatim
// question/answer stay the record of truth; this is ADDITIVE
// (payload.polished_question / polished_answer). One Sonnet call over all pairs.
//
// `glossary` (optional) = canonical entity spellings to normalize against. ASR
// mangles proper names PHONETICALLY ("no what cats" → NOWOCATS), which classic
// edit-distance fuzzy matching misses; handing the model the canonical list lets
// it map phonetic/spelling variants to the right name. Hook for the future
// "entity-spelling normalization" feature (glossary sourced from uploaded docs /
// a provided list / the dataset entity catalog).

export function buildQaPolishPrompt(opts: {
  pairs: Array<{ question: string; answer: string }>
  glossary?: string[]
}): { system: string; userPrompt: string } {
  const glossaryBlock = opts.glossary && opts.glossary.length > 0
    ? `\n\nCANONICAL SPELLINGS — when any name/place/term below appears in the text (including phonetic mis-hearings or alternate spellings from the audio transcription), use this EXACT spelling. Do not change anything else about the meaning:\n${opts.glossary.map(g => `  - ${g}`).join('\n')}`
    : ''

  const system = `You are an editor preparing an official, public-shareable Q&A record from a recorded town hall / public forum, to the standard of a professional agency "Questions & Answers Forum" document. Each pair below is a VERBATIM question and answer transcribed from audio. Produce a clean, publication-ready version of each.

THE QUESTION — synthesize into a clear, well-formed question:
- Rewrite the spoken question as ONE crisp, grammatical question a reader understands on its own. Strip preamble, rambling, and references to other speakers ("my main question is", "like the other lady said").
- PRESERVE the specific concern: keep the exact road, intersection, neighborhood, park, or development the resident named. Append "(specifically <place/concern>)" at the end ONLY when it adds a place or detail NOT already stated in the question itself — e.g. "How will access and circulation be improved? (specifically Bear Island Lake access)". If the question already names the place, do NOT repeat it in a parenthetical.
- Do NOT invent a concern, location, or detail that was not asked. If the question is already crisp, keep it.

THE ANSWER — faithful cleanup, NOT a rewrite:
- Preserve meaning EXACTLY. Do NOT add, infer, or invent any fact, number, name, date, commitment, caveat, or opinion not present in the original. Remove ONLY filler ("um", "uh", "you know", "like", "sort of"), false starts, self-corrections, repeated words, and crosstalk. Fix grammar, punctuation, and run-ons for readability.
- Keep ALL substance: every figure, dollar amount, date, name, commitment, qualifier, and the speaker's stance stay intact and unchanged — do not soften, strengthen, or shorten by dropping content. Write in complete, neutral, professional sentences. If an answer is already clean, return it essentially unchanged.

TERMINOLOGY — apply to BOTH question and answer:
- Render road and route designations as NUMERALS with their prefix, using ONE consistent abbreviated format throughout each answer: "SR 436" (State Road), "US 441" (U.S. Highway), "CR 435" (County Road), "I-4" (Interstate). Convert spoken number-words in a road context — "four thirty six State Road" → "SR 436", "four twenty nine" → "SR 429". Do not mix "State Road 441" and "SR 436" in the same response — pick the abbreviated form. Do NOT numeralize ordinary spoken counts that are not road designations.
- Expand an agency / program / technical acronym on FIRST use within a pair, then use the acronym — "Florida Department of Transportation (FDOT)", "Intelligent Transportation Systems (ITS)" — but ONLY when the full name is standard or evident; never invent an expansion.
- Stay strictly NEUTRAL and FACTUAL — no spin, no editorializing.

Output exactly one cleaned pair per input index. Do NOT merge, split, reorder, or drop pairs.${glossaryBlock}

OUTPUT FORMAT — a single JSON object, no prose, no markdown fences:

{
  "polished": [
    { "index": <int>, "question": "<synthesized question>", "answer": "<cleaned answer>" }
  ]
}`

  const pairBlock = opts.pairs.map((p, i) =>
    `[${i}]\n  Q: ${p.question}\n  A: ${p.answer}`
  ).join('\n\n')

  const userPrompt = `VERBATIM Q&A PAIRS TO CLEAN\n${pairBlock}`

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
5. Typology must be one of: ask | complaint | commentary | clarification — a descriptive label only (all pairs are retained and shown equally; typology just drives an optional filter, nothing is hidden).
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
