// app/recordings/[id]/setup/page.tsx
//
// Edit-anytime Setup editor (§ 5.2 / edit-anytime). Reachable at ANY lifecycle
// stage — the same shared form the create wizard uses, in edit mode. Loads the
// recording (org-scoped) + org agents/members, maps the row into the form's
// initial values, and PATCHes /api/recordings/[id] on save.

import { redirect, notFound } from 'next/navigation'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getUserContext } from '@/lib/userContext'
import TopNav from '@/components/nav/TopNav'
import SubHeader from '@/components/nav/SubHeader'
import RecordingSetupForm, { type RecordingSetupInitial } from '@/components/recordings/RecordingSetupForm'
import { isAnalysisConfigDrifted } from '@/lib/recordings/configVersion'
import type { RecordingRow, QaSetupInputs } from '@/lib/recordings/types'

export const dynamic = 'force-dynamic'

export default async function RecordingSetupPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const supabase = await createClient()
  const ctx = await getUserContext(supabase)
  if (!ctx) redirect('/login')
  if (!ctx.features.recordings) redirect('/dashboard')

  const service = createServiceRoleClient()

  // Resolve the recording directly by id. Multi-tenancy: pair id with org_id for
  // non-admins (admin-org sees all) — 404 on cross-org.
  const { data: recRow } = await service
    .from('recordings')
    .select('*')
    .eq('id', params.id)
    .single()
  if (!recRow) notFound()
  if (!ctx.isAdminOrg && (recRow as { org_id: string }).org_id !== ctx.orgId) notFound()
  const recording = recRow as unknown as RecordingRow

  // Org agents (brand/agent link) + members (analyst picker) — same as /new — and
  // the project documents already attached (deck + briefs) for the documents pane.
  // Admin orgs may link an agent from ANY org (e.g. a pilot agent in a client
  // org); non-admins see only the recording's org. Mirrors /new + /api/bots.
  const agentQuery = ctx.isAdminOrg
    ? service.from('agents').select('id, name').order('name')
    : service.from('agents').select('id, name').eq('org_id', recording.org_id).order('name')
  const [agentsRes, membersRes, docsRes] = await Promise.all([
    agentQuery,
    service.from('users').select('id, full_name, email').eq('org_id', recording.org_id).order('full_name'),
    service.from('recording_files')
      .select('id, original_filename, mime_type, size_bytes, file_role')
      .eq('recording_id', recording.id).eq('org_id', recording.org_id)
      .in('file_role', ['slides', 'document'])
      .order('sort_order', { ascending: true }),
  ])
  const agents = ((agentsRes.data ?? []) as Array<{ id: string; name: string | null }>)
    .map(a => ({ id: a.id, name: a.name || 'Untitled' }))
  const members = ((membersRes.data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>)
    .map(m => ({ id: m.id, name: (m.full_name?.trim()) || m.email || '' }))
    .filter(m => m.name)

  const documents = ((docsRes.data ?? []) as Array<{ id: string; original_filename: string; mime_type: string; size_bytes: number; file_role: 'slides' | 'document' }>)

  // Drift: analysis-shaping setup changed since the last analysis → inform + link.
  const configDrifted = await isAnalysisConfigDrifted(
    service, recording.id, recording.org_id,
    recording as unknown as Record<string, unknown>,
    recording.analyzed_config_version,
  )

  // Map the row into the form's initial values.
  const su = (recording.setup_inputs ?? {}) as Partial<QaSetupInputs>
  const initial: Partial<RecordingSetupInitial> = {
    name: recording.name,
    preset: recording.meeting_profile?.preset_id ?? 'town_hall_qa',
    meetingDate: recording.meeting_date ? recording.meeting_date.slice(0, 10) : '',
    location: recording.location ?? '',
    language: recording.language || 'en',
    panel: (su.panel ?? []).map(p => ({ name: p.name, role: p.role ?? '' })),
    agenda: su.agenda ?? [],
    glossary: (su.glossary ?? []).join('\n'),
    objectivesSummary: recording.objectives?.summary ?? '',
    objectivesQuestions: (recording.objectives?.questions ?? []).join('\n'),
    analysisOrg: recording.analysis_org || 'Datanautix',
    analysts: (recording.analysts ?? []).map(a => a.name),
    confidentiality: recording.confidentiality_class || 'client_confidential',
    asrStrategy: recording.asr_strategy,
    documents,
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
      <SubHeader crumbs={[{ label: 'Town Hall', href: '/recordings' }, ...(recording.name ? [{ label: recording.name }] : []), { label: 'Setup' }]} />
      <main className="pt-28 px-4 pb-12 max-w-5xl mx-auto">
        <RecordingSetupForm
          mode="edit"
          recordingId={recording.id}
          agents={agents}
          members={members}
          initial={initial}
          configDrifted={configDrifted}
        />
      </main>
    </div>
  )
}
