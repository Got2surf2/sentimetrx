// app/api/bots/[id]/questions/[questionId]/draft/route.ts
// POST — generate a SUGGESTED answer for a logged question, for a human to
// approve/edit in the guided review flow. It is never sent to anyone directly.
//
// Grounded ONLY in the agent's own knowledge (system prompt + KB chunks) so the
// draft can't fabricate — the whole point of these questions is the agent
// didn't know, so the prompt is explicit: if the knowledge doesn't cover it,
// draft an honest "we don't have that / here's the next step" rather than
// inventing hours/numbers/URLs/policies.
//
// Org-gated like the sibling answer route.

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { draftAnswerFromKB } from '@/lib/agentDraft'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface Params { params: Promise<{ id: string; questionId: string }> }

export async function POST(req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const agentReply = typeof body?.agentReply === 'string' ? body.agentReply : ''

  const service = createServiceRoleClient()
  const { data: bot } = await service.from('agents').select('id, org_id, name, system_prompt').eq('id', params.id).single()
  if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  if (!isAdmin && bot.org_id !== orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: question } = await service
    .from('logged_questions')
    .select('id, user_message, original_comment, source')
    .eq('id', params.questionId)
    .eq('bot_id', params.id)
    .eq('org_id', bot.org_id)
    .single()
  if (!question) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Comment-log items: draft from the full original comment (the user_message is
  // just the title/topic), and treat them as async one-way submissions.
  const isExternal = (question as any).source === 'external'
  const draftInput = (question as any).original_comment || question.user_message

  try {
    const draft = await draftAnswerFromKB(service, bot, draftInput, agentReply, { asyncReply: isExternal })
    return NextResponse.json({ draft })
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      return NextResponse.json({ error: 'Draft is taking longer than usual. Please try again.' }, { status: 503 })
    }
    throw err
  }
}
