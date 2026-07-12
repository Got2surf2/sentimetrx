// app/social/page.tsx
// Social media moderation dashboard — server component with auth + feature gate

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg, effectiveFeatures } from '@/lib/resolveOrg'
import type { ModuleFeatures } from '@/lib/types'
import TopNav from '@/components/nav/TopNav'
import SubHeader from '@/components/nav/SubHeader'
import SocialClient from './SocialClient'

export const dynamic = 'force-dynamic'

export default async function SocialPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, org_id, features, organizations(id, name, is_admin_org, logo_url, features)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations)
  const features = effectiveFeatures(orgData?.features as ModuleFeatures | null | undefined, userData?.features as ModuleFeatures | null | undefined)
  if (!features.social) redirect('/dashboard')

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <TopNav
        logoUrl={orgData?.logo_url || ''}
        orgName={orgData?.name}
        isAdmin={!!orgData?.is_admin_org}
        userEmail={user.email}
        fullName={userData?.full_name}
        features={features}
        currentPage="social"
      />
      <SubHeader crumbs={[{ label: 'Social' }]} />
      <div style={{ paddingTop: 112 }} className="flex-1">
        <SocialClient orgId={userData?.org_id || ''} />
      </div>
    </div>
  )
}
