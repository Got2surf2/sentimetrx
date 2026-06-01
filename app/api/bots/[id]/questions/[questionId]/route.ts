// app/api/bots/[id]/questions/[questionId]/route.ts
// PATCH — update status (open|answered|referred|n_a) + notes on a logged
// question. Used by the Unanswered Queue tab to triage gaps.
//
// Service role + paired (id, bot_id, org_id) check per CLAUDE.md
// multi-tenancy invariants. Audit fields (resolved_by, resolved_at) are
// populated server-side, never trusted from the client.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string; questionId: string }> }

const ALLOWED_STATUSES = new Set(['open', 'answered', 'referred', 'n_a'])

export async function PATCH(req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const status = typeof body?.status === 'string' ? body.status : null
  const notes = typeof body?.notes === 'string' ? body.notes : undefined
  const suggested = typeof body?.suggested_kb_addition === 'string' ? body.suggested_kb_addition : undefined

  if (status && !ALLOWED_STATUSES.has(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }
  if (!status && notes === undefined && suggested === undefined) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const service = createServiceRoleClient()

  const { data: bot } = await service.from('agents').select('id, org_id').eq('id', params.id).single()
  if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  if (!isAdmin && bot.org_id !== orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: existing } = await service
    .from('logged_questions')
    .select('id, bot_id, org_id, status')
    .eq('id', params.questionId)
    .eq('bot_id', params.id)
    .eq('org_id', bot.org_id)
    .single()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const patch: Record<string, any> = {}
  if (status) {
    patch.status = status
    if (status === 'open') {
      patch.resolved_by = null
      patch.resolved_at = null
    } else {
      patch.resolved_by = userId
      patch.resolved_at = new Date().toISOString()
    }
  }
  if (notes !== undefined) patch.notes = notes || null
  if (suggested !== undefined) patch.suggested_kb_addition = suggested || null

  const { data: updated, error } = await service
    .from('logged_questions')
    .update(patch)
    .eq('id', params.questionId)
    .eq('bot_id', params.id)
    .eq('org_id', bot.org_id)
    .select('id, session_id, conversation_id, turn_id, user_message, language, classification, status, resolved_by, resolved_at, notes, suggested_kb_addition, created_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ question: updated })
}
