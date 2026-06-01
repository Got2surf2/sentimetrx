// app/analyze/new/recording/page.tsx
// Recording wizard (§ 5.2). Server-renders the auth/nav shell.

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
  if (!ctx.features.analyze) redirect('/dashboard')
  // Recordings is a sub-feature of Analytics — see effectiveFeatures (analyze parent).
  if (!ctx.features.recordings) redirect('/analyze')

  return (
    <div className="min-h-screen bg-gray-50">
      <TopNav
        logoUrl={ctx.navProps.logoUrl || ''}
        orgName={ctx.navProps.orgName || ''}
        isAdmin={ctx.navProps.isAdmin}
        userEmail={ctx.navProps.userEmail}
        fullName={ctx.navProps.fullName || ''}
        features={ctx.navProps.features}
        analyzeEnabled={true}
        campaignsEnabled={!!ctx.features.campaigns}
        currentPage="analyze"
      />
      <main className="pt-20 px-4 pb-12 max-w-5xl mx-auto">
        <RecordingWizardClient />
      </main>
    </div>
  )
}
