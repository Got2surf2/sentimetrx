// app/bots/page.tsx
// Bot management page — list and manage custom chatbots

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg, effectiveFeatures } from '@/lib/resolveOrg'
import TopNav from '@/components/nav/TopNav'
import BotsClient from './BotsClient'

export const dynamic = 'force-dynamic'

export default async function BotsPage() {
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
  if (!features.bots) redirect('/dashboard')

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <TopNav
        logoUrl={orgData?.logo_url || ''}
        orgName={orgData?.name}
        isAdmin={!!orgData?.is_admin_org}
        userEmail={user.email}
        fullName={userData?.full_name}
        features={features}
        currentPage="bots"
      />
      <div style={{ paddingTop: 56 }} className="flex-1">
        <BotsClient orgId={userData?.org_id || ''} />
      </div>
    </div>
  )
}
