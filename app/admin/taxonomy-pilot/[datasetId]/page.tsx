// Ruth's Chris taxonomy pilot — side-by-side viewer.
//
// Renders verbatim · legacy tags · new structured assertions for each row in
// the pilot dataset. Admin-only (Datanautix org).

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg, effectiveFeatures } from '@/lib/resolveOrg'
import TopNav from '@/components/nav/TopNav'
import SubHeader from '@/components/nav/SubHeader'
import TaxonomyPilotClient from './TaxonomyPilotClient'
import type { ModuleFeatures } from '@/lib/types'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ datasetId: string }> }

export default async function TaxonomyPilotPage(props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, org_id, features, organizations(is_admin_org, logo_url, name, features)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations)
  if (!orgData?.is_admin_org) redirect('/dashboard')
  const features = effectiveFeatures(orgData?.features, userData?.features as ModuleFeatures | null | undefined)

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <TopNav
        logoUrl={orgData?.logo_url || ''}
        orgName={orgData?.name}
        isAdmin
        userEmail={user.email}
        fullName={userData?.full_name}
        features={features}
        currentPage="admin"
      />
      <SubHeader crumbs={[{ label: 'Settings & Admin', href: '/admin/hub' }, { label: 'Taxonomy Pilot' }, { label: 'Dataset' }]} />
      <div style={{ paddingTop: 112 }} className="flex-1">
        <TaxonomyPilotClient datasetId={params.datasetId} />
      </div>
    </div>
  )
}
