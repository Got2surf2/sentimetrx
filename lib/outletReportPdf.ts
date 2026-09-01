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
// It typesets from the payload the PAGE posts back (lib/outletPdfPayload.ts) —
// the same values it rendered — so nothing is recomputed and nothing is
// fabricated. If a figure isn't in the payload, it isn't in the document.
//
// 2026-08-18: the document now carries the page's "Deeper analysis" section too
// (both tabs). That block is `print:hidden` on screen, so the export used to be
// roughly half the page. The only piece that can't be reproduced literally is
// the what-if SLIDER — a static benchmark table plus one projection computed
// with the same pure `projectRecovery` stands in for it.
//
// ⚠️ Any route that calls this MUST be listed in next.config.js
// `outputFileTracingIncludes` with `@sparticuz/chromium/bin/**`, or it 500s on
// Vercel with "input directory .../bin does not exist".

import type { OutletSnapshot, ThemeDelta, ComparisonBlock, TrendPoint, ThemeTableRow } from '@/lib/outletReport'
import type { ActionPlan } from '@/lib/outletActionPlan'
import type { ThemeStanding, OutletSummary, PredictorModel, WhatIfView } from '@/lib/outletPredictor'
import type {
  OutletPdfPayload,
  LeaderboardPdfPayload, LeaderItemP, LeaderRowP, HierarchyPdfPayload,
} from '@/lib/outletPdfPayload'
import { projectRecovery } from '@/lib/outletPredictor'
import { verbatimSupports } from '@/lib/verbatimGuard'
import { starBarColor } from '@/lib/ratingGradient'
import { pct1, locOnly, rankWord, topWord, monthLabel, listWords } from '@/lib/outletPeerWords'

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
const n0 = (n: number) => Math.round(n).toLocaleString()

// Every number that lands in an unquoted CSS position goes through this. The
// payload is client-supplied (see lib/outletPdfPayload.ts) — a stray string in
// `style="width:${w}%"` would otherwise be an injection point.
const cssPct = (frac: number) => Math.min(100, Math.max(0, Number.isFinite(frac) ? frac * 100 : 0))

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
    const w = Math.max(0.6, cssPct(b.pct))
    // The network's spread for this star bucket, drawn on the track so every bar
    // carries its own comparison: ▶ lowest outlet · │ average · ◀ highest.
    return `<div class="dist">
      <span class="dist-k">${esc(String(b.star))}★</span>
      <span class="dist-track">
        <span class="dist-bar" style="width:${w}%;background:${starBarColor(b.star)}"></span>
        <span class="dist-lo" style="left:${cssPct(b.net.min)}%"></span>
        <span class="dist-hi" style="left:${cssPct(b.net.max)}%"></span>
        <span class="dist-tick" style="left:${cssPct(b.net.avg)}%"></span>
      </span>
      <span class="dist-v"><b>${n0(b.count)}</b> · ${pct0(b.pct)}</span>
    </div>`
  }).join('')
}

function themeTable(s: OutletSnapshot): string {
  if (!s.themeTable.length) return ''
  const rows = s.themeTable.map((t) => `<tr>
    <td class="t-name">${esc(t.theme)}</td>
    <td class="num">${n0(t.mentions)}</td>
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
  if (!block.available) return ''
  const rows: ThemeDelta[] = [...block.strengths, ...block.weaknesses].sort((a, b) => b.delta - a.delta)
  // Available but nothing cleared the reporting floor. The page SAYS so
  // (OutletDimensionsView) — an empty section here would read as a bug.
  if (!rows.length) {
    return `<section class="blk">
      <h2>Dimensions — how this ${esc(unit)} compares to the network</h2>
      <p class="empty">No dimension differed from the network by enough to report — this ${esc(unit)} tracks the network on every dimension with sufficient mentions.</p>
    </section>`
  }
  const scale = Math.max(...rows.map((r) => Math.abs(r.delta)))
  const MAX_ARM = 38
  const body = rows.map((d) => {
    const ahead = d.delta > 0
    const arm = scale > 0 ? Math.min(MAX_ARM, Math.max(1.5, (Math.abs(d.delta) / scale) * MAX_ARM)) : 0
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
      <span class="dv-meta"><b>${signedPct(d.outletNet)}</b> net · ${n0(d.n)} ${d.n === 1 ? 'mention' : 'mentions'}</span>
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
    <p class="note">Each dimension is scored by <b>net-positive rate</b> — the share of mentions that are positive minus the share that are negative. The bar is the gap between this ${esc(unit)} and the same figure across all ${n0(networkSize)} ${esc(unit)}s, in percentage points; the centre line is the network. Only dimensions with enough mentions here and network-wide to be reliable are shown.</p>
  </section>`
}

function actionPlanSection(plan: ActionPlan | null, reviews: number, themeTable: ThemeTableRow[]): string {
  if (!plan || !plan.priorities.length) return ''
  const byTheme = new Map(themeTable.map((t) => [t.theme, t]))
  const items = plan.priorities.map((p, i) => {
    const r = byTheme.get(p.theme)
    // Anchor each card to its row in the snapshot table above, so the narrated
    // priority and the measured figures read as one argument.
    const anchor = `<div class="pri-anchor">
      <span class="pill" style="color:#fff;background:${TEAL}">${esc(p.theme)}</span>
      ${r ? `<span class="pri-stats"><b>${r.avgStar.toFixed(2)}★</b> · <b>${pct0(r.pctNegative)}</b> negative · ${n0(r.mentions)} mentions</span>` : ''}
    </div>`
    return `<div class="pri">
      <div class="pri-h"><span class="pri-n">${i + 1}</span><span class="pri-tag">${esc(p.tag)}</span></div>
      <h3>${esc(p.title)}</h3>
      ${anchor}
      <p class="pri-d">${esc(p.diagnosis)}</p>
      ${p.verbatims.length ? `<div class="pri-q">${p.verbatims.map((v) => `<div><b>${esc(String(v.rating))}★</b> <em>“${esc(v.quote)}”</em></div>`).join('')}</div>` : ''}
      ${p.actions.length ? `<ul>${p.actions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
    </div>`
  })
  // The heading rides with the first card so it can't orphan at a page bottom;
  // the remaining cards flow (each avoids splitting on its own).
  return `<section class="blk flow">
    <div class="keeptog">
      <h2>Action plan — what to work on next</h2>
      <div class="badge">AI-generated from ${n0(reviews)} guest reviews</div>
      ${items[0]}
    </div>
    ${items.slice(1).join('')}
    ${plan.keepDoing ? `<div class="keep"><div class="eyebrow" style="color:${TEAL}">Keep doing</div><p>${esc(plan.keepDoing)}</p></div>` : ''}
    <p class="note"><b>Method.</b> AI-generated from ${n0(reviews)} Google reviews. Ratings, trend and response-rate are exact counts; theme figures are keyword-matched mentions (“% negative” = share of a theme’s mentions rated ≤3★). Verbatims are real guest reviews, lightly trimmed; names omitted. A prioritization signal, not a guaranteed star change.</p>
  </section>`
}

// ─── "Deeper analysis" — the page's screen-only tabs, typeset ────────────────
// Everything below mirrors app/analyze/[datasetId]/outlet-report/OutletReportTabs.tsx
// (and WhatIfPanel for the static what-if). Shared wording lives in
// lib/outletPeerWords so the two surfaces cannot drift on a phrase.

// Outlet vs network avg-rating over time — the same geometry as the page's
// inline SVG, emitted as markup rather than JSX.
function trendChartSvg(trend: TrendPoint[]): string {
  const p = trend.filter((x) => typeof x.networkAvg === 'number')
  if (p.length < 3) return `<p class="empty">Not enough dated reviews to chart a trend.</p>`
  const W = 660, H = 210, padL = 30, padR = 14, padT = 12, padB = 26
  const x = (i: number) => padL + (W - padL - padR) * (p.length === 1 ? 0 : i / (p.length - 1))
  const vals = p.flatMap((q) => [q.networkAvg, ...(q.outletAvg != null ? [q.outletAvg] : [])])
  const yMin = Math.max(1, Math.floor(Math.min(...vals) * 2) / 2 - 0.25)
  const yMax = 5
  const y = (v: number) => padT + (H - padT - padB) * (1 - (v - yMin) / (yMax - yMin))
  const netLine = p.map((q, i) => `${x(i).toFixed(1)},${y(q.networkAvg).toFixed(1)}`).join(' ')
  const outLine = p.map((q, i) => (q.outletAvg != null ? `${x(i).toFixed(1)},${y(q.outletAvg).toFixed(1)}` : '')).filter(Boolean).join(' ')
  const yTicks = [yMin, (yMin + yMax) / 2, yMax]
  const xIdx = [0, Math.floor((p.length - 1) / 2), p.length - 1]
  const grid = yTicks.map((t) => `<line x1="${padL}" x2="${W - padR}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="#ececed" stroke-width="1"/>
    <text x="${padL - 6}" y="${(y(t) + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#9ca3af">${t.toFixed(1)}</text>`).join('')
  const labels = xIdx.map((i) => `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#9ca3af">${esc(monthLabel(p[i].month))}</text>`).join('')
  return `<div class="legend start"><span><i style="background:${ORANGE}"></i>This location</span><span><i style="background:#9ca3af"></i>Network avg</span></div>
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;max-height:200px">
      ${grid}${labels}
      <polyline points="${netLine}" fill="none" stroke="#9ca3af" stroke-width="2"/>
      ${outLine ? `<polyline points="${outLine}" fill="none" stroke="${ORANGE}" stroke-width="2.5"/>` : ''}
    </svg>`
}

// "Recovering this location's unhappy guests" + the chain's systemic-driver
// callout — one argument, so they share a block and never split apart.
function recoveryBlock(a: {
  name: string; reviews: number; summary: OutletSummary | null; model: PredictorModel | null
  outletCount: number; levers: ThemeStanding[]; strengths: ThemeStanding[]; brandDrivers: string[]
}): string {
  if (!a.summary || !a.model) {
    return `<section class="blk"><h2>Deeper analysis — how this location compares to its peers</h2>
      <p class="empty">Not enough rated reviews at this location to build a plan.</p></section>`
  }
  const { summary: sm, model: m } = a
  const atPar = sm.gapToTarget <= 0.01
  const closing = a.levers.length
    ? 'Below are the themes where this location ranks among the worst in the brand — its real, fixable weaknesses.'
    : atPar
      ? 'This location already runs among your best — hold the line and share what’s working.'
      : 'It isn’t a bottom-quartile performer on any single operational theme; its 1–3★ reviews are spread across topics. Work the operational basics.'

  // The chain usually has MORE THAN ONE systemic driver, and this used to print
  // only the first under the words "the chain's one systemic issue" — then call
  // it the outlet's "highest-leverage fix", conflating brand-level
  // over-representation with local impact. The leverage claim now lives on the
  // lever list, where it is computed. (2026-08-18, owner.)
  const mine = new Set(a.levers.map((l) => l.theme))
  const strong = new Set(a.strengths.map((l) => l.theme))
  const weakDrivers = a.brandDrivers.filter((d) => mine.has(d))
  const strongDrivers = a.brandDrivers.filter((d) => strong.has(d))
  const tone = weakDrivers.length ? 'weak' : strongDrivers.length === a.brandDrivers.length ? 'strong' : 'mid'
  const lead = a.brandDrivers.length === 1
    ? `The chain’s one <b>systemic</b> issue is <b>${esc(a.brandDrivers[0])}</b> — a theme that shows up far more in 1–3★ reviews than in 4–5★ ones brand-wide.`
    : `The chain’s <b>systemic</b> issues are <b>${esc(listWords(a.brandDrivers))}</b> — themes that show up far more in 1–3★ reviews than in 4–5★ ones brand-wide.`
  const stand = weakDrivers.length
    ? `You’re <b>bottom-quartile</b> on ${weakDrivers.length === a.brandDrivers.length && a.brandDrivers.length > 1 ? `all ${a.brandDrivers.length}` : `<b>${esc(listWords(weakDrivers))}</b>`}.`
    : strongDrivers.length === a.brandDrivers.length
      ? `You’re <b>top-quartile</b> on ${a.brandDrivers.length > 1 ? 'every one of them' : 'it'} — protect that.`
      : 'None of them is a bottom-quartile weakness here.'

  return `<section class="blk">
    <h2>Deeper analysis — how this location compares to its peers</h2>
    <div class="rec${atPar ? ' ok' : ''}">
      <h3>Recovering this location’s unhappy guests</h3>
      <p><b>${pct1(sm.lowRate)}</b> of ${esc(a.name)}’s reviews are 1–3★ (${n0(sm.lowCount)} of ${n0(a.reviews)}) — the
      <b>#${n0(sm.lowRateRank)}</b> highest 1–3★ rate of ${n0(a.outletCount)} outlets (1 = worst), versus
      <b>${pct1(m.lowRate)}</b> brand average and <b>${pct1(m.bestLowRate)}</b> at your best location. ${closing}</p>
    </div>
    ${a.brandDrivers.length ? `<div class="callout ${tone}">${lead} ${stand}</div>` : ''}
  </section>`
}

// Sub-1 is spelled out rather than rounded to "~0", which would read as "this is
// pointless" when it really means "this rarely arrives on its own" — the
// combined what-if is where those themes pay off.
function recoveryWords(n: number): string {
  if (n < 0.5) return 'under 1 unhappy guest — it almost always arrives alongside another complaint'
  const r = Math.round(n)
  return `about ${r} unhappy guest${r === 1 ? '' : 's'}`
}

function leverCards(levers: ThemeStanding[]): string {
  if (!levers.length) return ''
  const cards = levers.map((l, i) => `<div class="card lever">
    <div class="card-h">
      <span><span class="rank">${i + 1}</span><b>${esc(l.theme)}</b></span>
      <span class="tag bad">${esc(rankWord(l.peerPercentile))} of locations</span>
    </div>
    <p class="card-d"><b>${pct1(l.problemRate)}</b> of all reviews here are 1–3★ and cite this (${pct1(l.shareInBad)} of its 1–3★ reviews).${l.cohortSize > 1 ? ` You’re one of <b>${n0(l.cohortSize)}</b> outlets in the bottom quartile here.` : ''}</p>
    <p class="card-d">Fixing <b>only this</b> — to the peer median — wins back <b>${esc(recoveryWords(l.soloRecovery))}</b>.</p>
    ${verbatimSupports(l.quote, 'negative') ? `<p class="q bad">“${esc(l.quote || '')}”</p>` : ''}
    ${l.exemplars.length ? `<div class="learn">★ <b>Learn from</b> ${l.exemplars.slice(0, 5).map((e) => `${esc(locOnly(e.label))}${e.rating != null ? ` (${e.rating.toFixed(1)}★)` : ''}`).join(', ')} — the top performers on this theme. Worth a call on how they run it.</div>` : ''}
  </div>`)
  return `<section class="blk flow">
    <div class="keeptog"><h2>Work these — biggest win first</h2>
    <p class="lede">Themes where this location is bottom-quartile vs all outlets, ordered by how many unhappy guests bringing each one to the peer median would win back — not by how unusual it is.</p>${cards[0]}</div>
    ${cards.slice(1).join('')}
  </section>`
}

function strengthCards(strengths: ThemeStanding[]): string {
  if (!strengths.length) return ''
  const cards = strengths.map((t) => `<div class="card good">
    <div class="card-h"><b>${esc(t.theme)}</b><span class="tag ok">${esc(topWord(t.peerPercentile))} of locations</span></div>
    <p class="card-d">Only <b>${pct1(t.problemRate)}</b> of reviews here are 1–3★ and cite this — among the best in the brand. Protect it.</p>
    ${verbatimSupports(t.quote, 'positive') ? `<p class="q ok">“${esc(t.quote || '')}”</p>` : ''}
  </div>`)
  return `<section class="blk flow">
    <div class="keeptog"><h2 style="color:${AHEAD}">What this location does best — top quartile vs all outlets</h2>${cards[0]}</div>
    ${cards.slice(1).join('')}
  </section>`
}

// The page's what-if is a slider panel — interactive, and `print:hidden` even
// there. The document instead states the benchmarks it lets you drag between,
// and resolves ONE scenario ("every theme at the peer median") with the same
// pure projectRecovery the panel calls, so the two can't disagree.
function whatIfStatic(w: WhatIfView): string {
  if (!w.themes.length || !w.reviews13.length) return ''

  const scenario = (target: number[]) => {
    const recovered = projectRecovery(w.reviews13, w.currentRate, target)
    const newLow = Math.max(0, w.lowCount - recovered)
    const newRate = w.totalReviews ? newLow / w.totalReviews : 0
    const d = Number.isFinite(w.happyAvg) && Number.isFinite(w.detractorAvg) ? w.happyAvg - w.detractorAvg : 0
    const newAvg = w.ratedReviews ? w.avg + (recovered * d) / w.ratedReviews : w.avg
    const newRank = 1 + w.otherRatings.filter((r) => r > newAvg).length
    return { recovered, newRate, newAvg, newRank }
  }
  const toMedian = scenario(w.currentRate.map((c, i) => Math.min(c, w.medianRate[i])))
  const toBest = scenario(w.currentRate.map((c, i) => Math.min(c, w.bestRate[i])))

  const showTrend = w.trendBasis !== null
  // Biggest gap to the peer median first — the document's job is prioritisation,
  // and the actionable-theme order carries no meaning.
  const order = w.themes.map((t, i) => ({ t, i })).sort((a, b) =>
    (w.currentRate[b.i] - w.medianRate[b.i]) - (w.currentRate[a.i] - w.medianRate[a.i]))
  const rows = order.map(({ t, i }) => {
    const behind = w.currentRate[i] > w.medianRate[i]
    const tr = w.trends[i]
    const trendCell = !tr || tr.direction === 'flat'
      ? '<span class="flat">→ flat</span>'
      : tr.direction === 'up'
        ? '<span class="worse">▲ worsening</span>'
        : '<span class="better">▼ improving</span>'
    return `<tr>
      <td class="t-name">${esc(t)}</td>
      <td class="num ${behind ? 'strong' : ''}">${pct1(w.currentRate[i])}${behind ? '' : ' <span class="ok-mark">✓</span>'}</td>
      <td class="num">${pct1(w.medianRate[i])}</td>
      <td class="num">${pct1(w.bestRate[i])}</td>
      ${showTrend ? `<td class="right">${trendCell}</td>` : ''}
    </tr>`
  }).join('')

  return `<section class="blk">
    <h2>What-if — how many unhappy guests could you win back?</h2>
    <p class="lede">Each theme's <b>1–3★ problem rate</b> — the share of this location's reviews that are 1–3★ and cite it — against what its peers achieve. Biggest gap first.</p>
    <table>
      <thead><tr><th>Theme</th><th class="num">You now</th><th class="num">Peer median</th><th class="num">Best-in-class</th>${showTrend ? '<th class="right">Trend</th>' : ''}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="eyebrow" style="margin:11px 0 5px">If every theme reached the peer median</div>
    <div class="kpis">
      ${kpi('Detractors recovered', `~${n0(toMedian.recovered)}`, `of ${n0(w.lowCount)} today`)}
      ${kpi('1–3★ review rate', pct1(toMedian.newRate), `from ${pct1(w.lowRate)}`)}
      ${kpi('Overall rating', toMedian.newAvg.toFixed(2), `from ${w.avg.toFixed(2)} · rank #${n0(w.currentRank)} → #${n0(toMedian.newRank)} of ${n0(w.outletCount)}`)}
    </div>
    <p class="note">Reaching <b>best-in-class</b> on every theme instead: ~${n0(toBest.recovered)} recovered, a ${pct1(toBest.newRate)} 1–3★ rate and a ${toBest.newAvg.toFixed(2)} rating (rank #${n0(toBest.newRank)}).${showTrend ? ` Trend is brand-wide quarter-over-quarter (${esc(w.trendBasis!.prior)} → ${esc(w.trendBasis!.recent)}).` : ''} A planning estimate, not a promise: each recovered review is credited only as far as its <b>least-improved</b> theme moves, and a review citing a theme you don't fix isn't counted at all — a conservative floor.</p>
  </section>`
}

function peerMethodNote(): string {
  return `<p class="note blk">Each operational theme is <b>peer-ranked</b> across all outlets by its problem rate — the share of a location’s reviews that are 1–3★ and cite that theme. Weaknesses = bottom quartile (among the worst); strengths = top quartile. Lagging outcomes like brand loyalty are excluded — they’re symptoms of these operational issues, not levers. Quotes are this location’s own reviews. Associational — a prioritization signal, not a guaranteed star change.</p>`
}

// Shared stylesheet for every composed outlet document (deep-dive,
// leaderboard, hierarchy rung) — one visual language across the family.
const DOC_CSS = `
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
  /* Card-list sections are allowed to span pages — each card avoids splitting on
     its own, so flowing them keeps the document dense instead of reserving a
     page for a heading. .keeptog holds the heading to its FIRST card so the
     heading can never orphan at a page bottom (ENGINEERING §6 rule 1). */
  .blk.flow { break-inside:auto; }
  .keeptog { break-inside:avoid; }
  .empty { border:1px dashed ${RULE}; border-radius:6px; padding:11px; text-align:center; color:${FAINT}; margin:0; }
  .lede { color:${MUTED}; margin:-3px 0 7px; }

  .kpis { display:flex; gap:7px; }
  .kpi { flex:1; border:1px solid ${RULE}; border-radius:6px; padding:7px 9px; }
  .kpi-l { font-size:7.5px; text-transform:uppercase; letter-spacing:.08em; color:${FAINT}; font-weight:700; }
  .kpi-v { font-size:20px; font-weight:700; margin-top:2px; letter-spacing:-.02em; }
  .kpi-s { font-size:8.5px; color:${MUTED}; margin-top:1px; }

  .dist { display:flex; align-items:center; gap:8px; margin:3px 0; }
  .dist-k { width:20px; color:${MUTED}; font-variant-numeric:tabular-nums; }
  .dist-track { position:relative; flex:1; height:7px; background:#f1f5f9; border-radius:99px; }
  .dist-bar { position:absolute; left:0; top:0; height:7px; border-radius:99px; }
  .dist-tick { position:absolute; top:-2.5px; width:2px; height:12px; margin-left:-1px; background:#374151; border-radius:99px; }
  /* Network spread for this star bucket: ▶ lowest outlet, ◀ highest outlet.
     Drawn as CSS triangles — printBackground is on, so they survive the render. */
  .dist-lo { position:absolute; top:0.5px; margin-left:-2.5px; width:0; height:0;
             border-top:3px solid transparent; border-bottom:3px solid transparent; border-left:5px solid #fff;
             filter:drop-shadow(0 0 .5px rgba(0,0,0,.55)); }
  .dist-hi { position:absolute; top:0.5px; margin-left:-2.5px; width:0; height:0;
             border-top:3px solid transparent; border-bottom:3px solid transparent; border-right:5px solid #9ca3af; }
  .dist-v { width:64px; text-align:right; color:${MUTED}; font-variant-numeric:tabular-nums; }
  .dist-v b { color:${INK}; }
  .dist-leg { float:right; font-weight:400; text-transform:none; letter-spacing:0; color:${FAINT}; }

  table { width:100%; border-collapse:collapse; }
  th { font-size:7.5px; text-transform:uppercase; letter-spacing:.07em; color:${FAINT};
       text-align:left; border-bottom:1px solid ${RULE}; padding:0 0 4px; font-weight:700; }
  td { padding:4px 0; border-bottom:1px solid #f1f5f9; }
  .num, th.num { text-align:right; font-variant-numeric:tabular-nums; }
  .right, th.right { text-align:right; }
  .t-name { font-weight:600; }
  .strong { font-weight:700; }
  .ok-mark { color:${AHEAD}; }
  .flat { color:${FAINT}; }
  .worse { color:${BEHIND}; font-weight:700; }
  .better { color:${AHEAD}; font-weight:700; }
  .pill { display:inline-block; padding:1px 5px; border-radius:3px; font-size:7.5px; font-weight:700; letter-spacing:.05em; }

  .legend { display:flex; gap:10px; justify-content:flex-end; font-size:8px; color:${FAINT}; margin:-4px 0 5px; }
  .legend.start { justify-content:flex-start; margin:0 0 4px; }
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
  .note b { color:${MUTED}; }

  .pri { border:1px solid ${RULE}; border-left:3px solid ${ORANGE}; border-radius:5px; padding:8px 11px; margin-bottom:6px; break-inside:avoid; }
  .pri-h { display:flex; align-items:center; gap:6px; }
  .pri-n { display:inline-flex; align-items:center; justify-content:center; width:15px; height:15px; border-radius:99px;
           background:${ORANGE}; color:#fff; font-size:8.5px; font-weight:700; }
  .pri-tag { font-size:7.5px; text-transform:uppercase; letter-spacing:.08em; color:${ORANGE}; font-weight:700; }
  .pri-anchor { margin:0 0 5px; }
  .pri-stats { font-size:8.5px; color:${FAINT}; margin-left:5px; font-variant-numeric:tabular-nums; }
  .pri-stats b { color:${MUTED}; }
  .pri-d { margin:0 0 5px; color:${MUTED}; }
  .pri-q { margin:0 0 5px; font-size:9.5px; }
  .pri-q em { color:${MUTED}; }
  .badge { display:inline-block; background:#ecfdf5; color:#047857; border-radius:99px; padding:2px 8px;
           font-size:7.5px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; margin:-2px 0 7px; }
  ul { margin:0; padding-left:15px; }
  li { margin:1.5px 0; }
  .keep { border:1px solid #99f6e4; background:#f0fdfa; border-radius:5px; padding:8px 11px; break-inside:avoid; }
  .keep p { margin:3px 0 0; color:${MUTED}; }

  .rec { border-radius:6px; background:#f8fafc; padding:9px 12px; }
  .rec.ok { background:#ecfdf5; }
  .rec h3 { font-size:11.5px; margin:0 0 3px; }
  .rec p { margin:0; color:${MUTED}; }
  .rec b { color:${INK}; }
  .callout { margin-top:6px; border:1px solid ${RULE}; border-radius:6px; padding:7px 11px; font-size:9.5px; color:${MUTED}; }
  .callout.weak { border-color:#fecdd3; background:#fff1f2; color:#9f1239; }
  .callout.strong { border-color:#a7f3d0; background:#ecfdf5; color:#065f46; }

  .card { border:1px solid ${RULE}; border-radius:6px; padding:8px 11px; margin-bottom:6px; break-inside:avoid; }
  .card.good { border-color:#a7f3d0; background:#f0fdf6; }
  .card-h { display:flex; align-items:baseline; justify-content:space-between; gap:8px; }
  .card-h b { font-size:11.5px; }
  .rank { display:inline-flex; align-items:center; justify-content:center; width:14px; height:14px; border-radius:99px;
          background:#1f2937; color:#fff; font-size:8px; font-weight:700; margin-right:5px; }
  .tag { flex:none; border-radius:3px; padding:1px 5px; font-size:7.5px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; }
  .tag.bad { background:#ffe4e6; color:#be123c; }
  .tag.ok { background:#ccfbf1; color:#0f766e; }
  .card-d { margin:4px 0 0; color:${MUTED}; }
  .card-d b { color:${INK}; }
  .q { margin:5px 0 0; padding-left:7px; font-style:italic; color:${MUTED}; font-size:9.5px; }
  .q.bad { border-left:2px solid #fda4af; }
  .q.ok { border-left:2px solid #6ee7b7; }
  .learn { margin-top:5px; border-radius:4px; background:#ecfdf5; color:#065f46; padding:4px 8px; font-size:9px; }
`

export function buildOutletReportHtml(p: OutletPdfPayload): string {
  const s = p.selected
  const unit = p.unitLabel || 'location'
  const snap = s.snapshot

  const fleet = snap.fleet
    ? `#${snap.fleet.rank} of ${snap.fleet.total} ${snap.fleet.peerNoun}`
    : 'Under 200 reviews'
  const recent = snap.recent
    ? `${snap.recent.avg.toFixed(2)}★ recent (${snap.recent.direction})`
    : ''

  // Every verbatim under "what guests consistently praise" must read as praise —
  // the rating selects the review, it does not vouch for the sentence lifted out
  // of it. The page filters here too (see lib/verbatimGuard).
  const praise = snap.praiseVerbatims.filter((v) => verbatimSupports(v.quote, 'positive'))

  const subtitle = [
    s.address,
    `${n0(s.reviews)} Google reviews${snap.dateRange ? ` (${snap.dateRange})` : ''}`,
    `full ${n0(p.networkSize)}-store network`,
  ].filter(Boolean).join(' · ')

  return `<!doctype html><html><head><meta charset="utf-8"><style>${DOC_CSS}</style></head><body>

  <div class="hdr">
    <div>
      <div class="meta">${esc(p.brand)}</div>
      <h1>${esc(s.name)}</h1>
      ${subtitle ? `<p class="sub">${esc(subtitle)}</p>` : ''}
    </div>
    <div class="meta">${esc(snap.asOf)}</div>
  </div>

  <section class="blk" style="margin-top:0">
    <h2>Location performance snapshot</h2>
    <div class="kpis">
      ${kpi('Rating', s.rating.toFixed(2), recent || `Network ${s.chainRating.toFixed(2)}★`)}
      ${kpi('Reviews', n0(s.reviews), `Rank #${n0(s.rank)} of ${n0(s.outletCount)}`)}
      ${kpi('5-Star Share', pct0(snap.fiveStarShare), `Detractors ${pct0(snap.detractorShare)}`)}
      ${kpi('Owner Responses', pct0(snap.ownerResponseRate), snap.ownerResponseBand)}
      ${kpi('Fleet Position', snap.fleet ? snap.fleet.band : '—', fleet)}
    </div>
  </section>

  <section class="blk">
    <h2>Rating distribution
      <span class="dist-leg">▶ lowest · │ avg · ◀ highest — across the network</span>
    </h2>
    ${distributionRows(snap)}
  </section>

  ${themeTable(snap)}

  ${(snap.praiseChips.length || praise.length) ? `<section class="blk">
    <h2>What guests consistently praise</h2>
    <div class="keep">
      ${snap.praiseChips.length ? `<div>${snap.praiseChips.map((c) => `<span class="pill" style="color:${TEAL};background:#f0fdfa;margin-right:4px">${esc(c)}</span>`).join('')}</div>` : ''}
      ${praise.map((v) => `<div style="margin-top:4px;font-size:9.5px"><b style="color:${TEAL}">${esc(String(v.rating))}★</b> <em style="color:${MUTED}">“${esc(v.quote)}”</em></div>`).join('')}
    </div>
  </section>` : ''}

  <section class="blk">
    <h2>Review score over time <span style="text-transform:none;letter-spacing:0;font-weight:400">— this location vs. network</span></h2>
    ${trendChartSvg(s.trend)}
  </section>

  ${actionPlanSection(p.plan, s.reviews, snap.themeTable)}

  ${dimensionRows(s.dimensions, unit, p.networkSize)}

  ${s.narrative ? `<section class="blk">
    <h2>How this location compares to the network</h2>
    <p style="margin:0;color:${MUTED}">${esc(s.narrative)}</p>
  </section>` : ''}

  ${recoveryBlock({
    name: s.name, reviews: s.reviews, summary: p.summary, model: p.model,
    outletCount: p.outletCount, levers: p.levers, strengths: p.strengths, brandDrivers: p.brandDrivers,
  })}

  ${leverCards(p.levers)}

  ${p.whatIf ? whatIfStatic(p.whatIf) : ''}

  ${strengthCards(p.strengths)}

  ${(p.levers.length || p.strengths.length) ? peerMethodNote() : ''}

  </body></html>`
}

// ─── Outlet Leaderboard — composed document (2026-09-02) ─────────────────────
// Replaces the leaderboard page's "print to PDF". Mirrors LeaderboardClient:
// per item, top-K vs bottom-K by net-positive rate with the bold figure being
// the GAP vs the chain average (green above / red below), grey = the outlet's
// own net · mentions · avg★. Same K the page showed.

function lbLine(r: LeaderRowP, chainNet: number): string {
  const gap = Math.round((r.net - chainNet) * 100)
  const own = `${Math.round(r.net * 100) >= 0 ? '+' : ''}${Math.round(r.net * 100)}% net · ${n0(r.n)}${r.rating != null ? ` · ${r.rating.toFixed(1)}★` : ''}`
  return `<div class="lb-line">
    <span class="lb-name">${esc(r.label)}</span>
    <span class="lb-fig"><b style="color:${gap >= 0 ? AHEAD : BEHIND}">${gap >= 0 ? '+' : '−'}${Math.abs(gap)} pts</b> <span class="lb-own">${esc(own)}</span></span>
  </div>`
}

function lbItemCard(item: LeaderItemP, k: number): string {
  const eK = Math.min(k, item.qualifying, item.ranked.length)
  const single = item.qualifying <= 2 * k
  const leaders = item.ranked.slice(0, eK)
  const laggards = item.ranked.slice(Math.max(item.ranked.length - eK, 0))
  const middleHidden = item.qualifying - (single ? item.ranked.length : 2 * eK)
  const chain = `chain ${Math.round(item.chainNet * 100) >= 0 ? '+' : ''}${Math.round(item.chainNet * 100)}% net · ${n0(item.chainN)} mentions · ${n0(item.qualifying)} outlets`
  const body = single
    ? `<div class="lb-col-h">All ${n0(item.qualifying)} outlets · best → worst</div>${item.ranked.map((r) => lbLine(r, item.chainNet)).join('')}`
    : `<div class="lb-grid">
        <div><div class="lb-col-h" style="color:${AHEAD}">● Top ${eK}</div>${leaders.map((r) => lbLine(r, item.chainNet)).join('')}</div>
        <div><div class="lb-col-h" style="color:${BEHIND}">● Bottom ${eK}</div>${laggards.map((r) => lbLine(r, item.chainNet)).join('')}</div>
      </div>${middleHidden > 0 ? `<div class="lb-mid">${n0(middleHidden)} more outlet${middleHidden === 1 ? '' : 's'} in between</div>` : ''}`
  return `<div class="card keeptog">
    <div class="card-h"><b>${item.category ? `<span class="tag" style="background:#f1f5f9;color:${MUTED};margin-right:5px">${esc(item.category)}</span>` : ''}${esc(item.label)}</b><span class="meta">${esc(chain)}</span></div>
    ${body}
  </div>`
}

const LB_CSS = `
  .lb-line { display:flex; justify-content:space-between; align-items:baseline; gap:8px; padding:2.5px 0; border-bottom:1px solid #f1f5f9; }
  .lb-line:last-child { border-bottom:none; }
  .lb-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lb-fig { flex:none; font-variant-numeric:tabular-nums; }
  .lb-own { color:${FAINT}; font-size:8.5px; }
  .lb-col-h { font-size:7.5px; text-transform:uppercase; letter-spacing:.07em; color:${FAINT}; font-weight:700; margin:6px 0 2px; }
  .lb-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  .lb-mid { text-align:center; color:${FAINT}; font-size:8px; margin-top:3px; }
`

export function buildLeaderboardHtml(p: LeaderboardPdfPayload): string {
  const section = (title: string, items: LeaderItemP[]) => items.length
    ? `<section class="blk flow"><h2>${esc(title)}</h2>${items.map((it) => lbItemCard(it, p.k)).join('')}</section>`
    : ''
  return `<!doctype html><html><head><meta charset="utf-8"><style>${DOC_CSS}${LB_CSS}</style></head><body>
  <div class="hdr">
    <div>
      <div class="meta">${esc(p.brand)}</div>
      <h1>Outlet leaderboard</h1>
      <p class="sub">Top &amp; bottom locations per theme and dimension · ${n0(p.outletCount)} outlets · showing ${n0(p.k)} per side</p>
    </div>
  </div>
  ${section('Themes', p.themes)}
  ${section('Dimensions', p.dimensions)}
  <p class="note">Outlets are ranked by net-positive rate (pos − neg) ÷ total among reviews mentioning the item.
  The <b>bold figure is the gap vs the chain average</b> in points (green above, red below); the grey figure is the
  outlet's own net-positive rate, mention count, and average ★. Only outlets with ≥6 such mentions are ranked, and
  only items carrying real chain-wide opinion appear.</p>
  </body></html>`
}

// ─── Hierarchy rung — composed document (2026-09-02) ─────────────────────────
// The rolled-up Network / Region / District view as a real PDF (it kept the
// print dialog when the per-outlet report got its composed document). Leads
// with the same absolute snapshot, then the child-rung table or the location
// list at the deepest rung.

export function buildHierarchyRungHtml(p: HierarchyPdfPayload): string {
  const snap = p.snapshot
  const fleet = snap.fleet ? `#${snap.fleet.rank} of ${snap.fleet.total} ${snap.fleet.peerNoun}` : `Full ${n0(p.networkOutlets)}-store network`
  const subtitle = [
    p.crumbs.length > 1 ? p.crumbs.join(' › ') : '',
    `${n0(p.outletCount)} location${p.outletCount === 1 ? '' : 's'}`,
    `${n0(p.reviews)} Google reviews${snap.dateRange ? ` (${snap.dateRange})` : ''}`,
  ].filter(Boolean).join(' · ')
  const praise = snap.praiseVerbatims.filter((v) => verbatimSupports(v.quote, 'positive'))

  const childRows = p.children.map((c) => `<tr>
    <td class="t-name">${esc(c.key)}</td>
    <td class="num">${n0(c.outlets)}</td>
    <td class="num">${n0(c.reviews)}</td>
    <td class="num strong">${c.rating != null ? c.rating.toFixed(2) : '—'}</td>
  </tr>`).join('')

  const outletRows = p.outlets.map((o) => `<tr>
    <td class="t-name">${esc(o.label)}</td>
    <td class="num">${n0(o.reviews)}</td>
    <td class="num strong">${esc(o.sublabel)}</td>
  </tr>`).join('')

  return `<!doctype html><html><head><meta charset="utf-8"><style>${DOC_CSS}</style></head><body>
  <div class="hdr">
    <div>
      <div class="meta">${esc(p.brand)} · ${esc(p.levelLabel)}</div>
      <h1>${esc(p.name)}</h1>
      ${subtitle ? `<p class="sub">${esc(subtitle)}</p>` : ''}
    </div>
    <div class="meta">${esc(snap.asOf)}</div>
  </div>

  <section class="blk" style="margin-top:0">
    <h2>${esc(p.levelLabel)} performance snapshot</h2>
    <div class="kpis">
      ${kpi('Rating', p.rating ? p.rating.toFixed(2) : '—', snap.recent ? `${snap.recent.avg.toFixed(2)}★ recent (${snap.recent.direction})` : '')}
      ${kpi('Reviews', n0(p.reviews), `${n0(p.outletCount)} locations`)}
      ${kpi('5-Star Share', pct0(snap.fiveStarShare), `Detractors ${pct0(snap.detractorShare)}`)}
      ${kpi('Owner Responses', pct0(snap.ownerResponseRate), snap.ownerResponseBand)}
      ${kpi(snap.fleet ? 'Standing' : 'Coverage', snap.fleet ? snap.fleet.band : n0(p.outletCount), fleet)}
    </div>
  </section>

  <section class="blk">
    <h2>Rating distribution
      <span class="dist-leg">▶ lowest · │ avg · ◀ highest — across peer ${esc(p.levelLabel.toLowerCase())}s</span>
    </h2>
    ${distributionRows(snap)}
  </section>

  ${themeTable(snap)}

  ${(snap.praiseChips.length || praise.length) ? `<section class="blk">
    <h2>What guests consistently praise</h2>
    <div class="keep">
      ${snap.praiseChips.length ? `<div>${snap.praiseChips.map((c) => `<span class="pill" style="color:${TEAL};background:#f0fdfa;margin-right:4px">${esc(c)}</span>`).join('')}</div>` : ''}
      ${praise.map((v) => `<div style="margin-top:4px;font-size:9.5px"><b style="color:${TEAL}">${esc(String(v.rating))}★</b> <em style="color:${MUTED}">“${esc(v.quote)}”</em></div>`).join('')}
    </div>
  </section>` : ''}

  ${p.children.length ? `<section class="blk flow">
    <h2>${esc(p.childLevelLabel || 'Children')}s under ${esc(p.name)}</h2>
    <table>
      <thead><tr><th>${esc(p.childLevelLabel || 'Node')}</th><th class="num">Locations</th><th class="num">Reviews</th><th class="num">Avg ★</th></tr></thead>
      <tbody>${childRows}</tbody>
    </table>
  </section>` : ''}

  ${p.outlets.length ? `<section class="blk flow">
    <h2>Locations</h2>
    <table>
      <thead><tr><th>Location</th><th class="num">Reviews</th><th class="num">Avg ★</th></tr></thead>
      <tbody>${outletRows}</tbody>
    </table>
  </section>` : ''}

  ${p.strayOutlets > 0 ? `<p class="note">⚠ ${n0(p.strayOutlets)} location${p.strayOutlets === 1 ? '' : 's'} had rows disagreeing on their hierarchy path — each is counted under its most common value.</p>` : ''}
  </body></html>`
}
