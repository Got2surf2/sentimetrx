// app/bots/[id]/knowledge/health/page.tsx
// Server wrapper — auth + TopNav + the KB Health view (inventory of the agent's
// knowledge chunks with age / source / size + prune actions, so the KB stays
// tight as answered questions feed into it over time).

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg } from '@/lib/resolveOrg'
import TopNav from '@/components/nav/TopNav'
import KbHealthClient from './KbHealthClient'

export const dynamic = 'force-dynamic'

export default async function KbHealthPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, org_id, organizations(id, name, is_admin_org, logo_url, features)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations) as any

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <TopNav
        logoUrl={orgData?.logo_url || ''}
        orgName={orgData?.name}
        isAdmin={!!orgData?.is_admin_org}
        userEmail={user.email}
        fullName={userData?.full_name}
        features={orgData?.features || {}}
        currentPage="bots"
      />
      <div style={{ paddingTop: 56 }} className="flex-1">
        <KbHealthClient />
      </div>
    </div>
  )
}
