// app/recordings/new/page.tsx
// New Town Hall wizard (§ 5.2). Server-renders the auth/nav shell.

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
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
        <RecordingWizardClient />
      </main>
    </div>
  )
}
