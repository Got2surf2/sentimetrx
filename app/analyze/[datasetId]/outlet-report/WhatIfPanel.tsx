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
  totalReviews: number
  lowCount: number
  lowRate: number
  otherLowRates: number[]   // every OTHER outlet's 1–3★ rate (for rank)
  currentRank: number
  outletCount: number
  trends: (Trend | null)[]  // brand-level QoQ trend per theme (index-aligned)
  trendBasis: { recent: string; prior: string } | null
}

const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`

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
  // Default: bring every above-median theme down to the peer median (a sensible
  // starting scenario); themes already at/below median start unchanged.
  const [target, setTarget] = useState<number[]>(() => d.currentRate.map((c, i) => Math.min(c, d.medianRate[i])))

  const out = useMemo(() => {
    const recovered = recover(d.reviews13, d.currentRate, target)
    const newLowCount = Math.max(0, d.lowCount - recovered)
    const newRate = d.totalReviews ? newLowCount / d.totalReviews : 0
    const newRank = 1 + d.otherLowRates.filter((r) => r > newRate).length
    return { recovered, newRate, newRank }
  }, [target, d])

  const setOne = (i: number, v: number) => setTarget((prev) => { const next = [...prev]; next[i] = v; return next })
  const preset = (fn: (c: number, i: number) => number) => setTarget(d.currentRate.map(fn))

  return (
    <div className="rounded-lg border border-gray-200 p-4 print:hidden">
      <h3 className="text-sm font-bold text-gray-700">What-if — how many unhappy guests could you win back?</h3>
      <p className="mt-0.5 text-xs leading-relaxed text-gray-500">
        Drag each theme’s 1–3★ problem rate down toward what your best outlets achieve. A review is only won back if <span className="font-medium text-gray-600">every</span> theme it complains about improves — so a review that also gripes about something you leave untouched stays a detractor.
      </p>

      <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
        <span className="text-gray-500">Quick set:</span>
        <button onClick={() => preset((c) => c)} className="rounded border border-gray-300 px-2 py-0.5 font-medium text-gray-600 hover:border-gray-400">Reset</button>
        <button onClick={() => preset((c, i) => Math.min(c, d.medianRate[i]))} className="rounded border border-gray-300 px-2 py-0.5 font-medium text-gray-600 hover:border-gray-400">All → peer median</button>
        <button onClick={() => preset((c, i) => Math.min(c, d.bestRate[i]))} className="rounded border border-gray-300 px-2 py-0.5 font-medium text-gray-600 hover:border-gray-400">All → best-in-class</button>
      </div>

      <div className="mt-3 space-y-2">
        {d.themes.map((t, i) => {
          const cur = d.currentRate[i]
          const reduced = cur > 0 && target[i] < cur - 1e-9
          return (
            <div key={t} className="flex items-center gap-3 text-xs">
              <div className="flex w-56 shrink-0 items-center gap-1.5">
                <span className="truncate text-gray-700">{t}</span>
                {d.trendBasis && <TrendBadge t={d.trends[i]} />}
              </div>
              <input
                type="range" min={0} max={Math.max(cur, 0.0001)} step={0.001} value={Math.min(target[i], cur)}
                onChange={(e) => setOne(i, Number(e.target.value))}
                disabled={cur <= 0}
                className="h-1.5 flex-1 cursor-pointer accent-gray-800 disabled:cursor-default disabled:opacity-40"
              />
              <span className="w-28 shrink-0 text-right tabular-nums">
                <span className="text-gray-400">{pct1(cur)}</span>
                <span className="mx-1 text-gray-300">→</span>
                <span className={reduced ? 'font-semibold text-emerald-700' : 'text-gray-400'}>{pct1(Math.min(target[i], cur))}</span>
              </span>
            </div>
          )
        })}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3 rounded-lg bg-gray-50 p-4">
        <div>
          <div className="text-2xl font-bold text-emerald-600">~{Math.round(out.recovered)}</div>
          <div className="text-xs text-gray-500">of {d.lowCount} detractors recovered</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-gray-900">{pct1(d.lowRate)} <span className="text-base font-medium text-gray-400">→</span> {pct1(out.newRate)}</div>
          <div className="text-xs text-gray-500">1–3★ review rate</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-gray-900">#{d.currentRank} <span className="text-base font-medium text-gray-400">→</span> #{out.newRank}</div>
          <div className="text-xs text-gray-500">of {d.outletCount} (1 = worst)</div>
        </div>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
        A planning estimate, not a promise: each recovered review is credited only as far as its least-improved theme moves, and reviews citing an unfixed theme aren’t counted — a conservative floor.{d.trendBasis ? ` Trend badges are brand-wide QoQ (${d.trendBasis.prior} → ${d.trendBasis.recent}).` : ''}
      </p>
    </div>
  )
}
