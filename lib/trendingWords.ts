// lib/trendingWords.ts
//
// Computes top words/phrases ("terms") from arrays of free-text comments.
// Two surfaces use this:
//   1. PulseIQ live screen — "Trending Now" strip (top terms in recent turns).
//   2. Dataset analytics — "Trending words" section + click-to-modal deep-dive.
//
// Heuristics:
//   - Tokenize to lowercase alphanumeric runs (drops punctuation).
//   - Filter common English stopwords + tokens shorter than 3 chars.
//   - Build unigrams and (optionally) bigrams.
//   - For "trending": compare a recent window to a baseline window and rank
//     by rate ratio (smoothed to avoid div-by-zero spikes from rare terms).

const STOP_WORDS = new Set([
  // Articles, conjunctions, common prepositions
  'the','a','an','and','or','but','if','then','else','than','that','this','these','those',
  'is','am','are','was','were','be','been','being','do','does','did','done','doing',
  'have','has','had','having','will','would','can','could','should','shall','may','might','must',
  'to','of','in','for','on','with','at','by','from','about','as','into','onto','upon','during','before','after',
  'so','too','very','really','just','quite','also','only','more','most','less','least','some','any','all','no','not','none',
  'i','you','he','she','it','we','they','me','him','her','us','them','my','your','his','their','our','its',
  'what','when','where','who','whom','whose','why','how','which','one','two','three','first','second','last',
  // Verbs that don't carry topic meaning
  'get','got','gets','getting','go','going','goes','went','gone','come','comes','came','coming',
  'see','sees','saw','seen','seeing','say','says','said','saying','tell','told','telling',
  'think','thought','thinking','know','knew','known','knowing','want','wanted','wanting',
  'make','made','making','take','took','taken','taking','give','gave','given','giving',
  // Filler / hedging
  'like','really','actually','basically','literally','honestly','seriously','probably','maybe','kinda','sorta','stuff','things','thing','something','someone','people','person',
  // Conversational artifacts
  'yeah','yep','nope','ok','okay','well','um','uh','hmm','oh','ah','huh','wow','hey','hi','hello','please','thanks','thank',
  // Time words (low signal for topic spotting)
  'today','tomorrow','yesterday','now','then','always','never','sometimes','often','usually','still','yet','already','soon','later',
])

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .split(/\s+/)
    .map(t => t.replace(/^['-]+|['-]+$/g, '')) // strip leading/trailing punct
    .filter(t => t.length >= 3 && !STOP_WORDS.has(t) && !/^\d+$/.test(t))
}

function bigrams(tokens: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < tokens.length - 1; i++) {
    out.push(tokens[i] + ' ' + tokens[i + 1])
  }
  return out
}

export interface Term {
  word: string
  count: number
}

/** Top N most-frequent terms across the given texts. */
export function topTerms(
  texts: string[],
  opts: { n?: number; minCount?: number; includeBigrams?: boolean } = {},
): Term[] {
  const { n = 10, minCount = 2, includeBigrams = true } = opts
  const counts = new Map<string, number>()
  for (const text of texts) {
    if (!text) continue
    const toks = tokenize(text)
    for (const t of toks) counts.set(t, (counts.get(t) || 0) + 1)
    if (includeBigrams) {
      for (const bg of bigrams(toks)) counts.set(bg, (counts.get(bg) || 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .filter(([_, c]) => c >= minCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([word, count]) => ({ word, count }))
}

export interface TrendingTerm {
  word: string
  recentCount: number
  baselineCount: number
  /** recentRate / baselineRate — values > 1 mean trending up */
  ratio: number
}

/**
 * Compare a recent window to a baseline window. Returns terms ranked by rate
 * ratio (recent rate / baseline rate, with Laplace smoothing so a single rare
 * mention doesn't dominate the ranking).
 *
 * `recentTexts` and `baselineTexts` should be disjoint document sets — the
 * caller decides what "recent" means (last 5 minutes, last 7 days, etc).
 */
export function trendingTerms(
  recentTexts: string[] | { text: string; source: string }[],
  baselineTexts: string[],
  opts: {
    n?: number; minRecentCount?: number; includeBigrams?: boolean
    /** Terms to suppress (lowercase) — e.g. words already covered by the
     *  session's topic labels/keywords; a themed word isn't "trending". */
    exclude?: Set<string>
    /** Require a term to appear in at least this many distinct sources
     *  (e.g. conversations). One participant's typos ("teh", "adn") must
     *  not trend — a real trend comes from more than one voice. Only
     *  enforced when recentTexts items carry a source. */
    minSources?: number
  } = {},
): TrendingTerm[] {
  const { n = 10, minRecentCount = 2, includeBigrams = true, exclude, minSources = 1 } = opts

  const recentCounts = new Map<string, number>()
  const termSources = new Map<string, Set<string>>()
  for (const item of recentTexts as (string | { text: string; source: string })[]) {
    const text = typeof item === 'string' ? item : item?.text
    const source = typeof item === 'string' ? null : item?.source
    if (!text) continue
    const toks = tokenize(text)
    const all = includeBigrams ? [...toks, ...bigrams(toks)] : toks
    for (const t of all) {
      recentCounts.set(t, (recentCounts.get(t) || 0) + 1)
      if (source) {
        if (!termSources.has(t)) termSources.set(t, new Set())
        termSources.get(t)!.add(source)
      }
    }
  }

  const baselineCounts = new Map<string, number>()
  for (const text of baselineTexts) {
    if (!text) continue
    const toks = tokenize(text)
    for (const t of toks) baselineCounts.set(t, (baselineCounts.get(t) || 0) + 1)
    if (includeBigrams) for (const bg of bigrams(toks)) baselineCounts.set(bg, (baselineCounts.get(bg) || 0) + 1)
  }

  const recentSize   = Math.max(recentTexts.length, 1)
  const baselineSize = Math.max(baselineTexts.length, 1)

  const out: TrendingTerm[] = []
  for (const [word, recentCount] of Array.from(recentCounts.entries())) {
    if (recentCount < minRecentCount) continue
    if (exclude && exclude.has(word)) continue
    if (minSources > 1) {
      const s = termSources.get(word)
      if (s && s.size < minSources) continue
    }
    const baselineCount = baselineCounts.get(word) || 0
    // Smoothed rate ratio — adds 1 to baseline count and recentSize to baseline
    // size so a never-before-seen term ranks high without dividing by zero,
    // but a single random outlier doesn't overwhelm well-supported terms.
    const recentRate   = recentCount / recentSize
    const baselineRate = (baselineCount + 1) / (baselineSize + 1)
    const ratio        = recentRate / baselineRate
    out.push({ word, recentCount, baselineCount, ratio })
  }
  return out.sort((a, b) => b.ratio - a.ratio).slice(0, n)
}

/**
 * Top phrases that co-occur with a given term across a set of texts.
 * Used by the dataset modal's "Context" tag list (e.g. clicking "friendly"
 * shows that it most often appears alongside "server", "service", "staff").
 */
export function contextTermsFor(
  term: string,
  texts: string[],
  opts: { n?: number; minCount?: number } = {},
): Term[] {
  const { n = 12, minCount = 2 } = opts
  const target = term.toLowerCase()
  const matched = texts.filter(t => t && tokenize(t).includes(target))
  // Tokenize again, drop the search term itself so it doesn't appear in its own context list.
  const counts = new Map<string, number>()
  for (const text of matched) {
    const toks = tokenize(text).filter(t => t !== target)
    for (const t of toks) counts.set(t, (counts.get(t) || 0) + 1)
  }
  return Array.from(counts.entries())
    .filter(([_, c]) => c >= minCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([word, count]) => ({ word, count }))
}
