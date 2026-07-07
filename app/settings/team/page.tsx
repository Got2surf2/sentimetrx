import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg } from '@/lib/resolveOrg'
import type { ModuleFeatures } from '@/lib/types'
import TeamClient from './TeamClient'

export const dynamic = 'force-dynamic'

type ResolvedOrg = {
  id: string
  name: string
  slug: string
  plan: string
  logo_url?: string
  is_admin_org: boolean
  features?: ModuleFeatures
}

export default async function TeamPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, role, full_name, organizations(id, name, slug, plan, logo_url, is_admin_org, features)')
    .eq('id', user.id)
    .single()

  if (!userData?.org_id) redirect('/dashboard')

  const org = resolveOrg(userData.organizations) as ResolvedOrg

  const { data: members } = await supabase
    .from('users')
    .select('id, email, full_name, role, created_at, features, disabled')
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
      orgFeatures={org?.features || {}}
    />
  )
}
