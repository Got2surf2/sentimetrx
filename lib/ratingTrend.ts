// lib/ratingTrend.ts
//
// Turn competitors' monthly rating aggregates into a rating-over-time chart
// model + recent-vs-prior trend deltas, using the shared dynamic time-framing
// (lib/trendWindows). Pure + unit-tested. The competitive report renders the
// result as an inline SVG (PDF-safe) so a reader can see whether each brand is
// climbing or sliding, and how far apart they are.

import { deriveTrendWindows, type BucketUnit } from '@/lib/trendWindows'

export interface MonthlyRating { ym: string; sum: number; n: number }   // ym = 'YYYY-MM'

export interface RatingTrendInput {
  name:  string
  focus: boolean                 // the competitive focus brand → emphasized
  monthlyRatings?: MonthlyRating[]
}

export interface RatingTrendSeries {
  name:   string
  focus:  boolean
  color:  string
  points: { key: string; avg: number }[]   // key = bucket label on the x-axis
}

export interface RatingTrendModel {
  unit:        BucketUnit
  keys:        string[]          // x-axis bucket keys, chronological
  series:      RatingTrendSeries[]
  deltas:      { name: string; focus: boolean; recentAvg: number | null; priorAvg: number | null; delta: number | null }[]
  windowLabel: string | null
  yMin:        number
  yMax:        number
}

const SERIES_COLORS = ['#0f766e', '#E85A1A', '#2563eb', '#9333ea', '#0891b2', '#db2777', '#65a30d', '#9a3412']
const FOCUS_COLOR   = '#0f172a'   // deep slate — the focus brand stands out

function esc(s: string): string { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string)) }
function ymToMs(ym: string): number { return Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1) }
function ymToBucket(ym: string, unit: BucketUnit): string {
  if (unit === 'quarter') { const m = Number(ym.slice(5, 7)); return `${ym.slice(0, 4)}-Q${Math.floor((m - 1) / 3) + 1}` }
  return ym   // month (we floor week→month since the data is monthly)
}

/**
 * @param recentMin  minimum total reviews across recent+prior for a delta to be
 *                   reported (guards against a 1-review bucket faking a swing)
 */
export function buildRatingTrend(inputs: RatingTrendInput[], opts: { minBucketReviews?: number } = {}): RatingTrendModel | null {
  const withData = inputs.filter(i => i.monthlyRatings && i.monthlyRatings.length > 0)
  if (withData.length < 2) return null   // a comparison needs ≥ 2 series

  // Domain across every series.
  let minMs = Infinity, maxMs = -Infinity
  for (const i of withData) for (const m of i.monthlyRatings!) {
    const ms = ymToMs(m.ym)
    if (ms < minMs) minMs = ms
    if (ms > maxMs) maxMs = ms
  }
  if (!isFinite(minMs) || maxMs <= minMs) return null

  const win = deriveTrendWindows(minMs, maxMs)
  const unit: BucketUnit = win.bucketUnit === 'week' ? 'month' : win.bucketUnit

  // Re-bucket each series to the chosen cadence.
  const keySet = new Set<string>()
  let yLo = 5, yHi = 1
  const series: RatingTrendSeries[] = withData.map((inp, idx) => {
    const buckets = new Map<string, { sum: number; n: number }>()
    for (const m of inp.monthlyRatings!) {
      const k = ymToBucket(m.ym, unit)
      const a = buckets.get(k) || { sum: 0, n: 0 }
      a.sum += m.sum; a.n += m.n
      buckets.set(k, a)
    }
    const points = [...buckets.entries()]
      .sort((a, b) => a[0] < b[0] ? -1 : 1)
      .map(([key, a]) => { const avg = +(a.sum / a.n).toFixed(2); keySet.add(key); if (avg < yLo) yLo = avg; if (avg > yHi) yHi = avg; return { key, avg } })
    return { name: inp.name, focus: inp.focus, color: inp.focus ? FOCUS_COLOR : SERIES_COLORS[idx % SERIES_COLORS.length], points }
  })

  // Recent-vs-prior delta per series, from the windows trendWindows derived.
  const minReviews = opts.minBucketReviews ?? 10
  const inWindow = (ms: number, w: { startMs: number; endMs: number } | null) => !!w && ms >= w.startMs && ms < w.endMs
  const deltas = withData.map(inp => {
    const acc = { rSum: 0, rN: 0, pSum: 0, pN: 0 }
    for (const m of inp.monthlyRatings!) {
      const ms = ymToMs(m.ym)
      if (inWindow(ms, win.recent)) { acc.rSum += m.sum; acc.rN += m.n }
      else if (inWindow(ms, win.prior)) { acc.pSum += m.sum; acc.pN += m.n }
    }
    const recentAvg = acc.rN >= minReviews ? +(acc.rSum / acc.rN).toFixed(2) : null
    const priorAvg  = acc.pN >= minReviews ? +(acc.pSum / acc.pN).toFixed(2) : null
    const delta = recentAvg != null && priorAvg != null ? +(recentAvg - priorAvg).toFixed(2) : null
    return { name: inp.name, focus: inp.focus, recentAvg, priorAvg, delta }
  })

  // Pad the y-axis to a clean half-star window, clamped to [1,5].
  const yMin = Math.max(1, Math.floor((yLo - 0.1) * 2) / 2)
  const yMax = Math.min(5, Math.ceil((yHi + 0.1) * 2) / 2)

  return {
    unit,
    keys: [...keySet].sort((a, b) => a < b ? -1 : 1),
    series,
    deltas,
    windowLabel: win.windowLabel,
    yMin: yMin < yMax ? yMin : Math.max(1, yMax - 0.5),
    yMax,
  }
}

// ── Inline-SVG renderer (PDF-safe — no client JS) ─────────────────────────
/** Render the trend model as a self-contained chart (SVG + legend HTML). */
export function renderRatingTrendSvg(model: RatingTrendModel): string {
  const W = 720, H = 250, padL = 34, padR = 12, padT = 12, padB = 30
  const plotW = W - padL - padR, plotH = H - padT - padB
  const n = model.keys.length
  const idx = new Map(model.keys.map((k, i) => [k, i]))
  const xOf = (key: string) => padL + (n <= 1 ? plotW / 2 : ((idx.get(key) ?? 0) / (n - 1)) * plotW)
  const span = Math.max(0.5, model.yMax - model.yMin)
  const yOf = (avg: number) => padT + (1 - (avg - model.yMin) / span) * plotH

  // Horizontal gridlines + star labels every 0.5.
  const grid: string[] = []
  for (let v = model.yMin; v <= model.yMax + 1e-6; v += 0.5) {
    const y = yOf(v).toFixed(1)
    grid.push(`<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#eef2f7" stroke-width="1"/>`)
    grid.push(`<text x="${padL - 4}" y="${(Number(y) + 3).toFixed(1)}" font-size="8" fill="#9ca3af" text-anchor="end">${v.toFixed(1)}</text>`)
  }
  // X labels — thin them so they don't collide.
  const step = Math.max(1, Math.ceil(n / 9))
  const xlabels: string[] = []
  model.keys.forEach((k, i) => {
    if (i % step !== 0 && i !== n - 1) return
    // Anchor the edge labels inward so they don't clip past the SVG bounds.
    const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'
    xlabels.push(`<text x="${xOf(k).toFixed(1)}" y="${H - padB + 14}" font-size="8" fill="#9ca3af" text-anchor="${anchor}">${esc(k)}</text>`)
  })
  // Series polylines (focus drawn last + thicker so it sits on top).
  const ordered = [...model.series].sort((a, b) => Number(a.focus) - Number(b.focus))
  const lines = ordered.map(s => {
    const pts = s.points.map(p => `${xOf(p.key).toFixed(1)},${yOf(p.avg).toFixed(1)}`).join(' ')
    const dots = s.points.map(p => `<circle cx="${xOf(p.key).toFixed(1)}" cy="${yOf(p.avg).toFixed(1)}" r="${s.focus ? 2.4 : 1.6}" fill="${s.color}"/>`).join('')
    return `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="${s.focus ? 2.6 : 1.5}" stroke-linejoin="round" stroke-linecap="round"/>${dots}`
  }).join('')

  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px" xmlns="http://www.w3.org/2000/svg">` +
    grid.join('') + xlabels.join('') + lines + `</svg>`

  // Legend with the recent-vs-prior delta (▲/▼) per brand.
  const deltaBy = new Map(model.deltas.map(d => [d.name, d]))
  const legend = model.series.map(s => {
    const d = deltaBy.get(s.name)
    let tag = '<span style="color:#9ca3af">· n/a</span>'
    if (d && d.delta != null) {
      const up = d.delta > 0.02, down = d.delta < -0.02
      const sym = up ? '▲' : down ? '▼' : '■'
      const col = up ? '#15803d' : down ? '#b91c1c' : '#9ca3af'
      tag = `<span style="color:${col};font-weight:700">${sym} ${d.delta > 0 ? '+' : ''}${d.delta.toFixed(2)}★</span>`
    }
    return `<span style="display:inline-flex;align-items:center;gap:5px;margin-right:14px;font-size:11px">` +
      `<span style="width:11px;height:3px;border-radius:2px;background:${s.color};display:inline-block"></span>` +
      `<span style="font-weight:${s.focus ? 700 : 500};color:#111827">${esc(s.name)}</span>${tag}</span>`
  }).join('')

  const sub = model.windowLabel ? `<div style="font-size:10px;color:#9ca3af;margin-top:4px">▲/▼ = ${esc(model.windowLabel)}</div>` : ''
  return `<div>${svg}<div style="margin-top:8px">${legend}</div>${sub}</div>`
}
