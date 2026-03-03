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

  // Build studies query — join org and creator info
  let studiesQuery = supabase
    .from('studies')
    .select('id, guid, name, bot_name, bot_emoji, status, visibility, created_by, created_at, config, org_id, organizations(name), users(full_name, email)')
    .order('created_at', { ascending: false })

  // Admin org filter — filter directly by org_id
  if (searchParams?.org && isAdmin) {
    studiesQuery = studiesQuery.eq('org_id', searchParams.org)
  }

  // User filter
  if (searchParams?.user) {
    studiesQuery = studiesQuery.eq('created_by', searchParams.user)
  }

  const { data: studies } = await studiesQuery

  const studyIds = (studies || []).map((s: any) => s.id)

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
      studies={studies || []}
      statsMap={statsMap}
    />
  )
}
