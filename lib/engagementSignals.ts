// lib/engagementSignals.ts
//
// Atomic primitives for engagement / disengagement detection in a chat
// conversation. Extracted as part of convergence Phase 2.4 (docs/
// CONVERGENCE.md) from app/api/townhall/chat/route.ts.
//
// Scope is deliberately narrow:
//   - countWords(text): whitespace-separated word count, null/empty safe.
//   - isCurtResponse(text): 1–3 word substantive answer ("yeah", "ok",
//     "fine"). Matches the per-turn CURT_RESPONSE check in the town hall
//     route; the route itself still owns the `!isOpeningResponse` and
//     multi-turn aggregation context.
//   - SUBTLE_DISENGAGE / isSubtleDisengage(text): the short-answer
//     subtle-disengagement regex used to trigger an AI tone check.
//
// Not extracted:
//   - Multi-turn aggregators (trajectoryDisengaging, recentAllCurt,
//     globalCheckout). They depend on the townhall_turns row shape and
//     PulseIQ-specific per-topic / per-session policy. When bots gain a
//     similar feature, the aggregators can be lifted at that point.
//   - The clarifier-cap policy decision. That belongs in the route.
//   - isInfoOnlyMessage (lib/botProbeGuards.ts). It overlaps with
//     SUBTLE_DISENGAGE in a few terms ("ok", "yeah"), but the semantics
//     differ: info-only filler ("thanks!", "hi") is not disengagement,
//     and disengagement ("whatever", "i guess") is not sociable filler.
//     Unifying would change behavior. botProbeGuards reuses countWords
//     here so the word-count primitive is no longer duplicated.

// Count whitespace-separated words. Trims first; returns 0 for empty or
// nullish input. Multiple consecutive whitespace characters collapse to a
// single separator. Punctuation attached to a word still counts as part of
// the word ("don't" = 1, "yes!" = 1).
export function countWords(text: string | null | undefined): number {
  if (!text) return 0
  const trimmed = text.trim()
  if (trimmed.length === 0) return 0
  return trimmed.split(/\s+/).filter(Boolean).length
}

// True when the message is 1–3 words. Matches the town hall route's
// CURT_RESPONSE rule (`wordCount > 0 && wordCount <= 3`). The route still
// gates this on per-turn context (e.g. `!isOpeningResponse`) before acting
// on it.
export function isCurtResponse(text: string | null | undefined): boolean {
  const wc = countWords(text)
  return wc > 0 && wc <= 3
}

// Subtle-disengagement regex. Matches a single short answer that, taken in
// isolation, *might* be disengagement but is too short to be sure — the
// town hall route fires an AI tone check on a match. Anchored to the full
// message (after trim) so longer answers don't accidentally match.
export const SUBTLE_DISENGAGE = /^(whatever|sure|fine|ok|okay|i guess|idk|i don't know|yeah|yep|yes|yup|nah|no|not really|i said what i said|all of the above|all of them|both|same|agreed|exactly|absolutely|definitely|correct|right)\s*[.!?]*$/i

// Convenience wrapper — trims the input and tests SUBTLE_DISENGAGE.
export function isSubtleDisengage(text: string | null | undefined): boolean {
  if (!text) return false
  return SUBTLE_DISENGAGE.test(text.trim())
}
