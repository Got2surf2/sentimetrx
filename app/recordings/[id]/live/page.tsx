// app/recordings/[id]/live/page.tsx
// Town Hall live capture (§ 15). Server-renders the auth/nav shell; the client
// captures mic audio in the room, then on Stop uploads the recording and hands
// off to the existing pipeline. Live capture only applies before media exists,
// so non-setup recordings redirect to the status page.

import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserContext } from '@/lib/userContext'
import TopNav from '@/components/nav/TopNav'
import LiveClient from './LiveClient'

export const dynamic = 'force-dynamic'

export default async function RecordingLivePage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const supabase = await createClient()
  const ctx = await getUserContext(supabase)
  if (!ctx) redirect('/login')
  if (!ctx.features.recordings) redirect('/dashboard')

  const { data: rec } = await supabase
    .from('recordings')
    .select('id, name, status')
    .eq('id', params.id)
    .single()
  if (!rec) notFound()
  // Live capture only makes sense before media is attached.
  if (rec.status !== 'awaiting_media' && rec.status !== 'draft') {
    redirect(`/recordings/${params.id}/status`)
  }

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
        <LiveClient recordingId={params.id} name={rec.name as string} />
      </main>
    </div>
  )
}
