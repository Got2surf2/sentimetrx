// app/admin/activity/page.tsx
//
// User activity dashboard for pilot health monitoring. Surfaces:
//   - Inactive users (no events in N days) — primary outreach list
//   - Per-user last-active + event volumes
//   - Recent-events feed
//
// Read-only, admin-only. All data comes from user_events / user_activity_summary
// (sql/057). The view groups across the whole platform — filter UX is
// client-side.

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg } from '@/lib/resolveOrg'
import ActivityClient from './ActivityClient'

export const dynamic = 'force-dynamic'

export default async function ActivityPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, full_name, organizations(is_admin_org, logo_url, name)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations) as { is_admin_org?: boolean; logo_url?: string; name?: string } | null
  const isAdmin = !!orgData?.is_admin_org
  if (!isAdmin) redirect('/dashboard')

  const service = createServiceRoleClient()

  // Per-user summary (excludes disabled users — they're not pilot candidates)
  const { data: summary } = await service
    .from('user_activity_summary')
    .select('*')
    .eq('disabled', false)
    .order('last_active_at', { ascending: false, nullsFirst: false })

  // Recent events feed for context (last 100)
  const { data: recent } = await service
    .from('user_events')
    .select('id, user_id, org_id, event_name, event_category, metadata, created_at')
    .order('created_at', { ascending: false })
    .limit(100)

  // Hydrate user names for the recent feed
  const recentUserIds = Array.from(new Set((recent || []).map((r: { user_id: string }) => r.user_id)))
  let userMap: Record<string, { email: string; full_name: string | null; org_name: string | null }> = {}
  if (recentUserIds.length > 0) {
    const { data: usersRows } = await service
      .from('users')
      .select('id, email, full_name, organizations(name)')
      .in('id', recentUserIds)
    userMap = ((usersRows || []) as Array<{
      id: string; email: string; full_name: string | null; organizations: { name?: string } | { name?: string }[] | null
    }>).reduce((acc, u) => {
      const org = Array.isArray(u.organizations) ? u.organizations[0] : u.organizations
      acc[u.id] = { email: u.email, full_name: u.full_name, org_name: org?.name || null }
      return acc
    }, {} as Record<string, { email: string; full_name: string | null; org_name: string | null }>)
  }

  return (
    <ActivityClient
      summary={(summary || []) as Array<{
        user_id: string; email: string; full_name: string | null;
        org_id: string | null; org_name: string | null;
        user_created_at: string; disabled: boolean;
        total_events: number; active_days: number;
        last_active_at: string | null; first_active_at: string | null;
        events_7d: number; events_30d: number;
        active_days_7d: number; active_days_30d: number;
      }>}
      recent={(recent || []) as Array<{
        id: string; user_id: string; org_id: string | null;
        event_name: string; event_category: string | null;
        metadata: Record<string, unknown>; created_at: string;
      }>}
      userMap={userMap}
      adminEmail={user.email!}
      logoUrl={orgData?.logo_url || ''}
      orgName={orgData?.name || ''}
      fullName={userData?.full_name || ''}
    />
  )
}
