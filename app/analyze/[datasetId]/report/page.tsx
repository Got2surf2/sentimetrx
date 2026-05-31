// app/analyze/[datasetId]/report/page.tsx
//
// Recording report (§ 5.4). Server-renders the auth shell + loads everything
// the tabs need — recording row, files, transcript (with segments), and the
// full extraction list. Hands off to ReportClient for the tab UI.
//
// Route is keyed by dataset_id rather than recording_id because /analyze
// already operates in dataset-id space; the recording is reverse-resolved
// via recordings.dataset_id.

import { redirect, notFound } from 'next/navigation'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getUserContext } from '@/lib/userContext'
import TopNav from '@/components/nav/TopNav'
import ReportClient, { type ReportData } from './ReportClient'
import type {
  RecordingRow,
  RecordingFileRow,
  RecordingTranscriptRow,
  RecordingExtractionRow,
} from '@/lib/recordings/types'

export const dynamic = 'force-dynamic'

export default async function RecordingReportPage({ params }: { params: { datasetId: string } }) {
  const supabase = createClient()
  const ctx = await getUserContext(supabase)
  if (!ctx) redirect('/login')
  if (!ctx.features.analyze) redirect('/dashboard')

  const service = createServiceRoleClient()

  // 1. Dataset must exist and belong to the caller's org (or admin-org sees all).
  const { data: dataset } = await service
    .from('datasets')
    .select('id, org_id, name, source')
    .eq('id', params.datasetId)
    .single()
  if (!dataset) notFound()
  if (!ctx.isAdminOrg && dataset.org_id !== ctx.orgId) notFound()
  if (dataset.source !== 'recording') {
    // Datasets from other sources don't have a recording report; bounce to the
    // standard dataset page where TextMine / Charts / Stats live.
    redirect(`/analyze/${params.datasetId}`)
  }

  // 2. Reverse-resolve the recording.
  const { data: recRow } = await service
    .from('recordings')
    .select('*')
    .eq('dataset_id', params.datasetId)
    .eq('org_id', dataset.org_id)
    .single()
  if (!recRow) notFound()
  const recording = recRow as unknown as RecordingRow

  // 3. Fetch the three side rows in parallel.
  const [filesRes, transcriptRes, extractionsRes] = await Promise.all([
    service
      .from('recording_files')
      .select('*')
      .eq('recording_id', recording.id)
      .eq('org_id', recording.org_id)
      .order('sort_order', { ascending: true }),
    service
      .from('recording_transcripts')
      .select('*')
      .eq('recording_id', recording.id)
      .eq('org_id', recording.org_id)
      .maybeSingle(),
    service
      .from('recording_extractions')
      .select('*')
      .eq('recording_id', recording.id)
      .eq('org_id', recording.org_id)
      .order('sort_order', { ascending: true }),
  ])

  const files = (filesRes.data ?? []) as unknown as RecordingFileRow[]
  const transcript = (transcriptRes.data ?? null) as unknown as RecordingTranscriptRow | null
  const extractions = (extractionsRes.data ?? []) as unknown as RecordingExtractionRow[]

  const data: ReportData = {
    recording,
    files,
    transcript,
    extractions,
    isOwner: recording.created_by === ctx.userId,
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <TopNav
        logoUrl={ctx.navProps.logoUrl || ''}
        orgName={ctx.navProps.orgName || ''}
        isAdmin={ctx.navProps.isAdmin}
        userEmail={ctx.navProps.userEmail}
        fullName={ctx.navProps.fullName || ''}
        features={ctx.navProps.features}
        analyzeEnabled={true}
        campaignsEnabled={!!ctx.features.campaigns}
        currentPage="analyze"
      />
      <main className="pt-20 px-4 pb-12 max-w-6xl mx-auto">
        <ReportClient data={data} />
      </main>
    </div>
  )
}
