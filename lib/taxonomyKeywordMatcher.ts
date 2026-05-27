// lib/taxonomyKeywordMatcher.ts
//
// Tier 1 keyword classifier — runs the dictionary in lib/taxonomyKeywords.ts
// against a review text and emits assertions in the same shape as the LLM
// extractor. No AI calls. Fully deterministic.
//
// Simple-NLP features:
//   - Case-insensitive phrase scan.
//   - Word-boundary-aware (so 'wine' doesn't match 'winery'; 'beer' doesn't
//     match 'cheerleader'). Multi-word phrases match as a substring with
//     boundaries at both ends.
//   - Negation flip: if a sentiment phrase is preceded by 'not'/'no'/"wasn't"/
//     etc. within NEGATION_WINDOW tokens, its polarity flips (pos↔neg, neu stays).
//   - Dedup by (axis, sub, item): same tuple matched multiple times → keep
//     the strongest single assertion (severity escalation > polarity strength).
//
// What it does NOT do (those are LLM jobs):
//   - mixed-polarity within one sentence
//   - novel phrasings outside the dictionary
//   - severity judgment based on context (just uses per-phrase default severity)
//   - sarcasm/irony

import {
  KEYWORD_DICTIONARY,
  NEGATION_TOKENS,
  NEGATION_WINDOW,
  type KeywordEntry,
} from './taxonomyKeywords'
import type {
  Assertion,
  Polarity,
  Severity,
} from './taxonomyVocabulary'

const KEYWORD_CONFIDENCE = 0.85

// Word-boundary regex helpers --------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Build a case-insensitive global regex with word boundaries around the phrase. */
function phraseRegex(phrase: string): RegExp {
  // \b doesn't work cleanly across non-word boundaries like ' or -, so we
  // approximate: require start-of-string OR non-word-char on both ends.
  // Use lookbehind/lookahead for non-consuming boundaries.
  const esc = escapeRegex(phrase)
  return new RegExp(`(?<![A-Za-z0-9])${esc}(?![A-Za-z0-9])`, 'gi')
}

function flipPolarity(p: Polarity): Polarity {
  if (p === 'pos') return 'neg'
  if (p === 'neg') return 'pos'
  return p
}

/**
 * Check whether the match at startIdx is preceded by a negation word within
 * NEGATION_WINDOW tokens (whitespace-split). True → flip polarity.
 */
function precededByNegation(text: string, startIdx: number): boolean {
  if (startIdx <= 0) return false
  const before = text.slice(Math.max(0, startIdx - 80), startIdx)
  // Split into words; drop empty.
  const words = before.toLowerCase().split(/[^a-z']+/i).filter(Boolean)
  const tail = words.slice(-NEGATION_WINDOW)
  for (const w of tail) {
    if (NEGATION_TOKENS.has(w)) return true
  }
  return false
}

interface ScratchHit {
  axis: string
  sub: string
  item?: string
  polarity: Polarity
  severity: Severity
  evidence: string
  matchIdx: number
}

function scanEntry(entry: KeywordEntry, text: string): ScratchHit[] {
  const hits: ScratchHit[] = []
  for (const p of entry.phrases) {
    const rx = phraseRegex(p.phrase)
    let m: RegExpExecArray | null
    while ((m = rx.exec(text)) !== null) {
      const matchedText = m[0]
      const matchIdx = m.index

      let polarity: Polarity = p.polarity
      if ((polarity === 'pos' || polarity === 'neg') && precededByNegation(text, matchIdx)) {
        polarity = flipPolarity(polarity)
      }

      // Evidence: matched phrase + a small surrounding window for context.
      const winStart = Math.max(0, matchIdx - 20)
      const winEnd = Math.min(text.length, matchIdx + matchedText.length + 20)
      const window = text.slice(winStart, winEnd).trim()

      hits.push({
        axis: entry.axis,
        sub: entry.sub,
        item: entry.item,
        polarity,
        severity: p.severity ?? 'normal',
        evidence: window,
        matchIdx,
      })

      // Avoid infinite loop on zero-width matches
      if (m.index === rx.lastIndex) rx.lastIndex++
    }
  }
  return hits
}

/**
 * Severity rank for picking the "stronger" of two hits on the same tuple.
 * crisis (2) > alert (1) > normal (0).
 */
function sevRank(s: Severity): number {
  if (s === 'crisis') return 2
  if (s === 'alert') return 1
  return 0
}

/**
 * Polarity rank for picking the "stronger" of two hits on the same tuple.
 * Non-neu (1) > neu (0). When both non-neu and they differ, the first match wins
 * (we don't try to detect mixed polarity at the keyword tier).
 */
function polRank(p: Polarity): number {
  return p === 'neu' ? 0 : 1
}

/**
 * Collapse multiple hits on (axis, sub, item) into one. Prefer:
 *   - higher severity
 *   - then non-neu polarity
 *   - then earliest matchIdx (for stable evidence)
 */
function collapseHits(hits: ScratchHit[]): ScratchHit[] {
  const byKey = new Map<string, ScratchHit>()
  for (const h of hits) {
    const k = `${h.axis}|${h.sub}|${h.item ?? ''}`
    const prev = byKey.get(k)
    if (!prev) { byKey.set(k, h); continue }
    if (sevRank(h.severity) > sevRank(prev.severity)) { byKey.set(k, h); continue }
    if (sevRank(h.severity) === sevRank(prev.severity)
        && polRank(h.polarity) > polRank(prev.polarity)) { byKey.set(k, h); continue }
    if (sevRank(h.severity) === sevRank(prev.severity)
        && polRank(h.polarity) === polRank(prev.polarity)
        && h.matchIdx < prev.matchIdx) {
      byKey.set(k, h)
    }
  }
  return Array.from(byKey.values())
}

export interface KeywordMatchResult {
  assertions: Assertion[]
  /** How many raw phrase hits before collapse — useful for diagnostics. */
  raw_hit_count: number
}

export function classifyByKeyword(text: string): KeywordMatchResult {
  if (!text || !text.trim()) return { assertions: [], raw_hit_count: 0 }
  const raw: ScratchHit[] = []
  for (const entry of KEYWORD_DICTIONARY) {
    raw.push(...scanEntry(entry, text))
  }
  const collapsed = collapseHits(raw)

  const assertions: Assertion[] = collapsed.map(h => {
    const a: Assertion = {
      axis: h.axis as Assertion['axis'],
      sub: h.sub,
      polarity: h.polarity,
      severity: h.severity,
      confidence: KEYWORD_CONFIDENCE,
      evidence: h.evidence,
      source: 'keyword',
    }
    if (h.item) a.item = h.item
    return a
  })

  return { assertions, raw_hit_count: raw.length }
}

// ── Hybrid merge: keyword + LLM ─────────────────────────────────────────────

/**
 * Merge a keyword-tier result with an LLM-tier result. Strategy:
 *   - Index keyword assertions by (axis, sub).
 *   - For each LLM assertion:
 *       - If (axis, sub) overlaps a keyword assertion → mark both as 'both'.
 *         Prefer LLM's evidence (it tends to be more grounded and may include
 *         a longer span). Prefer LLM's polarity (context-aware). Severity:
 *         take the higher of the two.
 *       - Otherwise → add as LLM-only.
 *   - Keyword assertions not matched by any LLM assertion stay as keyword-only.
 *
 * Note: the LLM is responsible for refusing to invent unsupported assertions
 * (prompt v4 rule 2a). The keyword tier is responsible for catching the
 * obvious-and-explicit. The intersection is high-confidence; the union is
 * the full picture.
 */
export function mergeAssertions(
  keywordAssertions: Assertion[],
  llmAssertions: Assertion[],
): Assertion[] {
  const byKey = new Map<string, Assertion>()
  for (const a of keywordAssertions) {
    byKey.set(`${a.axis}|${a.sub}`, { ...a, source: 'keyword' })
  }

  for (const llm of llmAssertions) {
    const k = `${llm.axis}|${llm.sub}`
    const kw = byKey.get(k)
    if (kw) {
      // Both tiers agree on the bucket → upgrade source.
      byKey.set(k, {
        ...llm,
        // Keep keyword's item if LLM didn't specify one.
        item: llm.item ?? kw.item,
        // Take the higher severity (crisis > alert > normal).
        severity: sevRank(llm.severity) >= sevRank(kw.severity) ? llm.severity : kw.severity,
        // LLM evidence wins when present (richer); fall back to keyword's.
        evidence: llm.evidence ?? kw.evidence,
        // Confidence: LLM's value, but ratchet up by ~10% for the cross-tier
        // confirmation, capped at 0.99.
        confidence: Math.min(0.99, (llm.confidence ?? 0.7) + 0.1),
        source: 'both',
      })
    } else {
      byKey.set(k, { ...llm, source: 'llm' })
    }
  }

  return Array.from(byKey.values())
}
