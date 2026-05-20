// app/bots/[id]/conversations/page.tsx
// Server component wrapper — auth + TopNav + client conversations viewer

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg } from '@/lib/resolveOrg'
import TopNav from '@/components/nav/TopNav'
import ConversationsClient from './ConversationsClient'

export const dynamic = 'force-dynamic'

export default async function ConversationsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, org_id, role, organizations(id, name, is_admin_org, logo_url, features)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations) as any
  const isSuperadmin = (userData as any)?.role === 'platform_admin'

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
        <ConversationsClient isSuperadmin={isSuperadmin} />
      </div>
    </div>
  )
}
