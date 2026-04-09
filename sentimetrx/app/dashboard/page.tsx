import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg } from '@/lib/resolveOrg'
import DashboardClient from './DashboardClient'

export const dynamic = 'force-dynamic'

export default async function DashboardPage({ searchParams }: { searchParams: { org?: string; user?: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, role, client_id, org_id, organizations(id, name, is_admin_org, logo_url, features)')
    .eq('id', user.id)
    .single()

  const orgData    = resolveOrg(userData?.organizations) as any
  const isAdmin    = !!orgData?.is_admin_org
  const clientName = orgData?.name ?? ''

  let studiesQuery = supabase
    .from('studies')
    .select('id, guid, slug, name, bot_name, bot_emoji, status, visibility, created_by, created_at, config, org_id')
    .order('created_at', { ascending: false })

  if (isAdmin && searchParams?.org) {
    studiesQuery = studiesQuery.eq('org_id', searchParams.org)
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
    // Try materialized view first (instant)
    let mvStats: any[] | null = null
    try {
      const { data } = await supabase.from('study_response_stats').select('*').in('study_id', studyIds)
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
      // Fallback: per-study count queries
      const statPromises = studyIds.map(async (sid: string) => {
        const { count } = await supabase.from('responses').select('id', { count: 'exact', head: true }).eq('study_id', sid)
        const { data: lastRow } = await supabase.from('responses').select('completed_at').eq('study_id', sid).order('completed_at', { ascending: false }).limit(1)
        return { sid, total: count || 0, lastResponse: lastRow?.[0]?.completed_at || null }
      })
      const results = await Promise.all(statPromises)
      for (const r of results) {
        const study = studies.find((s: any) => s.id === r.sid) as any
        const ratingLabel = study?.config?.experienceRatingLabel || 'Avg Rating'
        statsMap[r.sid] = { total: r.total, completeCount: r.total, promoters: 0, passives: 0, detractors: 0, avgScore: 0, ratingLabel, lastResponse: r.lastResponse }
      }
    }
  }

  return (
    <DashboardClient
      logoUrl={orgData?.logo_url || ''}
      orgId={orgData?.id || ''}
      analyzeEnabled={!!orgData?.features?.analyze}
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
