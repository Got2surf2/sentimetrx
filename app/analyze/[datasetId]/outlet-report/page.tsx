// app/analyze/[datasetId]/outlet-report/page.tsx
//
// One-page "outlet vs. peer group" summary report. For a multi-location brand,
// picks one outlet and shows its star rating + percentile rank against the
// brand's other outlets, plus the service themes where it excels / needs work
// relative to peers (sub-level taxonomy sentiment). See lib/outletReport.ts.

import { notFound, redirect } from 'next/navigation'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getUserContext } from '@/lib/userContext'
import { computeOutletReportWithPredictor } from '@/lib/outletReport'
import OutletPicker from './OutletPicker'
import OutletReportTabs from './OutletReportTabs'
import OutletSnapshotView from './OutletSnapshotView'
import OutletActionPlanSection from './OutletActionPlanSection'
import PrintButton from './PrintButton'
import AnalyticsNav from '../AnalyticsNav'

export const dynamic = 'force-dynamic'

export default async function OutletReportPage(props: {
  params: Promise<{ datasetId: string }>
  searchParams: Promise<{ outlet?: string }>
}) {
  const { datasetId } = await props.params
  const { outlet } = await props.searchParams

  const supabase = await createClient()
  const ctx = await getUserContext(supabase)
  if (!ctx) redirect('/login')

  // Org-scope the dataset (admin org sees all).
  const service = createServiceRoleClient()
  const { data: ds } = await service.from('datasets').select('org_id').eq('id', datasetId).maybeSingle()
  if (!ds) notFound()
  if (!ctx.isAdminOrg && ds.org_id !== ctx.orgId) notFound()

  const { report, predictor } = await computeOutletReportWithPredictor(datasetId, outlet)
  const s = report.selected
  const levers = s ? (predictor.outletLevers[s.placeId] || []) : []
  const strengths = s ? (predictor.outletStrengths[s.placeId] || []) : []
  const summary = s ? predictor.outletSummaries.find((o) => o.placeId === s.placeId) : undefined

  // Interactive what-if input for the selected outlet (only its own data ships to the client).
  const wi = s ? predictor.outletWhatIf[s.placeId] : undefined
  const whatIf = wi && summary ? {
    themes: predictor.actionableThemes,
    reviews13: wi.reviews13,
    currentRate: wi.currentRate,
    medianRate: predictor.themeTargets.map((t) => t.medianRate),
    bestRate: predictor.themeTargets.map((t) => t.bestRate),
    worstRate: predictor.themeTargets.map((t) => t.worstRate),
    totalReviews: wi.totalReviews,
    ratedReviews: wi.ratedReviews,
    lowCount: wi.lowCount,
    lowRate: wi.lowRate,
    avg: wi.avg,
    detractorAvg: wi.detractorAvg,
    happyAvg: wi.happyAvg,
    otherRatings: predictor.outletSummaries.filter((o) => o.placeId !== s!.placeId).map((o) => o.rating ?? 0),
    currentRank: summary.ratingRank,
    outletCount: predictor.outletSummaries.length,
    trends: predictor.actionableThemes.map((t) => predictor.themeTrends[t] || null),
    trendBasis: predictor.trendBasis,
  } : null

  return (
    <div className="min-h-screen bg-gray-100 py-8 print:bg-white print:py-0">
      <div className="mx-auto max-w-4xl px-4 print:max-w-none print:px-0">
        <div className="print:hidden">
          <AnalyticsNav datasetId={datasetId} active="outlet" outlet={s?.placeId} action={
            s ? (
              <div className="flex items-center gap-2">
                <a href={`/api/datasets/${datasetId}/outlet-plan-deck?outlet=${s.placeId}`} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50">GM deck (PPTX)</a>
                <PrintButton />
              </div>
            ) : undefined
          } />
          <div className="mb-4 mt-2 flex items-center justify-between">
            <OutletPicker outlets={report.outlets} selected={s?.placeId || ''} />
          </div>
        </div>

        {!s ? (
          <div className="rounded-xl bg-white p-10 text-center text-gray-500 shadow">
            No outlet data found for this dataset.
          </div>
        ) : (
          <>
            {/* Printable snapshot (page 1 of the export) */}
            <div className="rounded-xl bg-white p-8 shadow-sm ring-1 ring-gray-200 print:p-6 print:shadow-none print:ring-0">
              <OutletSnapshotView
                brand={report.brand} name={s.name} address={s.address}
                reviews={s.reviews} rating={s.rating} rank={s.rank} outletCount={s.outletCount}
                networkSize={report.outlets.length} snapshot={s.snapshot}
              />
            </div>

            {/* AI action plan (page 2 of the export) — lazily generated + cached. */}
            <OutletActionPlanSection key={s.placeId} datasetId={datasetId} outlet={s.placeId} outletName={s.name} reviews={s.reviews} themeTable={s.snapshot.themeTable} />

            {/* Deeper peer-relative analysis — screen only, not part of the export. */}
            <div className="mt-6 rounded-xl bg-white p-8 shadow-sm ring-1 ring-gray-200 print:hidden">
              <h2 className="text-sm font-bold text-gray-700">Deeper analysis <span className="font-normal text-gray-400">— how this location compares to its peers</span></h2>
              <OutletReportTabs
                selected={s} levers={levers} strengths={strengths} summary={summary} model={predictor.model}
                brandDriver={predictor.brandLevers[0]?.theme || null}
                outletCount={predictor.outletSummaries.length}
                whatIf={whatIf}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
