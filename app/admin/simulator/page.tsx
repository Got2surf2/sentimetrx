// Server wrapper — see /admin/usage/page.tsx for pattern.

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg, effectiveFeatures } from '@/lib/resolveOrg'
import TopNav from '@/components/nav/TopNav'
import SimulatorClient from './SimulatorClient'
import type { ModuleFeatures } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function SimulatorPage() {
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
        currentPage="simulator"
      />
      <div style={{ paddingTop: 56 }} className="flex-1">
        <SimulatorClient />
      </div>
    </div>
  )
}
