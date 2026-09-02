// lib/anaPdf.ts
// Compose Ana findings into a branded, print-quality PDF document (2026-09-02,
// owner: "generate a PDF with the findings as a take-away — pretty
// sophisticated"). Pure composition: the CLIENT posts the answer content it
// already has (export routes POST the page's data, never recompute); this
// module renders Ana's markdown-ish answers — headings, bullets, pipe TABLES,
// blockquote verbatims, inline ```chart blocks — into styled HTML, and appends
// each answer's "Provenance — how this was derived" trail so every figure in the
// hand-off carries its recreation recipe (platform-recreatable principle).
// Layout follows the composed-PDF doctrine: break-inside: avoid on sections
// and cards, never a forced break-before per section.

import { splitAnaSegments, type AnaChartSpec } from '@/lib/anaChartSpec'

export interface AnaExchange {
  question: string
  answer: string
  logic?: string[]
}

export interface AnaPdfOpts {
  datasetName: string
  exchanges: AnaExchange[]
  generatedAt: Date
}

const TEAL = '#0F7173'
const ORANGE = '#E85A1A'
const INK = '#0f172a'
const SOFT = '#475569'
const MUTED = '#94a3b8'
const RULE = '#e2e8f0'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Inline markdown: bold / italics / code, applied AFTER escaping.
function inline(s: string): string {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

const NUMERIC_CELL = /^[\s$~≈<>±-]*[\d,.]+[%★*\s]*$/

// A run of |…| lines → a styled table (numeric COLUMNS centered, header
// included, so counts line up under their heading; separator rows dropped).
function tableHtml(lines: string[]): string {
  const rows = lines
    .map(function(l) { return l.trim().replace(/^\||\|$/g, '').split('|').map(function(c) { return c.trim() }) })
    .filter(function(cells) { return !cells.every(function(c) { return /^:?-{2,}:?$/.test(c) || c === '' }) })
  if (rows.length === 0) return ''
  const header = rows[0]
  const body = rows.slice(1)
  const numericCol = header.map(function(_, i) {
    const vals = body.map(function(cells) { return (cells[i] || '').replace(/\*\*/g, '') }).filter(function(c) { return c !== '' })
    return vals.length > 0 && vals.every(function(c) { return NUMERIC_CELL.test(c) })
  })
  const th = header.map(function(c, i) {
    return '<th' + (numericCol[i] ? ' class="num"' : '') + '>' + inline(c) + '</th>'
  }).join('')
  const trs = body.map(function(cells) {
    return '<tr>' + cells.map(function(c, i) {
      return '<td' + (numericCol[i] ? ' class="num"' : '') + '>' + inline(c) + '</td>'
    }).join('') + '</tr>'
  }).join('')
  return '<table class="data"><thead><tr>' + th + '</tr></thead><tbody>' + trs + '</tbody></table>'
}

function chartHtml(spec: AnaChartSpec): string {
  const title = esc(spec.title) + (spec.unit ? ' <span class="unit">· ' + esc(spec.unit) + '</span>' : '')
  const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString('en-US') : String(Math.round(v * 100) / 100))
  if (spec.type === 'bar') {
    const max = Math.max(...spec.data.map(function(d) { return Math.abs(d[1]) }), 1)
    const rows = spec.data.map(function(d) {
      const pct = Math.max(2, Math.round(Math.abs(d[1]) / max * 100))
      return '<div class="brow"><span class="blabel">' + esc(d[0]) + '</span>' +
        '<span class="btrack"><span class="bfill" style="width:' + pct + '%"></span></span>' +
        '<span class="bval">' + fmt(d[1]) + '</span></div>'
    }).join('')
    return '<div class="chart"><div class="ctitle">' + title + '</div>' + rows + '</div>'
  }
  // line
  const W = 640, H = 150, PAD = 8
  const vals = spec.data.map(function(d) { return d[1] })
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const span = hi - lo || 1
  const pts = spec.data.map(function(d, i) {
    const x = PAD + (i / Math.max(1, spec.data.length - 1)) * (W - PAD * 2)
    const y = PAD + (1 - (d[1] - lo) / span) * (H - PAD * 2)
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10]
  })
  const poly = pts.map(function(p) { return p[0] + ',' + p[1] }).join(' ')
  const area = 'M' + pts[0][0] + ' ' + (H - PAD) + ' ' + pts.map(function(p) { return 'L' + p[0] + ' ' + p[1] }).join(' ') + ' L' + pts[pts.length - 1][0] + ' ' + (H - PAD) + ' Z'
  return '<div class="chart"><div class="ctitle">' + title + '</div>' +
    '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block">' +
    '<path d="' + area + '" fill="' + ORANGE + '" opacity="0.08"/>' +
    '<polyline points="' + poly + '" fill="none" stroke="' + ORANGE + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
    '<circle cx="' + pts[pts.length - 1][0] + '" cy="' + pts[pts.length - 1][1] + '" r="3.5" fill="' + ORANGE + '"/></svg>' +
    '<div class="caxis"><span>' + esc(spec.data[0][0]) + '</span><span>low ' + fmt(lo) + ' · high ' + fmt(hi) + '</span><span>' + esc(spec.data[spec.data.length - 1][0]) + '</span></div></div>'
}

// Block-level markdown-ish → HTML (mirrors the panel's renderer, upgraded for
// print: real tables, real blockquotes, charts, horizontal rules).
export function anaMarkdownToHtml(text: string): string {
  const out: string[] = []
  for (const seg of splitAnaSegments(text)) {
    if (seg.kind === 'chart') { out.push(chartHtml(seg.spec)); continue }
    if (seg.kind === 'pending') continue
    const lines = seg.text.split('\n')
    let i = 0
    let listOpen = false
    const closeList = () => { if (listOpen) { out.push('</ul>'); listOpen = false } }
    while (i < lines.length) {
      const line = lines[i]
      const t = line.trim()
      if (/^\|.*\|$/.test(t)) {
        closeList()
        const tbl: string[] = []
        while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) { tbl.push(lines[i]); i++ }
        out.push(tableHtml(tbl))
        continue
      }
      if (/^#{1,3}\s/.test(t)) { closeList(); out.push('<h3>' + inline(t.replace(/^#{1,3}\s/, '')) + '</h3>'); i++; continue }
      if (/^(-{3,}|\*{3,})$/.test(t)) { closeList(); out.push('<hr/>'); i++; continue }
      if (/^>\s?/.test(t)) {
        closeList()
        const q: string[] = []
        while (i < lines.length && /^>\s?/.test(lines[i].trim())) { q.push(lines[i].trim().replace(/^>\s?/, '')); i++ }
        out.push('<blockquote>' + q.map(inline).join('<br/>') + '</blockquote>')
        continue
      }
      if (/^[-*•]\s/.test(t) || /^\d+\.\s/.test(t)) {
        if (!listOpen) { out.push('<ul>'); listOpen = true }
        out.push('<li>' + inline(t.replace(/^[-*•]\s/, '').replace(/^\d+\.\s/, '')) + '</li>')
        i++
        continue
      }
      if (t === '') { closeList(); i++; continue }
      closeList()
      out.push('<p>' + inline(t) + '</p>')
      i++
    }
    closeList()
  }
  return out.join('\n')
}

export function composeAnaFindingsHtml(opts: AnaPdfOpts): string {
  const date = opts.generatedAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const sections = opts.exchanges.map(function(ex, i) {
    const logic = (ex.logic || []).length > 0
      ? '<div class="logic avoid-break"><div class="logic-title">Provenance &mdash; how this was derived</div><ol>' +
        ex.logic!.map(function(step) { return '<li>' + esc(step) + '</li>' }).join('') +
        '</ol><div class="logic-note">Every figure above comes from these queries against the full dataset — the same engine the platform&rsquo;s Charts, Statistics, and Search tabs use, and each step can be recreated there.</div></div>'
      : ''
    return '<section class="exchange">' +
      '<div class="question avoid-break"><span class="qlabel">Question ' + (opts.exchanges.length > 1 ? (i + 1) : '') + '</span>' + inline(ex.question) + '</div>' +
      '<div class="answer">' + anaMarkdownToHtml(ex.answer) + '</div>' +
      logic +
      '</section>'
  }).join('\n')

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; color: ${INK};
         font-size: 10.5pt; line-height: 1.55; margin: 0; }
  .masthead { border-bottom: 3px solid ${INK}; padding-bottom: 10pt; margin-bottom: 14pt; }
  .eyebrow { font-size: 8pt; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: ${ORANGE}; }
  h1 { font-size: 20pt; margin: 2pt 0 4pt; letter-spacing: -.02em; }
  .meta { font-size: 9pt; color: ${SOFT}; }
  .meta b { color: ${INK}; }
  section.exchange { margin-bottom: 16pt; }
  .question { border-left: 3px solid ${ORANGE}; background: #fdf3ee; padding: 7pt 10pt; font-weight: 600;
              font-size: 11pt; margin-bottom: 8pt; border-radius: 0 6px 6px 0; }
  .qlabel { display: block; font-size: 7.5pt; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: ${ORANGE}; margin-bottom: 2pt; }
  h3 { font-size: 12pt; margin: 12pt 0 4pt; letter-spacing: -.01em; break-after: avoid; }
  p { margin: 0 0 6pt; }
  ul { margin: 0 0 6pt; padding-left: 14pt; }
  li { margin-bottom: 2pt; }
  hr { border: none; border-top: 1px solid ${RULE}; margin: 10pt 0; }
  code { background: #f1f5f9; border-radius: 3px; padding: 0 3px; font-size: 9.5pt; }
  blockquote { border-left: 3px solid ${TEAL}; margin: 6pt 0 8pt; padding: 5pt 10pt; color: ${SOFT};
               font-style: italic; background: #f8fafc; border-radius: 0 6px 6px 0; break-inside: avoid; }
  table.data { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 9.5pt; break-inside: avoid; }
  table.data th { text-align: left; font-size: 8pt; letter-spacing: .06em; text-transform: uppercase;
                  color: ${SOFT}; border-bottom: 1.5px solid ${INK}; padding: 3pt 8pt 3pt 0; vertical-align: bottom; }
  table.data td { border-bottom: 1px solid ${RULE}; padding: 3.5pt 8pt 3.5pt 0; vertical-align: top; }
  table.data th.num { text-align: center; padding-right: 12pt; }
  table.data td.num { text-align: center; padding-right: 12pt; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .chart { border: 1px solid ${RULE}; border-radius: 8px; padding: 8pt 10pt; margin: 8pt 0 10pt; break-inside: avoid; }
  .ctitle { font-size: 9.5pt; font-weight: 700; margin-bottom: 6pt; }
  .ctitle .unit { font-weight: 400; color: ${MUTED}; }
  .brow { display: flex; align-items: center; gap: 8pt; margin-bottom: 3.5pt; }
  .blabel { flex: 0 0 110pt; font-size: 8.5pt; color: ${SOFT}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .btrack { flex: 1; height: 8pt; background: #f1f5f9; border-radius: 0 3px 3px 0; overflow: hidden; }
  .bfill { display: block; height: 100%; background: ${ORANGE}; border-radius: 0 3px 3px 0; }
  .bval { flex: 0 0 44pt; text-align: right; font-size: 8.5pt; font-variant-numeric: tabular-nums; color: ${INK}; }
  .caxis { display: flex; justify-content: space-between; font-size: 7.5pt; color: ${MUTED}; margin-top: 2pt; }
  .logic { border: 1px solid ${RULE}; border-radius: 8px; padding: 8pt 10pt; margin-top: 8pt; background: #fafafa; }
  .logic-title { font-size: 8pt; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: ${TEAL}; margin-bottom: 4pt; }
  .logic ol { margin: 0; padding-left: 14pt; font-size: 8.5pt; color: ${SOFT}; }
  .logic li { margin-bottom: 1.5pt; }
  .logic-note { font-size: 7.5pt; color: ${MUTED}; margin-top: 4pt; }
  .avoid-break { break-inside: avoid; }
  </style></head><body>
  <div class="masthead avoid-break">
    <div class="eyebrow">Analyst Findings</div>
    <h1>${esc(opts.datasetName)}</h1>
    <div class="meta">Prepared by <b>Ana</b> · ${date} · ${opts.exchanges.length} question${opts.exchanges.length === 1 ? '' : 's'} answered against the full dataset</div>
  </div>
  ${sections}
  </body></html>`
}
