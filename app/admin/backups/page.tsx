// app/admin/backups/page.tsx
// Top-level admin entry for the per-tenant backup system. Lists every org
// with quick links into each org's snapshot list + restore tool.

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg } from '@/lib/resolveOrg'
import BackupsClient from './BackupsClient'

export const dynamic = 'force-dynamic'

export default async function BackupsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, org_id, organizations(is_admin_org, logo_url, name, features)')
    .eq('id', user.id)
    .single()
  const orgData = resolveOrg(userData?.organizations) as any
  if (!orgData?.is_admin_org) redirect('/dashboard')

  const service = createServiceRoleClient()
  const { data: orgs } = await service
    .from('organizations')
    .select('id, name, slug, plan, is_admin_org')
    .order('name', { ascending: true })

  return (
    <BackupsClient
      orgs={(orgs || []) as any}
      logoUrl={orgData?.logo_url}
      orgName={orgData?.name}
      userEmail={user.email!}
      fullName={userData?.full_name || undefined}
      features={orgData?.features}
    />
  )
}
