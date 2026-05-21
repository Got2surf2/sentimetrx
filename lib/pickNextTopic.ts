// lib/pickNextTopic.ts
//
// Phase 5 commit 2 of the agents x PulseIQ convergence
// (docs/CONVERGENCE.md § 4 row 5).
//
// Pure function lifted out of app/api/townhall/chat/route.ts. Selects
// the next topic to probe for a participant given the available topic
// pool, the participant's conversation state, and an optional smart-
// probe hint from the current message.
//
// The function knows nothing about where topics come from — the caller
// passes them in. In the legacy PulseIQ orchestrator the pool is
// townhall_themes (with `state='active'` and live response_count from
// townhall_turns). In Phase 5 commit 3 the unified handleChatTurn will
// pass town_hall_topics when townHallContext is present, or the
// agent's seed focuses when it isn't.
//
// Selection rules (preserved from the legacy block):
//   1. Filter out topics whose id is in discussedTopicIds.
//   2. Prefer under-target topics (response_count < response_target);
//      fall back to over-target only if all under-target are discussed.
//   3. If preferOrganic is true AND any non-seed topics are available,
//      drop seed-source topics from the pool. (Seed-budget exhausted
//      override; lets organic topics surface once the curated seed list
//      has been chewed through.)
//   4. Smart probe: if the user's current message contains any keyword
//      from an available topic, jump to that topic — overrides the
//      default "fewest responses" pick.
//   5. Default pick: first available. Callers MUST pre-sort the input
//      array by response_count ascending so the default-pick rule
//      means "fewest responses so far". This function does not re-sort
//      because callers often want to preserve stable ordering across
//      multiple decisions in the same request.

export interface NextTopic {
  id: string
  label: string
  description?: string | null
  question?: string | null
  follow_up_angles?: string[] | null
  keywords?: string[] | null
  source: string                     // 'seed' | 'guide' | 'custom' | 'auto_detected' | 'manual'
  response_target: number
  response_count: number             // computed live by caller from turn data
}

export interface NextTopicState {
  /** Topic IDs the participant has already discussed in this conversation. */
  discussedTopicIds: Set<string>
  /** The user's current message — used for smart-probe keyword matching. */
  currentMessage?: string
  /** When true, organic (non-seed) topics are preferred over seed/guide topics. */
  preferOrganic?: boolean
  /** The topic the participant is currently on. Excluded from smart-probe
   *  (so a keyword match on the current topic doesn't get treated as a
   *  "jump") but NOT excluded from the default-pick — preserving the
   *  legacy semantic where the current topic can stay selected if it
   *  still has the fewest responses and isn't already discussed. */
  currentTopicId?: string
}

export type NextTopicReason =
  | 'smart_probe'
  | 'fewest_responses'
  | 'fallback_over_target'
  | 'all_covered'
  | 'no_topics'

export interface NextTopicResult {
  topic: NextTopic | null
  reason: NextTopicReason
  matchedKeyword?: string
}

const SEED_SOURCES = new Set(['seed', 'guide'])

export function pickNextTopic(
  topics: NextTopic[],
  state: NextTopicState,
): NextTopicResult {
  if (!topics || topics.length === 0) {
    return { topic: null, reason: 'no_topics' }
  }

  const underTarget = topics.filter(t => t.response_count < t.response_target && !state.discussedTopicIds.has(t.id))
  const overTarget = topics.filter(t => t.response_count >= t.response_target && !state.discussedTopicIds.has(t.id))
  let available = underTarget.length > 0 ? underTarget : overTarget

  if (state.preferOrganic) {
    const organic = available.filter(t => !SEED_SOURCES.has(t.source))
    if (organic.length > 0) available = organic
  }

  if (available.length === 0) {
    return { topic: null, reason: 'all_covered' }
  }

  if (state.currentMessage) {
    const lower = state.currentMessage.toLowerCase()
    for (const t of available) {
      if (state.currentTopicId && t.id === state.currentTopicId) continue
      const kws = t.keywords || []
      for (const kw of kws) {
        if (!kw) continue
        if (lower.includes(kw.toLowerCase())) {
          return { topic: t, reason: 'smart_probe', matchedKeyword: kw }
        }
      }
    }
  }

  return {
    topic: available[0],
    reason: underTarget.length > 0 ? 'fewest_responses' : 'fallback_over_target',
  }
}
