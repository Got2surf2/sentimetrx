import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg, effectiveFeatures } from '@/lib/resolveOrg'
import TopNav from '@/components/nav/TopNav'
import SubHeader from '@/components/nav/SubHeader'
import AdminHub from '@/components/admin/AdminHub'
import type { ModuleFeatures } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function AdminHubPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, full_name, features, organizations(is_admin_org, logo_url, name, features)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations)
  if (!orgData?.is_admin_org) redirect('/dashboard')
  const features = effectiveFeatures(orgData?.features, (userData?.features ?? null) as ModuleFeatures | null)

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
      <SubHeader crumbs={[{ label: 'Settings & Admin' }]} />
      <div style={{ paddingTop: 112 }} className="flex-1">
        <AdminHub
          buildNumber={process.env.NEXT_PUBLIC_BUILD_NUMBER}
          buildDate={process.env.NEXT_PUBLIC_BUILD_DATE}
        />
      </div>
    </div>
  )
}
