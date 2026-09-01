// app/analyze/[datasetId]/outlet-report/page.tsx
//
// One-page "outlet vs. peer group" summary report. For a multi-location brand,
// picks one outlet and shows its star rating + percentile rank against the
// brand's other outlets, plus the service themes where it excels / needs work
// relative to peers (sub-level taxonomy sentiment). See lib/outletReport.ts.

import { notFound, redirect } from 'next/navigation'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getUserContext } from '@/lib/userContext'
import { computeOutletReportWithPredictor, computeHierarchyReport } from '@/lib/outletReport'
import { hierarchyLevels, crumbsForPath } from '@/lib/hierarchy'
import { outletReportingOn } from '@/lib/resolveOrg'
import type { SchemaConfig } from '@/lib/analyzeTypes'
import OutletPicker from './OutletPicker'
import OutletReportTabs from './OutletReportTabs'
import OutletSnapshotView from './OutletSnapshotView'
import OutletDimensionsView from './OutletDimensionsView'
import OutletActionPlanSection from './OutletActionPlanSection'
import type { PdfPayloadProps } from './DownloadPdfButton'
import DownloadPdfButton from './DownloadPdfButton'
import DownloadRungPdfButton from './DownloadRungPdfButton'
import type { HierarchyPdfPayload } from '@/lib/outletPdfPayload'
import { OutletPlanProvider } from './OutletPlanContext'
import AnalyticsNav from '../AnalyticsNav'
import { HierarchyBreadcrumb, HierarchyChildren, HierarchyOutlets } from './HierarchyNav'

export const dynamic = 'force-dynamic'

export default async function OutletReportPage(props: {
  params: Promise<{ datasetId: string }>
  searchParams: Promise<{ outlet?: string; node?: string | string[] }>
}) {
  const { datasetId } = await props.params
  const { outlet, node } = await props.searchParams
  // Repeated ?node= params, in order — see HierarchyNav for why not a delimiter.
  const nodePath = node == null ? [] : Array.isArray(node) ? node : [node]

  const supabase = await createClient()
  const ctx = await getUserContext(supabase)
  if (!ctx) redirect('/login')

  // Org-scope the dataset (admin org sees all).
  const service = createServiceRoleClient()
  const { data: ds } = await service.from('datasets').select('org_id').eq('id', datasetId).maybeSingle()
  if (!ds) notFound()
  if (!ctx.isAdminOrg && ds.org_id !== ctx.orgId) notFound()

  // A dataset whose schema designates ≥2 hierarchy levels opens at the rolled-up
  // Network view and drills down; picking a location switches to the per-outlet
  // deep-dive below. Datasets without a hierarchy are untouched.
  const { data: stateRow } = await service.from('dataset_state').select('schema_config').eq('dataset_id', datasetId).maybeSingle()

  // Outlet reporting is an explicit capability (2026-08-18): the org feature or
  // this dataset's Schema-tab toggle. Enforced HERE as well as on the nav pill —
  // a hidden pill that still leaves the URL reachable is not a gate.
  if (!outletReportingOn(ctx.features, stateRow?.schema_config as SchemaConfig | null)) notFound()

  const schemaFields = (stateRow?.schema_config as SchemaConfig | null)?.fields
  const levels = hierarchyLevels(schemaFields)
  const hasHierarchy = levels.length >= 2

  if (hasHierarchy && !outlet) {
    const h = await computeHierarchyReport(datasetId, schemaFields, nodePath)
    if (!h) notFound()
    // The composed-PDF payload — everything the page renders below, serialized
    // for DownloadRungPdfButton to post back (POST-the-page's-data contract).
    const rungPdfPayload: HierarchyPdfPayload = {
      brand: h.brand, name: h.name, levelLabel: h.levelLabel, childLevelLabel: h.childLevelLabel,
      crumbs: h.crumbs.map((c) => c.label),
      reviews: h.reviews, rating: h.rating, outletCount: h.outletCount,
      networkOutlets: h.networkOutlets, strayOutlets: h.strayOutlets,
      snapshot: h.snapshot,
      children: h.children.map((c) => ({ key: c.key, outlets: c.outlets, reviews: c.reviews, rating: c.rating })),
      outlets: h.outlets.map((o) => ({ label: o.label, sublabel: o.sublabel, reviews: o.reviews })),
    }
    return (
      <div className="min-h-screen bg-gray-100 py-8 print:bg-white print:py-0">
        <div className="mx-auto max-w-4xl px-4 print:max-w-none print:px-0">
          <div className="print:hidden">
            <AnalyticsNav datasetId={datasetId} active="outlet" action={<DownloadRungPdfButton datasetId={datasetId} payload={rungPdfPayload} />} />
            <div className="mb-4 mt-2">
              <HierarchyBreadcrumb datasetId={datasetId} crumbs={h.crumbs} />
            </div>
          </div>

          <div className="rounded-xl bg-white p-8 shadow-sm ring-1 ring-gray-200 print:p-6 print:shadow-none print:ring-0">
            <OutletSnapshotView
              brand={h.brand} name={h.name} address=""
              reviews={h.reviews} rating={h.rating}
              rank={0} outletCount={h.outletCount} networkSize={h.networkOutlets}
              snapshot={h.snapshot}
              unitLabel={h.levelLabel}
              fleetEmptySub={h.path.length === 0 ? 'Network total — no peer group' : 'Not enough peers to rank'}
              subtitle={<>
                {h.outletCount.toLocaleString()} location{h.outletCount === 1 ? '' : 's'} · {h.reviews.toLocaleString()} Google reviews
                {h.snapshot.dateRange ? ` (${h.snapshot.dateRange})` : ''} · full {h.networkOutlets}-store network
              </>}
            />

            <div className="mt-7 border-t border-gray-200 pt-6 print:break-inside-avoid">
              {h.childLevelLabel
                ? <HierarchyChildren datasetId={datasetId} childLevelLabel={h.childLevelLabel} nodes={h.children} networkRating={h.rating} />
                : <HierarchyOutlets datasetId={datasetId} path={h.path} outlets={h.outlets} />}
            </div>

            {h.strayOutlets > 0 && (
              <p className="mt-4 text-xs text-amber-700 print:hidden">
                ⚠ {h.strayOutlets} location{h.strayOutlets === 1 ? '' : 's'} had rows disagreeing on their{' '}
                {levels.map((l) => l.label).join(' / ')} — each is counted under its most common value. Check those columns for typos.
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

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

  // Everything the composed PDF needs, assembled here because this is where it is
  // already computed. The export POSTs it straight back instead of re-running the
  // full dataset scan (lib/outletPdfPayload.ts) — typed against the builder's
  // contract so the two can't drift.
  const pdfPayload: PdfPayloadProps | null = s ? {
    outlet: s.placeId,
    brand: report.brand,
    networkSize: report.outlets.length,
    outletCount: predictor.outletSummaries.length,
    selected: s,
    levers, strengths,
    summary: summary || null,
    model: predictor.model,
    brandDrivers: predictor.brandLevers.map((d) => d.theme),
    whatIf,
  } : null

  // One provider owns the action-plan fetch for the whole page: the section below
  // displays it and the Download PDF button in the nav posts it back, so the
  // export never generates a second one. Keyed by outlet, so switching locations
  // can't carry a stale plan into the next download.
  const body = (
    <>
      <div className="print:hidden">
        {/* The "GM deck (PPTX)" link was removed 2026-08-18 (owner). It was the
            secondary export kept when print became the primary one in July;
            two export buttons offering different documents from one page was
            the confusion, not a feature. The route and lib/pptx/outletPlanDeck
            still exist but are now unreferenced — delete deliberately. */}
        <AnalyticsNav datasetId={datasetId} active="outlet" outlet={s?.placeId} action={
          pdfPayload ? <DownloadPdfButton datasetId={datasetId} payload={pdfPayload} /> : undefined
        } />
        {/* Arrived from a rolled-up rung — keep the trail so the way back up
            is one click, and the location reads as part of its branch. */}
        {hasHierarchy && nodePath.length > 0 && s && (
          <div className="mt-2">
            <HierarchyBreadcrumb
              datasetId={datasetId}
              crumbs={crumbsForPath(nodePath, levels)}
              current={{ label: s.name, levelLabel: 'Location' }}
            />
          </div>
        )}
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
          <OutletActionPlanSection outletName={s.name} reviews={s.reviews} themeTable={s.snapshot.themeTable} />

          {/* Dimensions vs the network (page 3 of the export).
              Its OWN card, and PRINTED — owner call 2026-08-18. It is the
              sharpest per-location read on the page ("how does this location
              compare to the other N on each dimension"), so burying it inside
              the screen-only "Deeper analysis" block made the most useful
              thing the least visible one.
              It stays OUT of the snapshot card above: that block is
              deliberately ABSOLUTE (GM-facing "how am I doing"), this is
              RELATIVE to the network. A titled section of its own keeps that
              separation legible instead of folding the two together. */}
          <div className="mt-6 rounded-xl bg-white p-8 shadow-sm ring-1 ring-gray-200 print:mt-0 print:break-before-page print:p-6 print:shadow-none print:ring-0">
            <h2 className="text-sm font-bold text-gray-700">
              Dimensions <span className="font-normal text-gray-400">— how this location compares to the network</span>
            </h2>
            <OutletDimensionsView block={s.dimensions} outletCount={s.outletCount} />
          </div>

          {/* Deeper peer-relative analysis — screen only, not part of the export. */}
          <div className="mt-6 rounded-xl bg-white p-8 shadow-sm ring-1 ring-gray-200 print:hidden">
            <h2 className="text-sm font-bold text-gray-700">Deeper analysis <span className="font-normal text-gray-400">— how this location compares to its peers</span></h2>
            <OutletReportTabs
              selected={s} levers={levers} strengths={strengths} summary={summary} model={predictor.model}
              brandDrivers={predictor.brandLevers.map((d) => d.theme)}
              outletCount={predictor.outletSummaries.length}
              whatIf={whatIf}
            />
          </div>
        </>
      )}
    </>
  )

  return (
    <div className="min-h-screen bg-gray-100 py-8 print:bg-white print:py-0">
      <div className="mx-auto max-w-4xl px-4 print:max-w-none print:px-0">
        {s ? (
          <OutletPlanProvider
            key={s.placeId}
            datasetId={datasetId}
            outlet={s.placeId}
            reviews={s.reviews}
            themeTable={s.snapshot.themeTable}
          >
            {body}
          </OutletPlanProvider>
        ) : body}
      </div>
    </div>
  )
}
