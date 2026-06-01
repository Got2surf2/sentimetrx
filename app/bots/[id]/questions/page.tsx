// app/bots/[id]/questions/page.tsx
// Question Log — team-facing access surface (docs/BOTS.md § 9.x.3).
// Server wrapper handles auth + bot lookup + org gate; QuestionsClient
// renders the UI.

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg } from '@/lib/resolveOrg'
import QuestionsClient from './QuestionsClient'

export const dynamic = 'force-dynamic'

interface Params { params: { id: string } }

export default async function BotQuestionsPage({ params }: Params) {
  const supabase = createClient()
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
  let agentQuery = service.from('agents').select('id, name, slug, org_id').eq('id', params.id)
  if (!isAdmin && userData?.org_id) agentQuery = agentQuery.eq('org_id', userData.org_id)
  const { data: bot } = await agentQuery.single()
  if (!bot) redirect('/bots')
  if (!isAdmin && (bot as any).org_id !== userData?.org_id) redirect('/bots')

  return (
    <QuestionsClient
      botId={params.id}
      botName={(bot as any).name}
      botSlug={(bot as any).slug}
      logoUrl={orgData?.logo_url}
      orgName={orgData?.name}
      isAdmin={isAdmin}
      userEmail={user.email!}
      fullName={userData?.full_name || undefined}
      features={orgData?.features}
    />
  )
}
