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
import { serverError } from '@/lib/apiError'

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
    .select('id, session_id, conversation_id, turn_id, user_message, language, classification, status, resolved_by, resolved_at, notes, suggested_kb_addition, answer_text, draft_response, original_comment, source, external_contact, batch_id, batch_label, created_at')
    .eq('bot_id', params.id)
    .eq('org_id', bot.org_id)
    .order('created_at', { ascending: false })
    .limit(1000)
  if (error) return serverError(error, 'bots.questions.list', { orgId: bot.org_id })

  // Attach the agent's actual reply to each question — the assistant turn that
  // immediately followed the logged user turn — so the reviewer sees what the
  // agent said (the thing to correct, or to accept as-is into the KB). The
  // capture path leaves turn_id/conversation_id null on most rows, so we match
  // the SAME way the Agent Study does: by session_id + the question text, then
  // take the next assistant turn. Questions with no clean match (e.g. some
  // deflects, or legacy non-phase-3 sessions) just get a null response.
  const questions = await attachAgentResponses(service, params.id, rows || [])
  return NextResponse.json({ questions })
}

const norm = (s: string | null) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()

async function attachAgentResponses(service: any, botId: string, rows: any[]): Promise<any[]> {
  const sessionIds = [...new Set(rows.map(r => r.session_id).filter(Boolean))]
  if (sessionIds.length === 0) return rows.map(r => ({ ...r, agent_response: null }))

  // All turns for these sessions (phase-3 conversations join, like agentStudy).
  const { data: turns } = await service
    .from('conversation_turns')
    .select('turn_number, role, content, content_en, conversations!inner(session_id, bot_id)')
    .eq('conversations.bot_id', botId)
    .in('conversations.session_id', sessionIds)
    .order('turn_number', { ascending: true })

  // session_id -> ordered turns
  const bySession = new Map<string, { turn_number: number; role: string; content: string; content_en: string | null }[]>()
  for (const t of (turns || [])) {
    const sid = t.conversations?.session_id
    if (!sid) continue
    if (!bySession.has(sid)) bySession.set(sid, [])
    bySession.get(sid)!.push({ turn_number: t.turn_number, role: t.role, content: t.content, content_en: t.content_en })
  }
  for (const arr of bySession.values()) arr.sort((a, b) => a.turn_number - b.turn_number)

  return rows.map(q => {
    let agent_response: string | null = null
    const ts = bySession.get(q.session_id)
    if (ts) {
      const nq = norm(q.user_message)
      const idx = ts.findIndex(t => t.role === 'user' && (norm(t.content) === nq || norm(t.content_en) === nq))
      if (idx >= 0) {
        const next = ts.slice(idx + 1).find(t => t.role === 'assistant')
        const text = (next?.content_en || next?.content || '').trim()
        if (text) agent_response = text
      }
    }
    return { ...q, agent_response }
  })
}
