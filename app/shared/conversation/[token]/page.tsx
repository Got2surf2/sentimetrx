import { createServiceRoleClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export default async function SharedConversationPage({ params }: { params: { token: string } }) {
  const db = createServiceRoleClient()

  const { data: link } = await db
    .from('shared_links')
    .select('type, metadata, expires_at')
    .eq('token', params.token)
    .single()

  if (!link || link.type !== 'conversation') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-lg font-bold text-gray-700 mb-2">Link not found</h1>
          <p className="text-sm text-gray-400">This conversation link is invalid or has been removed.</p>
        </div>
      </div>
    )
  }

  if (new Date(link.expires_at) < new Date()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-lg font-bold text-gray-700 mb-2">Link expired</h1>
          <p className="text-sm text-gray-400">This conversation link has expired. Ask the sender for a new one.</p>
        </div>
      </div>
    )
  }

  // Record access
  db.from('shared_links').update({ last_accessed_at: new Date().toISOString() }).eq('token', params.token).then(() => {})

  const html = link.metadata?.html
  if (!html) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-lg font-bold text-gray-700 mb-2">No conversation data</h1>
          <p className="text-sm text-gray-400">This link doesn't contain any conversation data.</p>
        </div>
      </div>
    )
  }

  // Serve the self-contained HTML
  return <iframe srcDoc={html} className="w-full min-h-screen border-0" title="Shared Conversation" />
}
