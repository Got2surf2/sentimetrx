// lib/agentReadoutHtml.ts
//
// Point-in-time HTML bake of an Agent Conversation Readout. Pure function —
// takes the same AgentReadout object the page, PDF, and PPTX consumers share,
// and emits self-contained, inline-styled HTML. No React, no fetch, no client
// JS: drill-downs use native <details>/<summary>, so the SAME markup renders in
// the interactive page, the headless-Chrome PDF, and a sandboxed (script-
// disabled) share iframe. Every piece of user-derived text is escaped.
//
// Deliberately the ONE renderer for the Readout (the Agent Study keeps a React
// report AND a baked-HTML mirror that must be hand-synced — this avoids that
// drift). `expand` controls samples: collapsed <details> for the interactive
// page (tidy), always-visible for the PDF/print handout. Datanautix-branded per
// the deck/report-export exception in CLAUDE.md.

import type { AgentReadout, QuestionTheme, BeyondTheme } from '@/lib/agentReadout'

const TEAL = '#0F7173'
const INK = '#111827'
const MUTE = '#6b7280'
const ORANGE = '#E8632A'

const DN_WORDMARK = '<span style="font-weight:800;font-size:17px;letter-spacing:-0.3px;white-space:nowrap;flex-shrink:0">'
  + '<span style="color:#0F7173">data</span><span style="color:#E8632A">nautix</span></span>'

function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

const CARD = 'background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:18px 20px;margin-bottom:14px'
const H2 = 'font-size:13px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:' + MUTE + ';margin:34px 0 14px'

// A compact three-segment sentiment bar (positive / neutral / negative) sized to
// the theme's tally. Neutral is the default for unscored turns, so most bars
// read mostly-gray — the colored ends are the signal.
function sentimentBar(s: { positive: number; neutral: number; negative: number }): string {
  const total = s.positive + s.neutral + s.negative || 1
  const seg = (n: number, color: string) => n > 0
    ? `<div style="width:${(n / total) * 100}%;height:100%;background:${color}"></div>` : ''
  return '<div style="display:flex;height:6px;width:120px;border-radius:4px;overflow:hidden;background:#F1F3F5" '
    + `title="${s.positive} positive · ${s.neutral} neutral · ${s.negative} negative">`
    + seg(s.positive, '#059669') + seg(s.neutral, '#D1D5DB') + seg(s.negative, '#DC2626') + '</div>'
}

function sourceBadge(source: 'focus' | 'emergent'): string {
  const [bg, fg, label] = source === 'focus'
    ? ['#CCFBF1', '#0F766E', 'Focus area']
    : ['#FEF3C7', '#92400E', 'Emerged from conversations']
  return `<span style="font-size:10px;font-weight:700;letter-spacing:0.03em;text-transform:uppercase;`
    + `background:${bg};color:${fg};padding:2px 8px;border-radius:999px;white-space:nowrap">${label}</span>`
}

// Samples either as a collapsed <details> (interactive) or an always-visible
// block (PDF/print). Same inner markup either way.
function samplesBlock(summary: string, accent: string, inner: string, expand: boolean): string {
  const body = `<div style="margin-top:10px;display:flex;flex-direction:column;gap:8px">${inner}</div>`
  if (expand) return `<div style="margin-top:12px"><div style="font-size:12px;color:${accent};font-weight:600">${summary}</div>${body}</div>`
  return `<details style="margin-top:12px"><summary style="cursor:pointer;font-size:12px;color:${accent};font-weight:600">${summary}</summary>${body}</details>`
}

function questionThemeCard(t: QuestionTheme, expand: boolean): string {
  const inner = t.samples.map(s => `<div style="font-size:13px;color:${INK};background:#F9FAFB;border-left:3px solid ${TEAL};`
    + `border-radius:0 8px 8px 0;padding:8px 12px">${esc(s.text)}</div>`).join('')
  const samples = t.samples.length ? samplesBlock(`What people asked (${plural(t.samples.length, 'example')})`, TEAL, inner, expand) : ''
  return `<div style="${CARD}">`
    + '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">'
    + `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span style="font-size:16px;font-weight:700;color:${INK}">${esc(t.label)}</span>${sourceBadge(t.source)}</div>`
    + sentimentBar(t.sentiment)
    + '</div>'
    + `<div style="font-size:13px;color:${MUTE};margin-top:6px">${plural(t.questions, 'question')} · across ${plural(t.sessions, 'conversation')}</div>`
    + samples
    + '</div>'
}

function beyondThemeCard(t: BeyondTheme, expand: boolean): string {
  const inner = t.samples.map(s => `<div style="font-size:13px;color:${INK};font-style:italic;background:#FFF7ED;border-left:3px solid ${ORANGE};`
    + `border-radius:0 8px 8px 0;padding:8px 12px">“${esc(s.quote)}”</div>`).join('')
  const samples = t.samples.length ? samplesBlock(`In their words (${plural(t.samples.length, 'comment')})`, ORANGE, inner, expand) : ''
  return `<div style="${CARD}">`
    + '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">'
    + `<span style="font-size:16px;font-weight:700;color:${INK}">${esc(t.label)}</span>`
    + sentimentBar(t.sentiment)
    + '</div>'
    + `<div style="font-size:13px;color:${MUTE};margin-top:6px">${plural(t.comments, 'comment')} · across ${plural(t.sessions, 'conversation')}</div>`
    + samples
    + '</div>'
}

// Tail-noise floor: themes with a single mention (often a one-off or a slightly
// mis-tagged factual aside) collapse into a one-line "also raised" footer
// instead of full cards, so the cards that remain are the real signal.
function splitTail<T>(themes: T[], countOf: (t: T) => number): { main: T[]; singletons: T[] } {
  const main: T[] = [], singletons: T[] = []
  for (const t of themes) (countOf(t) >= 2 ? main : singletons).push(t)
  return { main, singletons }
}
function singletonFooter(singletons: { label: string }[], lead: string): string {
  if (!singletons.length) return ''
  return `<div style="font-size:12px;color:${MUTE};margin:2px 4px 0">${lead} `
    + singletons.map(s => esc(s.label)).join(' · ') + '</div>'
}

function readoutBody(r: AgentReadout, expand: boolean): string {
  const q = splitTail(r.questionThemes, t => t.questions)
  const b = splitTail(r.beyondThemes, t => t.comments)

  const takeaways = r.summary.takeaways.length
    ? '<ul style="margin:10px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:7px">'
      + r.summary.takeaways.map(t => `<li style="font-size:13.5px;color:${INK};line-height:1.5">${esc(t)}</li>`).join('')
      + '</ul>'
    : ''
  const summaryCard = (r.summary.overview || takeaways)
    ? `<div style="${CARD};border-left:4px solid ${TEAL}">`
      + (r.summary.overview ? `<div style="font-size:14.5px;line-height:1.65;color:${INK}">${esc(r.summary.overview)}</div>` : '')
      + takeaways + '</div>'
    : ''

  return ''
    + '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:6px">'
    + `<div><div style="font-size:24px;font-weight:800;color:${INK};line-height:1.2">${esc(r.title)}</div>`
    + `<div style="font-size:13px;color:${MUTE};margin-top:6px">`
    + `${fmtDate(r.range.first)} – ${fmtDate(r.range.last)} · `
    + `Based on ${plural(r.scope.conversations, 'conversation')} · `
    + `${plural(r.scope.questions, 'question')} themed · ${plural(r.scope.beyondComments, 'comment')} raised beyond them`
    + '</div></div>'
    + DN_WORDMARK
    + '</div>'
    + summaryCard
    + `<div style="${H2}">Questions by theme</div>`
    + (q.main.length ? q.main.map(t => questionThemeCard(t, expand)).join('') : `<div style="font-size:13px;color:${MUTE}">No themed questions yet.</div>`)
    + singletonFooter(q.singletons, 'Also asked about, once:')
    + `<div style="${H2}">Raised beyond the questions</div>`
    + `<div style="font-size:13px;color:${MUTE};margin:-8px 4px 14px">What participants volunteered on their own — observations, concerns, suggestions, and opinions beyond what they asked.</div>`
    + (b.main.length ? b.main.map(t => beyondThemeCard(t, expand)).join('') : `<div style="font-size:13px;color:${MUTE}">No volunteered comments yet.</div>`)
    + singletonFooter(b.singletons, 'Also raised, once:')
    + `<div style="font-size:11.5px;color:${MUTE};margin-top:28px;line-height:1.5;border-top:1px solid #e5e7eb;padding-top:14px">${esc(r.meta.method)}</div>`
}

// Inner fragment for the interactive page (collapsed drill-downs).
export function renderAgentReadoutFragment(readout: AgentReadout): string {
  return readoutBody(readout, false)
}

// Full standalone HTML document for the PDF route + share bake (drill-downs
// expanded so a printed/shared handout shows the verbatims without clicking).
export function renderAgentReadoutHtml(readout: AgentReadout): string {
  return '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + `<title>${esc(readout.title)}</title>`
    + '<style>body{margin:0;background:#F9FAFB;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head>'
    + '<body><div style="max-width:860px;margin:0 auto;padding:32px 24px 56px">'
    + readoutBody(readout, true)
    + '</div></body></html>'
}
