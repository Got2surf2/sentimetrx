import 'server-only'
// lib/outletReportPdf.ts
// The Outlet Deep-Dive as a REAL composed PDF document.
//
// It replaces "the page's print output IS the export" (2026-07-15). That was a
// reasonable stopgap — one component, no drift — but it made the deliverable a
// screenshot of a web page: web spacing, web type scale, whatever the browser's
// print dialog decided, and no control over where pages break. A document handed
// to a GM or a franchisee should be typeset as a document.
//
// So this builds a print-first HTML document from the SAME computed values the
// page renders (`OutletReport['selected']` + the cached `ActionPlan`), and
// `htmlToPdfBuffer` renders it through headless Chrome with the shared
// `brandedPdfChrome` header/footer. Nothing is recomputed and nothing is
// fabricated — if a figure isn't in the snapshot, it isn't on the page.
//
// ⚠️ Any route that calls this MUST be listed in next.config.js
// `outputFileTracingIncludes` with `@sparticuz/chromium/bin/**`, or it 500s on
// Vercel with "input directory .../bin does not exist".

import type { OutletReport, OutletSnapshot, ThemeDelta, ComparisonBlock } from '@/lib/outletReport'
import type { ActionPlan } from '@/lib/outletActionPlan'

type Selected = NonNullable<OutletReport['selected']>

const TEAL = '#0F7173'
const ORANGE = '#E85A1A'
const AHEAD = '#0d9488'    // matches OutletDimensionsView — CVD-validated pair
const BEHIND = '#e11d48'
const INK = '#0f172a'
const MUTED = '#64748b'
const FAINT = '#94a3b8'
const RULE = '#e2e8f0'

const esc = (s: string) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const pct0 = (n: number) => `${Math.round(n * 100)}%`
const signedPct = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(Math.round(n * 100))}%`
const pts = (d: number) => `${d > 0 ? '+' : '−'}${Math.abs(Math.round(d * 100))}`

const READ_COLOR: Record<string, string> = {
  FIX: '#be123c', WATCH: '#b45309', SOLID: '#475569', STRENGTH: '#0f766e',
}
const READ_BG: Record<string, string> = {
  FIX: '#ffe4e6', WATCH: '#fef3c7', SOLID: '#f1f5f9', STRENGTH: '#ccfbf1',
}

function kpi(label: string, value: string, sub?: string): string {
  return `<div class="kpi">
    <div class="kpi-l">${esc(label)}</div>
    <div class="kpi-v">${esc(value)}</div>
    ${sub ? `<div class="kpi-s">${esc(sub)}</div>` : ''}
  </div>`
}

function distributionRows(s: OutletSnapshot): string {
  return s.distribution.map((b) => {
    const w = Math.max(0.6, b.pct * 100)
    // The network average for this star bucket, drawn as a tick on the track so
    // every bar carries its own comparison rather than needing a second chart.
    const at = Math.min(100, Math.max(0, b.net.avg * 100))
    return `<div class="dist">
      <span class="dist-k">${b.star}★</span>
      <span class="dist-track">
        <span class="dist-bar" style="width:${w}%"></span>
        <span class="dist-tick" style="left:${at}%"></span>
      </span>
      <span class="dist-v">${pct0(b.pct)}</span>
    </div>`
  }).join('')
}

function themeTable(s: OutletSnapshot): string {
  if (!s.themeTable.length) return ''
  const rows = s.themeTable.map((t) => `<tr>
    <td class="t-name">${esc(t.theme)}</td>
    <td class="num">${t.mentions.toLocaleString()}</td>
    <td class="num strong">${t.avgStar.toFixed(2)}</td>
    <td class="num">${pct0(t.pctNegative)}</td>
    <td class="right"><span class="pill" style="color:${READ_COLOR[t.read]};background:${READ_BG[t.read]}">${esc(t.read)}</span></td>
  </tr>`).join('')
  return `<section class="blk">
    <h2>What guests talk about — and how it scores</h2>
    <table>
      <thead><tr><th>Theme</th><th class="num">Mentions</th><th class="num">Avg ★</th><th class="num">% Negative</th><th class="right">Read</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`
}

function dimensionRows(block: ComparisonBlock, unit: string, networkSize: number): string {
  const rows: ThemeDelta[] = [...block.strengths, ...block.weaknesses].sort((a, b) => b.delta - a.delta)
  if (!block.available || !rows.length) return ''
  const scale = Math.max(...rows.map((r) => Math.abs(r.delta)))
  const MAX_ARM = 38
  const body = rows.map((d) => {
    const ahead = d.delta > 0
    const arm = scale > 0 ? Math.max(1.5, (Math.abs(d.delta) / scale) * MAX_ARM) : 0
    const color = ahead ? AHEAD : BEHIND
    const bar = ahead
      ? `<span class="dv-bar" style="left:50%;width:${arm}%;background:${color};border-radius:0 3px 3px 0"></span>`
      : `<span class="dv-bar" style="right:50%;width:${arm}%;background:${color};border-radius:3px 0 0 3px"></span>`
    const tip = ahead
      ? `<span class="dv-tip" style="left:calc(50% + ${arm}% + 5px);color:${color}">${pts(d.delta)}</span>`
      : `<span class="dv-tip" style="right:calc(50% + ${arm}% + 5px);color:${color}">${pts(d.delta)}</span>`
    return `<div class="dv-row">
      <span class="dv-label">${esc(d.label)} <em>${esc(d.axis)}</em></span>
      <span class="dv-track"><span class="dv-axis"></span>${bar}${tip}</span>
      <span class="dv-meta"><b>${signedPct(d.outletNet)}</b> net · ${d.n.toLocaleString()} ${d.n === 1 ? 'mention' : 'mentions'}</span>
    </div>`
  }).join('')

  const best = rows.find((r) => r.delta > 0 && r.quote)
  const worst = [...rows].reverse().find((r) => r.delta < 0 && r.quote)
  // Framed as "a review mentioning each" — the classifier's evidence is a
  // fixed-width window, so a quote is not proof of the polarity (see
  // lib/verbatimGuard). The colour identifies the row, nothing more.
  const words = (best || worst) ? `<div class="dv-words">
      <div class="eyebrow">In their words <span class="reg">— a review mentioning each</span></div>
      ${best ? `<div class="dv-q"><span style="color:${AHEAD}">${esc(best.label)}</span><em>“${esc(best.quote!)}”</em></div>` : ''}
      ${worst ? `<div class="dv-q"><span style="color:${BEHIND}">${esc(worst.label)}</span><em>“${esc(worst.quote!)}”</em></div>` : ''}
    </div>` : ''

  return `<section class="blk">
    <h2>Dimensions — how this ${esc(unit)} compares to the network</h2>
    <div class="legend"><span><i style="background:${AHEAD}"></i>ahead of network</span><span><i style="background:${BEHIND}"></i>behind</span></div>
    <div class="dv-card">${body}</div>
    ${words}
    <p class="note">Each dimension is scored by <b>net-positive rate</b> — the share of mentions that are positive minus the share that are negative. The bar is the gap between this ${esc(unit)} and the same figure across all ${networkSize.toLocaleString()} ${esc(unit)}s, in percentage points; the centre line is the network. Only dimensions with enough mentions here and network-wide to be reliable are shown.</p>
  </section>`
}

function actionPlanSection(plan: ActionPlan | null): string {
  if (!plan || !plan.priorities.length) return ''
  const items = plan.priorities.map((p, i) => `<div class="pri">
    <div class="pri-h"><span class="pri-n">${i + 1}</span><span class="pri-tag">${esc(p.tag)}</span></div>
    <h3>${esc(p.title)}</h3>
    <p class="pri-d">${esc(p.diagnosis)}</p>
    ${p.verbatims.length ? `<div class="pri-q">${p.verbatims.map((v) => `<div><b>${v.rating}★</b> <em>“${esc(v.quote)}”</em></div>`).join('')}</div>` : ''}
    ${p.actions.length ? `<ul>${p.actions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
  </div>`).join('')
  return `<section class="blk flow">
    <h2>Action plan — what to work on next</h2>
    ${items}
    ${plan.keepDoing ? `<div class="keep"><div class="eyebrow" style="color:${TEAL}">Keep doing</div><p>${esc(plan.keepDoing)}</p></div>` : ''}
  </section>`
}

export function buildOutletReportHtml(opts: {
  brand: string
  selected: Selected
  plan: ActionPlan | null
  networkSize: number
  unitLabel?: string
}): string {
  const { brand, selected: s, plan, networkSize } = opts
  const unit = opts.unitLabel || 'location'
  const snap = s.snapshot

  const fleet = snap.fleet
    ? `${snap.fleet.band} · #${snap.fleet.rank} of ${snap.fleet.total} ${snap.fleet.peerNoun}`
    : 'Under 200 reviews'
  const recent = snap.recent
    ? `${snap.recent.avg.toFixed(2)}★ recent (${snap.recent.direction})`
    : ''

  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: letter; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         color:${INK}; font-size:10.5px; line-height:1.5; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  h1 { font-size:19px; margin:0 0 2px; letter-spacing:-.01em; }
  h2 { font-size:9px; text-transform:uppercase; letter-spacing:.09em; color:${FAINT}; margin:0 0 7px; font-weight:700; }
  h3 { font-size:12.5px; margin:2px 0 4px; }
  .sub { color:${MUTED}; font-size:11px; margin:0 0 2px; }
  .meta { color:${FAINT}; font-size:9.5px; }
  .hdr { border-bottom:2px solid ${INK}; padding-bottom:9px; margin-bottom:14px; display:flex; justify-content:space-between; align-items:flex-end; }
  .blk { margin-top:12px; break-inside:avoid; }
  /* The action plan is the one section allowed to span pages — it is a list of
     self-contained cards, each of which avoids splitting, so flowing it keeps
     the document dense instead of reserving a page for a heading. */
  .blk.flow { break-inside:auto; }

  .kpis { display:flex; gap:7px; }
  .kpi { flex:1; border:1px solid ${RULE}; border-radius:6px; padding:7px 9px; }
  .kpi-l { font-size:7.5px; text-transform:uppercase; letter-spacing:.08em; color:${FAINT}; font-weight:700; }
  .kpi-v { font-size:20px; font-weight:700; margin-top:2px; letter-spacing:-.02em; }
  .kpi-s { font-size:8.5px; color:${MUTED}; margin-top:1px; }

  .dist { display:flex; align-items:center; gap:8px; margin:3px 0; }
  .dist-k { width:20px; color:${MUTED}; font-variant-numeric:tabular-nums; }
  .dist-track { position:relative; flex:1; height:7px; background:#f1f5f9; border-radius:99px; }
  .dist-bar { position:absolute; left:0; top:0; height:7px; background:${TEAL}; border-radius:99px; }
  .dist-tick { position:absolute; top:-2px; width:1.5px; height:11px; background:${INK}; opacity:.55; }
  .dist-v { width:32px; text-align:right; color:${MUTED}; font-variant-numeric:tabular-nums; }

  table { width:100%; border-collapse:collapse; }
  th { font-size:7.5px; text-transform:uppercase; letter-spacing:.07em; color:${FAINT};
       text-align:left; border-bottom:1px solid ${RULE}; padding:0 0 4px; font-weight:700; }
  td { padding:4px 0; border-bottom:1px solid #f1f5f9; }
  .num, th.num { text-align:right; font-variant-numeric:tabular-nums; }
  .right, th.right { text-align:right; }
  .t-name { font-weight:600; }
  .strong { font-weight:700; }
  .pill { display:inline-block; padding:1px 5px; border-radius:3px; font-size:7.5px; font-weight:700; letter-spacing:.05em; }

  .legend { display:flex; gap:10px; justify-content:flex-end; font-size:8px; color:${FAINT}; margin:-4px 0 5px; }
  .legend i { display:inline-block; width:9px; height:6px; border-radius:2px; margin-right:3px; vertical-align:middle; }
  .dv-card { border:1px solid ${RULE}; border-radius:6px; padding:7px 11px; }
  .dv-row { display:flex; align-items:center; gap:9px; }
  .dv-label { width:132px; flex:none; font-weight:600; }
  .dv-label em { font-style:normal; font-size:7.5px; text-transform:uppercase; letter-spacing:.05em; color:${FAINT}; margin-left:4px; }
  .dv-track { position:relative; flex:1; height:18px; }
  .dv-axis { position:absolute; left:50%; top:0; bottom:0; width:1px; background:${RULE}; }
  .dv-bar { position:absolute; top:6px; height:7px; }
  .dv-tip { position:absolute; top:4px; font-size:8.5px; font-weight:700; font-variant-numeric:tabular-nums; }
  .dv-meta { width:126px; flex:none; text-align:right; font-size:8.5px; color:${FAINT}; font-variant-numeric:tabular-nums; }
  .dv-words { margin-top:8px; }
  .dv-q { display:flex; gap:7px; margin-top:3px; font-size:9.5px; }
  .dv-q span { width:74px; flex:none; font-weight:700; }
  .dv-q em { color:${MUTED}; }
  .eyebrow { font-size:7.5px; text-transform:uppercase; letter-spacing:.09em; color:${FAINT}; font-weight:700; }
  .eyebrow .reg { text-transform:none; letter-spacing:0; font-weight:400; }
  .note { font-size:8px; color:${FAINT}; line-height:1.55; margin:7px 0 0; }

  .pri { border:1px solid ${RULE}; border-left:3px solid ${ORANGE}; border-radius:5px; padding:8px 11px; margin-bottom:6px; break-inside:avoid; }
  .pri-h { display:flex; align-items:center; gap:6px; }
  .pri-n { display:inline-flex; align-items:center; justify-content:center; width:15px; height:15px; border-radius:99px;
           background:${ORANGE}; color:#fff; font-size:8.5px; font-weight:700; }
  .pri-tag { font-size:7.5px; text-transform:uppercase; letter-spacing:.08em; color:${ORANGE}; font-weight:700; }
  .pri-d { margin:0 0 5px; color:${MUTED}; }
  .pri-q { margin:0 0 5px; font-size:9.5px; }
  .pri-q em { color:${MUTED}; }
  ul { margin:0; padding-left:15px; }
  li { margin:1.5px 0; }
  .keep { border:1px solid #99f6e4; background:#f0fdfa; border-radius:5px; padding:8px 11px; break-inside:avoid; }
  .keep p { margin:3px 0 0; color:${MUTED}; }
  </style></head><body>

  <div class="hdr">
    <div>
      <div class="meta">${esc(brand)}</div>
      <h1>${esc(s.name)}</h1>
      ${s.address ? `<p class="sub">${esc(s.address)}</p>` : ''}
    </div>
    <div style="text-align:right">
      <div class="meta">${esc(snap.asOf)}</div>
      <div class="meta">${esc(snap.dateRange)}</div>
    </div>
  </div>

  <section class="blk" style="margin-top:0">
    <h2>Location performance snapshot</h2>
    <div class="kpis">
      ${kpi('Rating', s.rating.toFixed(2), recent || `Network ${s.chainRating.toFixed(2)}★`)}
      ${kpi('Reviews', s.reviews.toLocaleString(), `Rank #${s.rank} of ${s.outletCount}`)}
      ${kpi('5-Star Share', pct0(snap.fiveStarShare), `Detractors ${pct0(snap.detractorShare)}`)}
      ${kpi('Owner Responses', pct0(snap.ownerResponseRate), snap.ownerResponseBand)}
      ${kpi('Fleet Position', snap.fleet ? snap.fleet.band : '—', fleet)}
    </div>
  </section>

  <section class="blk">
    <h2>Rating distribution <span style="text-transform:none;letter-spacing:0;font-weight:400">— tick marks the network average</span></h2>
    ${distributionRows(snap)}
  </section>

  ${themeTable(snap)}

  ${snap.praiseVerbatims.length ? `<section class="blk">
    <h2>What guests consistently praise</h2>
    <div class="keep">
      ${snap.praiseChips.length ? `<div>${snap.praiseChips.map((c) => `<span class="pill" style="color:${TEAL};background:#f0fdfa;margin-right:4px">${esc(c)}</span>`).join('')}</div>` : ''}
      ${snap.praiseVerbatims.map((v) => `<div style="margin-top:4px;font-size:9.5px"><b style="color:${TEAL}">${v.rating}★</b> <em style="color:${MUTED}">“${esc(v.quote)}”</em></div>`).join('')}
    </div>
  </section>` : ''}

  ${dimensionRows(s.dimensions, unit, networkSize)}

  ${actionPlanSection(plan)}

  </body></html>`
}
