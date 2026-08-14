// lib/collocations.ts
//
// Sentence-scoped collocation: "what words does this term actually appear
// alongside?" — the legacy Ana "Context" view, ported.
//
// Powers the Context tab in the word modal (OpinionPopover) and the theme
// modal (ThemePopover). Distinct from lib/opinionMining.ts, which only keeps
// words that are in the sentiment lexicon within a ±2-token window; Context
// keeps EVERY content word that shares a sentence with the target, which is
// what surfaces nouns like "quality" / "portion" that carry no polarity of
// their own.
//
// Counting unit is the COMMENT (row), not the token — deliberately, so the
// number on a context word equals the number of comments you get when you
// click it. A cloud that says 280 and drills into 312 comments is a
// credibility bug, not a rounding difference.
//
// Two rankings, both computed here:
//   - count    — how many comments contain the pair (legacy parity)
//   - score    — G² log-likelihood association vs. the corpus baseline, so
//                distinctive partners beat merely-common ones. A word that
//                is everywhere in the dataset scores near zero even when its
//                raw co-occurrence count is high.

import { tokenize } from './trendingWords'

// `tokenize` keeps contractions whole ("we're", "it's", "that's"), so they slip
// past its stop list — which only carries the uncontracted "we" / "it" / "that".
// On conversational or spoken corpora they dominate the top of the cloud.
// Stripping the enclitic and re-testing fixes that, and folds possessives into
// the base word ("trump's" → "trump") so a name isn't split across two entries.
//   "don't" → "do" (stop) · "isn't" → "is" (stop) · "can't" → "ca" (too short)
const ENCLITIC = /(?:n't|'(?:s|re|ve|ll|d|m))$/

// Function words that survive trendingWords' list but carry no topic.
//
// DELIBERATELY NARROWER than the WordCloud stop set, which also drops
// good/great/new/long/time/day. Those are legitimate ANSWERS here: "what is
// food talked about with?" is good / great / delicious — the top of the
// legacy Context view. A word that's noise as a cloud entry can be the whole
// point as a collocate, so only unambiguous function words belong in here.
const CONTEXT_STOPS = new Set([
  'because', 'lot', 'lots', 'other', 'another', 'way', 'ways',
  'out', 'back', 'off', 'own', 'due', 'per', 'such', 'here', 'there', 'same',
  'even', 'ever', 'every', 'each', 'few', 'many', 'much', 'both',
  'between', 'during', 'while', 'through', 'without', 'within', 'against',
  'along', 'since', 'away', 'around', 'able',
])

/**
 * Tokens eligible to appear as CONTEXT for a term. Layers contraction handling
 * and the extra function-word stops on top of the shared tokenizer, and is used
 * by BOTH passes so a candidate word and its corpus baseline count the same
 * surface forms.
 */
export function contextTokens(text: string): string[] {
  const out: string[] = []
  for (const raw of tokenize(text)) {
    const tok = normalizeToken(raw)
    if (tok) out.push(tok)
  }
  return out
}

/** Normalize one already-tokenized word, or '' if it should be dropped. */
function normalizeToken(raw: string): string {
  let tok = raw
  if (ENCLITIC.test(tok)) {
    tok = tok.replace(ENCLITIC, '')
    // Re-test: the contracted form dodged the stop list, the base may not.
    if (tok.length < 3 || tokenize(tok).length === 0) return ''
  }
  if (tok.length < 3 || CONTEXT_STOPS.has(tok)) return ''
  return tok
}

export interface Collocate {
  word: string
  /** Comments where this word shares a sentence with the target. */
  count: number
  /** Comments containing this word anywhere in the corpus (the baseline). */
  corpusCount: number
  /** G² log-likelihood. Positive = attracted to the target, negative = avoided. */
  score: number
}

export interface CollocationResult {
  targets: string[]
  /** Comments containing any target term. */
  matchedRows: number
  /** Comments with any text in the analyzed fields — the denominator. */
  totalRows: number
  /** Ranked by co-occurrence count — the legacy Context ordering. */
  byCount: Collocate[]
  /** Ranked by G² association, with the low-frequency floor applied. */
  byDistinctive: Collocate[]
}

/** Split on sentence terminators and newlines, keeping trailing punctuation. */
export function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?\n\r]+[.!?]*/g)
  if (!parts) return []
  const out: string[] = []
  for (const p of parts) {
    const t = p.trim()
    if (t) out.push(t)
  }
  return out
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// CANONICAL term-match regex — word-boundary, case-insensitive. Same shape as
// themeUtils.buildKwRegex / opinionMining / WordCloud so the mention counts in
// the Context tab agree with the ones in every other surface on the page.
function targetRegexes(targets: string[]): RegExp[] {
  const out: RegExp[] = []
  for (const t of targets) {
    const trimmed = String(t || '').trim()
    if (trimmed) out.push(new RegExp('\\b' + escapeRe(trimmed) + '\\b', 'i'))
  }
  return out
}

/** Tokens that ARE the target — never listed as their own context. */
function targetTokenSet(targets: string[]): Set<string> {
  const set = new Set<string>()
  for (const t of targets) {
    const lower = String(t || '').trim().toLowerCase()
    if (!lower) continue
    set.add(lower)
    for (const tok of contextTokens(lower)) set.add(tok)
  }
  return set
}

// G² (log-likelihood ratio) on the 2×2 table of
// [contains target] × [contains word]. Signed so anti-collocates come out
// negative rather than looking like a strong association.
function logLikelihood(both: number, targetRows: number, wordRows: number, total: number): number {
  if (total <= 0) return 0
  const o11 = both
  const o12 = targetRows - both
  const o21 = wordRows - both
  const o22 = total - targetRows - wordRows + both
  if (o12 < 0 || o21 < 0 || o22 < 0) return 0
  const e11 = (targetRows * wordRows) / total
  const e12 = (targetRows * (total - wordRows)) / total
  const e21 = ((total - targetRows) * wordRows) / total
  const e22 = ((total - targetRows) * (total - wordRows)) / total
  const term = (o: number, e: number) => (o > 0 && e > 0 ? o * Math.log(o / e) : 0)
  const g2 = 2 * (term(o11, e11) + term(o12, e12) + term(o21, e21) + term(o22, e22))
  return o11 >= e11 ? g2 : -g2
}

export interface CollocationOptions {
  /** Words kept per ranking (frequency and distinctiveness each get this many). */
  limit?: number
  /** Drop context words appearing in fewer than this many comments. */
  minCount?: number
}

/** Maximum candidates carried into the corpus-baseline pass. */
const CANDIDATE_POOL = 150

// Same token shape tokenize() produces (a maximal [a-z0-9'-] run with the
// leading/trailing punctuation stripped), but as a scanning regex — no
// intermediate arrays. Used for the baseline pass, which only needs
// membership tests against an already-normalized candidate set.
const TOKEN_SCAN = /[a-z0-9'-]+/g

/**
 * Context words for one or more target terms (a single cloud word, or every
 * keyword in a theme).
 *
 * Two passes, both shaped by the fact that TextMine hands us up to 50K rows
 * and this runs synchronously when the tab opens:
 *
 *   1. Co-occurrence — only rows that actually mention a target get split into
 *      sentences and tokenized. On a real corpus most rows don't.
 *   2. Corpus baseline — a lean scan over every row, counting only the ~150
 *      candidate words pass 1 surfaced, so it never tokenizes the corpus.
 *
 * Both rankings come back sorted, so the UI toggle is a list swap rather than
 * a recompute, and the ranking rules live in exactly one place.
 */
export function computeCollocates(
  rows: Record<string, unknown>[],
  fields: string | string[],
  targets: string[],
  opts: CollocationOptions = {},
): CollocationResult {
  const limit = opts.limit ?? 24
  const minCount = opts.minCount ?? 2
  const fieldArr = Array.isArray(fields) ? fields : [fields]
  const regexes = targetRegexes(targets)
  const selfTokens = targetTokenSet(targets)

  if (regexes.length === 0) {
    return { targets, matchedRows: 0, totalRows: 0, byCount: [], byDistinctive: [] }
  }

  // ── Pass 1: co-occurrence ────────────────────────────────────────────────
  const nearCounts = new Map<string, number>()
  const rowTexts: string[][] = []
  let matchedRows = 0

  for (const row of rows) {
    const texts: string[] = []
    for (const field of fieldArr) {
      const text = String(row[field] ?? '').trim()
      if (text) texts.push(text)
    }
    if (texts.length === 0) continue
    rowTexts.push(texts)

    // Counted once per COMMENT, so the number on a context word equals the
    // number of comments the drill-down returns.
    const near = new Set<string>()
    let isMatch = false
    for (const text of texts) {
      let mentionsTarget = false
      for (const re of regexes) {
        if (re.test(text)) { mentionsTarget = true; break }
      }
      if (!mentionsTarget) continue
      isMatch = true
      for (const sentence of splitSentences(text)) {
        let hit = false
        for (const re of regexes) {
          if (re.test(sentence)) { hit = true; break }
        }
        if (!hit) continue
        for (const tok of contextTokens(sentence)) {
          if (!selfTokens.has(tok)) near.add(tok)
        }
      }
    }
    if (isMatch) matchedRows++
    for (const tok of near) nearCounts.set(tok, (nearCounts.get(tok) || 0) + 1)
  }

  const totalRows = rowTexts.length

  // ── Pass 2: corpus baseline for the surviving candidates ─────────────────
  const candidates = [...nearCounts.entries()]
    .filter(e => e[1] >= minCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, CANDIDATE_POOL)

  const candidateSet = new Set(candidates.map(e => e[0]))
  const corpusCounts = new Map<string, number>()
  if (candidateSet.size > 0) {
    for (const texts of rowTexts) {
      const seen = new Set<string>()
      for (const text of texts) {
        const lower = text.toLowerCase()
        TOKEN_SCAN.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = TOKEN_SCAN.exec(lower)) !== null) {
          // Same normalization as pass 1 — otherwise "trump's" in the corpus
          // wouldn't count toward the "trump" candidate and the baseline
          // (hence the G² score) would be understated.
          const tok = normalizeToken(m[0].replace(/^['-]+|['-]+$/g, ''))
          if (tok && candidateSet.has(tok)) seen.add(tok)
        }
      }
      for (const tok of seen) corpusCounts.set(tok, (corpusCounts.get(tok) || 0) + 1)
    }
  }

  const all: Collocate[] = candidates.map(([word, count]) => {
    const corpusCount = Math.max(corpusCounts.get(word) || 0, count)
    return { word, count, corpusCount, score: logLikelihood(count, matchedRows, corpusCount, totalRows) }
  })

  const byCount = [...all]
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, limit)

  // G² rewards exclusivity, so on a small selection a word appearing in 2
  // comments and nowhere else outranks a genuine partner appearing in 6.
  // Floor the distinctiveness ranking at 3 comments (or 2% of the target's
  // comments, whichever is larger); fall back to the unfloored list only when
  // the floor would leave the tab empty — a short honest list beats a long
  // noisy one.
  const floor = Math.max(3, Math.ceil(matchedRows * 0.02))
  const floored = all.filter(c => c.count >= floor)
  const scorePool = floored.length > 0 ? floored : all
  const byDistinctive = [...scorePool]
    .sort((a, b) => b.score - a.score || b.count - a.count)
    .slice(0, limit)

  return { targets, matchedRows, totalRows, byCount, byDistinctive }
}

/**
 * The rows behind one context word — every comment where `collocate` shares a
 * sentence with a target term. Uses the same sentence scoping as
 * computeCollocates, so `filterCooccurringRows(...).length` always equals the
 * count rendered on that word in the cloud.
 */
export function filterCooccurringRows(
  rows: Record<string, unknown>[],
  fields: string | string[],
  targets: string[],
  collocate: string,
): Record<string, unknown>[] {
  const fieldArr = Array.isArray(fields) ? fields : [fields]
  const regexes = targetRegexes(targets)
  const word = String(collocate || '').trim().toLowerCase()
  if (regexes.length === 0 || !word) return []

  const out: Record<string, unknown>[] = []
  for (const row of rows) {
    let hit = false
    for (const field of fieldArr) {
      const text = String(row[field] ?? '').trim()
      if (!text) continue
      for (const sentence of splitSentences(text)) {
        let matchesTarget = false
        for (const re of regexes) {
          if (re.test(sentence)) { matchesTarget = true; break }
        }
        if (!matchesTarget) continue
        // contextTokens, not tokenize — the drill-down must apply the exact
        // normalization that produced the chip's count.
        if (contextTokens(sentence).includes(word)) { hit = true; break }
      }
      if (hit) break
    }
    if (hit) out.push(row)
  }
  return out
}
