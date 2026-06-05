// app/recordings/page.tsx
//
// Town Hall home (§ 5.5) — the top-level product landing. Lists past Town Halls
// (per-org, server-side; scoping mirrors § 4.8: isAdminOrg → all orgs, isAdmin →
// own org, regular user → created_by=self), a prominent "New Town Hall" CTA, and
// a materials-guidance panel. Click a row → status (in-progress/failed) or
// report (complete). Internal slug stays `recordings`; UI label is "Town Hall".

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getUserContext } from '@/lib/userContext'
import TopNav from '@/components/nav/TopNav'
import RecordingsListClient from './RecordingsListClient'

export const dynamic = 'force-dynamic'

interface Row {
  id: string
  org_id: string
  created_by: string
  dataset_id: string | null
  name: string
  session_type: string
  meeting_date: string | null
  status: string
  cost_cents: number
  source_duration_sec: number | null
  created_at: string
  completed_at: string | null
  owner_name: string | null
  org_name: string | null
  favorited: boolean
  entities_reviewed: boolean
  has_edits: boolean
  shared: boolean
  qa_pair_count: number
  media_file_count: number
  slide_file_count: number
}

export default async function RecordingsListPage() {
  const supabase = await createClient()
  const ctx = await getUserContext(supabase)
  if (!ctx) redirect('/login')
  if (!ctx.features.recordings) redirect('/dashboard')

  const service = createServiceRoleClient()

  let q = service
    .from('recordings')
    .select(
      'id, org_id, created_by, dataset_id, name, session_type, meeting_date, status, ' +
      'cost_cents, source_duration_sec, created_at, completed_at, share_enabled, entity_map, ' +
      'organizations:org_id(name)',
    )
    .order('created_at', { ascending: false })
    .limit(200)

  if (!ctx.isAdminOrg) {
    if (ctx.isAdmin) {
      q = q.eq('org_id', ctx.orgId)
    } else {
      q = q.eq('org_id', ctx.orgId).eq('created_by', ctx.userId)
    }
  }

  const { data, error } = await q

  // recordings.created_by → auth.users, which PostgREST can't embed; look the
  // owner names up from public.users by id and map them in.
  const ownerIds = Array.from(new Set((data ?? []).map((r: any) => r.created_by).filter(Boolean)))
  const ownerById = new Map<string, { full_name: string | null; email: string | null }>()
  if (ownerIds.length > 0) {
    const { data: owners } = await service.from('users').select('id, full_name, email').in('id', ownerIds)
    for (const u of (owners ?? []) as any[]) {
      ownerById.set(u.id as string, { full_name: u.full_name ?? null, email: u.email ?? null })
    }
  }

  const ids = (data ?? []).map((r: any) => r.id)

  // Which recordings have a human-edited Q&A pair (§3.5d) → the "Polished edits"
  // lifecycle step. One JSONB query across the loaded recordings' extractions.
  const editedIds = new Set<string>()
  if (ids.length > 0) {
    const { data: edits } = await service
      .from('recording_extractions')
      .select('recording_id')
      .in('recording_id', ids)
      .not('payload->>edited_at', 'is', null)
    for (const e of (edits ?? []) as any[]) editedIds.add(e.recording_id as string)
  }

  // Per-recording Q&A pair count for the card meta row — same filter the report
  // header + GET /api/recordings/[id] use (unit_type='qa_pair'; excludes
  // action_item / quote rows) so the card and the report agree.
  const qaCountById = new Map<string, number>()
  if (ids.length > 0) {
    const { data: pairs } = await service
      .from('recording_extractions')
      .select('recording_id')
      .in('recording_id', ids)
      .eq('unit_type', 'qa_pair')
    for (const p of (pairs ?? []) as any[]) qaCountById.set(p.recording_id, (qaCountById.get(p.recording_id) ?? 0) + 1)
  }

  // Per-recording file counts, split by role (media = audio/video, slides = PDF
  // deck) so the card can show "2 media · 1 slides".
  const mediaCountById = new Map<string, number>()
  const slideCountById = new Map<string, number>()
  if (ids.length > 0) {
    const { data: files } = await service
      .from('recording_files')
      .select('recording_id, file_role')
      .in('recording_id', ids)
    for (const f of (files ?? []) as any[]) {
      const m = f.file_role === 'slides' ? slideCountById : mediaCountById
      m.set(f.recording_id, (m.get(f.recording_id) ?? 0) + 1)
    }
  }

  // The caller's favorited recordings (per-user) → hydrate the card star state.
  const favIds = new Set<string>()
  {
    const { data: favs } = await service
      .from('user_favorites')
      .select('resource_id')
      .eq('user_id', ctx.userId)
      .eq('resource_type', 'recording')
    for (const f of (favs ?? []) as any[]) favIds.add(f.resource_id as string)
  }

  // Platform-admin only: the active orgs a recording can be transferred to.
  let allOrgs: { id: string; name: string }[] = []
  if (ctx.isAdminOrg) {
    const { data: orgs } = await service
      .from('organizations')
      .select('id, name, status')
      .neq('status', 'suspended')
      .order('name')
    allOrgs = (orgs ?? []).filter((o: any) => o.id !== ctx.orgId).map((o: any) => ({ id: o.id, name: o.name }))
  }

  const rows: Row[] = (data ?? []).map((r: any) => ({
    id: r.id,
    org_id: r.org_id,
    created_by: r.created_by,
    dataset_id: r.dataset_id,
    name: r.name,
    session_type: r.session_type,
    meeting_date: r.meeting_date,
    status: r.status,
    cost_cents: r.cost_cents ?? 0,
    source_duration_sec: r.source_duration_sec,
    created_at: r.created_at,
    completed_at: r.completed_at,
    owner_name: ownerById.get(r.created_by)?.full_name || ownerById.get(r.created_by)?.email || null,
    org_name: r.organizations?.name || null,
    favorited: favIds.has(r.id),
    // §5.5 lifecycle checklist flags.
    entities_reviewed: !!r.entity_map?.reviewed_at,
    has_edits: editedIds.has(r.id),
    shared: !!r.share_enabled,
    qa_pair_count: qaCountById.get(r.id) ?? 0,
    media_file_count: mediaCountById.get(r.id) ?? 0,
    slide_file_count: slideCountById.get(r.id) ?? 0,
  }))

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
        <header className="flex items-baseline justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Town Hall</h1>
            <p className="text-sm text-gray-500 mt-1">
              {rows.length === 1 ? '1 Town Hall' : `${rows.length} Town Halls`}
              {ctx.isAdminOrg ? ' across all orgs' : ctx.isAdmin ? ' in your org' : ' you own'}
            </p>
          </div>
          <Link
            href="/recordings/new"
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ backgroundColor: '#E8632A' }}
          >
            + New Town Hall
          </Link>
        </header>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 mb-4">
            {error.message}
          </div>
        )}

        <RecordingsListClient rows={rows} showOrg={ctx.isAdminOrg} isAdmin={ctx.isAdminOrg} allOrgs={allOrgs} />
      </main>
    </div>
  )
}

