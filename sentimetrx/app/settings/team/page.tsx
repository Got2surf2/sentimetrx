import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import TeamClient from './TeamClient'

export const dynamic = 'force-dynamic'

export default async function TeamPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, role, organizations(id, name, slug, plan, logo_url, is_admin_org)')
    .eq('id', user.id)
    .single()

  if (!userData?.org_id) redirect('/dashboard')

  const org = Array.isArray(userData.organizations)
    ? userData.organizations[0]
    : userData.organizations as any

  const { data: members } = await supabase
    .from('users')
    .select('id, email, full_name, role, created_at')
    .eq('org_id', userData.org_id)
    .order('created_at', { ascending: true })

  const { data: invites } = await supabase
    .from('invites')
    .select('id, token, email, role, used_at, expires_at, created_at')
    .eq('org_id', userData.org_id)
    .is('used_at', null)
    .order('created_at', { ascending: false })

  const isAdmin = org?.is_admin_org === true
  const isOwner = userData.role === 'owner' || isAdmin

  return (
    <TeamClient
      org={org}
      members={members || []}
      invites={invites || []}
      currentUserId={user.id}
      isOwner={isOwner}
      isAdmin={isAdmin}
      userEmail={user.email || ""}
      fullName={userData?.full_name || ""}
    />
  )
}
