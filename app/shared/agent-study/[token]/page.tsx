// app/shared/agent-study/[token]/page.tsx
// Public viewer for a shared Agent Study snapshot. Mirrors
// /shared/conversation/[token]: look up the share by token with the service-role
// client, guard on type + expiry, record access, then hand the baked HTML to a
// client wrapper that renders it in a sandboxed iframe. No auth — the token is
// the capability.

import { createServiceRoleClient } from '@/lib/supabase/server'
import SharedReportView from './SharedReportView'

export const dynamic = 'force-dynamic'

export default async function SharedAgentStudyPage(props: { params: Promise<{ token: string }> }) {
  const params = await props.params
  const db = createServiceRoleClient()

  const { data: link } = await db
    .from('shared_links')
    .select('type, metadata, expires_at')
    .eq('token', params.token)
    .single()

  if (!link || link.type !== 'agent_study') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-lg font-bold text-gray-700 mb-2">Link not found</h1>
          <p className="text-sm text-gray-400">This report link is invalid or has been removed.</p>
        </div>
      </div>
    )
  }

  if (new Date(link.expires_at) < new Date()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-lg font-bold text-gray-700 mb-2">Link expired</h1>
          <p className="text-sm text-gray-400">This report link has expired. Ask the sender for a new one.</p>
        </div>
      </div>
    )
  }

  // Record access (fire-and-forget)
  db.from('shared_links').update({ last_accessed_at: new Date().toISOString() }).eq('token', params.token).then(() => {})

  const html = link.metadata?.html
  if (!html) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-lg font-bold text-gray-700 mb-2">No report data</h1>
          <p className="text-sm text-gray-400">This link doesn&apos;t contain any report data.</p>
        </div>
      </div>
    )
  }

  return <SharedReportView html={html} />
}
