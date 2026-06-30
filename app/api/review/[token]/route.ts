// app/api/review/[token]/route.ts
// PUBLIC, token-gated client-review actions for a question batch. No auth — the
// batch's share_token is the bearer capability. Fail-closed: unknown token,
// sharing disabled, or expired → 404. Used by the /review/<token> page.
//
// POST body: { action: 'draft' | 'accept', questionId, answer? }
//   draft  — return an AI-suggested response (grounded in the agent's KB).
//   accept — save the client's accepted/edited response on the question and add
//            the Q→A to the corpus (What We Heard). It NEVER writes to the KB —
//            a client reviewer can't teach the agent — that stays admin-only.
//
// CSRF/auth bypass for this path is configured in proxy.ts (token-gated, not
// cookie-authed). Service-role throughout; every question read/write is pinned to
// the resolved batch so one token can't touch another batch's rows.

import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { draftAnswerFromKB } from '@/lib/agentDraft'
import { materializeExternalExchange } from '@/lib/externalExchange'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function resolveBatch(service: ReturnType<typeof createServiceRoleClient>, token: string) {
  const { data: batch } = await service
    .from('question_batches')
    .select('id, org_id, bot_id, share_enabled, share_expires_at')
    .eq('share_token', token).maybeSingle()
  if (!batch || !batch.share_enabled) return null
  if (batch.share_expires_at && new Date(batch.share_expires_at).getTime() < Date.now()) return null
  return batch
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  if (!token) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const service = createServiceRoleClient()
  const batch = await resolveBatch(service, token)
  if (!batch) return NextResponse.json({ error: 'This review link is unavailable.' }, { status: 404 })

  const body = await req.json().catch(() => ({})) as { action?: string; questionId?: string; answer?: string }
  const questionId = typeof body.questionId === 'string' ? body.questionId : ''
  if (!questionId) return NextResponse.json({ error: 'missing question' }, { status: 400 })

  // The question must belong to THIS batch (token scope).
  const { data: question } = await service
    .from('logged_questions')
    .select('id, bot_id, org_id, session_id, user_message, original_comment, source')
    .eq('id', questionId).eq('batch_id', batch.id).maybeSingle()
  if (!question) return NextResponse.json({ error: 'not found' }, { status: 404 })

  if (body.action === 'draft') {
    const { data: bot } = await service.from('agents').select('id, org_id, name, system_prompt').eq('id', batch.bot_id).single()
    if (!bot) return NextResponse.json({ error: 'not found' }, { status: 404 })
    try {
      const draft = await draftAnswerFromKB(service, bot, question.user_message)
      return NextResponse.json({ draft })
    } catch {
      return NextResponse.json({ error: 'Could not draft a response right now. Please try again.' }, { status: 503 })
    }
  }

  if (body.action === 'accept') {
    const answer = typeof body.answer === 'string' ? body.answer.trim() : ''
    if (answer.length < 2) return NextResponse.json({ error: 'A response is required.' }, { status: 400 })

    // Client-accepted answers are recorded + added to the corpus, but NEVER to the
    // KB (no client teaching). resolved_by stays null (no user account).
    const { error: upErr } = await service.from('logged_questions')
      .update({ status: 'answered', answer_text: answer, suggested_kb_addition: answer, resolved_at: new Date().toISOString() })
      .eq('id', questionId).eq('batch_id', batch.id)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

    if (question.source === 'external' && question.session_id) {
      try {
        await materializeExternalExchange(service, {
          botId: question.bot_id, orgId: question.org_id, sessionId: question.session_id,
          questionId, question: question.original_comment || question.user_message, answer,
        })
      } catch { /* answer saved regardless */ }
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
