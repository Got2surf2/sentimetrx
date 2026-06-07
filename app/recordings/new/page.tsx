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

  // §3.5c — the org's agents, for the optional "link an agent" entity-catalog seed.
  const service = createServiceRoleClient()
  const { data: agentRows } = await service
    .from('agents')
    .select('id, name')
    .eq('org_id', ctx.orgId)
    .order('name')
  const agents = (agentRows ?? []).map((a: any) => ({ id: a.id as string, name: (a.name as string) || 'Untitled' }))

  // §2.8 — org members for the analyst picker (pick-a-teammate OR free-text).
  const { data: memberRows } = await service
    .from('users')
    .select('id, full_name, email')
    .eq('org_id', ctx.orgId)
    .order('full_name')
  const members = (memberRows ?? [])
    .map((m: any) => ({ id: m.id as string, name: ((m.full_name as string)?.trim()) || (m.email as string) || '' }))
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
