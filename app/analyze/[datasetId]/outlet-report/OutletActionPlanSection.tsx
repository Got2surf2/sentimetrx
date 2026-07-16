'use client'

// Page-2 "AI Action Plan" — the LLM-narrated "3 things to work on next", fetched
// lazily (generation is one Claude call, cached server-side) so the snapshot
// paints instantly. Matches the Datanautix PDF's action-plan page.

import { useEffect, useState } from 'react'
import LottieLoader from '@/components/ui/LottieLoader'
import type { ActionPlan } from '@/lib/outletActionPlan'
import type { ThemeTableRow } from '@/lib/outletReport'

const TEAL = '#0F7173'
const ORANGE = '#E85A1A'

const pct0 = (n: number) => `${Math.round(n * 100)}%`
const starCls = (avg: number) => (avg < 4.0 ? 'text-rose-600' : avg < 4.35 ? 'text-amber-600' : 'text-emerald-600')
const negCls = (p: number) => (p >= 0.35 ? 'text-rose-600' : p >= 0.18 ? 'text-amber-600' : 'text-gray-500')
// Neutral Sarina-teal theme pill (a red/severity tint would wrongly read as an alarm;
// severity is already carried by the coloured avg★/%-negative next to it).
const SARINA = '#0F7173'

function Datanautix() {
  return (
    <span className="text-[15px] font-extrabold lowercase tracking-tight">
      <span style={{ color: TEAL }}>data</span>
      <span style={{ color: ORANGE }}>nautix</span>
    </span>
  )
}

// Descending-severity accent per priority (P1 most severe).
const ACCENT = [
  { bar: 'border-rose-400', kicker: 'text-rose-600' },
  { bar: 'border-amber-400', kicker: 'text-amber-600' },
  { bar: 'border-teal-400', kicker: 'text-teal-700' },
]

export default function OutletActionPlanSection({ datasetId, outlet, outletName, reviews, themeTable }: {
  datasetId: string; outlet: string; outletName: string; reviews: number; themeTable: ThemeTableRow[]
}) {
  const [plan, setPlan] = useState<ActionPlan | null>(null)
  const [status, setStatus] = useState<'loading' | 'error' | 'ok'>('loading')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let cancelled = false
    const ctrl = new AbortController()
    // The plan is one LLM call (~30s the first time, cached after). Cap the wait
    // so a slow/failed call surfaces a Retry instead of spinning forever.
    // (Loading state is set on mount / by the Retry handler, not here — the
    // parent keys this component by outlet so it remounts fresh per outlet.)
    const timer = setTimeout(() => ctrl.abort(), 90000)
    fetch(`/api/datasets/${datasetId}/outlet-action-plan?outlet=${encodeURIComponent(outlet)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (!cancelled) { setPlan(d.plan); setStatus('ok') } })
      .catch(() => { if (!cancelled) setStatus('error') })
      .finally(() => clearTimeout(timer))
    return () => { cancelled = true; clearTimeout(timer); ctrl.abort() }
  }, [datasetId, outlet, retry])

  return (
    // Break to a fresh page for the export; until the plan loads, drop out of
    // print entirely so an early Ctrl-P yields a clean 1-page snapshot, not a
    // near-blank page 2.
    <section className={`outlet-print-page mt-6 rounded-xl bg-white p-8 shadow-sm ring-1 ring-gray-200 print:p-6 print:mt-0 print:shadow-none print:ring-0 print:break-before-page ${status === 'ok' ? '' : 'print:hidden'}`}>
      {/* Brand bar */}
      <div className="flex items-center justify-between border-b border-gray-200 pb-3">
        <Datanautix />
        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">AI Action Plan · {outletName}</div>
      </div>

      {status === 'loading' && (
        <div className="flex flex-col items-center justify-center py-16 print:hidden">
          <LottieLoader size={110} message="Building this location's action plan…" />
          <p className="mt-1 text-xs text-gray-400">Reading the guest reviews — up to a minute the first time, then it’s instant.</p>
        </div>
      )}

      {status === 'error' && (
        <div className="flex flex-col items-center gap-3 py-12 text-center print:hidden">
          <p className="text-sm text-gray-500">Couldn’t build the action plan just now.</p>
          <button onClick={() => { setPlan(null); setStatus('loading'); setRetry((r) => r + 1) }} className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700">Retry</button>
        </div>
      )}

      {plan && <ActionPlanBody plan={plan} reviews={reviews} themeTable={themeTable} />}
    </section>
  )
}

// Presentational body — data-free of fetching, so it renders on the server and
// is QC/print-able. Consumed by the client wrapper above.
export function ActionPlanBody({ plan, reviews, themeTable = [] }: { plan: ActionPlan; reviews: number; themeTable?: ThemeTableRow[] }) {
  const themeRow = new Map(themeTable.map((t) => [t.theme, t]))
  return (
    <div className="mt-4">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-700">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> AI-generated from {reviews.toLocaleString()} guest reviews
      </span>
      <h2 className="mt-3 text-2xl font-bold text-gray-900">3 things to work on next</h2>
      <p className="mt-1 text-sm text-gray-500">Ranked by impact — each is drawn from this location’s own reviews: the theme scores plus the specific language guests use when they drop below 4 stars.</p>

      <div className="mt-5 space-y-4">
        {plan.priorities.map((p, i) => {
          const a = ACCENT[i] || ACCENT[2]
          return (
            <div key={i} className={`rounded-lg border border-gray-200 border-l-4 ${a.bar} bg-gray-50/60 p-4 print:break-inside-avoid`}>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className={`text-[10px] font-bold uppercase tracking-widest ${a.kicker}`}>Priority {i + 1} · {p.tag}</span>
                <span className="text-base font-bold text-gray-900">{p.title}</span>
              </div>
              {/* Anchor the card to its theme row in the snapshot table above. */}
              {(() => { const r = themeRow.get(p.theme); return (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <span className="rounded-full px-2 py-0.5 font-semibold text-white" style={{ background: SARINA }}>{p.theme}</span>
                  {r && (
                    <span className="flex items-center gap-x-1.5 text-gray-400">
                      <span className={`font-semibold tabular-nums ${starCls(r.avgStar)}`}>{r.avgStar.toFixed(2)}★</span>
                      <span className="text-gray-300">·</span>
                      <span className={`font-semibold tabular-nums ${negCls(r.pctNegative)}`}>{pct0(r.pctNegative)} negative</span>
                      <span className="text-gray-300">·</span>
                      <span className="tabular-nums">{r.mentions.toLocaleString()} mentions</span>
                    </span>
                  )}
                </div>
              ) })()}
              <p className="mt-2 text-sm leading-relaxed text-gray-600">{p.diagnosis}</p>
              {p.verbatims.map((v, j) => (
                <p key={j} className="mt-2 border-l-2 border-gray-300 pl-2.5 text-xs italic text-gray-500">
                  <span className="not-italic font-semibold text-gray-600">{v.rating}★</span> “{v.quote}”
                </p>
              ))}
              {p.actions.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {p.actions.map((act, k) => (
                    <li key={k} className="flex gap-2 text-sm text-gray-700">
                      <span aria-hidden className="mt-0.5 shrink-0 text-emerald-600">◆</span>
                      <span>{act}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>

      {/* Keep doing */}
      <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 print:break-inside-avoid">
        <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">Keep doing</div>
        <p className="mt-1.5 text-sm leading-relaxed text-gray-700">{plan.keepDoing}</p>
      </div>

      <p className="mt-4 border-t border-gray-100 pt-3 text-[11px] leading-relaxed text-gray-400">
        <span className="font-semibold text-gray-500">Method.</span> AI-generated from {reviews.toLocaleString()} Google reviews. Ratings, trend and response-rate are exact counts; theme figures are keyword-matched mentions (“% negative” = share of a theme’s mentions rated ≤3★). Verbatims are real guest reviews, lightly trimmed; names omitted. A prioritization signal, not a guaranteed star change.
      </p>
    </div>
  )
}
