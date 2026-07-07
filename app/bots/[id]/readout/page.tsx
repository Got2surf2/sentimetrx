// app/bots/[id]/readout/page.tsx
// Server wrapper — auth + TopNav + the interactive Agent Conversation Readout
// (questions by theme + raised beyond the questions). Mirrors the Agent Study
// report wrapper.

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg } from '@/lib/resolveOrg'
import TopNav from '@/components/nav/TopNav'
import ReadoutClient from './ReadoutClient'

export const dynamic = 'force-dynamic'

export default async function ReadoutPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, org_id, role, organizations(id, name, is_admin_org, logo_url, features)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations)

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
        <ReadoutClient />
      </div>
    </div>
  )
}
