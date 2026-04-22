import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg } from '@/lib/resolveOrg'
import HealthClient from './HealthClient'

export const dynamic = 'force-dynamic'

export default async function HealthPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, full_name, organizations(is_admin_org, logo_url, name)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations) as any
  const isAdmin = !!orgData?.is_admin_org
  if (!isAdmin) redirect('/dashboard')

  const service = createServiceRoleClient()

  // ── Supabase connectivity check ─────────────────────────────────────
  let dbOk = false
  let dbLatency = 0
  try {
    const t0 = Date.now()
    await service.from('organizations').select('id', { count: 'exact', head: true })
    dbLatency = Date.now() - t0
    dbOk = true
  } catch {}

  // ── Active studies with recent responses ─────────────────────────────
  const now = new Date()
  const h24 = new Date(now.getTime() - 24 * 3600 * 1000).toISOString()
  const h1 = new Date(now.getTime() - 3600 * 1000).toISOString()

  const { data: activeStudies } = await service
    .from('studies')
    .select('id, name, status, org_id, organizations(name)')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(50)

  // Per-study response stats (last 24h)
  const studyHealth = await Promise.all((activeStudies || []).map(async (s: any) => {
    const [total24h, complete24h, partial24h, total1h] = await Promise.all([
      service.from('responses').select('id', { count: 'exact', head: true }).eq('study_id', s.id).gte('completed_at', h24),
      service.from('responses').select('id', { count: 'exact', head: true }).eq('study_id', s.id).eq('status', 'complete').gte('completed_at', h24),
      service.from('responses').select('id', { count: 'exact', head: true }).eq('study_id', s.id).neq('status', 'complete').gte('completed_at', h24),
      service.from('responses').select('id', { count: 'exact', head: true }).eq('study_id', s.id).gte('completed_at', h1),
    ])
    const totalAll = await service.from('responses').select('id', { count: 'exact', head: true }).eq('study_id', s.id)
    const completeAll = await service.from('responses').select('id', { count: 'exact', head: true }).eq('study_id', s.id).eq('status', 'complete')

    const org = Array.isArray(s.organizations) ? s.organizations[0] : s.organizations
    return {
      id: s.id,
      name: s.name,
      orgName: org?.name || '',
      total24h: total24h.count || 0,
      complete24h: complete24h.count || 0,
      partial24h: partial24h.count || 0,
      total1h: total1h.count || 0,
      totalAll: totalAll.count || 0,
      completeAll: completeAll.count || 0,
      completionRate: (totalAll.count || 0) > 0
        ? Math.round(((completeAll.count || 0) / (totalAll.count || 1)) * 100)
        : 0,
    }
  }))

  // Sort by 24h activity (most active first)
  studyHealth.sort(function(a, b) { return b.total24h - a.total24h })

  // ── Overall platform stats ──────────────────────────────────────────
  const { count: totalResponses24h } = await service.from('responses').select('id', { count: 'exact', head: true }).gte('completed_at', h24)
  const { count: totalComplete24h } = await service.from('responses').select('id', { count: 'exact', head: true }).eq('status', 'complete').gte('completed_at', h24)

  return (
    <HealthClient
      logoUrl={orgData?.logo_url || ''}
      orgName={orgData?.name || ''}
      fullName={userData?.full_name || ''}
      userEmail={user.email || ''}
      dbOk={dbOk}
      dbLatency={dbLatency}
      studyHealth={studyHealth}
      totalResponses24h={totalResponses24h || 0}
      totalComplete24h={totalComplete24h || 0}
    />
  )
}
