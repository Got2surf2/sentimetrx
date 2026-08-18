// lib/verbatimGuard.ts
//
// A verbatim shown to support a claim must actually support it.
//
// Every surface that prints a customer quote does so to make a point: "here is
// what's going wrong at your worst outlets", "here is why this dimension sits
// below the network", "here is what guests praise". The quote is EVIDENCE. When
// the selected text doesn't carry the premise, the slide argues against itself,
// and the reader discounts the whole deck — not just that tile.
//
// This bit twice in one day (2026-08-18):
//   · the per-outlet Dimensions block quoted "Forgot how delicious the food is"
//     under a ▼ weakness;
//   · the Operational Review deck's "What Guests Are Telling You" slide, headed
//     "Verbatim 1–3★ reviews from the lowest-rated outlets", printed "I got
//     seated fast!" and "So I had a steak, med rare, steak was good." Two of six
//     tiles undercut the slide.
//
// ⭐ THE ROOT CAUSE, and the reason a rating check is not enough: the REVIEW is
// negative (1–3★, or a negative assertion) so the ROW is correctly selected —
// but the SENTENCE lifted out of it is not. A rating is a property of the
// review; a premise is a property of the text you display. Check them
// separately.
//
// ⭐ THE RULE: test any verbatim slotted for display against the premise of the
// thing it illustrates. Prefer `pickSupportingSentence` — a negative review
// usually DOES contain a negative sentence, so choose that one rather than the
// first. Dropping is the safe fallback: five supporting quotes beat six where
// two argue the opposite.

import { lexiconScore } from './themeUtils'
import { detectEmotionAssertions } from './emotionFlags'

/** What the surrounding claim asserts. A quote must read consistently with it. */
export type VerbatimPremise = 'negative' | 'positive'

// Cues the sentiment lexicon misses that matter specifically for EVIDENCE
// selection. Deliberately NOT added to lib/sentimentLexicon: that list drives
// theme sentiment product-wide (theme cards, opinion mining, deck figures), so
// widening it to fix quote picking would move published numbers. This guard is a
// different job — "does this sentence carry the claim?" — so it carries its own
// short list and leaves the classifier alone.
const NEG_CUES: RegExp[] = [
  /\bnot worth\b/i,
  /\bwaste of\b/i,
  /\brip[-\s]?off\b/i,
  /\bovercharged\b/i,
  /\bnot (?:coming|going) back\b/i,
  /\bno (?:one|body) (?:came|checked|helped)\b/i,
]
const POS_CUES: RegExp[] = [
  /\bimmaculate\b/i,
  /\bno complaints\b/i,
  /\bcan'?t fault\b/i,
  /\bcannot fault\b/i,
  /\bspot on\b/i,
  /\bsecond to none\b/i,
]

const hits = (text: string, pats: RegExp[]) => pats.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0)

/** Signed strength of the premise this text carries. >0 positive, <0 negative. */
function polarity(text: string): number {
  const { pos, neg } = lexiconScore(text)
  // Emotion signals (disappointment / blame / churn intent) are validated
  // negative markers the plain lexicon has no word for — reuse them rather than
  // restating their patterns here.
  const emotion = detectEmotionAssertions(text).length
  return (pos + hits(text, POS_CUES)) - (neg + hits(text, NEG_CUES) + emotion)
}

/**
 * Does this text carry the premise it is being shown to evidence?
 *
 * Deliberately strict: text with NO detectable polarity fails too. "I got seated
 * fast!" is not evidence of a problem, and neither is a neutral fragment —
 * silence is not support. A false negative costs one quote; a false positive
 * costs the credibility of the slide.
 */
export function verbatimSupports(text: string | null | undefined, premise: VerbatimPremise): boolean {
  const t = (text || '').trim()
  if (!t) return false
  const p = polarity(t)
  return premise === 'negative' ? p < 0 : p > 0
}

/**
 * The first candidate that carries the premise, or null when none does.
 * Order is the caller's preference order, so this filters without reordering.
 */
export function pickSupportingVerbatim(
  candidates: (string | null | undefined)[],
  premise: VerbatimPremise,
): string | null {
  for (const c of candidates) {
    if (verbatimSupports(c, premise)) return (c || '').trim()
  }
  return null
}

/**
 * The sentence from `fullText` that best carries the premise, or null.
 *
 * This is the preferred entry point when the whole review is available. A 1–3★
 * review almost always contains a sentence that says why — it just isn't
 * reliably the FIRST one ("So I had a steak, med rare, steak was good. Then…").
 * Picking the strongest-carrying sentence keeps the tile full AND on-message,
 * where a first-sentence fallback fills it with a contradiction.
 */
export function pickSupportingSentence(
  fullText: string | null | undefined,
  premise: VerbatimPremise,
  opts: { maxLen?: number } = {},
): string | null {
  const full = (fullText || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  if (!full) return null
  const maxLen = opts.maxLen ?? 180

  const finalise = (text: string): string => {
    // Same leading-punctuation clean as lib/outletReport's clamp — a sentence
    // split can leave ", and then…" at the front of a tile.
    let out = text.replace(/^[\s,;:.!?)\]}"'\u2019\u201d\-–—]+/, '')
    if (out.length > maxLen) out = out.slice(0, maxLen).replace(/\s\S*$/, '') + '…'
    return out.charAt(0).toUpperCase() + out.slice(1)
  }

  const scored = full.split(/(?<=[.!?])\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => ({ text: t, strength: premise === 'negative' ? -polarity(t) : polarity(t) }))
    .filter((x) => x.strength > 0)
    // Strongest signal first; on a tie the shorter sentence, which reads better
    // on a slide than a run-on.
    .sort((a, b) => b.strength - a.strength || a.text.length - b.text.length)

  // ⚠️ VERIFY AFTER TRUNCATION, NOT BEFORE. `maxLen` can cut the very words that
  // made the sentence qualify — a 200-char lead-in followed by "…the waiter was
  // wonderful" truncates to a neutral fragment. This is the same failure as
  // `clamp` in lib/outletReport's extractSentence, and it slipped straight back
  // in here: the first version of this function scored the raw sentence and then
  // truncated the winner, and a real-data sweep found two survivors. Whatever is
  // RETURNED is what gets displayed, so that is what has to pass.
  for (const { text } of scored) {
    const out = finalise(text)
    if (verbatimSupports(out, premise)) return out
  }
  return null
}
