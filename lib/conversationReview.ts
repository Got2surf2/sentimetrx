// lib/conversationReview.ts
//
// Conversation-level quality gate for agent reports. Auto-detects trolls,
// bots, and wholly off-topic conversations so they're excluded from the Agent
// Study while staying in the DB; humans clear/confirm them from the Transcripts
// page (sql/096 conversation_reviews).
//
// Auto-flagging is computed LIVE here (not persisted). Lower-level than
// lib/agentStudy.ts, which imports `isSubstantive` + the flag helpers from
// here (one-way dependency — no cycle).

export interface TurnLike {
  role: string
  content: string
  content_en?: string | null
  source?: string | null
  content_flags?: string[] | null
  created_at: string
}

// Safety/abuse flags written per-turn by lib/contentGuard / the audit pass.
export const SAFETY_FLAGS = ['profanity', 'slur', 'threat', 'sexual', 'insult', 'spam']

// A user turn is "substantive" when it's a real message (>=3 words or contains
// a question mark) — one-word chip taps / acks don't count. Shared with
// agentStudy so the two never drift.
export function isSubstantive(t: TurnLike): boolean {
  if (t.role !== 'user' || !(t.source === 'normal' || t.source == null)) return false
  const c = (t.content_en || t.content || '').trim()
  if (c.includes('?')) return c.length > 1
  return c.split(/\s+/).filter(Boolean).length >= 3
}

// Stable fingerprint of a session's substantive user messages — identical
// fingerprints across sessions signal scripted/bot traffic.
export function sessionFingerprint(turns: TurnLike[]): string {
  return turns.filter(isSubstantive)
    .map(t => (t.content_en || t.content || '').toLowerCase().replace(/\s+/g, ' ').trim())
    .sort().join('|')
}

const RAPID_FLOOD_MS = 20000   // >=4 substantive turns inside 20s = flood
const RAPID_FLOOD_MIN_TURNS = 4

/**
 * Live auto-flag reasons for a single conversation. Empty = clean. A non-empty
 * result means "exclude from reports pending human review" unless a human row
 * already approved it.
 *
 * `duplicateFingerprints` is the set of fingerprints shared by >1 session in
 * the same bot (computed once by the caller across all sessions).
 */
export function autoFlagReasons(turns: TurnLike[], opts: { duplicateFingerprints?: Set<string> } = {}): string[] {
  const reasons: string[] = []
  const subs = turns.filter(isSubstantive)
  if (subs.length === 0) return reasons   // no real input is handled upstream (no-input), not a review flag

  // 1) Safety / abuse — any safety flag on any turn
  const hasSafety = turns.some(t => Array.isArray(t.content_flags) && t.content_flags.some(f => SAFETY_FLAGS.includes(f)))
  if (hasSafety) reasons.push('abuse')

  // 2) Wholly off-topic — EVERY substantive exchange was deflected as
  //    out-of-scope (a tangent inside an otherwise on-topic chat does NOT
  //    trip this; the whole conversation must be off-topic).
  const offTopic = subs.every((t, i) => {
    if (Array.isArray(t.content_flags) && t.content_flags.includes('outside_scope')) return true
    // the assistant turn answering this user turn was a deflection
    const idx = turns.indexOf(t)
    const answer = turns.slice(idx + 1).find(x => x.role === 'assistant')
    return answer?.source === 'deflect'
  })
  if (offTopic) reasons.push('off_topic')

  // 3) Bot-like — repeated identical messages, cross-session duplication, or a
  //    rapid flood of turns.
  const normed = subs.map(t => (t.content_en || t.content || '').toLowerCase().replace(/\s+/g, ' ').trim())
  const uniq = new Set(normed)
  if (subs.length >= 2 && uniq.size < subs.length) reasons.push('repetitive')
  if (opts.duplicateFingerprints?.has(sessionFingerprint(turns))) reasons.push('duplicate')
  if (subs.length >= RAPID_FLOOD_MIN_TURNS) {
    const times = subs.map(t => new Date(t.created_at).getTime()).sort((a, b) => a - b)
    if (times[times.length - 1] - times[0] < RAPID_FLOOD_MS) reasons.push('rapid')
  }

  return [...new Set(reasons)]
}

export type ReviewStatus = 'clean' | 'auto_flagged' | 'approved' | 'excluded'

// Resolve the effective status from the persisted human decision (if any) and
// the live auto-flag reasons.
export function resolveReviewStatus(humanStatus: 'approved' | 'excluded' | null, autoReasons: string[]): ReviewStatus {
  if (humanStatus === 'excluded') return 'excluded'
  if (humanStatus === 'approved') return 'approved'
  return autoReasons.length > 0 ? 'auto_flagged' : 'clean'
}

// Whether a conversation should appear in reports.
export function includedInReports(status: ReviewStatus): boolean {
  return status === 'clean' || status === 'approved'
}

// Build the set of fingerprints that occur in >1 session (cross-session dup
// detection input for autoFlagReasons).
export function duplicateFingerprintSet(sessions: Map<string, TurnLike[]>): Set<string> {
  const counts = new Map<string, number>()
  for (const ts of sessions.values()) {
    const fp = sessionFingerprint(ts)
    if (!fp) continue
    counts.set(fp, (counts.get(fp) || 0) + 1)
  }
  return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([fp]) => fp))
}
