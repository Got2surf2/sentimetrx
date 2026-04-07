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

  // Fetch per-study stats using lightweight aggregate queries (not all response rows)
  const studyIds = studies.map((s: any) => s.id)
  const statsMap: Record<string, { total: number; completeCount: number; promoters: number; passives: number; detractors: number; avgScore: number; ratingLabel: string; lastResponse: string | null }> = {}

  if (studyIds.length > 0) {
    // Batch: fetch counts + avg scores per study in parallel
    // Each query fetches only aggregation-relevant columns with a limit of 1 for metadata
    const statPromises = studyIds.map(async (sid: string) => {
      const [countResult, sentimentResult, scoreResult, lastResult] = await Promise.all([
        // Total count
        supabase.from('responses').select('id', { count: 'exact', head: true }).eq('study_id', sid),
        // Sentiment counts — fetch only sentiment column, cap at 50K for safety
        supabase.from('responses').select('sentiment').eq('study_id', sid).limit(50000),
        // Score averages — fetch only score columns, cap at 50K
        supabase.from('responses').select('experience_score, nps_score').eq('study_id', sid).not('experience_score', 'is', null).limit(50000),
        // Last response date
        supabase.from('responses').select('completed_at').eq('study_id', sid).order('completed_at', { ascending: false }).limit(1),
      ])

      const total = countResult.count || 0
      const sentRows = sentimentResult.data || []
      const promoters  = sentRows.filter((r: any) => r.sentiment === 'positive' || r.sentiment === 'promoter').length
      const passives   = sentRows.filter((r: any) => r.sentiment === 'neutral'  || r.sentiment === 'passive').length
      const detractors = sentRows.filter((r: any) => r.sentiment === 'negative' || r.sentiment === 'detractor').length

      const scoreRows = scoreResult.data || []
      const avgScore = scoreRows.length > 0
        ? Math.round(scoreRows.reduce((sum: number, r: any) => sum + (r.experience_score || 0), 0) / scoreRows.length * 10) / 10
        : 0

      const lastResponse = lastResult.data?.[0]?.completed_at || null

      return { sid, total, completeCount: total, promoters, passives, detractors, avgScore, lastResponse }
    })

    const results = await Promise.all(statPromises)
    for (const r of results) {
      const study = studies.find((s: any) => s.id === r.sid) as any
      const ratingLabel = study?.config?.experienceRatingLabel || 'Avg Rating'
      statsMap[r.sid] = { ...r, ratingLabel }
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
