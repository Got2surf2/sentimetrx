// lib/emotionFlags.ts
//
// Emotion-language flags — the keyword-tier detector for the `emotion` axis
// embedded in data._tx beside the 7 ABSA axes. Deterministic regex layer,
// validated 2026-07-04 on 4 prod datasets + a 30-sample owner spot-check
// (disappointment 12/12 precision, blame 6/6, churn-intent stable ~7% of
// negatives / 0.3% of positives across brands).
//
// EXPRESSED-LANGUAGE FRAMING ONLY: a flag asserts the text CONTAINS
// disappointment/blame/churn-intent language — never that the author felt an
// emotion. Every assertion carries a verbatim evidence span.
//
// REGRET is deliberately dark: the keyword tier only reached 50–60% precision
// (self-directed counterfactuals need context the regex layer can't see), so
// first-person "should have" hits are DROPPED here and wait for the LLM tier.
// Third-party "should have" routes to blame; passive/impersonal "should have
// been" is an expectation gap and routes to disappointment (spot-check fixes).
//
// The emotion axis is keyword-tier ONLY: it is excluded from the LLM
// extractor's closed vocabulary (AXES in lib/taxonomyVocabulary.ts stays the
// 7 ABSA axes), so the LLM can never emit it.
//
// Vertical gating (see project memory / ANALYTICS spec): churn-intent is only
// meaningful where the audience CHOSE the venue; captive verticals (airports,
// civic) should pass suppressChurn. Blame subjects are core ⊕ a per-vertical
// overlay (restaurant roles today — a civic vertical would add board/county/
// TSA-style subjects instead).

import { EMOTION_SUBS, type Assertion } from './taxonomyVocabulary'
import { NEGATION_TOKENS, NEGATION_WINDOW } from './taxonomyKeywords'

export const EMOTION_AXIS = 'emotion' as const

export { EMOTION_SUBS }
export type EmotionSub = typeof EMOTION_SUBS[number]

const EMOTION_CONFIDENCE = 0.85 // matches the Tier-1 keyword matcher

// ── Lexicon (ported from the validated probe, scripts/_probe-regret-lexicon.ts) ──

const DISAPPOINTMENT_PATTERNS: RegExp[] = [
  /\bexpected .*? but\b/gi,
  /\bwas (?:really )?hoping\b/gi,
  /\bhoped (?:for|it would)\b/gi,
  /\blet down\b/gi,
  /\bletdown\b/gi,
  /\bunderwhelm(?:ed|ing)\b/gi,
  /\bnot what i (?:expected|was expecting|hoped)\b/gi,
  /\bthought it would be\b/gi,
  /\bfell short\b/gi,
  /\bdisappoint(?:ed|ing|ment)?\b/gi,
  /\bexpected (?:a lot |much |way |far |so much )?(?:more|better)\b/gi,
  /\bnot up to (?:par|standard|the usual)\b/gi,
  /\bused to be (?:better|great|good)\b/gi,
]

const BLAME_PATTERNS: RegExp[] = [
  /\bmanager (?:should|decided|chose)\b/gi,
  /\bwhoever (?:decided|designed|thought)\b/gi,
  /\bwhy (?:did|would) they\b/gi,
  /\bpoor (?:decision|choice|call|management)\b/gi,
  /\bbad call by\b/gi,
]

// Churn intent = a stated decision not to repeat, usually with an external
// cause. Orthogonal to disappointment/blame (a review can carry all three).
const CHURN_PATTERNS: RegExp[] = [
  /\bnever (?:again|coming back|going back|returning)\b/gi,
  /\bwon'?t (?:be (?:back|returning)|return|come back|be going back)\b/gi,
  /\bnot (?:be )?(?:coming|going) back\b/gi,
  /\b(?:first and last|last) (?:time|visit|trip)\b/gi,
  /\bnot planning to return\b/gi,
  /\bwill not be returning\b/gi,
  /\bstopped going\b/gi,
]

// Subject-attributed counterfactual: "<subject> should have/should've/should of".
// Attribution decides the flag (or drops the hit) — see header.
const SHOULD_HAVE = /(\S+)\s+should(?:'ve| have| of|n'?t have)\b|^should(?:'ve| have| of)\b/gim
const FIRST_PERSON = new Set(['i', 'we', "i'd", 'i’d'])

// Core third-party subjects (true in any vertical) ⊕ the restaurant overlay.
// A future vertical adds its own overlay set (taxonomyDictionary pattern).
const BLAME_SUBJECTS_CORE = new Set([
  'they', 'he', 'she', 'manager', 'management', 'staff',
  'someone', 'somebody', 'owner', 'owners', 'corporate',
])
const BLAME_SUBJECTS_RESTAURANT = new Set([
  'server', 'waiter', 'waitress', 'kitchen', 'chef', 'hostess', 'restaurant',
])

export interface EmotionDetectOptions {
  /** Captive-audience verticals (airport, civic): churn intent is conceptually
   *  meaningless — the audience can't take their business elsewhere. */
  suppressChurn?: boolean
  /** Extra third-party blame subjects for the dataset's vertical. */
  blameSubjectOverlay?: ReadonlySet<string>
}

/** Negation guard: 'you will not be disappointed' / 'never disappoints' must
 *  not flag. Same token window the Tier-1 matcher uses. */
function precededByNegation(text: string, startIdx: number): boolean {
  if (startIdx <= 0) return false
  const before = text.slice(Math.max(0, startIdx - 80), startIdx)
  const words = before.toLowerCase().split(/[^a-z'’]+/i).filter(Boolean)
  const tail = words.slice(-NEGATION_WINDOW)
  for (const w of tail) {
    if (NEGATION_TOKENS.has(w)) return true
  }
  return false
}

/** First (index-earliest) un-negated match across a pattern list, with a small
 *  context window as the evidence span. Null when nothing fires. */
function firstHit(
  patterns: RegExp[],
  text: string,
  guardNegation: boolean,
): { idx: number; evidence: string } | null {
  let best: { idx: number; len: number } | null = null
  for (const p of patterns) {
    p.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = p.exec(text)) !== null) {
      if (!guardNegation || !precededByNegation(text, m.index)) {
        if (!best || m.index < best.idx) best = { idx: m.index, len: m[0].length }
        break // earliest match of THIS pattern found; try the next pattern
      }
      if (m.index === p.lastIndex) p.lastIndex++ // zero-width safety
    }
  }
  if (!best) return null
  const winStart = Math.max(0, best.idx - 20)
  const winEnd = Math.min(text.length, best.idx + best.len + 20)
  return { idx: best.idx, evidence: text.slice(winStart, winEnd).trim() }
}

/**
 * Detect emotion-language flags in one comment's text. Returns at most one
 * assertion per sub (evidence = earliest firing span). Pure and deterministic.
 */
export function detectEmotionAssertions(
  text: string,
  opts: EmotionDetectOptions = {},
): Assertion[] {
  if (!text || !text.trim()) return []

  const hits = new Map<EmotionSub, { idx: number; evidence: string }>()
  const record = (sub: EmotionSub, hit: { idx: number; evidence: string } | null) => {
    if (!hit) return
    const prev = hits.get(sub)
    if (!prev || hit.idx < prev.idx) hits.set(sub, hit)
  }

  record('disappointment', firstHit(DISAPPOINTMENT_PATTERNS, text, true))
  record('blame', firstHit(BLAME_PATTERNS, text, false))
  if (!opts.suppressChurn) record('churn intent', firstHit(CHURN_PATTERNS, text, false))

  // "should have" attribution (spot-check fixes): third-party subject → blame;
  // passive "should have been…" or impersonal subject → disappointment
  // (expectation gap, done TO the reviewer); first-person → regret → DROPPED.
  SHOULD_HAVE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = SHOULD_HAVE.exec(text)) !== null) {
    const subj = (m[1] ?? '').toLowerCase().replace(/[^a-z'’]/g, '')
    const after = text.slice(m.index + m[0].length).trimStart().toLowerCase()
    const passive = after.startsWith('been ') || after.startsWith('be ')
    const winStart = Math.max(0, m.index - 20)
    const winEnd = Math.min(text.length, m.index + m[0].length + 20)
    const hit = { idx: m.index, evidence: text.slice(winStart, winEnd).trim() }

    const isThirdParty = BLAME_SUBJECTS_CORE.has(subj)
      || BLAME_SUBJECTS_RESTAURANT.has(subj)
      || (opts.blameSubjectOverlay?.has(subj) ?? false)
    if (isThirdParty) record('blame', hit)
    else if (passive) record('disappointment', hit) // done TO the reviewer
    else if (FIRST_PERSON.has(subj)) { /* regret — dark until the LLM tier */ }
    else record('disappointment', hit) // impersonal subject → expectation gap
    if (m.index === SHOULD_HAVE.lastIndex) SHOULD_HAVE.lastIndex++
  }

  const assertions: Assertion[] = []
  for (const sub of EMOTION_SUBS) {
    const hit = hits.get(sub)
    if (!hit) continue
    assertions.push({
      axis: EMOTION_AXIS,
      sub,
      polarity: 'neg',
      confidence: EMOTION_CONFIDENCE,
      severity: 'normal',
      evidence: hit.evidence,
      source: 'keyword',
    })
  }
  return assertions
}
