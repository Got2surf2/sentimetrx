// lib/logQuestion.ts
//
// Question Log capture helper. Inserts a row into `logged_questions`
// when the chat handler hits one of three signals that mean the bot
// didn't (or couldn't) give the user a useful answer:
//
//   - 'deflect'        deflection router fired (off-topic / sensitive)
//   - 'kb_miss'        RAG top match was below the confidence floor and
//                      no KB fallback hit
//   - 'ai_uncertain'   assistant response matched an "I don't know" marker
//
// All capture is fire-and-forget. Errors are logged and never thrown —
// the user response must never depend on Question Log writes landing.
//
// Driver: NOWOCATS PM-2 public-record requirement (docs/BOTS.md § 9.x).
// The table is generic; every bot benefits from a structured record of
// gaps that can feed back into KB improvements.

import type { SupabaseClient } from '@supabase/supabase-js'

export type QuestionClassification = 'deflect' | 'kb_miss' | 'ai_uncertain'

export interface LogQuestionArgs {
  service: SupabaseClient
  orgId: string
  botId: string
  sessionId: string
  userMessage: string
  language?: string | null
  classification: QuestionClassification
  /** Optional — known when chatCore's mirrored conversation_turns insert
   *  already landed (rare race-free path). Most callers leave this null
   *  and the admin UI joins on session_id when surfacing the question. */
  conversationId?: string | null
  turnId?: string | null
}

/**
 * Skip noise: don't log greetings, acks, or single-word turns. They
 * trip the "kb_miss" classifier too easily (RAG returns nothing
 * meaningful for "hi" / "thanks") and would bury the real questions
 * under noise in the admin UI.
 */
function isLoggableMessage(text: string): boolean {
  if (!text) return false
  const trimmed = text.trim()
  if (trimmed.length < 12) return false
  const words = trimmed.split(/\s+/).filter(Boolean)
  if (words.length < 3) return false
  return true
}

export async function logQuestion(args: LogQuestionArgs): Promise<void> {
  if (!isLoggableMessage(args.userMessage)) return

  try {
    const { error } = await args.service.from('logged_questions').insert({
      org_id: args.orgId,
      bot_id: args.botId,
      session_id: args.sessionId,
      conversation_id: args.conversationId ?? null,
      turn_id: args.turnId ?? null,
      user_message: args.userMessage,
      language: args.language ?? null,
      classification: args.classification,
    })
    if (error) {
      console.error({ at: 'log-question', msg: 'insert failed', err: error.message, bot_id: args.botId, classification: args.classification })
    }
  } catch (e: any) {
    console.error({ at: 'log-question', msg: 'unexpected error', err: e?.message })
  }
}

/**
 * "I don't know" heuristic for the assistant reply. Matches the common
 * phrasings the model emits when it can't answer; kept regex-based so
 * we don't add an AI call to a hot path.
 *
 * Intentionally conservative — false negatives are fine, but false
 * positives pollute the Question Log. Add new patterns when reviewing
 * a session and finding a hedge that this regex missed.
 */
const AI_UNCERTAIN_PATTERNS: RegExp[] = [
  /\bi (?:don'?t|do not) (?:know|have(?:\s+(?:that|specific|the))? )/i,
  /\bi'?m not sure (?:about (?:that|the)|of )/i,
  /\bi'?m unable to (?:find|locate|answer|help)/i,
  /\bi don'?t have (?:specific )?information /i,
  /\bthat (?:specific )?(?:information|detail) (?:isn'?t|is not) /i,
  /\bi (?:can'?t|cannot) (?:answer|help) (?:that|with that)/i,
  // Sarina-style third-person hedges — the model deflects without saying "I"
  /\b(?:isn'?t|is not) in (?:the|my|our|what i have|what i'?ve been given) /i,
  /\bnot (?:something i|in the (?:project|study|knowledge|materials)) /i,
  /\boutside (?:what i can help|the scope|my role) /i,
]

export function replyLooksUncertain(reply: string): boolean {
  if (!reply) return false
  return AI_UNCERTAIN_PATTERNS.some(p => p.test(reply))
}
