// Ruth's Chris taxonomy pilot — side-by-side viewer.
//
// Renders verbatim · legacy tags · new structured assertions for each row in
// the pilot dataset. Admin-only (Datanautix org).

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg, effectiveFeatures } from '@/lib/resolveOrg'
import TopNav from '@/components/nav/TopNav'
import TaxonomyPilotClient from './TaxonomyPilotClient'

export const dynamic = 'force-dynamic'

interface Params { params: { datasetId: string } }

export default async function TaxonomyPilotPage({ params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, org_id, features, organizations(is_admin_org, logo_url, name, features)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations) as any
  if (!orgData?.is_admin_org) redirect('/dashboard')
  const features = effectiveFeatures(orgData?.features, (userData as any)?.features)

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
      <div style={{ paddingTop: 56 }} className="flex-1">
        <TaxonomyPilotClient datasetId={params.datasetId} />
      </div>
    </div>
  )
}
