import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardClient from './DashboardClient'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, role, client_id, clients(name)')
    .eq('id', user.id)
    .single()

  const { data: studies } = await supabase
    .from('studies')
    .select('id, guid, name, bot_name, bot_emoji, status, created_at, config')
    .order('created_at', { ascending: false })

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
    const rows = stats.filter(r => r.study_id === s.id)
    const total = rows.length
    const promoters = rows.filter(r => r.sentiment === 'promoter').length
    const passives = rows.filter(r => r.sentiment === 'passive').length
    const detractors = rows.filter(r => r.sentiment === 'detractor').length
    const avgNps = total > 0
      ? Math.round(rows.reduce((sum, r) => sum + (r.nps_score || 0), 0) / total * 10) / 10
      : 0
    statsMap[s.id] = { total, promoters, passives, detractors, avgNps }
  }

  const rawClients = userData?.clients
  const clientData = Array.isArray(rawClients) ? rawClients[0] : rawClients

  const userProp = {
    email: user.email!,
    fullName: userData?.full_name ?? '',
    role: userData?.role ?? '',
    clientName: clientData?.name ?? '',
  }

  return (
    <DashboardClient
      user={userProp}
      studies={studies || []}
      statsMap={statsMap}
    />
  )
}
