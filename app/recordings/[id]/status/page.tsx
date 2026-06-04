// app/recordings/[id]/status/page.tsx
// Town Hall status surface (§ 5.3). Server-renders the auth/nav shell + the
// initial recording snapshot; client polls /api/recordings/[id] for live updates.

import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserContext } from '@/lib/userContext'
import TopNav from '@/components/nav/TopNav'
import StatusClient from './StatusClient'

export const dynamic = 'force-dynamic'

export default async function RecordingStatusPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = await createClient()
  const ctx = await getUserContext(supabase)
  if (!ctx) redirect('/login')
  if (!ctx.features.recordings) redirect('/dashboard')

  // Verify the recording exists and the user can see it (RLS does this via the
  // anon client — service-role would bypass).
  const { data: rec } = await supabase
    .from('recordings')
    .select('id, name, status')
    .eq('id', params.id)
    .single()
  if (!rec) notFound()

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
      <main className="pt-20 px-4 pb-12 max-w-4xl mx-auto">
        <StatusClient
          recordingId={params.id}
          initialName={rec.name as string}
          initialStatus={rec.status as string}
        />
      </main>
    </div>
  )
}
