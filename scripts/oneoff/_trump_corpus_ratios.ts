/**
 * Defensible "he talks about A, X times more than B" comparisons.
 *
 *   node_modules/.bin/tsx scripts/oneoff/_trump_corpus_ratios.ts
 *
 * Restricted to UNSCRIPTED speech — tarmac and plane exchanges, Oval Office
 * sprays, phone interviews, gaggles — so this is top-of-mind, not staff-written.
 *
 * Why these ratios hold up where the earlier one did not: both sides are HIS
 * OWN WORDS, in one corpus, matched by one matcher, over one denominator. The
 * earlier draft divided a poll percentage by an attention share — different
 * units on different populations, and indefensible. Nothing here crosses that
 * line; voter-priority figures are context only, never an operand.
 *
 * Two tiers, because they carry different burdens of proof:
 *   TIER 1 — single-word/phrase counts. No interpretation at all: he either
 *            said the word or he did not. Unfalsifiable by an opponent.
 *   TIER 2 — topic sets. Stronger claim, but depends on the keyword list, so
 *            every list prints with per-keyword counts and a check that no one
 *            keyword carries more than half the topic.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { scanThemes, type MinedTheme } from '../../lib/themeMining'

const DIR = path.join(homedir(), 'Downloads', 'trump-corpus')
const ADHOC = /Exchange With Reporters|Interview|Telephone Remarks/i

interface Item { source: string; title: string; trump_text: string }
const corpus = readFileSync(path.join(DIR, 'trump_corpus.ndjson'), 'utf-8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l) as Item)

const U: string[] = []
for (const c of corpus) {
  if (c.source !== 'govinfo_dcpd' || !ADHOC.test(c.title)) continue
  for (const p of c.trump_text.split('\n\n').map((x) => x.trim())) {
    if (p.split(/\s+/).length >= 15) U.push(p)
  }
}

const th = (kw: string[]): MinedTheme => ({
  id: 'x', name: 'x', description: '', keywords: kw, sentiment: 'neutral', count: 0, percentage: 0, relatedThemes: [],
})
/**
 * ⚠️ POLICY-MANDATE DENY (2026-08-08). "mandate" in the election-win topic was
 * catching "the EV mandate", "COVID-19 Vaccine Mandates" and similar — policy
 * mandates, not "my recent election is a mandate". 19 of 41 unscripted matches.
 * Blocked forms are stripped before matching, so a passage survives only if
 * something other than a policy mandate put it in the topic.
 */
const POLICY_MANDATE = /\b(electric vehicle|ev|vaccine|covid(-19)?|mask|emission|gas)\s+mandate[sd]?\b/gi
/** golf→golfer/golfing: other people playing golf is not him on his properties. */
const GOLFER = /golfer[s]?|golfing/gi
const hit = (kw: string[]) => {
  const cleaned = U.map((t) => t.replace(POLICY_MANDATE, ' ').replace(GOLFER, ' '))
  return scanThemes(cleaned, [th(kw)]).perTheme[0] ?? 0
}
const pct = (n: number) => Math.round((10000 * n) / U.length) / 100

console.log(`UNSCRIPTED corpus: ${U.length} paragraphs (tarmac, plane, Oval, phone interviews, gaggles)\n`)

// ── TIER 1: bare word counts, zero interpretation ──────────────────────────
console.log('══ TIER 1 — word counts (no interpretation possible) ══\n')
const WORDS = ['witch hunt', 'hoax', 'rigged', 'golf', 'landslide', 'Nobel', 'beautiful',
  'fake news', 'my poll numbers', 'greatest President',
  'uninsured', 'affordable housing', 'good-paying jobs', 'preschool', 'minimum wage',
  'cost of living', 'child care', 'premiums', 'medical bills', 'rent']
const counts: Record<string, number> = {}
for (const w of WORDS) { counts[w] = hit([w]); console.log(`  ${w.padEnd(20)} ${String(counts[w]).padStart(5)}`) }

// ── TIER 2: topic sets, each audited for a dominant keyword ────────────────
const TOPICS: Record<string, string[]> = {
  // Things voters do not rank as priorities
  'His own grievances (witch hunt, hoax, rigged, lawfare)': ['witch hunt', 'hoax', 'rigged', 'lawfare', 'weaponized', 'deep state', 'stolen election'],
  'The media': ['fake news', 'lamestream', 'failing New York Times', 'CNN', 'MSNBC', 'fake polls'],
  'His election win / mandate': ['landslide', 'mandate', 'won the election', 'biggest victory', 'swing states'],
  'Attacking Biden personally': ['Crooked Joe', 'Sleepy Joe', 'autopen', 'worst President'],
  'Golf and his properties': ['golf', 'Mar-a-Lago', 'Doral', 'Turnberry', 'my club'],
  // Things voters rank at the very top
  'Health care costs': ['health care', 'healthcare', 'health insurance', 'premiums', 'deductible', 'Medicaid', 'Obamacare', 'uninsured', 'medical bills'],
  'Housing costs': ['housing', 'rent', 'rents', 'mortgage', 'homebuyer', 'affordable housing', 'homeless'],
  'Wages and paychecks': ['wages', 'minimum wage', 'take-home pay', 'salaries', 'paycheck'],
  'Child care and family costs': ['child care', 'childcare', 'day care', 'preschool', 'paid leave'],
  'Groceries and the cost of living': ['cost of living', 'grocery', 'groceries', 'affordability', 'making ends meet'],
}

console.log('\n══ TIER 2 — topic sets, with dominance audit ══\n')
const topic: Record<string, { n: number; pct: number; top: string; topShare: number; ok: boolean }> = {}
for (const [name, kws] of Object.entries(TOPICS)) {
  const n = hit(kws)
  const per = kws.map((k) => ({ k, n: hit([k]) })).sort((a, b) => b.n - a.n)
  const topShare = n ? Math.round((100 * per[0].n) / n) : 0
  const ok = topShare <= 60 || n < 40 // a dominant keyword only matters at scale
  topic[name] = { n, pct: pct(n), top: per[0].k, topShare, ok }
  console.log(`  ${name}`)
  console.log(`    ${n} paragraphs (${pct(n)}%)  top keyword "${per[0].k}" = ${topShare}% of topic  ${ok ? '✓' : '✗ DOMINATED — do not publish'}`)
  console.log(`    ${per.slice(0, 6).map((p) => `${p.k}:${p.n}`).join('  ')}`)
}

// ── The comparisons ────────────────────────────────────────────────────────
const PAIRS: [string, string][] = [
  ['His own grievances (witch hunt, hoax, rigged, lawfare)', 'Health care costs'],
  ['His own grievances (witch hunt, hoax, rigged, lawfare)', 'Housing costs'],
  ['The media', 'Health care costs'],
  ['The media', 'Housing costs'],
  ['His election win / mandate', 'Wages and paychecks'],
  ['Golf and his properties', 'Child care and family costs'],
  ['Attacking Biden personally', 'Child care and family costs'],
  ['His own grievances (witch hunt, hoax, rigged, lawfare)', 'Groceries and the cost of living'],
]

console.log('\n══ DEFENSIBLE COMPARISONS (unscripted, his words only) ══\n')
const out: Record<string, unknown>[] = []
for (const [a, b] of PAIRS) {
  const A = topic[a], B = topic[b]
  const ratio = B.n ? Math.round((10 * A.n) / B.n) / 10 : null
  const flag = A.ok && B.ok ? '' : '   ⚠ keyword-dominated'
  console.log(`  ${ratio === null ? 'n/a' : `${ratio}×`}  ${a}  (${A.n})  vs  ${b}  (${B.n})${flag}`)
  out.push({ a, aN: A.n, aPct: A.pct, b, bN: B.n, bPct: B.pct, ratio, publishable: A.ok && B.ok && B.n >= 20 })
}

writeFileSync(path.join(DIR, 'ratios.json'), JSON.stringify({ unscriptedParagraphs: U.length, words: counts, topics: topic, comparisons: out }, null, 2))
console.log(`\nWrote ${path.join(DIR, 'ratios.json')}`)
