// app/bots/[id]/report/page.tsx
// Server wrapper — auth + TopNav + the interactive Agent Study report. This is
// the surface that replaces the old conversations-page "Deck" + "Mine
// Conversations" buttons: an HTML report with expand/collapse drill-down into
// real conversation snippets, plus a PPTX export of the same analysis.

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg } from '@/lib/resolveOrg'
import TopNav from '@/components/nav/TopNav'
import ReportClient from './ReportClient'

export const dynamic = 'force-dynamic'

export default async function ReportPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, org_id, role, organizations(id, name, is_admin_org, logo_url, features)')
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
        <ReportClient />
      </div>
    </div>
  )
}
