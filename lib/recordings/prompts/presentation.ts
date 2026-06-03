// lib/recordings/prompts/presentation.ts
//
// Prompts for the presentation side of the meeting tool:
//   buildSlideVisionSystem()       — Claude vision reads slide images → per-slide outline
//   buildPresentationSummaryPrompt — neutral summary of the presentation phase,
//                                     grounded in the slide outline (ground truth for figures)
//
// The neutral-voice directive is shared verbatim with the Q&A synthesis pass —
// the deck may be handed to the client/organizer, so no opining anywhere.

import type { PresentationOutline, QaSetupInputs, TranscriptSegment } from '@/lib/recordings/types'

// Shared with buildQaSynthesisPrompt — keep the wording identical.
const NEUTRAL_VOICE = `VOICE — CRITICAL: This document may be shared with the meeting's organizer/client (e.g. the county/agency). Write strictly NEUTRAL, DESCRIPTIVE, FACTUAL prose — like official meeting minutes. NO opinion, NO spin, NO editorializing, NO dramatic or persuasive framing. Do NOT characterize anything with loaded words (avoid "threats", "crisis", "dominates", "looms", "nears", "concerns mount", "frustration", "tensions"). State what was presented and said. Attribute any sentiment to the speaker factually rather than asserting it as the report's own conclusion.`

// ── Slide vision (per-page outline) ──────────────────────────────────────────

export function buildSlideVisionSystem(): string {
  return `You are reading the slides of a meeting presentation, one image per page. For EACH page, extract a structured outline. Read text, headings, and data EXACTLY as printed — these figures/names/dates are the ground-truth record, so transcribe numbers, dollar amounts, dates, and proper names verbatim. Describe charts/maps/diagrams briefly in notes if they carry information not in the text.

For each page return:
- title: the slide's heading/title (or null if none)
- key_points: the main bullet points / takeaways as short strings
- figures: any explicit data points as { "label": "...", "value": "..." } (e.g. {"label":"Project cost","value":"$4.2M"}); empty array if none
- presenter: a presenter name/role if the slide names one, else null
- notes: anything else load-bearing (chart/map description, footnotes), else null

OUTPUT FORMAT — a single JSON object, no prose, no markdown fences:
{ "pages": [ { "title": <string|null>, "key_points": [string], "figures": [{"label":string,"value":string}], "presenter": <string|null>, "notes": <string|null> } ] }
One entry per page image, in the order shown.`
}

// ── Presentation summary ─────────────────────────────────────────────────────

export function buildPresentationSummaryPrompt(opts: {
  setup: QaSetupInputs
  transcript: TranscriptSegment[]      // the presentation-phase slice
  outline?: PresentationOutline | null
}): { system: string; userPrompt: string } {
  const agenda = (opts.setup?.agenda ?? []).map((t, i) => `  ${i + 1}. ${t}`).join('\n')

  const system = `You are a neutral minutes-taker summarizing the PRESENTATION portion of a recorded meeting (before audience Q&A). You have the transcript of what was said, and — when available — a structured outline of the actual slides (the ground-truth source for figures/names/dates).

${NEUTRAL_VOICE}

AGENDA (context only):
${agenda || '  (none provided)'}

WRITE:
1. overview — 2-4 neutral sentences: what the presentation covered overall.
2. items — one entry per distinct agenda item / slide topic presented. For each:
   - title: the topic/agenda item
   - presenter: the person/role who presented it, if identifiable (from slides or transcript), else null
   - what_was_presented: a neutral, factual paragraph of what was said/shown
   - key_figures: concrete data points (cost, timeline, counts) as {label,value} — pull from the slide outline FIRST (exact), then the transcript; empty array if none
   - slide_refs: the slide_number(s) this maps to (from the outline), or []

Ground every figure in the slide outline or transcript. Do NOT invent numbers, names, dates, or commitments.

OUTPUT FORMAT — a single JSON object, no prose, no markdown fences:
{ "overview": "...", "items": [ { "title": "...", "presenter": <string|null>, "what_was_presented": "...", "key_figures": [{"label":string,"value":string}], "slide_refs": [int] } ] }`

  const outlineBlock = opts.outline?.slides?.length
    ? `SLIDE OUTLINE (ground truth — slide_number: title — key points / figures)\n` +
      opts.outline.slides.map(s => {
        const figs = s.figures?.length ? ` | figures: ${s.figures.map(f => `${f.label}=${f.value}`).join(', ')}` : ''
        const pts = s.key_points?.length ? ` — ${s.key_points.join('; ')}` : ''
        return `[${s.slide_number}] ${s.title ?? '(untitled)'}${pts}${figs}${s.presenter ? ` | presenter: ${s.presenter}` : ''}`
      }).join('\n')
    : '(no slide outline available — summarize from the transcript alone)'

  const userPrompt = `${outlineBlock}\n\nPRESENTATION TRANSCRIPT\n${formatTranscript(opts.transcript)}`
  return { system, userPrompt }
}

function formatTranscript(segments: TranscriptSegment[]): string {
  return segments.map(s => {
    const m = Math.floor(s.start / 60), sec = Math.floor(s.start % 60)
    const sp = s.speaker ? `${s.speaker}: ` : ''
    return `[${m}:${sec.toString().padStart(2, '0')}] ${sp}${s.text}`
  }).join('\n')
}
