'use client'

import { useMemo, useState } from 'react'

// Interactive "recover your detractors" what-if for one outlet. Toggle the
// themes to fix + the target (peer median / best-in-class) and see the projected
// 1–3★ rate and rank update live. Honest about co-occurrence: only 1–3★ reviews
// whose complaints are ENTIRELY within the selected themes count, each scaled by
// how far the outlet closes the gap to target (target is a rate, not zero).

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
  defaultSelected: number[] // weakness theme indices, pre-checked
}

const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`
const ord = (n: number) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]) }

// Detractors recovered if `selected` themes hit `target` (mirror of the pure
// projectRecovery in lib/outletPredictor — inlined to keep the client bundle small).
function recover(reviews13: number[][], selected: Set<number>, current: number[], target: number[]): number {
  let r = 0
  for (const rev of reviews13) {
    if (!rev.length || !rev.every((i) => selected.has(i))) continue
    let w = 0
    for (const i of rev) w += current[i] > 0 ? Math.max(0, (current[i] - target[i]) / current[i]) : 0
    r += w / rev.length
  }
  return r
}

export default function WhatIfPanel(d: WhatIfData) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set(d.defaultSelected.length ? d.defaultSelected : d.themes.map((_, i) => i)))
  const [target, setTarget] = useState<'median' | 'best'>('median')

  const out = useMemo(() => {
    const tgt = target === 'median' ? d.medianRate : d.bestRate
    const recovered = recover(d.reviews13, selected, d.currentRate, tgt)
    const newLowCount = Math.max(0, d.lowCount - recovered)
    const newRate = d.totalReviews ? newLowCount / d.totalReviews : 0
    const newRank = 1 + d.otherLowRates.filter((r) => r > newRate).length
    return { recovered, newRate, newRank }
  }, [selected, target, d])

  const toggle = (i: number) => setSelected((prev) => {
    const next = new Set(prev); next.has(i) ? next.delete(i) : next.add(i); return next
  })

  return (
    <div className="rounded-lg border border-gray-200 p-4 print:hidden">
      <h3 className="text-sm font-bold text-gray-700">What-if — how many unhappy guests could you win back?</h3>
      <p className="mt-0.5 text-xs leading-relaxed text-gray-500">
        Pick the themes you’d fix and the bar to hit. We count only 1–3★ reviews whose complaints are <span className="font-medium text-gray-600">entirely within</span> those themes — a review that also gripes about something else stays a detractor.
      </p>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {d.themes.map((t, i) => (
          <label key={t} className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-700">
            <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} className="h-3.5 w-3.5 rounded border-gray-300" />
            {t} <span className="text-gray-400">({pct1(d.currentRate[i])})</span>
          </label>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs">
        <span className="text-gray-500">Bring them to:</span>
        {([['median', 'Peer median'], ['best', 'Best-in-class']] as const).map(([v, lbl]) => (
          <button key={v} onClick={() => setTarget(v)}
            className={`rounded-md border px-2.5 py-1 font-medium transition-colors ${target === v ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-300 text-gray-600 hover:border-gray-400'}`}>
            {lbl}
          </button>
        ))}
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
        A planning estimate, not a promise: each qualifying review is credited in proportion to how far you’d close the gap to {target === 'median' ? 'the peer median' : 'your best outlets'} on the themes it mentions. Reviews that also cite an unfixed theme aren’t counted, so this is a conservative floor.
      </p>
    </div>
  )
}
