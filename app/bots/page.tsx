// app/bots/page.tsx
// Bot management page — list and manage custom chatbots

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg, effectiveFeatures } from '@/lib/resolveOrg'
import type { UserFeatures } from '@/lib/types'
import { validateOrgFilter } from '@/lib/orgValidate'
import TopNav from '@/components/nav/TopNav'
import SubHeader from '@/components/nav/SubHeader'
import BotsClient from './BotsClient'

export const dynamic = 'force-dynamic'

export default async function BotsPage(props: { searchParams: Promise<{ org?: string }> }) {
  const searchParams = await props.searchParams;
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, org_id, features, organizations(id, name, is_admin_org, logo_url, features)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations)
  const features = effectiveFeatures(orgData?.features, userData?.features as UserFeatures | null | undefined)
  if (!features.bots) redirect('/dashboard')

  const isAdmin = !!orgData?.is_admin_org
  const orgFilter = isAdmin ? (validateOrgFilter(searchParams?.org) || '') : ''

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <TopNav
        logoUrl={orgData?.logo_url || ''}
        orgName={orgData?.name}
        isAdmin={isAdmin}
        userEmail={user.email}
        fullName={userData?.full_name}
        features={features}
        currentPage="bots"
      />
      <SubHeader crumbs={[{ label: 'Agents' }]} isAdmin={isAdmin} orgId={userData?.org_id || ''} showFilters />
      <div style={{ paddingTop: 96 }} className="flex-1">
        <BotsClient orgId={userData?.org_id || ''} isAdmin={isAdmin} orgFilter={orgFilter} />
      </div>
    </div>
  )
}
