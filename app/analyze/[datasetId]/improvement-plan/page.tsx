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
import AnalyticsNav from '../AnalyticsNav'
import PlaybookPanel from './PlaybookPanel'

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
  const nonDrivers = p.drivers.filter((d) => !d.isDriver && !d.isOutcome && d.nBad >= 20)
  const worst = p.outletSummaries[0]
  const best = p.exemplars[0]
  const hotlist = p.outletSummaries.slice(0, 10)

  return (
    <div className="min-h-screen bg-gray-100 py-8 print:bg-white print:py-0">
      <div className="mx-auto max-w-4xl px-4">
        <AnalyticsNav datasetId={datasetId} active="brand" action={
          <a href={`/api/datasets/${datasetId}/improvement-plan-deck`} className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-gray-700">Export deck</a>
        } />

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

              {/* Recommended actions — the interactive, de-duplicated playbook */}
              {p.recommendedActions.length > 0 && (
                <>
                  <h2 className="mt-7 text-sm font-bold text-gray-700">Recommended actions — build your plan</h2>
                  <p className="mt-0.5 text-xs text-gray-500">Ranked by 1–3★ guests won back if laggards reach the peer median. Check the actions you’d commit to and watch the brand impact update.</p>
                  <PlaybookPanel
                    actions={p.recommendedActions}
                    population={m.population}
                    lowCount={m.lowCount}
                    chainAvg={m.chainAvg}
                    detractorAvg={m.detractorAvg}
                    happyAvg={m.happyAvg}
                  />
                </>
              )}

              {/* What drives unhappy guests */}
              <h2 className="mt-7 text-sm font-bold text-gray-700">What to fix — the actionable drivers</h2>
              <p className="mt-0.5 text-xs text-gray-500">
                Operational themes that appear disproportionately in 1–3★ reviews vs 4–5★ reviews — what a manager can actually act on, not just the loudest topics.
              </p>
              <div className="mt-2 space-y-2.5">
                {drivers.map((d, i) => (
                  <div key={d.theme} className="rounded-lg border border-gray-200 p-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="flex items-baseline gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-800 text-[11px] font-bold text-white">{i + 1}</span>
                        <span className="text-sm font-semibold text-gray-900">{d.theme}</span>
                        {(() => { const tr = p.themeTrends[d.theme]; if (!tr || tr.direction === 'flat') return null; const up = tr.direction === 'up'; return <span className={`text-[10px] font-semibold ${up ? 'text-rose-600' : 'text-emerald-600'}`} title={`${pct1(tr.priorRate)} → ${pct1(tr.recentRate)} QoQ`}>{up ? '▲ worsening' : '▼ improving'}</span> })()}
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
                  <p className="rounded-lg border border-dashed border-gray-200 p-4 text-xs text-gray-500">No single operational theme is over-represented among unhappy guests — dissatisfaction is diffuse across topics.</p>
                )}
              </div>
              {p.outcomeSignals.length > 0 && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                  <div className="text-xs font-semibold text-amber-800">Brand-health signal (a symptom, not a lever)</div>
                  <p className="mt-0.5 text-xs leading-relaxed text-amber-800/90">
                    {p.outcomeSignals.map((d) => `${d.theme} (${d.lift.toFixed(1)}×)`).join(', ')} also shows up disproportionately in 1–3★ reviews — guests
                    signalling eroding loyalty. But that’s an <span className="font-semibold">outcome</span> of the operational drivers, not something a manager fixes directly.
                  </p>
                  {(() => {
                    const corr = p.outcomeCorrelations.find((c) => p.outcomeSignals.some((s) => s.theme === c.outcome))
                    const top = corr?.drivers.filter((d) => d.lift >= 1.2).slice(0, 3) || []
                    if (!top.length) return null
                    return (
                      <p className="mt-1.5 text-xs leading-relaxed text-amber-900">
                        <span className="font-semibold">Where it comes from:</span> brand-wide, loyalty erosion travels most with{' '}
                        {top.map((d, i) => <span key={d.theme}>{i > 0 ? ', ' : ''}<span className="font-medium">{d.theme}</span> ({d.lift.toFixed(1)}×)</span>)}
                        {' '}— prioritize those to protect loyalty. <span className="text-amber-700/80">(brand-level, n={corr!.n} loyalty-citing 1–3★ reviews; directional)</span>
                      </p>
                    )
                  })()}
                </div>
              )}
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
                      <th className="px-3 py-2 font-semibold">Worst-ranked issue (vs all outlets)</th>
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
                        <td className="px-3 py-2 text-gray-700">
                          {o.topIssue ? o.topIssue.theme : <span className="text-gray-400">no single weakness</span>}
                          {o.weaknessCount > 1 && <span className="ml-1 text-xs text-gray-400">+{o.weaknessCount - 1} more</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* By issue — outlets to focus on per theme (mirrors the deck) */}
              {p.actionableThemes.some((t) => (p.themeFocus[t] || []).length > 0) && (
                <>
                  <h2 className="mt-7 text-sm font-bold text-gray-700">By issue — which outlets to focus on</h2>
                  <p className="mt-0.5 text-xs text-gray-500">For each operational theme, the outlets in the bottom quartile (worst performers vs all locations).</p>
                  <div className="mt-2 space-y-3">
                    {p.actionableThemes
                      .map((t) => ({ theme: t, focus: p.themeFocus[t] || [] }))
                      .filter((x) => x.focus.length > 0)
                      .sort((a, b) => b.focus.length - a.focus.length)
                      .map(({ theme, focus }) => (
                        <div key={theme} className="rounded-lg border border-gray-200 p-3">
                          <div className="text-sm font-semibold text-gray-900">{theme} <span className="text-xs font-normal text-gray-400">· {focus.length} outlet{focus.length === 1 ? '' : 's'} to focus on</span></div>
                          <div className="mt-1 text-xs leading-relaxed text-gray-600">
                            {focus.slice(0, 8).map((o, i) => (
                              <span key={o.placeId}>
                                {i > 0 ? ', ' : ''}
                                <Link href={`/analyze/${datasetId}/outlet-report?outlet=${o.placeId}`} className="text-gray-700 underline decoration-gray-300 hover:decoration-gray-500">{locOnly(o.label)}</Link>
                                <span className="text-gray-400"> ({pct1(o.problemRate)})</span>
                              </span>
                            ))}
                            {focus.length > 8 && <span className="text-gray-400"> +{focus.length - 8} more</span>}
                          </div>
                          {(p.themeExemplars[theme] || []).length > 0 && (
                            <div className="mt-1.5 text-xs text-emerald-700">
                              <span className="font-medium">Learn from:</span> {p.themeExemplars[theme].slice(0, 5).map((e) => locOnly(e.label)).join(', ')}
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                </>
              )}

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
