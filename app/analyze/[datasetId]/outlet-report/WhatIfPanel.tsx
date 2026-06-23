'use client'

import { useMemo, useState } from 'react'

// Interactive "recover your detractors" what-if for one outlet. Drag each
// theme's problem rate down (toward best-in-class) and see the projected 1–3★
// rate + rank update live. Honest about co-occurrence: a 1–3★ review is
// recovered gated by its LEAST-improved theme — a review citing a theme you
// leave untouched stays a detractor.

type Trend = { direction: 'up' | 'down' | 'flat'; recentRate: number; priorRate: number }

export type WhatIfData = {
  themes: string[]          // actionable theme names (index-aligned)
  reviews13: number[][]     // each 1–3★ review's actionable-theme indices
  currentRate: number[]     // this outlet's problem rate per theme
  medianRate: number[]      // peer-median problem rate per theme
  bestRate: number[]        // best-quartile problem rate per theme
  worstRate: number[]       // worst-in-class problem rate per theme (the right anchor)
  totalReviews: number
  lowCount: number
  lowRate: number
  avg: number               // outlet's current avg star rating
  detractorAvg: number      // mean rating of its 1–3★ reviews
  happyAvg: number          // mean rating of its 4–5★ reviews
  otherRatings: number[]    // every OTHER outlet's avg star (for the conventional rank)
  currentRank: number       // 1 = best (highest avg star)
  outletCount: number
  trends: (Trend | null)[]  // brand-level QoQ trend per theme (index-aligned)
  trendBasis: { recent: string; prior: string } | null
}

const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`

// Benchmark colors on each slider track: You = Ana orange, Peer median = the
// brand Sarina teal, Best-in-class = a bright lime green (kept LIGHT so it
// reads clearly distinct from the darker teal) — three separable hues.
const C = { you: '#E85A1A', median: '#0F7173', best: '#84CC16' }
const clampPct = (frac: number) => Math.max(0, Math.min(100, frac * 100))

// Per-theme axis: a fixed, intuitive scale — left = 0 (perfect), right = the
// rounded-up WORST-IN-CLASS rate (the worst any outlet does on this theme). So
// every tick reads against a real anchor, and dragging right models the theme
// getting worse, up to the worst peer. Handle + ticks share this scale.
const domainOf = (worst: number) => Math.max(0.01, Math.ceil(worst / 0.005) * 0.005)

// Reference ticks on a slider track — all three plotted on the shared domain so
// "You" is visible (not pinned to the edge) and benchmarks read honestly even
// when the outlet already beats one (its tick simply sits left of You).
function Marks({ cur, median, best, domainMax }: { cur: number; median: number; best: number; domainMax: number }) {
  if (domainMax <= 0) return null
  const ticks = [
    { pos: clampPct(best / domainMax), color: C.best },     // Best-in-class (lowest rate)
    { pos: clampPct(median / domainMax), color: C.median }, // Peer median
    { pos: clampPct(cur / domainMax), color: C.you },       // You (current) — drawn last so it's on top
  ]
  return (
    <div className="pointer-events-none absolute inset-x-[7px] inset-y-0 z-10">
      {ticks.map((t, k) => (
        <span key={k} className="absolute top-0 bottom-0 w-[3px] -translate-x-1/2 rounded-sm" style={{ left: `${t.pos}%`, background: t.color }} />
      ))}
    </div>
  )
}

// Recovery gated by the least-improved theme (mirror of pure projectRecovery).
function recover(reviews13: number[][], current: number[], target: number[]): number {
  let r = 0
  for (const rev of reviews13) {
    if (!rev.length) continue
    let min = Infinity
    for (const i of rev) { const red = current[i] > 0 ? Math.max(0, (current[i] - target[i]) / current[i]) : 0; if (red < min) min = red }
    r += min === Infinity ? 0 : min
  }
  return r
}

function TrendBadge({ t }: { t: Trend | null }) {
  if (!t || t.direction === 'flat') return <span className="text-[10px] text-gray-300">→ flat</span>
  const up = t.direction === 'up' // up = problem rate rising = worsening
  return (
    <span className={`text-[10px] font-semibold ${up ? 'text-rose-600' : 'text-emerald-600'}`} title={`${pct1(t.priorRate)} → ${pct1(t.recentRate)} QoQ`}>
      {up ? '▲ worsening' : '▼ improving'}
    </span>
  )
}

export default function WhatIfPanel(d: WhatIfData) {
  // Default: start at "You today" (each target = current rate) so the user drags
  // down from where they are. Reset returns here.
  const [target, setTarget] = useState<number[]>(() => [...d.currentRate])

  const out = useMemo(() => {
    // Improvement (target < current): careful review-level recovery, gated by the
    // least-improved theme. Worsening (target > current): a directional estimate
    // of ADDED detractors ≈ Δrate × reviews, summed over worsened themes and
    // capped at the still-happy pool (rough, but lets them model decline too).
    const recovered = recover(d.reviews13, d.currentRate, target)
    const happyPool = Math.max(0, d.totalReviews - d.lowCount)
    let added = 0
    for (let i = 0; i < d.currentRate.length; i++) { const inc = target[i] - d.currentRate[i]; if (inc > 0) added += inc * d.totalReviews }
    added = Math.min(added, happyPool)
    const net = recovered - added // detractors removed; negative = net added (worse)
    const newLowCount = Math.max(0, Math.min(d.totalReviews, d.lowCount - net))
    const newRate = d.totalReviews ? newLowCount / d.totalReviews : 0
    // Project the outlet's avg star: each net-removed detractor moves from the
    // detractor avg up to the happy avg (and vice-versa for added). Then rank
    // against every other outlet's (fixed) avg — conventional, 1 = best.
    const delta = (isFinite(d.happyAvg) && isFinite(d.detractorAvg) ? d.happyAvg - d.detractorAvg : 0)
    const newAvg = d.totalReviews ? d.avg + (net * delta) / d.totalReviews : d.avg
    const newRank = 1 + d.otherRatings.filter((r) => r > newAvg).length
    return { net, newRate, newAvg, newRank }
  }, [target, d])

  const setOne = (i: number, v: number) => setTarget((prev) => { const next = [...prev]; next[i] = v; return next })
  const preset = (fn: (c: number, i: number) => number) => setTarget(d.currentRate.map(fn))

  return (
    <div className="rounded-lg border border-gray-200 p-4 print:hidden">
      <h3 className="text-sm font-bold text-gray-700">What-if — how many unhappy guests could you win back?</h3>
      <p className="mt-0.5 text-xs leading-relaxed text-gray-500">
        Drag each theme’s 1–3★ problem rate <span className="font-medium text-gray-600">left to improve</span> (toward — or past — what your best outlets achieve) or <span className="font-medium text-gray-600">right to model it getting worse</span>, and see the impact. A review is only won back if every theme it complains about improves — so a review that also gripes about something you leave untouched stays a detractor.
      </p>

      <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
        <span className="text-gray-500">Quick set:</span>
        <button onClick={() => preset((c) => c)} className="rounded border border-gray-300 px-2 py-0.5 font-medium text-gray-600 hover:border-gray-400">Reset</button>
        <button onClick={() => preset((c, i) => Math.min(c, d.medianRate[i]))} className="rounded border border-gray-300 px-2 py-0.5 font-medium text-gray-600 hover:border-gray-400">All → peer median</button>
        <button onClick={() => preset((c, i) => Math.min(c, d.bestRate[i]))} className="rounded border border-gray-300 px-2 py-0.5 font-medium text-gray-600 hover:border-gray-400">All → best-in-class</button>
      </div>

      {/* Legend (labels the colored ticks that appear on every slider). */}
      <div className="mt-3 flex items-center gap-4 text-[11px] text-gray-500">
        <span className="font-medium text-gray-400">On each bar:</span>
        {([['You (today)', C.you], ['Peer median', C.median], ['Best-in-class', C.best]] as const).map(([lbl, col]) => (
          <span key={lbl} className="flex items-center gap-1"><span className="inline-block h-2.5 w-[3px] rounded-sm" style={{ background: col }} /> {lbl}</span>
        ))}
        <span className="ml-auto text-gray-400">drag ← better · worse →</span>
      </div>

      <div className="mt-2 space-y-2">
        {d.themes.map((t, i) => {
          const cur = d.currentRate[i]
          const dmax = domainOf(d.worstRate[i])
          const tgt = Math.min(target[i], dmax)
          const reduced = cur > 0 && target[i] < cur - 1e-9
          const worse = target[i] > cur + 1e-9
          return (
            <div key={t} className="flex items-center gap-3 text-xs">
              <div className="flex w-56 shrink-0 items-center gap-1.5">
                <span className="truncate text-gray-700">{t}</span>
                {d.trendBasis && <TrendBadge t={d.trends[i]} />}
              </div>
              {/* Track: native range (neutral handle) + benchmark ticks on the
                  shared 0→worst-in-class scale, with the 0% / worst% anchors marked
                  at the ends. Drag left to improve (past best toward 0), right to
                  worsen (toward the worst peer). */}
              <div className="flex-1">
                <div className="relative flex h-5 items-center">
                  <input
                    type="range" min={0} max={dmax} step={dmax / 200} value={tgt}
                    onChange={(e) => setOne(i, Number(e.target.value))}
                    className="relative z-0 h-1.5 w-full cursor-pointer accent-gray-500"
                  />
                  <Marks cur={cur} median={d.medianRate[i]} best={d.bestRate[i]} domainMax={dmax} />
                </div>
                <div className="relative mt-0.5 inset-x-[7px] h-3 text-[9px] tabular-nums text-gray-400">
                  <span className="absolute left-0">0%</span>
                  <span className="absolute right-0">{pct1(dmax)}</span>
                </div>
              </div>
              <span className="w-36 shrink-0 text-right">
                <span className="tabular-nums">
                  <span className="text-gray-400">{pct1(cur)}</span>
                  <span className="mx-1 text-gray-300">→</span>
                  <span className={reduced ? 'font-semibold text-emerald-700' : worse ? 'font-semibold text-rose-600' : 'text-gray-400'}>{pct1(tgt)}</span>
                </span>
                <span className="block text-[9px] tabular-nums" style={{ color: C.median }}>median {pct1(d.medianRate[i])} <span style={{ color: C.best }}>· best {pct1(d.bestRate[i])}</span></span>
              </span>
            </div>
          )
        })}
      </div>

      {(() => {
        const gained = out.net >= 0
        const rateWorse = out.newRate > d.lowRate + 1e-9
        const rankWorse = out.newRank > d.currentRank
        return (
          <div className="mt-3 grid grid-cols-3 gap-3 rounded-lg bg-gray-50 p-4">
            <div>
              <div className={`text-2xl font-bold ${gained ? 'text-emerald-600' : 'text-rose-600'}`}>{gained ? '~' : '+'}{Math.round(Math.abs(out.net))}</div>
              <div className="text-xs text-gray-500">of {d.lowCount} detractors {gained ? 'recovered' : 'added'}</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{pct1(d.lowRate)} <span className="text-base font-medium text-gray-400">→</span> <span className={rateWorse ? 'text-rose-600' : ''}>{pct1(out.newRate)}</span></div>
              <div className="text-xs text-gray-500">1–3★ review rate</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">#{d.currentRank} <span className="text-base font-medium text-gray-400">→</span> <span className={rankWorse ? 'text-rose-600' : out.newRank < d.currentRank ? 'text-emerald-600' : ''}>#{out.newRank}</span></div>
              <div className="text-xs text-gray-500">overall rank · of {d.outletCount} (1 = best)</div>
            </div>
          </div>
        )
      })()}

      <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
        A planning estimate, not a promise. <span className="text-gray-500">Improving</span> (drag left): each recovered review is credited only as far as its least-improved theme moves, and reviews citing an unfixed theme aren’t counted — a conservative floor. <span className="text-gray-500">Worsening</span> (drag right): added detractors ≈ the rise in each theme’s problem rate × your reviews — a directional estimate.{d.trendBasis ? ` Trend badges are brand-wide QoQ (${d.trendBasis.prior} → ${d.trendBasis.recent}).` : ''}
      </p>
    </div>
  )
}
