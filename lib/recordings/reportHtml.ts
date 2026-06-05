// lib/recordings/reportHtml.ts
//
// Point-in-time HTML bake of a Town Hall report (docs/RECORDINGS.md §4.14). Pure
// function — emits a self-contained, inline-styled HTML document with no React,
// no fetch, no client JS, so headless Chrome's page.pdf() can render it directly
// (the /api/recordings/[id]/report/pdf route).
//
// Mirrors app/th/[token]/page.tsx section-for-section so the PDF reads like the
// public share link: meeting meta + executive summary + polished Q&A by topic,
// polished→verbatim fallback per pair. Optionally appends the full transcript
// (spelling-corrected via the reviewed entity map) when the owner opts in — the
// one thing the public /th page never shows. Datanautix-branded (deck/report
// export brand rule in CLAUDE.md). Every user/AI-derived string is escaped.

import type {
  RecordingAnalysisSummary,
  QaPairPayload,
  RecordingExtractionRow,
  TranscriptSegment,
  EntityMap,
} from '@/lib/recordings/types'
import { normalizeSegments } from '@/lib/recordings/normalize'
import { displayQuestion, displayAnswer } from '@/lib/recordings/qaDisplay'
import { buildTimelineModel, renderTimelineHtml } from '@/lib/recordings/timeline'

const TEAL = '#0f766e'
const ORANGE = '#c2410c'
const INK = '#0f172a'
const BODY = '#334155'
const MUTE = '#64748b'
const FAINT = '#94a3b8'
const LINE = '#e2e8f0'

// Datanautix wordmark (data = teal, nautix = orange) — the company brand on
// exported/shared reports, per CLAUDE.md.
const DN_WORDMARK =
  '<span style="font-weight:800"><span style="color:#1FA8A8">data</span><span style="color:#F07040">nautix</span></span>'

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fmtDate(s: string | null): string {
  if (!s) return ''
  try {
    // meeting_date is a date-only column — format in UTC so a value like
    // '2026-05-21' doesn't shift to the 20th in negative-UTC timezones.
    return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
  } catch {
    return ''
  }
}

export interface TownHallReportInput {
  name: string
  meeting_date: string | null
  location: string | null
  summary: RecordingAnalysisSummary | null
  pairs: Array<Pick<RecordingExtractionRow, 'unit_type' | 'topic' | 'payload' | 'sort_order' | 'start_sec' | 'end_sec'>>
  /** Raw ASR segments + vendor; only used when includeTranscript is true. */
  transcript: { vendor: string; segments: TranscriptSegment[] } | null
  /** Reviewed entity map — drives the spelling-corrected transcript view. */
  entityMap: EntityMap | null
  includeTranscript: boolean
  /** Meeting length — anchors the timeline bar; falls back to last pair end. */
  source_duration_sec?: number | null
}

// One Q&A card — mirrors the /th page's question/response block.
function qaCard(qa: QaPairPayload): string {
  const q = displayQuestion(qa)
  const a = displayAnswer(qa)
  return (
    `<div class="qa">` +
    `<div class="q-head">` +
    `<div class="label" style="color:${TEAL}">Question${qa.asker_name ? `  ·  ${esc(qa.asker_name)}` : ''}</div>` +
    `<p class="q-text">${esc(q)}</p>` +
    `</div>` +
    `<div class="a-body">` +
    `<div class="label" style="color:${ORANGE}">Response${qa.panelist_name ? `  ·  ${esc(qa.panelist_name)}` : ''}</div>` +
    `<p class="a-text">${esc(a)}</p>` +
    `</div>` +
    `</div>`
  )
}

// Full-transcript appendix — corrected segments, merged into speaker paragraphs.
function transcriptSection(input: TownHallReportInput): string {
  if (!input.includeTranscript || !input.transcript || input.transcript.segments.length === 0) return ''
  const corrected = normalizeSegments(input.transcript.segments, input.entityMap)

  // Merge consecutive same-speaker segments into one paragraph for readability.
  const paras: Array<{ speaker?: string; text: string }> = []
  for (const s of corrected) {
    const text = s.text.trim()
    if (!text) continue
    const last = paras[paras.length - 1]
    if (last && last.speaker === s.speaker) last.text += ' ' + text
    else paras.push({ speaker: s.speaker, text })
  }

  const corrected_note = input.entityMap && input.entityMap.entities.length > 0
    ? ' Names are normalized to the reviewed spellings; the raw ASR is otherwise unchanged.'
    : ''

  return (
    `<section class="appendix">` +
    `<h2 class="topic">Full Transcript</h2>` +
    `<p class="caption">Verbatim ASR (${esc(input.transcript.vendor)}).${corrected_note}</p>` +
    `<div class="tx">` +
    paras
      .map(
        p =>
          `<p class="seg">${p.speaker ? `<span class="spk">${esc(p.speaker)}</span>` : ''}${esc(p.text)}</p>`,
      )
      .join('') +
    `</div>` +
    `</section>`
  )
}

export function renderTownHallReportHtml(input: TownHallReportInput): string {
  const pairs = input.pairs.filter(p => p.unit_type === 'qa_pair')
  const summary = input.summary

  // Topic order from the summary, then any extraction topics it didn't cover.
  const order: string[] = []
  for (const t of summary?.topic_summaries ?? []) if (!order.includes(t.topic)) order.push(t.topic)
  for (const p of pairs) {
    const t = p.topic || 'Other'
    if (!order.includes(t)) order.push(t)
  }

  const meta = [fmtDate(input.meeting_date), input.location].filter(Boolean).join('  ·  ')

  const topics = order
    .map(topic => {
      const tPairs = pairs.filter(p => (p.topic || 'Other') === topic)
      if (tPairs.length === 0) return ''
      return (
        `<div class="topic-block">` +
        `<h2 class="topic">${esc(topic)}</h2>` +
        tPairs.map(p => qaCard(p.payload as QaPairPayload)).join('') +
        `</div>`
      )
    })
    .join('')

  const overview = summary?.executive_summary
    ? `<section class="overview"><h2 class="ov-h">Overview</h2><p class="ov-p">${esc(summary.executive_summary)}</p></section>`
    : ''

  // Meeting timeline summary bar (single brand colour — flagged state is internal).
  const tlModel = buildTimelineModel(pairs, input.source_duration_sec ?? null)
  const timeline = tlModel ? renderTimelineHtml(tlModel, TEAL) : ''

  return (
    `<!doctype html><html><head><meta charset="utf-8"><style>` +
    `@page{margin:14mm 12mm}` +
    `*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}` +
    `body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:${INK};margin:0;background:#fff;font-size:14px;line-height:1.5}` +
    `.wrap{max-width:720px;margin:0 auto;padding:8px 0 24px}` +
    `.eyebrow{font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${FAINT};margin-bottom:6px}` +
    `h1{font-size:26px;font-weight:800;color:${INK};margin:0}` +
    `.sub{font-size:13px;color:${MUTE};margin-top:6px}` +
    `.overview{margin:22px 0;border:1px solid ${LINE};border-radius:14px;padding:16px 18px;background:#f8fafc;page-break-inside:avoid}` +
    `.ov-h{font-size:13px;font-weight:700;color:${BODY};margin:0 0 6px}` +
    `.ov-p{font-size:14px;line-height:1.6;color:${BODY};margin:0;white-space:pre-wrap}` +
    `.topic-block{margin-top:22px}` +
    `.topic{font-size:17px;font-weight:800;color:${INK};border-bottom:1px solid ${LINE};padding-bottom:6px;margin:0 0 14px}` +
    `.qa{border:1px solid ${LINE};border-radius:12px;overflow:hidden;margin-bottom:14px;page-break-inside:avoid}` +
    `.q-head{padding:11px 14px;border-bottom:1px solid #f1f5f9}` +
    `.a-body{padding:11px 14px;background:#f8fafc}` +
    `.label{font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:3px}` +
    `.q-text{font-size:14px;font-weight:600;color:${INK};margin:0}` +
    `.a-text{font-size:14px;line-height:1.6;color:${BODY};margin:0;white-space:pre-wrap}` +
    `.appendix{margin-top:30px;page-break-before:always}` +
    `.caption{font-size:12px;color:${MUTE};margin:0 0 12px}` +
    `.tx .seg{font-size:13px;line-height:1.55;color:${BODY};margin:0 0 8px}` +
    `.spk{display:inline-block;font-weight:700;color:${MUTE};margin-right:6px}` +
    `.foot{margin-top:34px;padding-top:14px;border-top:1px solid ${LINE};text-align:center;font-size:11px;color:${FAINT}}` +
    `</style></head><body><div class="wrap">` +
    `<header><div class="eyebrow">Meeting Q&amp;A Summary</div><h1>${esc(input.name)}</h1>${meta ? `<p class="sub">${esc(meta)}</p>` : ''}</header>` +
    overview +
    timeline +
    `<section>${topics}</section>` +
    transcriptSection(input) +
    `<footer class="foot">Prepared by ${DN_WORDMARK}  ·  datanautix.com</footer>` +
    `</div></body></html>`
  )
}
