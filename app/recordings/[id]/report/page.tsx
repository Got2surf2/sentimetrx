// app/recordings/[id]/report/page.tsx
//
// Town Hall report (§ 5.4). Server-renders the auth shell + loads everything the
// tabs need — recording row, files, transcript (with segments), and the full
// extraction list. Hands off to ReportClient for the tab UI.
//
// Keyed by recording_id (Town Hall is its own product). The derived dataset
// remains the under-the-hood analytics view, reachable via "Open in Analytics".

import { redirect, notFound } from 'next/navigation'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getUserContext } from '@/lib/userContext'
import TopNav from '@/components/nav/TopNav'
import { isAnalysisConfigDrifted } from '@/lib/recordings/configVersion'
import ReportClient, { type ReportData } from './ReportClient'
import type {
  RecordingRow,
  RecordingFileRow,
  RecordingTranscriptRow,
  RecordingExtractionRow,
} from '@/lib/recordings/types'

export const dynamic = 'force-dynamic'

export default async function RecordingReportPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = await createClient()
  const ctx = await getUserContext(supabase)
  if (!ctx) redirect('/login')
  if (!ctx.features.recordings) redirect('/dashboard')

  const service = createServiceRoleClient()

  // Resolve the recording directly by id. Multi-tenancy: service-role lookup
  // must pair id with org_id for non-admins (admin-org sees all) — 404 on cross-org.
  const { data: recRow } = await service
    .from('recordings')
    .select('*')
    .eq('id', params.id)
    .single()
  if (!recRow) notFound()
  if (!ctx.isAdminOrg && (recRow as { org_id: string }).org_id !== ctx.orgId) notFound()
  const recording = recRow as unknown as RecordingRow

  // 3. Fetch the side rows + the org's agents (for the brand/agent link) in parallel.
  const [filesRes, transcriptRes, extractionsRes, agentsRes] = await Promise.all([
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
    service
      .from('agents')
      .select('id, name')
      .eq('org_id', recording.org_id)
      .order('name'),
  ])

  const files = (filesRes.data ?? []) as unknown as RecordingFileRow[]
  const transcript = (transcriptRes.data ?? null) as unknown as RecordingTranscriptRow | null
  const extractions = (extractionsRes.data ?? []) as unknown as RecordingExtractionRow[]
  const agents = ((agentsRes.data ?? []) as Array<{ id: string; name: string | null }>).map(a => ({ id: a.id, name: a.name || 'Untitled' }))

  // Drift: did the analysis-shaping setup change since the last analysis? → banner.
  const configDrifted = await isAnalysisConfigDrifted(
    service, recording.id, recording.org_id,
    recording as unknown as Record<string, unknown>,
    recording.analyzed_config_version,
  )

  const data: ReportData = {
    recording,
    files,
    transcript,
    extractions,
    agents,
    isOwner: recording.created_by === ctx.userId,
    configDrifted,
    // "Open in Analytics" cross-link — only when the dataset mirror exists AND
    // the user actually has Analytics (graceful degradation when it's off).
    analyticsDatasetId: ctx.features.analyze ? (recording.dataset_id ?? null) : null,
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
        campaignsEnabled={!!ctx.features.campaigns}
        currentPage="recordings"
      />
      <main className="pt-20 px-4 pb-12 max-w-6xl mx-auto">
        <ReportClient data={data} />
      </main>
    </div>
  )
}
