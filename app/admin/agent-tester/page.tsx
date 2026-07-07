// app/admin/agent-tester/page.tsx
// Admin tool: type a message → see every guardrail / moderation /
// intent that triggers, scoped to a chosen agent's config.

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg } from '@/lib/resolveOrg'
import AgentTesterClient from './AgentTesterClient'

export const dynamic = 'force-dynamic'

export default async function AgentTesterPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, org_id, organizations(is_admin_org, logo_url, name, features)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations)
  if (!orgData?.is_admin_org) redirect('/dashboard')

  return (
    <AgentTesterClient
      logoUrl={orgData?.logo_url}
      orgName={orgData?.name}
      userEmail={user.email!}
      fullName={userData?.full_name || undefined}
      features={orgData?.features}
    />
  )
}
