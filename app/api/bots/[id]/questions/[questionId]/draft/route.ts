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

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { callAI } from '@/lib/ai'
import { logUsage } from '@/lib/usageLog'

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
    .select('id, user_message')
    .eq('id', params.questionId)
    .eq('bot_id', params.id)
    .eq('org_id', bot.org_id)
    .single()
  if (!question) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // KB grounding via the full-text search RPC (no embedding needed). Empty for
  // agents whose knowledge lives only in the system prompt (e.g. Sarina).
  let kb = ''
  try {
    const { data: chunks } = await service.rpc('search_knowledge_chunks', { p_bot_id: params.id, p_query: question.user_message, p_limit: 4 })
    kb = (chunks || []).map((c: any) => `- ${c.title}: ${c.content}`).join('\n').slice(0, 4000)
  } catch { /* RPC absent / no chunks → system prompt alone */ }

  const knowledge = [(bot.system_prompt || '').slice(0, 8000), kb].filter(s => s && s.trim()).join('\n\n---\n\n')

  const system = `You are drafting a SUGGESTED answer for a human reviewer to approve or edit — it is NOT sent to anyone directly. Write the answer the agent "${bot.name}" should give to the visitor's question next time: concise, plain, factual, in the agent's voice.
GROUND IT ONLY in the agent knowledge below. Do NOT invent facts, numbers, hours, dates, names, URLs, prices, or policies that aren't in the knowledge. If the knowledge does not contain the answer, draft a short honest response that acknowledges what isn't available and points the visitor to a reasonable next step — never fabricate specifics.
Return ONLY the drafted answer text — no preamble, no quotes, no "Draft:" label.

AGENT KNOWLEDGE:
${knowledge || '(no agent knowledge available)'}`

  const userContent = `Visitor asked: ${question.user_message}\n\nThe agent previously replied (flagged as inadequate): ${agentReply || '(no reply captured)'}`

  try {
    const res = await callAI({ tier: 'standard', maxTokens: 500, timeoutMs: 30000, system, messages: [{ role: 'user', content: userContent }] })
    logUsage({ org_id: bot.org_id, resource_type: 'bot', resource_id: bot.id, event_type: 'question_answer_draft' }, res.usage)
    return NextResponse.json({ draft: res.text.trim() })
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      return NextResponse.json({ error: 'Draft is taking longer than usual. Please try again.' }, { status: 503 })
    }
    throw err
  }
}
