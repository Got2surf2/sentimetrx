import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg } from '@/lib/resolveOrg'
import { probeBalances, getServiceHealthRows } from '@/lib/serviceHealth'
import HealthClient from './HealthClient'

export const dynamic = 'force-dynamic'

export default async function HealthPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, full_name, organizations(is_admin_org, logo_url, name)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations)
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
  type ActiveStudy = {
    id: string
    name: string
    organizations?: { name?: string | null } | { name?: string | null }[] | null
  }
  const studyHealth = await Promise.all((activeStudies || []).map(async (s: ActiveStudy) => {
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

  // ── Sentry health (errors over last 24h) ────────────────────────────
  // Optional: shows live error data when SENTRY_AUTH_TOKEN, SENTRY_ORG, and
  // SENTRY_PROJECT are configured. Without them we still know if Sentry is
  // configured (DSN set), just no live count.
  const sentryDsnSet = !!process.env.NEXT_PUBLIC_SENTRY_DSN
  const sentryToken  = process.env.SENTRY_AUTH_TOKEN
  const sentryOrg    = process.env.SENTRY_ORG
  const sentryProject = process.env.SENTRY_PROJECT

  let sentryError: string | null = null
  let sentryIssues: { id: string; title: string; lastSeen: string; count: number; permalink: string }[] = []
  let sentryIssueCount24h = 0
  let sentryEvents24h = 0

  if (sentryDsnSet && sentryToken && sentryOrg && sentryProject) {
    try {
      const r = await fetch(
        `https://sentry.io/api/0/projects/${sentryOrg}/${sentryProject}/issues/?statsPeriod=24h&query=is:unresolved&limit=5`,
        { headers: { Authorization: `Bearer ${sentryToken}` }, cache: 'no-store' }
      )
      if (r.ok) {
        type SentryIssueRaw = {
          id: string
          title?: string
          metadata?: { value?: string }
          lastSeen: string
          count: string
          permalink?: string
        }
        const data = await r.json() as SentryIssueRaw[]
        sentryIssues = data.map(d => ({
          id: d.id,
          title: d.title || d.metadata?.value || '(no title)',
          lastSeen: d.lastSeen,
          count: parseInt(d.count) || 0,
          permalink: d.permalink || '',
        }))
        sentryIssueCount24h = sentryIssues.length
        sentryEvents24h = sentryIssues.reduce((s, x) => s + x.count, 0)
      } else {
        sentryError = `Sentry API ${r.status}`
      }
    } catch (e) {
      sentryError = (e instanceof Error && e.message) || 'Sentry API unreachable'
    }
  }

  // ── Service credits / vendor health ─────────────────────────────────
  // Live-probe tier-1 balances on load (the balance endpoints are free) so
  // the admin sees current numbers; then read the full roster (tier-1
  // balances + tier-2 last-error rows). Both best-effort.
  try { await probeBalances() } catch {}
  let serviceCredits: Awaited<ReturnType<typeof getServiceHealthRows>> = []
  try { serviceCredits = await getServiceHealthRows() } catch {}

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
      serviceCredits={serviceCredits}
      sentry={{
        dsnSet: sentryDsnSet,
        tokenSet: !!sentryToken,
        orgSlug: sentryOrg || null,
        projectSlug: sentryProject || null,
        issueCount24h: sentryIssueCount24h,
        events24h: sentryEvents24h,
        topIssues: sentryIssues,
        error: sentryError,
      }}
    />
  )
}
