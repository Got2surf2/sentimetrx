import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardClient from './DashboardClient'

export const dynamic = 'force-dynamic'

export default async function DashboardPage({ searchParams }: { searchParams: { org?: string; user?: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, role, client_id, org_id, organizations(id, name, is_admin_org, logo_url)')
    .eq('id', user.id)
    .single()

  const rawOrg     = userData?.organizations
  const orgData    = Array.isArray(rawOrg) ? rawOrg[0] : rawOrg as any
  const isAdmin    = !!orgData?.is_admin_org
  const clientName = orgData?.name ?? ''

  // Build studies query
  let studiesQuery = supabase
    .from('studies')
    .select('id, guid, name, bot_name, bot_emoji, status, visibility, created_by, created_at, config, org_id')
    .order('created_at', { ascending: false })

  if (isAdmin && searchParams?.org) {
    studiesQuery = studiesQuery.eq('org_id', searchParams.org)
  }
  if (searchParams?.user) {
    studiesQuery = studiesQuery.eq('created_by', searchParams.user)
  }

  const { data: rawStudies } = await studiesQuery
  const studies = rawStudies || []

  // Fetch ALL users who created these studies (for names + org lookup)
  const creatorIds = Array.from(new Set(studies.map((s: any) => s.created_by).filter(Boolean)))
  const { data: creatorsData } = creatorIds.length > 0
    ? await supabase.from('users').select('id, full_name, email, org_id').in('id', creatorIds)
    : { data: [] }

  const creatorMap: Record<string, { name: string; orgId: string }> = {}
  for (const c of creatorsData || []) {
    creatorMap[c.id] = { name: c.full_name || c.email || '', orgId: c.org_id || '' }
  }

  // Collect all org_ids (from study directly OR from creator's org)
  const allOrgIds = Array.from(new Set(
    studies.map((s: any) => s.org_id || creatorMap[s.created_by]?.orgId).filter(Boolean)
  ))
  const { data: orgsData } = allOrgIds.length > 0
    ? await supabase.from('organizations').select('id, name').in('id', allOrgIds)
    : { data: [] }

  const orgMap: Record<string, string> = {}
  for (const o of orgsData || []) orgMap[o.id] = o.name

  // Enrich studies with resolved org name and creator name
  const enrichedStudies = studies.map((s: any) => {
    const resolvedOrgId = s.org_id || creatorMap[s.created_by]?.orgId || ''
    return {
      ...s,
      org_id:      resolvedOrgId,
      orgName:     orgMap[resolvedOrgId] || '',
      creatorName: creatorMap[s.created_by]?.name || '',
    }
  })

  // Stats
  const studyIds = studies.map((s: any) => s.id)
  const statsQuery = studyIds.length > 0
    ? await supabase.from('responses').select('study_id, sentiment, nps_score').in('study_id', studyIds)
    : { data: [] }

  const stats = statsQuery.data || []
  const statsMap: Record<string, { total: number; promoters: number; passives: number; detractors: number; avgNps: number }> = {}

  for (const s of studies) {
    const rows       = stats.filter((r: any) => r.study_id === s.id)
    const total      = rows.length
    const promoters  = rows.filter((r: any) => r.sentiment === 'promoter').length
    const passives   = rows.filter((r: any) => r.sentiment === 'passive').length
    const detractors = rows.filter((r: any) => r.sentiment === 'detractor').length
    const avgNps     = total > 0
      ? Math.round(rows.reduce((sum: number, r: any) => sum + (r.nps_score || 0), 0) / total * 10) / 10
      : 0
    statsMap[s.id] = { total, promoters, passives, detractors, avgNps }
  }

  const userProp = {
    email:      user.email!,
    fullName:   userData?.full_name ?? '',
    role:       userData?.role ?? '',
    clientName,
    isAdmin,
    userId:     user.id,
  }

  return (
    <DashboardClient
      logoUrl={orgData?.logo_url || ''}
      orgId={orgData?.id || ''}
      user={userProp}
      studies={enrichedStudies}
      statsMap={statsMap}
    />
  )
}
