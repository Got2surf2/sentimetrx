// app/api/bots/[id]/conversations/[sessionId]/review/route.ts
// POST — record a human review decision for a conversation.
//   { action: 'approve' }  → include an auto-flagged conversation in reports
//   { action: 'exclude' }  → never include (troll/bot/off-topic confirmed, or manual)
//   { action: 'reset' }    → remove the decision (back to clean / live auto-flag)
// Service-role write paired with bot.org_id per the multi-tenancy invariant.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, props: { params: Promise<{ id: string; sessionId: string }> }) {
  const { id: botId, sessionId } = await props.params
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: bot } = await service.from('agents').select('org_id').eq('id', botId).single()
  if (!bot) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isAdmin && bot.org_id !== orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const action = body?.action
  const reasons = Array.isArray(body?.reasons) ? body.reasons.slice(0, 8) : []

  if (action === 'reset') {
    await service.from('conversation_reviews').delete().eq('bot_id', botId).eq('session_id', sessionId).eq('org_id', bot.org_id)
    return NextResponse.json({ ok: true, status: 'clean' })
  }
  if (action !== 'approve' && action !== 'exclude') {
    return NextResponse.json({ error: 'action must be approve | exclude | reset' }, { status: 400 })
  }
  const status = action === 'approve' ? 'approved' : 'excluded'
  const { error } = await service.from('conversation_reviews').upsert({
    bot_id: botId, org_id: bot.org_id, session_id: sessionId,
    status, reasons, reviewed_by: userId, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }, { onConflict: 'bot_id,session_id' })
  if (error) return serverError(error, 'bots.conversations.review', { orgId: bot.org_id })
  return NextResponse.json({ ok: true, status })
}
