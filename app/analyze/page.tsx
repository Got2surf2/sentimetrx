// app/analyze/page.tsx
// Server component -- analyze gate + datasets list

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg, effectiveFeatures } from '@/lib/resolveOrg'
import { validateOrgFilter } from '@/lib/orgValidate'
import TopNav from '@/components/nav/TopNav'
import SubHeader from '@/components/nav/SubHeader'
import AnalyzeClient from './AnalyzeClient'

export const dynamic = 'force-dynamic'

export default async function AnalyzePage({ searchParams }: { searchParams: { org?: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, org_id, features, organizations(id, name, is_admin_org, logo_url, features)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations) as any
  const features = effectiveFeatures(orgData?.features, (userData as any)?.features)

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
    allOrgs = (orgs || []).filter((o: any) => o.id !== orgId).map((o: any) => ({ id: o.id, name: o.name }))
  }

  let dsQuery = supabase
    .from('datasets')
    .select('id, org_id, name, description, source, study_id, ana_library, visibility, status, row_count, last_synced_at, created_at, updated_at, created_by, studies(name), dataset_state(theme_model)')
    .order('created_at', { ascending: false })
  if (scopeOrgId) dsQuery = dsQuery.eq('org_id', scopeOrgId)
  const { data: rawDatasets, error: dsErr } = await dsQuery

  if (dsErr) console.error('[AnalyzePage] datasets query error:', dsErr.message)

  // Fetch creator names separately (the FK join to auth.users is unreliable)
  const creatorIds = Array.from(new Set((rawDatasets || []).map(function(d: any) { return d.created_by }).filter(Boolean)))
  const creatorMap: Record<string, string> = {}
  if (creatorIds.length > 0) {
    const { data: creators } = await supabase
      .from('users')
      .select('id, full_name, email')
      .in('id', creatorIds)
    ;(creators || []).forEach(function(c: any) { creatorMap[c.id] = c.full_name || c.email || 'Unknown' })
  }

  // Fetch org names — for admin cross-org view, each card needs its own org label.
  const orgNameMap: Record<string, string> = {}
  if (isAdmin) {
    const orgIds = Array.from(new Set((rawDatasets || []).map((d: any) => d.org_id).filter(Boolean)))
    if (orgIds.length > 0) {
      const service = createServiceRoleClient()
      const { data: orgs } = await service.from('organizations').select('id, name').in('id', orgIds)
      ;(orgs || []).forEach((o: any) => { orgNameMap[o.id] = o.name })
    }
  }

  // Compute live row counts for collections
  const collectionDs = (rawDatasets || []).filter((d: any) => d.source === 'collection')
  const collectionRowCounts: Record<string, number> = {}
  if (collectionDs.length > 0) {
    const { data: cols } = await supabase.from('collections').select('id, dataset_id').in('dataset_id', collectionDs.map((d: any) => d.id))
    if (cols && cols.length > 0) {
      const { data: members } = await supabase.from('collection_members').select('collection_id, dataset_id').in('collection_id', cols.map(c => c.id))
      if (members && members.length > 0) {
        const memberDsIds = Array.from(new Set(members.map(m => m.dataset_id)))
        const { data: memberDs } = await supabase.from('datasets').select('id, row_count').in('id', memberDsIds)
        const memberCounts: Record<string, number> = {}
        ;(memberDs || []).forEach(d => { memberCounts[d.id] = d.row_count || 0 })
        for (const col of cols) {
          const colMembers = members.filter(m => m.collection_id === col.id)
          collectionRowCounts[col.dataset_id] = colMembers.reduce((s, m) => s + (memberCounts[m.dataset_id] || 0), 0)
        }
      }
    }
  }

  const datasets = (rawDatasets || []).map(function(d: any) {
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
    return { ...rest, row_count: rowCount, study_name: studyName, creator_name: creatorName, org_name: cardOrgName, theme_count: themeCount, theme_source: themeSource, theme_lib_name: themeLibName }
  })

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
