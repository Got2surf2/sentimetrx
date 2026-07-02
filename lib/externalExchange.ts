// lib/externalExchange.ts
// Materialize an accepted EXTERNAL question's Q→A as a one-exchange conversation
// so the agent's reporting (What We Heard, etc.) treats it like a live exchange.
// Shared by the admin answer route and the public client-review accept so the two
// never drift. Idempotent on the question's synthetic session_id (re-answering
// updates the reply turn in place).
//
// Provenance lives on the CONVERSATION (source='external' + metadata.external) so
// external Q&A stays distinguishable from the agent's organic chats; the TURNS are
// source='normal' because isSubstantive (lib/conversationReview) only counts
// source='normal'/null user turns — an 'external' question turn would be dropped
// from What We Heard. The visitor is the `user` turn; the agent is only the
// `assistant` (answerer), never the asker.

import type { SupabaseClient } from '@supabase/supabase-js'
import { logError } from '@/lib/log'

export async function materializeExternalExchange(
  service: SupabaseClient,
  args: { botId: string; orgId: string; sessionId: string; questionId: string; question: string; answer: string },
): Promise<void> {
  const { botId, orgId, sessionId, questionId, question, answer } = args

  const { data: existing, error: existingErr } = await service
    .from('conversations').select('id')
    .eq('bot_id', botId).eq('session_id', sessionId).maybeSingle()
  if (existingErr) void logError('externalExchange.materializeExternalExchange', existingErr, { orgId })

  if (existing) {
    await service.from('conversation_turns')
      .update({ content: answer, content_en: answer })
      .eq('conversation_id', existing.id).eq('role', 'assistant')
    return
  }

  const { data: conv, error: convErr } = await service
    .from('conversations')
    .insert({ org_id: orgId, bot_id: botId, session_id: sessionId, source: 'external', turn_count: 2, metadata: { external: true, logged_question_id: questionId } })
    .select('id').single()
  if (convErr || !conv) throw new Error(convErr?.message || 'conversation insert failed')

  const turns = [
    { conversation_id: conv.id, org_id: orgId, turn_number: 1, role: 'user',      content: question, content_en: question, source: 'normal' },
    { conversation_id: conv.id, org_id: orgId, turn_number: 2, role: 'assistant', content: answer,   content_en: answer,   source: 'normal', sentiment: 'neutral' },
  ]
  const { error: turnErr } = await service.from('conversation_turns').insert(turns)
  if (turnErr) throw new Error(turnErr.message)
}
