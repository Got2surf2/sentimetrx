// app/analyze/[datasetId]/improvement-plan/page.tsx
//
// Brand-level "recover your 1–3★ guests" plan — the executive summary that
// frames the opportunity as the spread in low-rated (1–3★) review rates across
// outlets, names the themes that genuinely drive unhappy guests (over-
// represented in bad vs good reviews), and pinpoints which outlets to start with
// and which to learn from. The "why you need us" artifact. Reached via a button
// on the Leaderboard (NOT a new tab). See lib/outletPredictor.ts.

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getUserContext } from '@/lib/userContext'
import { computeOutletPredictor } from '@/lib/outletReport'
import PrintButton from '../outlet-report/PrintButton'

export const dynamic = 'force-dynamic'

const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`
const pct0 = (n: number) => `${Math.round(n * 100)}%`
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
  const m = p.model
  const drivers = p.brandLevers
  const nonDrivers = p.drivers.filter((d) => !d.isDriver && d.nBad >= 20)
  const worst = p.outletSummaries[0]
  const best = p.exemplars[0]
  const hotlist = p.outletSummaries.slice(0, 10)

  return (
    <div className="min-h-screen bg-gray-100 py-8 print:bg-white print:py-0">
      <div className="mx-auto max-w-4xl px-4">
        <div className="mb-4 flex items-center justify-between print:hidden">
          <Link href={`/analyze/${datasetId}/outlet-leaderboard`} className="text-sm font-medium text-gray-500 hover:text-gray-700">← Back to Leaderboard</Link>
          <div className="flex items-center gap-3">
            <a
              href={`/api/datasets/${datasetId}/improvement-plan-deck`}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-gray-700"
            >
              Export deck
            </a>
            <PrintButton />
          </div>
        </div>

        <div className="rounded-xl bg-white p-8 shadow-sm ring-1 ring-gray-200 print:shadow-none print:ring-0">
          {/* Header */}
          <div className="border-b border-gray-200 pb-4">
            <div className="text-xs font-semibold uppercase tracking-widest text-gray-400">{brand}</div>
            <h1 className="mt-1 text-2xl font-bold text-gray-900">Guest experience improvement plan</h1>
            <div className="text-sm text-gray-500">
              {p.outletSummaries.length} outlets · {m.population.toLocaleString()} reviews analyzed · brand average {m.chainAvg.toFixed(2)}★
            </div>
          </div>

          {!p.available || !worst ? (
            <div className="mt-8 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500">
              Not enough rated, themed reviews across outlets to build a plan yet.
            </div>
          ) : (
            <>
              {/* The opportunity — the 1–3★ rate and its spread */}
              <div className="mt-6 rounded-lg bg-gray-50 p-5">
                <h2 className="text-sm font-bold text-gray-700">The opportunity</h2>
                <p className="mt-1 text-sm leading-relaxed text-gray-700">
                  <span className="font-semibold text-gray-900">{pct1(m.lowRate)}</span> of {brand}’s reviews are 1–3★
                  ({m.lowCount.toLocaleString()} of {m.population.toLocaleString()}) — but that ranges from{' '}
                  <span className="font-semibold text-emerald-700">{pct1(m.bestLowRate)}</span> at your best outlet
                  {best ? ` (${locOnly(best.label)})` : ''} to{' '}
                  <span className="font-semibold text-rose-700">{pct1(m.worstLowRate)}</span> at your worst
                  {worst ? ` (${locOnly(worst.label)})` : ''}. That spread is operational inconsistency you can close.
                  If every outlet matched your best-run quarter (~{pct1(m.targetLowRate)}), the brand’s 1–3★ rate would fall to about{' '}
                  <span className="font-semibold text-gray-900">{pct1(m.projectedLowRate)}</span>.
                </p>
              </div>

              {/* What drives unhappy guests */}
              <h2 className="mt-7 text-sm font-bold text-gray-700">What drives your unhappy guests</h2>
              <p className="mt-0.5 text-xs text-gray-500">
                Themes that appear disproportionately in 1–3★ reviews vs 4–5★ reviews — the real drivers of low ratings, not just the loudest topics.
              </p>
              <div className="mt-2 space-y-2.5">
                {drivers.map((d, i) => (
                  <div key={d.theme} className="rounded-lg border border-gray-200 p-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="flex items-baseline gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-800 text-[11px] font-bold text-white">{i + 1}</span>
                        <span className="text-sm font-semibold text-gray-900">{d.theme}</span>
                      </div>
                      <span className="shrink-0 text-sm font-bold text-rose-600">{d.lift.toFixed(1)}× more likely in 1–3★ reviews</span>
                    </div>
                    <div className="mt-1.5 text-xs text-gray-500">
                      Cited in <span className="font-medium text-gray-700">{pct0(d.pBad)}</span> of 1–3★ reviews vs{' '}
                      <span className="font-medium text-gray-700">{pct0(d.pGood)}</span> of 4–5★ reviews · {d.nBad} unhappy mentions
                    </div>
                  </div>
                ))}
                {drivers.length === 0 && (
                  <p className="rounded-lg border border-dashed border-gray-200 p-4 text-xs text-gray-500">No single theme is over-represented among unhappy guests — dissatisfaction is diffuse across topics.</p>
                )}
              </div>
              {nonDrivers.length > 0 && (
                <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
                  Discussed about equally by happy and unhappy guests — loud topics, not differentiators:{' '}
                  {nonDrivers.map((d) => `${d.theme} (${d.lift.toFixed(1)}×)`).join(', ')}.
                </p>
              )}

              {/* Where to start — outlet hot-list by 1–3★ rate */}
              <h2 className="mt-7 text-sm font-bold text-gray-700">Where to start — outlets with the highest 1–3★ rate</h2>
              <div className="mt-2 overflow-hidden rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-400">
                      <th className="px-3 py-2 font-semibold">Location</th>
                      <th className="px-3 py-2 text-right font-semibold">1–3★ rate</th>
                      <th className="px-3 py-2 text-right font-semibold">Rating</th>
                      <th className="px-3 py-2 font-semibold">Their unhappy guests cite</th>
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
                        <td className="px-3 py-2 text-right font-semibold text-rose-600">{pct1(o.lowRate)}</td>
                        <td className="px-3 py-2 text-right text-gray-700">{o.rating != null ? `${o.rating.toFixed(2)}★` : '—'}</td>
                        <td className="px-3 py-2 text-gray-700">{o.topDriver ? o.topDriver.theme : <span className="text-gray-400">diffuse</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Learn from — best operators */}
              {p.exemplars.length > 0 && (
                <>
                  <h2 className="mt-7 text-sm font-bold text-gray-700">Who already does it well</h2>
                  <p className="mt-0.5 text-xs text-gray-500">Your best operators — lowest 1–3★ rates at real review volume. Their playbook is the fastest fix for the laggards.</p>
                  <div className="mt-2 grid grid-cols-3 gap-3">
                    {p.exemplars.map((e) => (
                      <div key={e.placeId} className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
                        <div className="text-sm font-semibold text-gray-900">{locOnly(e.label)}</div>
                        <div className="mt-1 text-xs text-emerald-800">
                          <span className="font-bold">{pct1(e.lowRate)}</span> 1–3★{e.rating != null ? ` · ${e.rating.toFixed(2)}★` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <p className="mt-6 border-t border-gray-100 pt-3 text-[11px] leading-relaxed text-gray-400">
                Low-rated = 1–3★. A theme’s “driver” strength is its over-representation: P(theme | 1–3★) ÷ P(theme | 4–5★), which controls for base
                rate so a frequently-discussed-but-neutral topic doesn’t mislead. Outlet 1–3★ rates and the best-quartile target are straight counts.
                Computed from {m.population.toLocaleString()} rated reviews across {p.outletSummaries.length} outlets. Associational — a prioritization signal
                that benchmarks outlets against their own peers, not a guaranteed star change.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
