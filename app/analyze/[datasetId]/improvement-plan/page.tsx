// app/analyze/[datasetId]/improvement-plan/page.tsx
//
// Brand-level "guest experience improvement plan" — the executive summary that
// ranks the themes most dragging guest sentiment across ALL outlets, quantifies
// the lift from bringing laggards to the peer median, and pinpoints which
// outlets to start with. This is the "why you need us" artifact. Reached via a
// button on the Leaderboard (NOT a new tab). See lib/outletPredictor.ts.

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getUserContext } from '@/lib/userContext'
import { computeOutletPredictor } from '@/lib/outletReport'
import PrintButton from '../outlet-report/PrintButton'

export const dynamic = 'force-dynamic'

const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`
// Brand label cleanup — exemplar/outlet labels carry the brand prefix; the brand
// is already the eyebrow, so show just the location half.
function locOnly(label: string): string {
  const i = label.indexOf(' — ')
  return i >= 0 ? label.slice(i + 3) : label
}

export default async function ImprovementPlanPage(props: {
  params: Promise<{ datasetId: string }>
}) {
  const { datasetId } = await props.params

  const supabase = await createClient()
  const ctx = await getUserContext(supabase)
  if (!ctx) redirect('/login')

  const service = createServiceRoleClient()
  const { data: ds } = await service.from('datasets').select('org_id, name').eq('id', datasetId).maybeSingle()
  if (!ds) notFound()
  if (!ctx.isAdminOrg && ds.org_id !== ctx.orgId) notFound()

  const p = await computeOutletPredictor(datasetId)
  const brand = ds.name || 'Brand'
  const top = p.brandLevers[0]
  const hotlist = p.outletSummaries.filter((o) => o.topLever).slice(0, 10)

  return (
    <div className="min-h-screen bg-gray-100 py-8 print:bg-white print:py-0">
      <div className="mx-auto max-w-4xl px-4">
        <div className="mb-4 flex items-center justify-between print:hidden">
          <Link href={`/analyze/${datasetId}/outlet-leaderboard`} className="text-sm font-medium text-gray-500 hover:text-gray-700">← Back to Leaderboard</Link>
          <PrintButton />
        </div>

        <div className="rounded-xl bg-white p-8 shadow-sm ring-1 ring-gray-200 print:shadow-none print:ring-0">
          {/* Header */}
          <div className="border-b border-gray-200 pb-4">
            <div className="text-xs font-semibold uppercase tracking-widest text-gray-400">{brand}</div>
            <h1 className="mt-1 text-2xl font-bold text-gray-900">Guest experience improvement plan</h1>
            <div className="text-sm text-gray-500">
              {p.outletSummaries.length} outlets · {p.model.population.toLocaleString()} reviews analyzed · brand average {p.model.chainAvg.toFixed(2)}★
            </div>
          </div>

          {!p.available || !top ? (
            <div className="mt-8 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500">
              Not enough rated, themed reviews across outlets to build a plan yet.
            </div>
          ) : (
            <>
              {/* Executive summary */}
              <div className="mt-6 rounded-lg bg-gray-50 p-5">
                <h2 className="text-sm font-bold text-gray-700">The opportunity</h2>
                <p className="mt-1 text-sm leading-relaxed text-gray-700">
                  Across {p.outletSummaries.length} {brand} locations, the single biggest lever on guest sentiment is{' '}
                  <span className="font-semibold text-gray-900">{top.theme}</span> — each negative mention costs about{' '}
                  <span className="font-semibold">{top.drag.toFixed(1)}★</span>, and{' '}
                  <span className="font-semibold">{top.outletsAboveMedian}</span> outlets sit below the peer median on it. The plan below ranks
                  every lever by modeled impact and names exactly which outlets to start with — and which sister locations already do it well.
                </p>
              </div>

              {/* Brand levers */}
              <h2 className="mt-7 text-sm font-bold text-gray-700">Where the brand should focus — levers by modeled impact</h2>
              <div className="mt-2 space-y-2.5">
                {p.brandLevers.map((l, i) => (
                  <div key={l.theme} className="rounded-lg border border-gray-200 p-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="flex items-baseline gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-800 text-[11px] font-bold text-white">{i + 1}</span>
                        <span className="text-sm font-semibold text-gray-900">{l.theme}</span>
                      </div>
                      <span className="shrink-0 text-xs text-gray-500">
                        ≈ <span className="font-semibold text-emerald-600">+{l.chainLift.toFixed(3)}★</span> brand-wide if all → peer median
                      </span>
                    </div>
                    <div className="mt-1.5 text-xs text-gray-500">
                      Each negative mention ≈ <span className="font-medium text-gray-700">{l.drag.toFixed(1)}★</span> lower ·
                      peer median <span className="font-medium text-gray-700">{pct1(l.peerMedian)}</span> ·
                      <span className="font-medium text-gray-700"> {l.outletsAboveMedian}</span> outlets above it
                    </div>
                    {l.topOutlets.length > 0 && (
                      <div className="mt-2 text-xs text-gray-500">
                        <span className="font-medium text-gray-600">Start with:</span>{' '}
                        {l.topOutlets.map((o, k) => (
                          <span key={o.placeId}>
                            {k > 0 ? ', ' : ''}
                            <Link href={`/analyze/${datasetId}/outlet-report?outlet=${o.placeId}`} className="text-gray-700 underline decoration-gray-300 hover:decoration-gray-500">
                              {locOnly(o.label)}
                            </Link>{' '}
                            <span className="text-gray-400">({pct1(o.negRate)})</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Where to start — outlet hot-list */}
              <h2 className="mt-7 text-sm font-bold text-gray-700">Where to start — outlets with the most to gain</h2>
              <div className="mt-2 overflow-hidden rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-400">
                      <th className="px-3 py-2 font-semibold">Location</th>
                      <th className="px-3 py-2 text-right font-semibold">Rating</th>
                      <th className="px-3 py-2 font-semibold">Biggest lever</th>
                      <th className="px-3 py-2 text-right font-semibold">Potential</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hotlist.map((o) => (
                      <tr key={o.placeId} className="border-b border-gray-100 last:border-0">
                        <td className="px-3 py-2">
                          <Link href={`/analyze/${datasetId}/outlet-report?outlet=${o.placeId}`} className="font-medium text-gray-800 underline decoration-gray-300 hover:decoration-gray-500">
                            {locOnly(o.label)}
                          </Link>
                          <span className="ml-1 text-xs text-gray-400">· {o.reviews} reviews</span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span className="font-semibold text-gray-900">{o.rating != null ? o.rating.toFixed(2) : '—'}</span>
                          <span className={`ml-1 text-xs ${o.ratingDelta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {o.ratingDelta >= 0 ? '+' : ''}{o.ratingDelta.toFixed(2)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-700">{o.topLever?.theme}</td>
                        <td className="px-3 py-2 text-right font-semibold text-emerald-600">+{o.topLever?.lift.toFixed(2)}★</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="mt-6 border-t border-gray-100 pt-3 text-[11px] leading-relaxed text-gray-400">
                Levers ranked by a de-biased model (ridge regression of star rating on theme-negative mentions, so co-occurring complaints
                don’t double-count; explains {Math.round(p.model.r2 * 100)}% of rating variance across {p.model.population.toLocaleString()} reviews).
                Brand-wide “potential” = the volume-weighted star lift if every outlet’s negative-mention rate on a theme dropped to the peer
                median × that theme’s modeled ★-drag. Per-outlet potential is the same gap × drag for that location. Associational, not causal —
                a prioritization signal, not a guaranteed star change.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
