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
  ProceedingsSummary,
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
  /** Presentation/meeting-notes summary — rendered above the Q&A when present. */
  proceedings?: ProceedingsSummary | null
  pairs: Array<Pick<RecordingExtractionRow, 'unit_type' | 'topic' | 'payload' | 'sort_order' | 'start_sec' | 'end_sec'>>
  /** Raw ASR segments + vendor; only used when includeTranscript is true. */
  transcript: { vendor: string; segments: TranscriptSegment[] } | null
  /** Reviewed entity map — drives the spelling-corrected transcript view. */
  entityMap: EntityMap | null
  includeTranscript: boolean
  /** Meeting length — anchors the timeline bar; falls back to last pair end. */
  source_duration_sec?: number | null
  /** Analysis attribution (§2.8) — printed in the header when present. */
  analysis_org?: string | null
  analysts?: Array<{ name: string }>
  objectives?: { summary: string; questions: string[] } | null
  confidentiality_class?: string | null
  signoff?: { approved_by: string; approved_at?: string | null } | null
  config_version?: number | null
  /** Unreviewed AI draft → DRAFT watermark + opening "pending review" statement. */
  draft?: boolean | null
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

// Meeting-notes section — the presentation half of the meeting. Mirrors the
// in-app PresentationTab (app/recordings/[id]/report/ReportClient.tsx) so the
// PDF carries both halves of a community meeting, not just the Q&A.
function proceedingsSection(p: ProceedingsSummary | null | undefined): string {
  if (!p || (!p.overview && (p.items?.length ?? 0) === 0)) return ''
  const items = (p.items ?? [])
    .map(it => {
      const slideRefs = (it.slide_refs?.length ?? 0) > 0
        ? `<span class="slideref">${it.slide_refs.length === 1 ? 'Slide' : 'Slides'} ${esc(it.slide_refs.join(', '))}</span>`
        : ''
      const figs = (it.key_figures?.length ?? 0) > 0
        ? `<div class="figs">` +
          it.key_figures.map(f => `<span class="fig"><span class="fl">${esc(f.label)}</span><span class="fv">${esc(f.value)}</span></span>`).join('') +
          `</div>`
        : ''
      return (
        `<div class="pitem">` +
        `<div class="pitem-head"><h3 class="pitem-t">${esc(it.title)}</h3>${slideRefs}</div>` +
        (it.presenter ? `<div class="pres">${esc(it.presenter)}</div>` : '') +
        (it.what_was_presented ? `<p class="pwhat">${esc(it.what_was_presented)}</p>` : '') +
        figs +
        `</div>`
      )
    })
    .join('')
  return (
    `<section class="notes">` +
    `<h2 class="topic">Meeting Notes</h2>` +
    (p.overview ? `<p class="notes-ov">${esc(p.overview)}</p>` : '') +
    items +
    `<p class="caption" style="margin-top:10px">Neutral AI summary of the presentation portion of the meeting. The Q&amp;A below covers the discussion that followed.</p>` +
    `</section>`
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
  // Attribution line (§2.8): prepared-by + analysis org + config version + sign-off.
  const CONF_LABEL: Record<string, string> = {
    public: 'Public', internal: 'Internal — Not for Distribution',
    client_confidential: 'Confidential — Client Only', restricted: 'Restricted',
  }
  const analystStr = (input.analysts ?? []).map(a => a.name).filter(Boolean).join(', ')
  const preparedBits = [
    `Prepared by ${analystStr ? esc(analystStr) + ' · ' : ''}${esc(input.analysis_org || 'Datanautix')}`,
    input.config_version != null ? `Config v${input.config_version}` : null,
    input.signoff?.approved_by ? `Approved by ${esc(input.signoff.approved_by)}${input.signoff.approved_at ? ' on ' + fmtDate(input.signoff.approved_at) : ''}` : null,
    input.confidentiality_class ? (CONF_LABEL[input.confidentiality_class] ?? null) : null,
  ].filter(Boolean).join('  ·  ')
  const objHtml = (input.objectives?.summary || (input.objectives?.questions?.length ?? 0) > 0)
    ? `<div class="objectives"><div class="label">Objectives</div>${input.objectives?.summary ? `<p style="margin:0 0 4px">${esc(input.objectives.summary)}</p>` : ''}${(input.objectives?.questions?.length ?? 0) > 0 ? `<ul style="margin:0;padding-left:18px">${input.objectives!.questions.map(q => `<li>${esc(q)}</li>`).join('')}</ul>` : ''}</div>`
    : ''

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

  const notes = proceedingsSection(input.proceedings)
  // Eyebrow reflects scope: both halves present → "Meeting Summary"; Q&A only → legacy label.
  const eyebrow = notes ? 'Meeting Summary' : 'Meeting Q&amp;A Summary'

  const overview = summary?.executive_summary
    ? `<section class="overview"><h2 class="ov-h">${notes ? 'Q&amp;A Overview' : 'Overview'}</h2><p class="ov-p">${esc(summary.executive_summary)}</p></section>`
    : ''

  // Meeting timeline summary bar (single brand colour — flagged state is internal).
  const tlModel = buildTimelineModel(pairs, input.source_duration_sec ?? null)
  const timeline = tlModel ? renderTimelineHtml(tlModel, TEAL) : ''

  // Draft watermark + opening statement (position:fixed repeats on every PDF page).
  const draftCss = input.draft
    ? `.draft-wm{position:fixed;top:42%;left:0;right:0;text-align:center;font-size:120px;font-weight:900;color:rgba(245,158,11,0.13);transform:rotate(-28deg);pointer-events:none;letter-spacing:10px}`
      + `.draft-banner{background:#fef3c7;border:1px solid #fcd34d;border-radius:10px;padding:12px 16px;margin:14px 0 0}`
      + `.draft-banner .t{font-weight:800;color:#b45309;font-size:13px}.draft-banner .d{color:#92400e;font-size:12px;margin:4px 0 0;line-height:1.5}`
    : ''
  const draftWm = input.draft ? `<div class="draft-wm">DRAFT</div>` : ''
  const draftBanner = input.draft
    ? `<div class="draft-banner"><div class="t">⚠ DRAFT — pending human review</div><p class="d">This report was generated automatically and has <strong>not yet been reviewed by a person</strong>. Figures and attributions may change. It will be finalized after review.</p></div>`
    : ''

  return (
    `<!doctype html><html><head><meta charset="utf-8"><style>` +
    // Page margins are owned by the PDF renderer's `margin` option (it reserves
    // the bottom band for the repeated footer); keep @page at 0 so they don't
    // stack. See lib/recordings/reportPdf.ts.
    `@page{margin:0}` +
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
    // Keep a section title with the content that follows it — never let a
    // heading sit alone at the foot of a page (widowed title). `break-after`
    // for modern Chromium, the legacy alias for older print engines.
    `h1,.topic,.ov-h{break-after:avoid;page-break-after:avoid}` +
    // Trim single-line widows/orphans on flowing body copy.
    `.ov-p,.a-text,.pwhat,.notes-ov,.tx .seg{orphans:3;widows:3}` +
    `.notes{margin:22px 0}` +
    `.notes-ov{font-size:14px;line-height:1.6;color:${BODY};margin:0 0 14px;white-space:pre-wrap}` +
    `.pitem{border:1px solid ${LINE};border-radius:12px;padding:12px 14px;margin-bottom:12px;page-break-inside:avoid}` +
    `.pitem-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px}` +
    `.pitem-t{font-size:14px;font-weight:700;color:${INK};margin:0}` +
    `.slideref{font-size:11px;color:${FAINT};white-space:nowrap}` +
    `.pres{font-size:11px;color:${MUTE};margin-top:2px}` +
    `.pwhat{font-size:14px;line-height:1.6;color:${BODY};margin:8px 0 0;white-space:pre-wrap}` +
    `.figs{margin-top:10px;display:flex;flex-wrap:wrap;gap:6px}` +
    `.fig{display:inline-flex;align-items:baseline;gap:5px;padding:3px 9px;border:1px solid ${LINE};border-radius:8px;background:#f8fafc;font-size:12px}` +
    `.fig .fl{color:${MUTE}}` +
    `.fig .fv{font-weight:700;color:${INK}}` +
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
    draftCss +
    `</style></head><body>` + draftWm + `<div class="wrap">` +
    `<header><div class="eyebrow">${eyebrow}</div><h1>${esc(input.name)}</h1>${meta ? `<p class="sub">${esc(meta)}</p>` : ''}<p class="sub" style="font-size:11px">${preparedBits}</p>${objHtml}${draftBanner}</header>` +
    notes +
    overview +
    timeline +
    `<section>${topics}</section>` +
    transcriptSection(input) +
    `</div></body></html>`
  )
}
