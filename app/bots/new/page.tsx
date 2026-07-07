// app/bots/new/page.tsx
// Server wrapper for the agent editor. Auth + feature-gate, then render
// TopNav + the client form so the editor has the same top nav as every
// other module (was missing — "edit agent loses the top menu bar").

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg, effectiveFeatures } from '@/lib/resolveOrg'
import TopNav from '@/components/nav/TopNav'
import EditAgentClient from './EditAgentClient'
import type { ModuleFeatures } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function BotsNewPage() {
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
        <EditAgentClient />
      </div>
    </div>
  )
}
