// app/analyze/page.tsx
// Server component -- analyze gate + datasets list

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg, effectiveFeatures } from '@/lib/resolveOrg'
import { validateOrgFilter } from '@/lib/orgValidate'
import TopNav from '@/components/nav/TopNav'
import SubHeader from '@/components/nav/SubHeader'
import AnalyzeClient from './AnalyzeClient'
import type { ModuleFeatures } from '@/lib/types'
import type { Dataset, DatasetWithState } from '@/lib/analyzeTypes'

export const dynamic = 'force-dynamic'

// Minimal shapes for the untyped Supabase query rows this page reads.
interface RawDatasetRow {
  id:         string
  org_id:     string
  source:     string | null
  created_by: string | null
  updated_at: string | null
}
interface OrgRow { id: string; name: string; plan?: string }
interface CreatorRow { id: string; full_name: string | null; email: string | null }
interface CollectionRow {
  id:         string
  dataset_id: string
  kind:       string | null
  purpose:    'community' | 'competitive' | 'brand_360' | null
}
interface MemberDatasetRow {
  id:             string
  row_count:      number | null
  updated_at:     string | null
  last_synced_at: string | null
}
interface ThemeModelJson {
  themes?:       unknown[] | null
  themeSource?:  string | null
  source?:       string | null
  themeLibName?: string | null
  libName?:      string | null
}
// Full row shape for the main datasets select — column types come from the
// canonical Dataset interface; studies/dataset_state are to-one joins, so
// Supabase returns objects here (arrays only on to-many).
interface DatasetQueryRow extends Pick<Dataset,
  'id' | 'org_id' | 'name' | 'description' | 'source' | 'study_id' | 'ana_library' |
  'visibility' | 'status' | 'row_count' | 'last_synced_at' | 'created_at' | 'updated_at' | 'created_by'
> {
  brand_collection_id: string | null
  studies:             { name: string | null } | null
  dataset_state:       { theme_model: ThemeModelJson | null } | { theme_model: ThemeModelJson | null }[] | null
}
interface MemberCollectionRow {
  dataset_id:  string
  collections:
    | { dataset_id: string | null; datasets: { name: string | null } | { name: string | null }[] | null }
    | { dataset_id: string | null; datasets: { name: string | null } | { name: string | null }[] | null }[]
    | null
}

export default async function AnalyzePage(props: { searchParams: Promise<{ org?: string }> }) {
  const searchParams = await props.searchParams;
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, org_id, features, organizations(id, name, is_admin_org, logo_url, features)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations)
  const features = effectiveFeatures(orgData?.features, (userData?.features as ModuleFeatures | null | undefined))

  if (!features.analyze) redirect('/dashboard')

  const orgId = userData?.org_id
  const isAdmin = !!orgData?.is_admin_org
  const orgFilter = isAdmin ? validateOrgFilter(searchParams?.org) : null
  // Admin: all orgs unless ?org= narrows. Non-admin: locked to own org.
  const scopeOrgId = isAdmin ? orgFilter : orgId

  // Fetch active/trial orgs for admin transfer
  let allOrgs: { id: string; name: string }[] = []
  if (isAdmin) {
    const service = createServiceRoleClient()
    const { data: orgs } = await service
      .from('organizations')
      .select('id, name, plan')
      .neq('plan', 'suspended')
      .neq('status', 'suspended')
      .order('name')
    allOrgs = ((orgs || []) as OrgRow[]).filter((o) => o.id !== orgId).map((o) => ({ id: o.id, name: o.name }))
  }

  let dsQuery = supabase
    .from('datasets')
    .select('id, org_id, name, description, source, study_id, ana_library, visibility, status, row_count, last_synced_at, created_at, updated_at, created_by, brand_collection_id, studies(name), dataset_state(theme_model)')
    .order('created_at', { ascending: false })
  if (scopeOrgId) dsQuery = dsQuery.eq('org_id', scopeOrgId)
  const { data: rawDatasets, error: dsErr } = await dsQuery

  if (dsErr) console.error('[AnalyzePage] datasets query error:', dsErr.message)

  // Fetch creator names separately (the FK join to auth.users is unreliable)
  const creatorIds = Array.from(new Set(((rawDatasets || []) as RawDatasetRow[]).map(function(d) { return d.created_by }).filter(Boolean)))
  const creatorMap: Record<string, string> = {}
  if (creatorIds.length > 0) {
    const { data: creators } = await supabase
      .from('users')
      .select('id, full_name, email')
      .in('id', creatorIds)
    ;((creators || []) as CreatorRow[]).forEach(function(c) { creatorMap[c.id] = c.full_name || c.email || 'Unknown' })
  }

  // Fetch org names — for admin cross-org view, each card needs its own org label.
  const orgNameMap: Record<string, string> = {}
  if (isAdmin) {
    const orgIds = Array.from(new Set(((rawDatasets || []) as RawDatasetRow[]).map((d) => d.org_id).filter(Boolean)))
    if (orgIds.length > 0) {
      const service = createServiceRoleClient()
      const { data: orgs } = await service.from('organizations').select('id, name').in('id', orgIds)
      ;((orgs || []) as OrgRow[]).forEach((o) => { orgNameMap[o.id] = o.name })
    }
  }

  // Compute live row counts + kind + member tallies for collections.
  // kind/collection_id are mapped for every collection (incl. empty ones)
  // so the Brand pill still renders; row/member counts only exist once a
  // collection has members.
  const collectionDs = ((rawDatasets || []) as RawDatasetRow[]).filter((d) => d.source === 'collection')
  const collectionRowCounts:    Record<string, number> = {}
  const collectionMemberCounts: Record<string, number> = {}
  const collectionKindByDsId:   Record<string, 'manual' | 'brand'> = {}
  const collectionIdByDsId:     Record<string, string> = {}
  const collectionPurposeByDsId: Record<string, 'community' | 'competitive' | 'brand_360'> = {}
  const collectionStaleByDsId:  Record<string, boolean> = {}
  // Collection's last recompute time (its dataset updated_at) — a member that
  // changed after this is "newer than the cache" → the refresh badge.
  const collectionUpdatedAt: Record<string, number> = {}
  collectionDs.forEach(d => { collectionUpdatedAt[d.id] = d.updated_at ? new Date(d.updated_at).getTime() : 0 })
  if (collectionDs.length > 0) {
    // Aggregate member counts/rows via service-role: `collectionDs` is already
    // RLS-filtered, so we only ever roll up collections the caller can see —
    // but RLS on collection_members hides cross-org rows from an admin viewing
    // another org's collection (the "0 datasets despite 16,989 comments" bug).
    const colSvc = createServiceRoleClient()
    const { data: cols } = await colSvc.from('collections').select('id, dataset_id, kind, purpose').in('dataset_id', collectionDs.map((d) => d.id))
    if (cols && cols.length > 0) {
      for (const col of cols as CollectionRow[]) {
        collectionKindByDsId[col.dataset_id] = col.kind === 'brand' ? 'brand' : 'manual'
        collectionIdByDsId[col.dataset_id]   = col.id
        if (col.purpose) collectionPurposeByDsId[col.dataset_id] = col.purpose
      }
      const { data: members } = await colSvc.from('collection_members').select('collection_id, dataset_id').in('collection_id', cols.map(c => c.id))
      if (members && members.length > 0) {
        const memberDsIds = Array.from(new Set(members.map(m => m.dataset_id)))
        const { data: memberDs } = await colSvc.from('datasets').select('id, row_count, updated_at, last_synced_at').in('id', memberDsIds)
        const memberCounts: Record<string, number> = {}
        const memberChangedAt: Record<string, number> = {}
        ;((memberDs || []) as MemberDatasetRow[]).forEach(d => {
          memberCounts[d.id] = d.row_count || 0
          // A member's "last changed" = the later of its sync + its analyze/edit.
          const u = d.updated_at ? new Date(d.updated_at).getTime() : 0
          const s = d.last_synced_at ? new Date(d.last_synced_at).getTime() : 0
          memberChangedAt[d.id] = Math.max(u, s)
        })
        for (const col of cols) {
          const colMembers = members.filter(m => m.collection_id === col.id)
          collectionRowCounts[col.dataset_id]    = colMembers.reduce((s, m) => s + (memberCounts[m.dataset_id] || 0), 0)
          collectionMemberCounts[col.dataset_id] = colMembers.length
          // Stale when any member changed after the collection last recomputed.
          // 5s grace absorbs the recompute's own write-time jitter.
          const recomputedAt = collectionUpdatedAt[col.dataset_id] || 0
          collectionStaleByDsId[col.dataset_id] = colMembers.some(m => (memberChangedAt[m.dataset_id] || 0) > recomputedAt + 5000)
        }
      }
    }
  }

  // Preload "is this dataset in a collection?" for every non-collection
  // dataset in one query. Previously each DatasetCard did its own
  // /api/datasets/<id>/collection-check fetch on mount — Sentry flagged
  // the N+1 (30 cards → 30 round-trips on every /analyze load).
  const nonCollectionIds = ((rawDatasets || []) as RawDatasetRow[]).filter((d) => d.source !== 'collection').map((d) => d.id)
  const collectionInfoByDsId: Record<string, { collectionDatasetId: string; collectionName: string }> = {}
  if (nonCollectionIds.length > 0) {
    const { data: mems } = await supabase
      .from('collection_members')
      .select('dataset_id, collections(dataset_id, datasets!collections_dataset_id_fkey(name))')
      .in('dataset_id', nonCollectionIds)
    for (const m of (mems || []) as MemberCollectionRow[]) {
      const colRel = Array.isArray(m.collections) ? m.collections[0] : m.collections
      const colDsId = colRel?.dataset_id
      const nameRel = colRel?.datasets
      const name = Array.isArray(nameRel) ? nameRel[0]?.name : nameRel?.name
      if (colDsId) collectionInfoByDsId[m.dataset_id] = { collectionDatasetId: colDsId, collectionName: name || 'Untitled Collection' }
    }
  }

  const datasets = ((rawDatasets || []) as unknown as DatasetQueryRow[]).map(function(d) {
    const studyName = d.studies?.name ?? null
    const creatorName = creatorMap[d.created_by] || null
    const stateArr = d.dataset_state
    const state = Array.isArray(stateArr) ? stateArr[0] : stateArr
    const tm = state?.theme_model || null
    const themeCount = tm?.themes?.length || 0
    const themeSource = tm?.themeSource || tm?.source || null
    const themeLibName = tm?.themeLibName || tm?.libName || d.ana_library || null
    const { studies: _s, dataset_state: _ds, ...rest } = d
    const rowCount = d.source === 'collection' && collectionRowCounts[d.id] != null ? collectionRowCounts[d.id] : d.row_count
    const cardOrgName = isAdmin ? (orgNameMap[d.org_id] || null) : (orgData?.name || null)
    const collectionInfo = collectionInfoByDsId[d.id] || null
    const isColl = d.source === 'collection'
    return {
      ...rest, row_count: rowCount, study_name: studyName, creator_name: creatorName,
      org_name: cardOrgName, theme_count: themeCount, theme_source: themeSource,
      theme_lib_name: themeLibName, collection_info: collectionInfo,
      collection_kind: isColl ? (collectionKindByDsId[d.id] || 'manual') : undefined,
      member_count:    isColl ? (collectionMemberCounts[d.id] ?? 0) : undefined,
      collection_id:   isColl ? (collectionIdByDsId[d.id] || null) : undefined,
      collection_purpose: isColl ? (collectionPurposeByDsId[d.id] || null) : undefined,
      members_updated: isColl ? (collectionStaleByDsId[d.id] || false) : undefined,
    }
    // client_id isn't in this select (AnalyzeClient never reads it), so the
    // mapped rows structurally miss that one DatasetWithState field.
  }) as unknown as DatasetWithState[]

  return (
    <div className="min-h-screen bg-gray-50">
      <TopNav
        logoUrl={orgData?.logo_url    || ''}
        orgName={orgData?.name        || ''}
        isAdmin={isAdmin}
        userEmail={user.email         || ''}
        fullName={userData?.full_name  || ''}
        analyzeEnabled={true}
        campaignsEnabled={!!features.campaigns}
        features={features}
        currentPage="analyze"
      />
      <SubHeader crumbs={[{ label: 'Analyze' }]} isAdmin={isAdmin} orgId={orgId || ''} showFilters />
      <main className="pt-28 px-4 pb-12 max-w-6xl mx-auto">
        <AnalyzeClient initialDatasets={datasets} isAdmin={isAdmin} allOrgs={allOrgs} userOrgId={orgId} />
      </main>
    </div>
  )
}
