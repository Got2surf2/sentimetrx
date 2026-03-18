// app/analyze/new/page.tsx
// Upload flow -- server component with analyze gate

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import TopNav from '@/components/nav/TopNav'
import UploadClient from './UploadClient'

export const dynamic = 'force-dynamic'

export default async function NewDatasetPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, org_id, organizations(id, name, is_admin_org, logo_url, features)')
    .eq('id', user.id)
    .single()

  const rawOrg  = userData?.organizations
  const orgData = Array.isArray(rawOrg) ? rawOrg[0] : rawOrg as any

  if (!orgData?.features?.analyze) redirect('/dashboard')

  return (
    <div className="min-h-screen bg-gray-50">
      <TopNav
        logoUrl={orgData?.logo_url    || ''}
        orgName={orgData?.name        || ''}
        isAdmin={!!orgData?.is_admin_org}
        userEmail={user.email         || ''}
        fullName={userData?.full_name  || ''}
        analyzeEnabled={true}
        currentPage="analyze"
      />
      <main className="pt-20 px-4 pb-12 max-w-2xl mx-auto">
        <UploadClient />
      </main>
    </div>
  )
}
