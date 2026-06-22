// app/analyze/[datasetId]/outlet-report/page.tsx
//
// One-page "outlet vs. peer group" summary report. For a multi-location brand,
// picks one outlet and shows its star rating + percentile rank against the
// brand's other outlets, plus the service themes where it excels / needs work
// relative to peers (sub-level taxonomy sentiment). See lib/outletReport.ts.

import { notFound, redirect } from 'next/navigation'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getUserContext } from '@/lib/userContext'
import { computeOutletReport } from '@/lib/outletReport'
import OutletPicker from './OutletPicker'
import PrintButton from './PrintButton'
import OutletReportTabs from './OutletReportTabs'

export const dynamic = 'force-dynamic'

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

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

  const report = await computeOutletReport(datasetId, outlet)
  const s = report.selected

  return (
    <div className="min-h-screen bg-gray-100 py-8 print:bg-white print:py-0">
      <div className="mx-auto max-w-4xl px-4">
        <div className="mb-4 flex items-center justify-between print:hidden">
          <OutletPicker outlets={report.outlets} selected={s?.placeId || ''} />
          <PrintButton />
        </div>

        {!s ? (
          <div className="rounded-xl bg-white p-10 text-center text-gray-500 shadow">
            No outlet data found for this dataset.
          </div>
        ) : (
          <div className="rounded-xl bg-white p-8 shadow-sm ring-1 ring-gray-200 print:shadow-none print:ring-0">
            {/* Header */}
            <div className="flex items-start justify-between border-b border-gray-200 pb-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-widest text-gray-400">{report.brand}</div>
                <h1 className="mt-1 text-2xl font-bold text-gray-900">{s.name}</h1>
                <div className="text-sm text-gray-500">{s.location} · {s.reviews.toLocaleString()} reviews</div>
              </div>
              <div className="text-right">
                <div className="text-xs font-medium uppercase tracking-wide text-gray-400">Outlet performance vs. peer group</div>
                <div className="mt-1 text-sm text-gray-500">{s.outletCount} outlets compared</div>
              </div>
            </div>

            {/* KPI row */}
            <div className="mt-5 grid grid-cols-2 gap-4">
              <div className="rounded-lg bg-gray-50 p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-gray-400">Star rating</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-gray-900">{s.rating.toFixed(2)}</span>
                  <span className={`text-sm font-semibold ${s.ratingDelta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {s.ratingDelta >= 0 ? '+' : ''}{s.ratingDelta.toFixed(2)} vs peers
                  </span>
                </div>
                <div className="text-xs text-gray-500">peer average {s.chainRating.toFixed(2)}</div>
              </div>
              <div className="rounded-lg bg-gray-50 p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-gray-400">Peer rank</div>
                <div className="mt-1 text-3xl font-bold text-gray-900">#{s.rank}<span className="text-lg font-medium text-gray-400"> / {s.outletCount}</span></div>
                <div className="text-xs text-gray-500">{ordinal(s.percentile)} percentile</div>
              </div>
            </div>

            {/* Themes / Dimensions / Summary tabs (client) */}
            <OutletReportTabs selected={s} />
          </div>
        )}
      </div>
    </div>
  )
}
