import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg, effectiveFeatures } from '@/lib/resolveOrg'
import { validateOrgFilter } from '@/lib/orgValidate'
import TownHallListClient from './TownHallListClient'

export const dynamic = 'force-dynamic'

export default async function TownHallPage({ searchParams }: { searchParams: { org?: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, role, client_id, org_id, features, organizations(id, name, is_admin_org, logo_url, features)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations) as any
  const features = effectiveFeatures(orgData?.features, (userData as any)?.features)
  if (!features.townhall) redirect('/dashboard')
  const isAdmin = !!orgData?.is_admin_org
  const orgFilter = isAdmin ? (validateOrgFilter(searchParams?.org) || '') : ''

  return (
    <TownHallListClient
      logoUrl={orgData?.logo_url}
      analyzeEnabled={!!features.analyze}
      campaignsEnabled={!!features.campaigns}
      features={features}
      user={{
        email: user.email || '',
        fullName: userData?.full_name || undefined,
        role: userData?.role || undefined,
        clientName: orgData?.name || '',
        isAdmin,
      }}
      orgId={userData?.org_id || ''}
      orgFilter={orgFilter}
    />
  )
}
