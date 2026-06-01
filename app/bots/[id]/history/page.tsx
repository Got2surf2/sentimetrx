// app/bots/[id]/history/page.tsx
// View the change log for a single bot. Org-member or admin gated.

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg } from '@/lib/resolveOrg'
import HistoryClient from './HistoryClient'

export const dynamic = 'force-dynamic'

interface Params { params: { id: string } }

export default async function BotHistoryPage({ params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, full_name, organizations(is_admin_org, logo_url, name, features)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations) as any
  const isAdmin = !!orgData?.is_admin_org

  const service = createServiceRoleClient()
  // Service-role lookup pairs id with org_id for non-admins (multi-tenancy
  // invariant); admins may load any org's agent.
  let agentQuery = service.from('agents').select('id, name, slug, org_id, created_at, updated_at').eq('id', params.id)
  if (!isAdmin && userData?.org_id) agentQuery = agentQuery.eq('org_id', userData.org_id)
  const { data: bot } = await agentQuery.single()
  if (!bot) redirect('/bots')
  if (!isAdmin && (bot as any).org_id !== userData?.org_id) redirect('/bots')

  return (
    <HistoryClient
      botId={params.id}
      botName={(bot as any).name}
      botSlug={(bot as any).slug}
      botCreatedAt={(bot as any).created_at}
      botUpdatedAt={(bot as any).updated_at}
      logoUrl={orgData?.logo_url}
      orgName={orgData?.name}
      isAdmin={isAdmin}
      userEmail={user.email!}
      fullName={userData?.full_name || undefined}
      features={orgData?.features}
    />
  )
}
