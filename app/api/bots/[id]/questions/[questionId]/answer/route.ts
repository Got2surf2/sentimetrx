// app/api/bots/[id]/questions/[questionId]/answer/route.ts
// POST — answer a logged question and feed the answer back into the agent's
// knowledge base, atomically. The unanswered-questions queue becomes a closed
// loop: type the right answer here and the agent retrieves it on the next
// matching question (RAG is live over agent_knowledge_chunks — no rebuild).
//
// Idempotent per question (the correction loop): the created chunk is tagged
// with metadata.logged_question_id, so saving again UPDATES + RE-EMBEDS that
// same chunk instead of duplicating — fix a wrong/weak answer and the agent's
// knowledge updates in place.
//
// Sharp edge handled: knowledge chunks carry a sentiment tag and RAG SUPPRESSES
// negative-tagged chunks (the deflect path). A human-authored answer to a hard
// question must never be silently suppressed, so these chunks are forced
// sentiment:'neutral' and skip the AI sentiment classifier entirely.
//
// Service role + paired (id, bot_id, org_id) checks per CLAUDE.md multi-tenancy
// invariants; chunks are bot-scoped (agent_knowledge_chunks has no org_id, FK to
// agents).

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { generateEmbedding } from '@/lib/embeddings'
import { logBotChange } from '@/lib/auditLog'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface Params { params: Promise<{ id: string; questionId: string }> }

export async function POST(req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const answer = typeof body?.answer === 'string' ? body.answer.trim() : ''
  if (answer.length < 2) return NextResponse.json({ error: 'An answer is required' }, { status: 400 })

  const service = createServiceRoleClient()

  const { data: bot } = await service.from('agents').select('id, org_id').eq('id', params.id).single()
  if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  if (!isAdmin && bot.org_id !== orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: question } = await service
    .from('logged_questions')
    .select('id, bot_id, org_id, user_message')
    .eq('id', params.questionId)
    .eq('bot_id', params.id)
    .eq('org_id', bot.org_id)
    .single()
  if (!question) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // The knowledge chunk: title = the question (drives semantic match on future
  // phrasings), content = a self-contained Q→A so the injected context reads
  // clearly. Forced-neutral so RAG never suppresses it.
  const title = question.user_message.slice(0, 160)
  const content = `Q: ${question.user_message}\nA: ${answer}`
  const metadata = {
    source: 'Answered question',
    source_type: 'logged_qa',
    sentiment: 'neutral',
    logged_question_id: params.questionId,
  }

  // Upsert by logged_question_id: update+re-embed the existing chunk (correction
  // loop) or insert a fresh one.
  const { data: existingChunk } = await service
    .from('agent_knowledge_chunks')
    .select('id')
    .eq('bot_id', params.id)
    .contains('metadata', { logged_question_id: params.questionId })
    .limit(1)
    .maybeSingle()

  let chunkId: string
  let created: boolean
  if (existingChunk) {
    chunkId = existingChunk.id
    created = false
    const { error } = await service.from('agent_knowledge_chunks')
      .update({ title, content, metadata })
      .eq('id', chunkId)
      .eq('bot_id', params.id)
    if (error) return NextResponse.json({ error: 'Failed to update knowledge: ' + error.message }, { status: 500 })
  } else {
    const { data: inserted, error } = await service.from('agent_knowledge_chunks')
      .insert({ bot_id: params.id, title, content, metadata })
      .select('id')
      .single()
    if (error || !inserted) return NextResponse.json({ error: 'Failed to add knowledge: ' + (error?.message || '') }, { status: 500 })
    chunkId = inserted.id
    created = true
  }

  // Embed (re-embed on correction). Non-blocking: a null embedding (org AI off /
  // no key) still leaves the chunk retrievable via the full-text fallback.
  try {
    const vec = await generateEmbedding(title + '\n' + content, bot.org_id)
    if (vec) await service.from('agent_knowledge_chunks').update({ embedding: JSON.stringify(vec) }).eq('id', chunkId)
  } catch (e: any) {
    console.error({ at: 'question-answer', msg: 'embedding failed (chunk still usable)', err: e?.message })
  }

  // Close the loop on the question: mark answered + keep the answer text on the
  // row (also what prefills the editor for the correction loop).
  const { data: updated, error: qErr } = await service
    .from('logged_questions')
    .update({ status: 'answered', resolved_by: userId, resolved_at: new Date().toISOString(), suggested_kb_addition: answer })
    .eq('id', params.questionId)
    .eq('bot_id', params.id)
    .eq('org_id', bot.org_id)
    .select('id, session_id, conversation_id, turn_id, user_message, language, classification, status, resolved_by, resolved_at, notes, suggested_kb_addition, created_at')
    .single()
  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 })

  void logBotChange({
    botId: params.id,
    orgId: bot.org_id,
    actorId: userId,
    actorEmail: null,
    action: 'knowledge_added',
    summary: (created ? 'Added' : 'Updated') + ' knowledge from an answered question: "' + title.slice(0, 80) + (title.length > 80 ? '…' : '') + '"',
    metadata: { source_type: 'logged_qa', logged_question_id: params.questionId, chunk_id: chunkId, corrected: !created },
  })

  return NextResponse.json({ question: updated, chunkId, created })
}
