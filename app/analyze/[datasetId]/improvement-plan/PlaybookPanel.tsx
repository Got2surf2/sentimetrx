'use client'

import { useMemo, useState } from 'react'
import type { RecommendedAction } from '@/lib/outletPredictor'

// Interactive brand playbook: check the recommended actions you'd commit to and
// see the live, DE-DUPLICATED impact — detractors recovered, the brand's 1–3★
// rate, and its average star rating. Each action ships its per-review recovery
// contributions (`rec`), so any subset's total is the union (max weight per
// review), never the (overlapping) sum of individual actions.

const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`
function locOnly(label: string): string { const i = label.indexOf(' — '); return i >= 0 ? label.slice(i + 3) : label }

export default function PlaybookPanel({ actions, population, lowCount, chainAvg, detractorAvg, happyAvg }: {
  actions: RecommendedAction[]
  population: number
  lowCount: number
  chainAvg: number
  detractorAvg: number
  happyAvg: number
}) {
  const [on, setOn] = useState<boolean[]>(() => actions.map(() => true))

  // Standalone recovery per action (its own rec weights) — for the row figure.
  const standalone = useMemo(() => actions.map((a) => a.rec.reduce((s, r) => s + r.w, 0)), [actions])

  const out = useMemo(() => {
    const best = new Map<number, number>()
    actions.forEach((a, k) => { if (on[k]) for (const r of a.rec) best.set(r.i, Math.max(best.get(r.i) || 0, r.w)) })
    let recovered = 0; best.forEach((w) => { recovered += w })
    const newLowCount = Math.max(0, lowCount - recovered)
    const newRate = population ? newLowCount / population : 0
    const delta = isFinite(happyAvg) && isFinite(detractorAvg) ? happyAvg - detractorAvg : 0
    const newAvg = population ? chainAvg + (recovered * delta) / population : chainAvg
    return { recovered, newRate, newAvg }
  }, [on, actions, population, lowCount, chainAvg, detractorAvg, happyAvg])

  const toggle = (k: number) => setOn((p) => { const n = [...p]; n[k] = !n[k]; return n })
  const lowRate = population ? lowCount / population : 0

  return (
    <div>
      <ol className="mt-2 space-y-2">
        {actions.map((a, i) => (
          <li key={i} className={`flex items-baseline gap-3 rounded-lg border p-3 transition-colors ${on[i] ? 'border-gray-200' : 'border-dashed border-gray-200 opacity-50'}`}>
            <input type="checkbox" checked={on[i]} onChange={() => toggle(i)} className="mt-1 h-4 w-4 shrink-0 rounded border-gray-300" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-gray-900">
                {a.kind === 'outlet' ? `Turn around ${locOnly(a.label || '')}` : `${a.theme} program`}
                {a.kind === 'theme' && a.trend === 'up' && <span className="ml-1.5 text-[10px] font-semibold text-rose-600">▲ worsening</span>}
              </div>
              <div className="text-xs text-gray-500">
                {a.kind === 'outlet'
                  ? `Bring its ${a.weaknessThemes?.length} bottom-quartile themes to the peer median`
                  : `Bring this theme to the peer median at its ${a.cohort} bottom-quartile outlets`}
              </div>
            </div>
            <span className="shrink-0 text-right">
              <span className="text-sm font-bold text-emerald-600">+{Math.round(standalone[i])}</span>
              <span className="block text-[10px] text-gray-400">detractors (alone)</span>
            </span>
          </li>
        ))}
      </ol>

      {/* Live projection for the SELECTED plan (de-duplicated). */}
      <div className="mt-3 grid grid-cols-3 gap-3 rounded-lg bg-gray-50 p-4">
        <div>
          <div className="text-2xl font-bold text-emerald-600">~{Math.round(out.recovered)}</div>
          <div className="text-xs text-gray-500">of {lowCount.toLocaleString()} detractors won back</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-gray-900">{pct1(lowRate)} <span className="text-base font-medium text-gray-400">→</span> <span className="text-emerald-700">{pct1(out.newRate)}</span></div>
          <div className="text-xs text-gray-500">brand 1–3★ rate</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-gray-900">{chainAvg.toFixed(2)}★ <span className="text-base font-medium text-gray-400">→</span> <span className="text-emerald-700">{out.newAvg.toFixed(2)}★</span></div>
          <div className="text-xs text-gray-500">brand avg rating</div>
        </div>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
        Check the actions you’d commit to — the plan total is <span className="font-medium text-gray-500">de-duplicated</span> (a review fixed by two actions is counted once), so it’s less than the sum of the per-action figures. The projected avg rating assumes each recovered detractor rises from your brand’s 1–3★ average to its 4–5★ average. A planning estimate, not a promise.
      </p>
    </div>
  )
}
