// lib/deflectionRouter.ts
//
// Shared pre-checks for the deflection path: deciding whether an AI deflection
// call is worth making for a given user message.
//
// Extracted from app/api/bots/[id]/chat/route.ts and app/api/townhall/chat/
// route.ts as part of convergence Phase 2.3 (docs/CONVERGENCE.md).
//
// Scope is deliberately narrow:
//   - the QUESTION_SIGNALS regex (byte-identical between both routes)
//   - the sensitive-topic regex-build pattern (byte-identical)
//   - the decision rule:  hits-sensitive  ||  (no feedback signal AND has question signal)
//
// Not extracted:
//   - FEEDBACK_SIGNALS regex. PulseIQ's word list is a domain-specific superset
//     of the bots list (traffic/parking/safety/housing/schools/etc). Each route
//     passes its own regex.
//   - The AI prompt template. Bots use a generic "conversational agent" framing;
//     PulseIQ uses a "facilitator in a PulseIQ discussion" framing with
//     community-specific bullets. Unifying would change Sarina's live behavior.
//   - The turn-storage write. bot_conversation_turns and townhall_turns have
//     different shapes; that converges in Phase 3 when the routes merge.

// Matches messages that start with a question word — a strong signal that the
// user is asking for information rather than giving feedback. Anchored to the
// start of the message (after optional whitespace) so mid-sentence "what" in
// "I love what they did" does not match.
export const DEFLECTION_QUESTION_SIGNALS = /^\s*(who|what|where|when|why|how|can you|could you|do you|is there|are there|will you|would you)\b/i

// Escape a string for safe use inside a RegExp body.
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// True if `text` contains any of the listed sensitive topics as a whole word
// (case-insensitive). Returns false for empty/missing topic lists.
export function hitsSensitiveTopic(text: string, topics: readonly string[] | null | undefined): boolean {
  if (!topics || topics.length === 0) return false
  return topics.some(t => new RegExp('\\b' + escapeRegex(t) + '\\b', 'i').test(text))
}

export interface DeflectionDecision {
  shouldAttempt: boolean
  hitsSensitive: boolean
}

// Decide whether to spend an AI call evaluating deflection. Returns hitsSensitive
// alongside shouldAttempt so the caller can adjust prompt wording and signals.
//
// Decision rule (identical to the inline rule each route used previously):
//   - If the message touches a sensitive/banned topic → always attempt.
//   - Otherwise attempt only if the message has no feedback-signal word AND
//     starts with a question word (i.e. looks like an off-topic ask).
export function evaluateDeflection(
  text: string,
  sensitiveTopics: readonly string[] | null | undefined,
  feedbackSignals: RegExp,
): DeflectionDecision {
  const hits = hitsSensitiveTopic(text, sensitiveTopics)
  const shouldAttempt = hits || (!feedbackSignals.test(text) && DEFLECTION_QUESTION_SIGNALS.test(text))
  return { shouldAttempt, hitsSensitive: hits }
}
