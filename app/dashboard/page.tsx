import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg, effectiveFeatures } from '@/lib/resolveOrg'
import { validateOrgFilter } from '@/lib/orgValidate'
import DashboardClient from './DashboardClient'

export const dynamic = 'force-dynamic'

export default async function DashboardPage(props: { searchParams: Promise<{ org?: string; user?: string }> }) {
  const searchParams = await props.searchParams;
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, role, client_id, org_id, features, organizations(id, name, is_admin_org, logo_url, features)')
    .eq('id', user.id)
    .single()

  const orgData    = resolveOrg(userData?.organizations) as any
  // Effective features = org ∩ user. Per-user overrides apply on top of the
  // org-level subscription. See lib/resolveOrg.ts:effectiveFeatures.
  const features   = effectiveFeatures(orgData?.features, (userData as any)?.features)
  if (!features.surveys) {
    if (features.analyze)        redirect('/analyze')
    else if (features.townhall)  redirect('/townhall')
    else if (features.campaigns) redirect('/campaigns')
    else if (features.bots)      redirect('/bots')
    else if (features.social)    redirect('/social')
    // If nothing else enabled, stay on dashboard (admin can still access settings)
  }
  const isAdmin    = !!orgData?.is_admin_org
  const clientName = orgData?.name ?? ''

  let studiesQuery = supabase
    .from('studies')
    .select('id, guid, slug, name, bot_name, bot_emoji, status, visibility, created_by, created_at, config, org_id')
    .order('created_at', { ascending: false })

  const orgFilter = validateOrgFilter(searchParams?.org)
  if (isAdmin && orgFilter) {
    studiesQuery = studiesQuery.eq('org_id', orgFilter)
  }
  if (searchParams?.user) {
    studiesQuery = studiesQuery.eq('created_by', searchParams.user)
  }

  const { data: rawStudies } = await studiesQuery
  const studies = rawStudies || []

  // Fetch creator info
  const creatorIds = Array.from(new Set(studies.map((s: any) => s.created_by).filter(Boolean)))
  const { data: creatorsData } = creatorIds.length > 0
    ? await supabase.from('users').select('id, full_name, email, org_id').in('id', creatorIds)
    : { data: [] }

  const creatorMap: Record<string, { name: string; orgId: string }> = {}
  for (const c of (creatorsData || [])) {
    creatorMap[c.id] = { name: c.full_name || c.email || '', orgId: c.org_id || '' }
  }

  // Fetch org names
  const allOrgIds = Array.from(new Set(
    studies.map((s: any) => s.org_id || creatorMap[s.created_by]?.orgId).filter(Boolean)
  ))
  const { data: orgsData } = allOrgIds.length > 0
    ? await supabase.from('organizations').select('id, name').in('id', allOrgIds)
    : { data: [] }

  const orgMap: Record<string, string> = {}
  for (const o of (orgsData || [])) orgMap[o.id] = o.name

  const enrichedStudies = studies.map((s: any) => {
    const resolvedOrgId = s.org_id || creatorMap[s.created_by]?.orgId || ''
    return {
      ...s,
      org_id:      resolvedOrgId,
      orgName:     orgMap[resolvedOrgId]           || '',
      creatorName: creatorMap[s.created_by]?.name  || '',
    }
  })

  // Fetch per-study stats from materialized view (single query) with fallback to count queries
  const studyIds = studies.map((s: any) => s.id)
  const statsMap: Record<string, { total: number; completeCount: number; promoters: number; passives: number; detractors: number; avgScore: number; ratingLabel: string; lastResponse: string | null }> = {}

  if (studyIds.length > 0) {
    // Try materialized view first (instant). The MV is locked down to
    // service role only — the RPC is a SECURITY DEFINER wrapper that
    // filters rows to the caller's org, so it can't leak other orgs'
    // stats even though the underlying MV is org-agnostic.
    let mvStats: any[] | null = null
    try {
      const { data } = await supabase.rpc('get_study_response_stats_for_user', { p_study_ids: studyIds })
      mvStats = data
    } catch {}

    if (mvStats && mvStats.length > 0) {
      // Use materialized view
      for (const mv of mvStats) {
        const study = studies.find((s: any) => s.id === mv.study_id) as any
        const ratingLabel = study?.config?.experienceRatingLabel || 'Avg Rating'
        statsMap[mv.study_id] = {
          total: mv.total_responses || 0,
          completeCount: mv.complete_count || 0,
          promoters: mv.promoters || 0,
          passives: mv.passives || 0,
          detractors: mv.detractors || 0,
          avgScore: mv.avg_experience ? Math.round(mv.avg_experience * 10) / 10 : 0,
          ratingLabel,
          lastResponse: mv.last_response_at || null,
        }
      }
      // Studies not in the view (no responses) get zeros
      for (const sid of studyIds) {
        if (!statsMap[sid]) {
          const study = studies.find((s: any) => s.id === sid) as any
          statsMap[sid] = { total: 0, completeCount: 0, promoters: 0, passives: 0, detractors: 0, avgScore: 0, ratingLabel: study?.config?.experienceRatingLabel || 'Avg Rating', lastResponse: null }
        }
      }
    } else {
      // Fallback: single grouped aggregate via study_stats_for_ids RPC.
      // Pre-fill zeros so studies with zero responses (and any RPC failure)
      // still get a stats row.
      for (const sid of studyIds) {
        const study = studies.find((s: any) => s.id === sid) as any
        statsMap[sid] = { total: 0, completeCount: 0, promoters: 0, passives: 0, detractors: 0, avgScore: 0, ratingLabel: study?.config?.experienceRatingLabel || 'Avg Rating', lastResponse: null }
      }
      try {
        const { data: liveStats } = await supabase.rpc('study_stats_for_ids', { p_study_ids: studyIds })
        for (const row of (liveStats || [])) {
          const study = studies.find((s: any) => s.id === row.study_id) as any
          const ratingLabel = study?.config?.experienceRatingLabel || 'Avg Rating'
          statsMap[row.study_id] = {
            total:         row.total_responses || 0,
            completeCount: row.complete_count  || 0,
            promoters:     row.promoters       || 0,
            passives:      row.passives        || 0,
            detractors:    row.detractors      || 0,
            avgScore:      row.avg_experience ? Math.round(row.avg_experience * 10) / 10 : 0,
            ratingLabel,
            lastResponse:  row.last_response_at || null,
          }
        }
      } catch {}
    }
  }

  return (
    <DashboardClient
      logoUrl={orgData?.logo_url || ''}
      orgId={orgData?.id || ''}
      analyzeEnabled={!!features.analyze}
      campaignsEnabled={!!features.campaigns || isAdmin}
      features={features}
      user={{
        email:      user.email!,
        fullName:   userData?.full_name ?? '',
        role:       userData?.role ?? '',
        clientName,
        isAdmin,
        userId:     user.id,
      }}
      studies={enrichedStudies}
      statsMap={statsMap}
    />
  )
}
