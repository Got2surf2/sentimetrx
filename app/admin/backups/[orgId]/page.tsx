// app/admin/backups/[orgId]/page.tsx
// List of snapshots for one org. Restore lives here.

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg } from '@/lib/resolveOrg'
import OrgBackupsClient from './OrgBackupsClient'

export const dynamic = 'force-dynamic'

interface Params { params: { orgId: string } }

export default async function OrgBackupsPage({ params }: Params) {
  const supabase = createClient()
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
  const { data: org } = await service.from('organizations').select('id, name, slug').eq('id', params.orgId).single()
  if (!org) redirect('/admin/backups')

  return (
    <OrgBackupsClient
      orgId={params.orgId}
      targetOrgName={(org as any).name}
      targetOrgSlug={(org as any).slug}
      logoUrl={orgData?.logo_url}
      orgName={orgData?.name}
      userEmail={user.email!}
      fullName={userData?.full_name || undefined}
      features={orgData?.features}
    />
  )
}
