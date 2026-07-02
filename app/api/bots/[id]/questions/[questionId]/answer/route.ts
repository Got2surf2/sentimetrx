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

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { serverError } from '@/lib/apiError'
import { generateEmbedding } from '@/lib/embeddings'
import { logBotChange } from '@/lib/auditLog'
import { materializeExternalExchange } from '@/lib/externalExchange'

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
  // Near-duplicate guard handshake: `force` = add anyway despite a near-dup;
  // `replaceChunkId` = merge into the flagged existing chunk instead of adding.
  const force = body?.force === true
  const replaceChunkId = typeof body?.replaceChunkId === 'string' ? body.replaceChunkId : null
  // Opt-in KB write (decision 2 for external questions, but honored generally):
  // default ON to preserve the existing closed-loop behavior; pass false to just
  // record the answer (and, for external questions, add it to the corpus) without
  // teaching the agent.
  const writeKb = body?.writeKb !== false

  const service = createServiceRoleClient()

  const { data: bot } = await service.from('agents').select('id, org_id').eq('id', params.id).single()
  if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  if (!isAdmin && bot.org_id !== orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: question } = await service
    .from('logged_questions')
    .select('id, bot_id, org_id, user_message, source, session_id, original_comment')
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

  const NEAR_DUP_THRESHOLD = 0.92
  let chunkId: string | null = null
  let created = false
  let merged = false

  // KB write is opt-in (default ON). When off we skip the chunk entirely — the
  // answer is still recorded on the row (and, for external questions, added to
  // the corpus below) without teaching the agent.
  if (writeKb) {
    // Embed up front: the vector is both stored on the row AND used for the
    // near-duplicate check. Non-blocking — a null embedding (org AI off / no key)
    // just means no dup-check and full-text-only retrieval.
    let vec: number[] | null = null
    try {
      vec = await generateEmbedding(title + '\n' + content, bot.org_id)
    } catch (e: any) {
      console.error({ at: 'question-answer', msg: 'embedding failed (chunk still usable)', err: e?.message })
    }
    const embeddingPatch = vec ? { embedding: JSON.stringify(vec) } : {}

    // Existing chunk for THIS question (the correction loop) — always update it,
    // never dup-checked (it's the same question being re-answered).
    const { data: existingChunk } = await service
      .from('agent_knowledge_chunks')
      .select('id')
      .eq('bot_id', params.id)
      .contains('metadata', { logged_question_id: params.questionId })
      .limit(1)
      .maybeSingle()

    if (existingChunk) {
      chunkId = existingChunk.id
      const { error } = await service.from('agent_knowledge_chunks')
        .update({ title, content, metadata, ...embeddingPatch })
        .eq('id', chunkId).eq('bot_id', params.id)
      if (error) return serverError(error, 'bots.questions.answer.updateChunk', { orgId: bot.org_id })
    } else if (replaceChunkId) {
      // Reviewer chose to merge into the flagged near-duplicate: overwrite it and
      // re-point it at this question (so future corrections update this chunk).
      chunkId = replaceChunkId
      merged = true
      const { error } = await service.from('agent_knowledge_chunks')
        .update({ title, content, metadata, ...embeddingPatch })
        .eq('id', chunkId).eq('bot_id', params.id)
      if (error) return serverError(error, 'bots.questions.answer.mergeChunk', { orgId: bot.org_id })
    } else {
      // Near-duplicate guard: if a near-identical chunk already exists, don't add
      // — hand the match back so the reviewer can Replace it / Add anyway / Cancel.
      // Skipped when forced or when we have no embedding to compare.
      if (!force && vec) {
        const { data: near } = await service.rpc('match_agent_knowledge_embedding', {
          p_bot_id: params.id, p_embedding: JSON.stringify(vec), p_limit: 1,
        })
        const top = Array.isArray(near) ? near[0] : null
        if (top && typeof top.similarity === 'number' && top.similarity >= NEAR_DUP_THRESHOLD) {
          return NextResponse.json({
            duplicate: { chunkId: top.id, title: top.title, content: top.content, similarity: Math.round(top.similarity * 100) },
          })
        }
      }
      const { data: inserted, error } = await service.from('agent_knowledge_chunks')
        .insert({ bot_id: params.id, title, content, metadata, ...embeddingPatch })
        .select('id')
        .single()
      if (error || !inserted) return serverError(error, 'bots.questions.answer.addChunk', { orgId: bot.org_id })
      chunkId = inserted.id
      created = true
    }
  }

  // External questions: materialize the accepted Q→A as a conversation_turn pair
  // so it's treated the SAME as a live agent exchange — flows into What We Heard,
  // sentiment, and exports (loadTurns reads conversation_turns by bot_id). Live
  // questions already have their turns from the chat path, so this is external-only.
  // Idempotent on the question's synthetic session_id (re-answer updates the reply).
  if (question.source === 'external' && question.session_id) {
    try {
      await materializeExternalExchange(service, {
        botId: params.id, orgId: bot.org_id, sessionId: question.session_id,
        // The user turn carries the FULL original comment when we have it (so What
        // We Heard sees the real words — question + commentary), else the question.
        questionId: params.questionId, question: question.original_comment || question.user_message, answer,
      })
    } catch (e: any) {
      console.error({ at: 'question-answer', msg: 'external corpus materialize failed (answer still saved)', err: e?.message })
    }
  }

  // Close the loop on the question: mark answered + keep the answer text on the
  // row (answer_text drives the export; suggested_kb_addition prefills the editor
  // for the correction loop).
  const { data: updated, error: qErr } = await service
    .from('logged_questions')
    .update({ status: 'answered', resolved_by: userId, resolved_at: new Date().toISOString(), answer_text: answer, suggested_kb_addition: answer })
    .eq('id', params.questionId)
    .eq('bot_id', params.id)
    .eq('org_id', bot.org_id)
    .select('id, session_id, conversation_id, turn_id, user_message, language, classification, status, resolved_by, resolved_at, notes, suggested_kb_addition, answer_text, source, external_contact, batch_label, created_at')
    .single()
  if (qErr) return serverError(qErr, 'bots.questions.answer.markAnswered', { orgId: bot.org_id })

  if (writeKb) {
    void logBotChange({
      botId: params.id,
      orgId: bot.org_id,
      actorId: userId,
      actorEmail: null,
      action: 'knowledge_added',
      summary: (created ? 'Added' : merged ? 'Merged into existing' : 'Updated') + ' knowledge from an answered question: "' + title.slice(0, 80) + (title.length > 80 ? '…' : '') + '"',
      metadata: { source_type: 'logged_qa', logged_question_id: params.questionId, chunk_id: chunkId, corrected: !created, merged },
    })
  }

  return NextResponse.json({ question: updated, chunkId, created, merged, wroteKb: writeKb })
}
