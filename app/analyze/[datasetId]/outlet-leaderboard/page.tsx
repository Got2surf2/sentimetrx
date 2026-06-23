// app/analyze/[datasetId]/outlet-leaderboard/page.tsx
//
// Chain-wide "leaderboard": for each theme and dimension, the top/bottom outlets
// by net-positive rate. This is the INVERSE of the per-outlet report — a brand-
// level view, deliberately NOT a tab inside the single-location report. Reached
// via the "Leaderboard" sub-tab in TextMine. See lib/outletReport.ts.

import { notFound, redirect } from 'next/navigation'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getUserContext } from '@/lib/userContext'
import { computeOutletLeaderboard } from '@/lib/outletReport'
import PrintButton from '../outlet-report/PrintButton'
import AnalyticsNav from '../AnalyticsNav'
import LeaderboardClient from './LeaderboardClient'

export const dynamic = 'force-dynamic'

export default async function OutletLeaderboardPage(props: {
  params: Promise<{ datasetId: string }>
}) {
  const { datasetId } = await props.params

  const supabase = await createClient()
  const ctx = await getUserContext(supabase)
  if (!ctx) redirect('/login')

  // Org-scope the dataset (admin org sees all).
  const service = createServiceRoleClient()
  const { data: ds } = await service.from('datasets').select('org_id, name').eq('id', datasetId).maybeSingle()
  if (!ds) notFound()
  if (!ctx.isAdminOrg && ds.org_id !== ctx.orgId) notFound()

  const lb = await computeOutletLeaderboard(datasetId)

  return (
    <div className="min-h-screen bg-gray-100 py-8 print:bg-white print:py-0">
      <div className="mx-auto max-w-4xl px-4">
        <AnalyticsNav datasetId={datasetId} active="leaderboard" action={<PrintButton />} />

        <div className="rounded-xl bg-white p-8 shadow-sm ring-1 ring-gray-200 print:shadow-none print:ring-0">
          <div className="border-b border-gray-200 pb-4">
            <div className="text-xs font-semibold uppercase tracking-widest text-gray-400">{ds.name || 'Brand'}</div>
            <h1 className="mt-1 text-2xl font-bold text-gray-900">Outlet leaderboard</h1>
            <div className="text-sm text-gray-500">Top &amp; bottom locations per theme and dimension · {lb.outletCount} outlets</div>
          </div>
          <div className="mt-6">
            <LeaderboardClient lb={lb} />
          </div>
        </div>
      </div>
    </div>
  )
}
