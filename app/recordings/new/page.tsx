// app/recordings/new/page.tsx
// New Town Hall wizard (§ 5.2). Server-renders the auth/nav shell.

import { redirect } from 'next/navigation'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getUserContext } from '@/lib/userContext'
import TopNav from '@/components/nav/TopNav'
import RecordingWizardClient from './RecordingWizardClient'

export const dynamic = 'force-dynamic'

export default async function NewRecordingPage() {
  const supabase = await createClient()
  const ctx = await getUserContext(supabase)
  if (!ctx) redirect('/login')
  // Town Hall (recordings) is a standalone top-level product (not under Analyze).
  if (!ctx.features.recordings) redirect('/dashboard')

  // §3.5c — agents for the optional "link an agent" entity-catalog seed. Admin
  // orgs (platform admins) may link an agent from ANY org — e.g. a pilot agent
  // that lives in a client org — so they're not scoped; non-admins see only
  // their own org's agents. Mirrors the /api/bots admin-sees-all rule.
  const service = createServiceRoleClient()
  let agentQ = service.from('agents').select('id, name').order('name')
  if (!ctx.isAdminOrg) agentQ = agentQ.eq('org_id', ctx.orgId)
  const { data: agentRows } = await agentQ
  const agents = (agentRows ?? []).map((a: { id: string; name: string | null }) => ({ id: a.id as string, name: (a.name as string) || 'Untitled' }))

  // §2.8 — org members for the analyst picker (pick-a-teammate OR free-text).
  const { data: memberRows } = await service
    .from('users')
    .select('id, full_name, email')
    .eq('org_id', ctx.orgId)
    .order('full_name')
  const members = (memberRows ?? [])
    .map((m: { id: string; full_name: string | null; email: string | null }) => ({ id: m.id as string, name: ((m.full_name as string)?.trim()) || (m.email as string) || '' }))
    .filter((m: { name: string }) => m.name)

  return (
    <div className="min-h-screen bg-gray-50">
      <TopNav
        logoUrl={ctx.navProps.logoUrl || ''}
        orgName={ctx.navProps.orgName || ''}
        isAdmin={ctx.navProps.isAdmin}
        userEmail={ctx.navProps.userEmail}
        fullName={ctx.navProps.fullName || ''}
        features={ctx.navProps.features}
        campaignsEnabled={!!ctx.features.campaigns}
        currentPage="recordings"
      />
      <main className="pt-20 px-4 pb-12 max-w-5xl mx-auto">
        <RecordingWizardClient agents={agents} members={members} />
      </main>
    </div>
  )
}
