// lib/sourceSummary.ts
//
// Shared "what was presented" renderer — the source-material section that opens
// both reports, so they read as siblings:
//   - Town Hall report → a neutral summary of the meeting's PRESENTATION
//     (lib/recordings, from slides/transcript: ProceedingsSummary)
//   - Agent Study report → a neutral summary of the agent's KNOWLEDGE BASE
//     ("what this agent is equipped to cover": system prompt + knowledge chunks)
//
// Both are "the official content the audience was given before they reacted." The
// SourceSummary shape is a neutral superset of recordings' ProceedingsSummary;
// each report maps onto it. Pure function, self-contained inline styles,
// parameterized like renderCommentaryHtml / renderTimelineHtml. All caller text
// is escaped here.

export interface SourceSummaryFigure {
  label: string
  value: string
}

export interface SourceSummaryItem {
  title: string
  /** Presenter (town hall) / source document (agent). Optional. */
  attribution?: string | null
  /** Neutral, factual body — what was presented / what the KB topic covers. */
  body?: string | null
  /** Stats/data points read off the source — verbatim. */
  figures?: SourceSummaryFigure[]
  /** Right-aligned reference label, e.g. "Slides 3, 4" (town hall only). */
  refs?: string | null
}

export interface SourceSummary {
  /** 2–4 neutral sentences. */
  overview: string
  items: SourceSummaryItem[]
}

export interface SourceSummaryRenderOpts {
  heading?: string     // 'Meeting Notes' (town hall) / 'Knowledge Base' (agent)
  subtitle?: string    // optional one-liner under the heading
  caption?: string     // muted footnote under the items
}

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

/**
 * Render the source-summary section. Returns '' when there's no overview and no
 * items, so callers can append unconditionally.
 */
export function renderSourceSummaryHtml(s: SourceSummary | null | undefined, opts: SourceSummaryRenderOpts = {}): string {
  if (!s || (!s.overview && (s.items?.length ?? 0) === 0)) return ''
  const heading = opts.heading || 'Source Material'

  const items = (s.items ?? []).map(it => {
    const refs = it.refs
      ? `<span style="font-size:11px;color:${FAINT};white-space:nowrap">${esc(it.refs)}</span>`
      : ''
    const figs = (it.figures?.length ?? 0) > 0
      ? `<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px">` +
        it.figures!.map(f =>
          `<span style="display:inline-flex;align-items:baseline;gap:5px;padding:3px 9px;border:1px solid ${LINE};border-radius:8px;background:#f8fafc;font-size:12px">` +
          `<span style="color:${MUTE}">${esc(f.label)}</span><span style="font-weight:700;color:${INK}">${esc(f.value)}</span></span>`,
        ).join('') +
        `</div>`
      : ''
    return (
      `<div style="border:1px solid ${LINE};border-radius:12px;padding:12px 14px;margin-bottom:12px;page-break-inside:avoid">` +
      `<div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px">` +
      `<h3 style="font-size:14px;font-weight:700;color:${INK};margin:0">${esc(it.title)}</h3>${refs}</div>` +
      (it.attribution ? `<div style="font-size:11px;color:${MUTE};margin-top:2px">${esc(it.attribution)}</div>` : '') +
      (it.body ? `<p style="font-size:14px;line-height:1.6;color:${BODY};margin:8px 0 0;white-space:pre-wrap">${esc(it.body)}</p>` : '') +
      figs +
      `</div>`
    )
  }).join('')

  const sub = opts.subtitle
    ? `<p style="font-size:12px;color:${MUTE};margin:0 0 12px">${esc(opts.subtitle)}</p>`
    : ''
  const caption = opts.caption
    ? `<p style="font-size:12px;color:${MUTE};margin:10px 0 0">${esc(opts.caption)}</p>`
    : ''

  return (
    `<section style="margin:0;page-break-inside:auto">` +
    `<h2 style="font-size:17px;font-weight:800;color:${INK};border-bottom:1px solid ${LINE};padding-bottom:6px;margin:0 0 12px;break-after:avoid;page-break-after:avoid">${esc(heading)}</h2>` +
    sub +
    (s.overview ? `<p style="font-size:14px;line-height:1.6;color:${BODY};margin:0 0 14px;white-space:pre-wrap">${esc(s.overview)}</p>` : '') +
    items +
    caption +
    `</section>`
  )
}
