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
    .select('full_name, role, client_id, org_id, organizations(name, is_admin_org, logo_url)')
    .eq('id', user.id)
    .single()

  const rawOrg     = userData?.organizations
  const orgData    = Array.isArray(rawOrg) ? rawOrg[0] : rawOrg as any
  const isAdmin    = !!orgData?.is_admin_org
  const clientName = orgData?.name ?? ''

  // If admin selected an org filter, only load studies for that org's users
  let studiesQuery = supabase
    .from('studies')
    .select('id, guid, name, bot_name, bot_emoji, status, visibility, created_by, created_at, config')
    .order('created_at', { ascending: false })

  if (searchParams?.org && isAdmin) {
    const { data: orgUsers } = await supabase.from('users').select('id').eq('org_id', searchParams.org)
    const orgUserIds = (orgUsers || []).map(u => u.id)
    if (orgUserIds.length > 0) studiesQuery = studiesQuery.in('created_by', orgUserIds)
    else studiesQuery = studiesQuery.eq('id', 'no-match')
  }

  const { data: studies } = await studiesQuery

  const studyIds = (studies || []).map(s => s.id)

  const statsQuery = studyIds.length > 0
    ? await supabase
        .from('responses')
        .select('study_id, sentiment, nps_score, experience_score')
        .in('study_id', studyIds)
    : { data: [] }

  const stats = statsQuery.data || []

  const statsMap: Record<string, {
    total: number
    promoters: number
    passives: number
    detractors: number
    avgNps: number
  }> = {}

  for (const s of studies || []) {
    const rows       = stats.filter(r => r.study_id === s.id)
    const total      = rows.length
    const promoters  = rows.filter(r => r.sentiment === 'promoter').length
    const passives   = rows.filter(r => r.sentiment === 'passive').length
    const detractors = rows.filter(r => r.sentiment === 'detractor').length
    const avgNps     = total > 0
      ? Math.round(rows.reduce((sum, r) => sum + (r.nps_score || 0), 0) / total * 10) / 10
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
      logoUrl={orgData?.logo_url || ""}
      user={userProp}
      studies={studies || []}
      statsMap={statsMap}
    />
  )
}
