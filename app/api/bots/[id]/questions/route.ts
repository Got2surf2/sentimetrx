// app/api/bots/[id]/questions/route.ts
// GET — list logged_questions for a bot. Org-member or admin gated.
// Powers /bots/[id]/questions (Question Log admin UI, docs/BOTS.md § 9.x.3).
//
// Service role + paired (id, org_id) check on the agent row per CLAUDE.md
// multi-tenancy invariants. RLS would also gate the SELECT, but service
// role bypasses it — the explicit org check is what protects us.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

interface Params { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()

  const { data: bot } = await service.from('agents').select('id, org_id').eq('id', params.id).single()
  if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  if (!isAdmin && bot.org_id !== orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: rows, error } = await service
    .from('logged_questions')
    .select('id, session_id, conversation_id, turn_id, user_message, language, classification, status, resolved_by, resolved_at, notes, suggested_kb_addition, created_at')
    .eq('bot_id', params.id)
    .eq('org_id', bot.org_id)
    .order('created_at', { ascending: false })
    .limit(1000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ questions: rows || [] })
}
