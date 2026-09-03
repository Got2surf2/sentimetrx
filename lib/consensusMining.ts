// lib/consensusMining.ts
// Stratified + consensus theme mining (owner-directed, 2026-09-03).
//
// WHY: a single AI mine reads ONE sample and returns ONE draw of a stochastic
// process. Measured failure (EA Football, 2026-09-03): a 350-review sample
// whose own summary read "overwhelmingly negative" dropped the corpus's
// positive theme entirely — the sample was skewed AND there was no way to
// tell which themes were stable structure vs run noise. Two-part fix:
//
//  1. STRATIFY each mining sample by rating/recommend bucket × time position
//     (proportional allocation — representation by construction, not luck).
//  2. CONSENSUS: K independent mines on DISJOINT stratified samples, themes
//     matched across runs by keyword/name overlap; only themes recurring in
//     ≥ minSupport runs survive. Keywords merge (union, capped), sentiment by
//     majority, and each surviving theme carries stability metrics the UI can
//     show ("stable in 3/3 runs · keyword agreement 62%").
//
// Caveat (stated to owner): consensus stabilizes STRUCTURE, not truth — if
// every sample were skewed the same way, K runs would agree on the same wrong
// model. Stratification protects representativeness; consensus kills run
// noise. Both halves are required.

import { buildKwRegex } from './themeUtils'
import type { MinedTheme } from './themeMining'

// ── Part 1: stratified disjoint sampling ────────────────────────────────────

// Bucket a row's rating value. ≤6 distinct raw values → each value is its own
// stratum (covers 1–5 stars, yes/no recommend, NPS 0–10 collapses below);
// more → thirds of the observed numeric range. Missing/unparseable → 'none'.
export function ratingBuckets(values: (string | number | null | undefined)[]): string[] {
  const raw = values.map(v => (v === null || v === undefined ? '' : String(v).trim()))
  const distinct = new Set(raw.filter(Boolean))
  if (distinct.size > 0 && distinct.size <= 6) {
    return raw.map(v => (v ? 'v:' + v : 'none'))
  }
  const nums = raw.map(v => parseFloat(v))
  const present = nums.filter(n => !isNaN(n))
  if (!present.length) return raw.map(() => 'none')
  const lo = Math.min(...present), hi = Math.max(...present)
  const span = hi - lo
  return nums.map(n => {
    if (isNaN(n)) return 'none'
    if (span === 0) return 'mid'
    const t = (n - lo) / span
    return t < 1 / 3 ? 'low' : t < 2 / 3 ? 'mid' : 'high'
  })
}

// Full stratum key per item: rating bucket × time quartile (position in the
// input order is the time proxy — rows arrive in row_index order).
export function stratumKeys(ratingVals: (string | number | null | undefined)[], timeBuckets = 4): string[] {
  const rb = ratingBuckets(ratingVals)
  const total = rb.length
  return rb.map((b, i) => b + '|q' + (total ? Math.min(timeBuckets - 1, Math.floor((i / total) * timeBuckets)) : 0))
}

// Evenly spaced index picks (same spirit as themeUtils.evenSample, over indices).
function evenIndices(len: number, n: number): number[] {
  if (len <= n) return Array.from({ length: len }, (_, i) => i)
  const step = len / n
  return Array.from({ length: n }, (_, i) => Math.floor(i * step))
}

/**
 * K disjoint stratified samples of size ~n each, deterministic.
 * `buckets[i]` is item i's stratum key; returns k arrays of item indices.
 *
 * Per stratum: proportional allocation (largest remainder), pick k×alloc
 * evenly spaced items, deal them round-robin so every run stays spread across
 * the stratum. A stratum too small for k disjoint allocations is dealt whole —
 * runs simply get fewer rows from it (disjointness is never sacrificed).
 */
export function stratifiedDisjointSamples(buckets: string[], n: number, k: number): number[][] {
  const total = buckets.length
  const runs: number[][] = Array.from({ length: k }, () => [])
  if (!total || n <= 0 || k <= 0) return runs

  const byStratum = new Map<string, number[]>()
  buckets.forEach((b, i) => {
    const arr = byStratum.get(b)
    if (arr) arr.push(i)
    else byStratum.set(b, [i])
  })

  // Proportional allocation with largest-remainder rounding (Σ alloc = n).
  const strata = Array.from(byStratum.entries()).map(([key, idx]) => {
    const exact = (idx.length / total) * n
    return { key, idx, exact, alloc: Math.floor(exact) }
  })
  let remaining = n - strata.reduce((s, x) => s + x.alloc, 0)
  strata
    .slice()
    .sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)))
    .forEach(s => { if (remaining > 0 && s.alloc < s.idx.length) { s.alloc++; remaining-- } })

  for (const s of strata) {
    if (!s.alloc) continue
    const want = Math.min(s.idx.length, s.alloc * k)
    const picks = evenIndices(s.idx.length, want).map(j => s.idx[j])
    picks.forEach((itemIdx, j) => { runs[j % k].push(itemIdx) })
  }
  runs.forEach(r => r.sort((a, b) => a - b))
  return runs
}

/** Human-readable sample composition for the mining prompt (top buckets by share). */
export function compositionNote(ratingVals: (string | number | null | undefined)[], fieldLabel: string): string | null {
  const rb = ratingBuckets(ratingVals)
  const counts = new Map<string, number>()
  rb.forEach(b => counts.set(b, (counts.get(b) || 0) + 1))
  const total = rb.length
  if (!total || counts.size < 2) return null
  const parts = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([b, c]) => Math.round((c / total) * 100) + '% ' + (b.startsWith('v:') ? '"' + b.slice(2) + '"' : b))
  return 'Sample composition by ' + fieldLabel + ': ' + parts.join(', ') +
    '. The sample is stratified to mirror the full dataset — capture themes from EVERY segment present, including minority sentiment (do not collapse the sample into its dominant tone). ' +
    'Where both satisfied and dissatisfied voices appear, include at least one theme for EACH side: complaints are easy to name, but what satisfied respondents praise is a required theme too, not background noise.'
}

// ── Part 2: consensus across K mined models ─────────────────────────────────

export interface ThemeStability {
  /** Runs this theme appeared in. */
  support: number
  /** Total runs. */
  runs: number
  /** Mean pairwise keyword agreement among the matched run-themes, 0–100. */
  kwAgreement: number
}

export interface ConsensusTheme extends MinedTheme { stability: ThemeStability }

export interface ConsensusResult {
  themes: ConsensusTheme[]
  /** Candidate themes that failed the support bar (name + how many runs had them). */
  dropped: { name: string; support: number }[]
  runs: number
  minSupport: number
}

// Light stem for cross-run keyword comparison: lowercase, strip a common
// suffix, collapse a doubled final consonant, drop a trailing 'e' so
// freeze/freezing, crash/crashes, lag/lagging all reduce to one stem.
function stemLite(w: string): string {
  let s = w.toLowerCase().trim()
  for (const suf of ['ings', 'ing', 'ers', 'ies', 'ed', 'er', 'es', 's']) {
    if (s.length > suf.length + 2 && s.endsWith(suf)) { s = s.slice(0, -suf.length); break }
  }
  if (s.length > 3 && s[s.length - 1] === s[s.length - 2]) s = s.slice(0, -1)
  if (s.length > 3 && s.endsWith('e')) s = s.slice(0, -1)
  return s
}

// Two keywords are equivalent when the product's own matcher matches either
// against the other, or their word-by-word light stems agree — consensus
// should never count "freeze" and "freezing" as two distinct keywords.
function kwEquivalent(a: string, b: string): boolean {
  const al = a.toLowerCase(), bl = b.toLowerCase()
  if (al === bl) return true
  const sa = al.split(/\s+/).map(stemLite).join(' ')
  const sb = bl.split(/\s+/).map(stemLite).join(' ')
  if (sa === sb) return true
  try { return buildKwRegex(a).test(bl) || buildKwRegex(b).test(al) } catch { return false }
}

/** Fuzzy Jaccard over keyword sets using matcher-equivalence (greedy 1:1 pairing). */
export function keywordJaccard(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 0
  const usedB = new Set<number>()
  let inter = 0
  for (const ka of a) {
    for (let j = 0; j < b.length; j++) {
      if (usedB.has(j)) continue
      if (kwEquivalent(ka, b[j])) { usedB.add(j); inter++; break }
    }
  }
  return inter / (a.length + b.length - inter)
}

const NAME_STOP = new Set(['and', 'or', 'the', 'of', 'a', 'an', 'to', 'in', 'on', 'for', 'with', 'issues', 'concerns', 'problems', 'complaints', 'experience', 'quality', 'feedback', 'general'])

function nameTokens(name: string): Set<string> {
  return new Set(
    (name || '').toLowerCase().split(/[^a-z0-9]+/)
      .filter(t => t.length > 2 && !NAME_STOP.has(t))
      .map(t => t.replace(/(ing|ers?|s)$/, ''))
  )
}

function nameOverlap(a: string, b: string): number {
  const ta = nameTokens(a), tb = nameTokens(b)
  if (!ta.size || !tb.size) return 0
  let inter = 0
  ta.forEach(t => { if (tb.has(t)) inter++ })
  return inter / (ta.size + tb.size - inter)
}

const DESC_STOP = new Set(['the', 'and', 'or', 'of', 'a', 'an', 'to', 'in', 'on', 'for', 'with', 'that', 'this', 'are', 'is', 'was', 'were', 'be', 'being', 'have', 'has', 'from', 'their', 'they', 'about', 'many', 'often', 'frequently', 'report', 'reports', 'reviewers', 'reviewer', 'respondents', 'respondent', 'players', 'player', 'users', 'user', 'customers', 'customer', 'people', 'complain', 'complaints', 'mention', 'mentions', 'express', 'describe', 'discuss', 'cite', 'citing', 'including', 'such', 'other', 'game', 'games'])

function descTokens(desc: string): Set<string> {
  return new Set(
    (desc || '').toLowerCase().split(/[^a-z0-9]+/)
      .filter(t => t.length > 2 && !DESC_STOP.has(t))
      .map(stemLite)
  )
}

function descOverlap(a: string, b: string): number {
  const ta = descTokens(a), tb = descTokens(b)
  if (!ta.size || !tb.size) return 0
  let inter = 0
  ta.forEach(t => { if (tb.has(t)) inter++ })
  return inter / (ta.size + tb.size - inter)
}

// The STRONGEST single signal decides, not a weighted average — an average
// dilutes a decisive signal with the two that happen to miss. Two runs' crash
// themes can pick near-disjoint keyword flavors ("crash, freeze, bug" vs
// "lag, stutter, fps") yet describe the same failure in near-identical
// vocabulary; measured on TEST EA Football (2026-09-03), keyword+name blend
// scored that pair 0.14 and a 3/3-stable Technical Performance theme was
// dropped from the next generation's consensus. Scales rank the signals'
// trustworthiness: shared keywords > shared description vocabulary > name.
export function themeSimilarity(a: MinedTheme, b: MinedTheme): number {
  return Math.max(
    keywordJaccard(a.keywords || [], b.keywords || []),
    0.8 * descOverlap(a.description || '', b.description || ''),
    0.7 * nameOverlap(a.name, b.name),
  )
}

/** Minimum similarity for two run-themes to be considered the same theme. */
const MATCH_THRESHOLD = 0.25

interface Cluster { members: { run: number; theme: MinedTheme }[] }

/**
 * Match themes across K independently mined models and keep only those with
 * support ≥ minSupport (default: majority of runs). Greedy agglomerative:
 * clusters seed from the first run; each later run's themes pair to their most
 * similar cluster (one theme per run per cluster), else start a new cluster.
 */
export function consensusThemes(models: MinedTheme[][], minSupportArg?: number): ConsensusResult {
  const runs = models.length
  const minSupport = minSupportArg ?? Math.max(2, Math.ceil(runs / 2))
  const clusters: Cluster[] = (models[0] || []).map(t => ({ members: [{ run: 0, theme: t }] }))

  for (let r = 1; r < runs; r++) {
    const themes = models[r] || []
    const pairs: { ti: number; ci: number; sim: number }[] = []
    themes.forEach((t, ti) => {
      clusters.forEach((c, ci) => {
        const sim = c.members.reduce((s, m) => s + themeSimilarity(t, m.theme), 0) / c.members.length
        if (sim >= MATCH_THRESHOLD) pairs.push({ ti, ci, sim })
      })
    })
    pairs.sort((a, b) => b.sim - a.sim)
    const takenTheme = new Set<number>(), takenCluster = new Set<number>()
    for (const p of pairs) {
      if (takenTheme.has(p.ti) || takenCluster.has(p.ci)) continue
      clusters[p.ci].members.push({ run: r, theme: themes[p.ti] })
      takenTheme.add(p.ti); takenCluster.add(p.ci)
    }
    themes.forEach((t, ti) => { if (!takenTheme.has(ti)) clusters.push({ members: [{ run: r, theme: t }] }) })
  }

  const kept: ConsensusTheme[] = []
  const dropped: { name: string; support: number }[] = []
  clusters.forEach((c, ci) => {
    const support = c.members.length
    if (support < minSupport) {
      dropped.push({ name: c.members[0].theme.name, support })
      return
    }
    // Medoid member (highest mean similarity to the others) names the theme.
    let medoid = c.members[0]
    if (c.members.length > 1) {
      let best = -1
      for (const m of c.members) {
        const mean = c.members.reduce((s, o) => (o === m ? s : s + themeSimilarity(m.theme, o.theme)), 0) / (c.members.length - 1)
        if (mean > best) { best = mean; medoid = m }
      }
    }
    // Keywords: union ranked by how many runs carry an equivalent, capped.
    const kwVotes: { kw: string; votes: number; order: number }[] = []
    c.members.forEach(m => {
      (m.theme.keywords || []).forEach((kw, oi) => {
        const hit = kwVotes.find(v => kwEquivalent(v.kw, kw))
        if (hit) hit.votes++
        else kwVotes.push({ kw, votes: 1, order: kwVotes.length * 100 + oi })
      })
    })
    const keywords = kwVotes
      .sort((a, b) => b.votes - a.votes || a.order - b.order)
      .slice(0, 15)
      .map(v => v.kw)
    // Sentiment: majority, medoid breaks ties.
    const sentVotes = new Map<string, number>()
    c.members.forEach(m => { const s = m.theme.sentiment || ''; if (s) sentVotes.set(s, (sentVotes.get(s) || 0) + 1) })
    let sentiment = medoid.theme.sentiment
    let bestVotes = 0
    sentVotes.forEach((v, s) => { if (v > bestVotes || (v === bestVotes && s === medoid.theme.sentiment)) { bestVotes = v; sentiment = s } })
    // Mean pairwise keyword agreement within the cluster.
    let agree = 0, nPairs = 0
    for (let i = 0; i < c.members.length; i++) {
      for (let j = i + 1; j < c.members.length; j++) {
        agree += keywordJaccard(c.members[i].theme.keywords || [], c.members[j].theme.keywords || [])
        nPairs++
      }
    }
    kept.push({
      ...medoid.theme,
      id: 'ct' + (ci + 1),
      keywords,
      sentiment,
      stability: {
        support,
        runs,
        kwAgreement: nPairs ? Math.round((agree / nPairs) * 100) : 100,
      },
    })
  })

  kept.sort((a, b) => b.stability.support - a.stability.support || (b.count || 0) - (a.count || 0))
  return { themes: kept, dropped, runs, minSupport }
}
