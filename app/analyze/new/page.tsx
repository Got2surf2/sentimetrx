// app/analyze/new/page.tsx
// Upload wizard -- server component with analyze gate

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg, effectiveFeatures } from '@/lib/resolveOrg'
import TopNav from '@/components/nav/TopNav'
import UploadClient from './UploadClient'

export const dynamic = 'force-dynamic'

export default async function NewDatasetPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, org_id, features, organizations(id, name, is_admin_org, logo_url, features)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations) as any

  const features = effectiveFeatures(orgData?.features, (userData as any)?.features)
  if (!features.analyze) redirect('/dashboard')

  // Recordings is a sub-feature of Analytics; effectiveFeatures already forces
  // it off when analyze is off. Only surface the Recording tile when enabled.
  const recordingsEnabled = !!features.recordings

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
      <main className="pt-20 px-4 pb-12 max-w-4xl mx-auto">
        <UploadClient recordingsEnabled={recordingsEnabled} />
      </main>
    </div>
  )
}


