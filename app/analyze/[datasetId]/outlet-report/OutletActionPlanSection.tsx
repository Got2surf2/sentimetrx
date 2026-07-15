'use client'

// Page-2 "AI Action Plan" — the LLM-narrated "3 things to work on next", fetched
// lazily (generation is one Claude call, cached server-side) so the snapshot
// paints instantly. Matches the Datanautix PDF's action-plan page.

import { useEffect, useState } from 'react'
import LottieLoader from '@/components/ui/LottieLoader'
import type { ActionPlan } from '@/lib/outletActionPlan'

const TEAL = '#0F7173'
const ORANGE = '#E85A1A'

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

export default function OutletActionPlanSection({ datasetId, outlet, outletName, reviews }: {
  datasetId: string; outlet: string; outletName: string; reviews: number
}) {
  const [plan, setPlan] = useState<ActionPlan | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    const ctrl = new AbortController()
    setPlan(null); setError(false)
    fetch(`/api/datasets/${datasetId}/outlet-action-plan?outlet=${encodeURIComponent(outlet)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setPlan(d.plan))
      .catch((e) => { if (e?.name !== 'AbortError') setError(true) })
    return () => ctrl.abort()
  }, [datasetId, outlet])

  return (
    <section className="outlet-print-page mt-6 rounded-xl bg-white p-8 shadow-sm ring-1 ring-gray-200 print:mt-0 print:shadow-none print:ring-0">
      {/* Brand bar */}
      <div className="flex items-center justify-between border-b border-gray-200 pb-3">
        <Datanautix />
        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">AI Action Plan · {outletName}</div>
      </div>

      {!plan && !error && (
        <div className="flex flex-col items-center justify-center py-16 print:hidden">
          <LottieLoader size={110} message="Building this location's action plan…" />
          <p className="mt-1 text-xs text-gray-400">Reading the guest reviews — this takes a few seconds.</p>
        </div>
      )}

      {error && (
        <div className="py-10 text-center text-sm text-gray-400 print:hidden">Couldn’t build the action plan right now. Reload to try again.</div>
      )}

      {plan && <ActionPlanBody plan={plan} reviews={reviews} />}
    </section>
  )
}

// Presentational body — data-free of fetching, so it renders on the server and
// is QC/print-able. Consumed by the client wrapper above.
export function ActionPlanBody({ plan, reviews }: { plan: ActionPlan; reviews: number }) {
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
              <p className="mt-1.5 text-sm leading-relaxed text-gray-600">{p.diagnosis}</p>
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
