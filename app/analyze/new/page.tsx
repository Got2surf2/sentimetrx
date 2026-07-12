// app/analyze/new/page.tsx
// Upload wizard -- server component with analyze gate

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg, effectiveFeatures } from '@/lib/resolveOrg'
import TopNav from '@/components/nav/TopNav'
import SubHeader from '@/components/nav/SubHeader'
import UploadClient from './UploadClient'
import type { ModuleFeatures } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function NewDatasetPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, org_id, features, organizations(id, name, is_admin_org, logo_url, features)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations)

  const features = effectiveFeatures(orgData?.features, userData?.features as ModuleFeatures | null | undefined)
  if (!features.analyze) redirect('/dashboard')

  return (
    <div className="min-h-screen bg-gray-50">
      <TopNav
        logoUrl={orgData?.logo_url    || ''}
        orgName={orgData?.name        || ''}
        isAdmin={!!orgData?.is_admin_org}
        userEmail={user.email         || ''}
        fullName={userData?.full_name  || ''}
        analyzeEnabled={true}
        campaignsEnabled={!!orgData?.features?.campaigns}
        features={orgData?.features || {}}
        currentPage="analyze"
      />
      <SubHeader crumbs={[{ label: 'Analyze', href: '/analyze' }, { label: 'New Dataset' }]} />
      <main className="pt-28 px-4 pb-12 max-w-4xl mx-auto">
        <UploadClient />
      </main>
    </div>
  )
}


