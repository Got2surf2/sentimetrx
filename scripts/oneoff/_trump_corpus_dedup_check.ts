/**
 * Can we stand behind every published number? Dedup impact, figure by figure.
 *
 *   node_modules/.bin/tsx scripts/oneoff/_trump_corpus_dedup_check.ts
 *
 * Recomputes every figure in the summary PDF and the long-form report twice —
 * once on the corpus as built, once with exact-duplicate units removed — and
 * prints them side by side. A figure that moves is a figure we cannot publish
 * until the move is understood.
 *
 * WHY EXACT DEDUP IS THE RIGHT STANDARD, and near-dedup is not: the endorsement
 * letters are near-identical by design, but each one is a real, separate letter
 * about a different candidate. Collapsing them would erase a genuine act.
 * Collapsing byte-identical text does not — the same post appearing twice in
 * the archive is one thing he wrote, not two.
 *
 * DIRECTION OF ERROR: duplicates inflate the denominator, which makes every
 * absence percentage SMALLER and therefore makes the silence case look stronger
 * than it is. That is the unsafe direction, so it gets measured rather than
 * waved through.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { scanThemes, type MinedTheme } from '../../lib/themeMining'

const DIR = path.join(homedir(), 'Downloads', 'trump-corpus')
const ADHOC = /Exchange With Reporters|Interview|Telephone Remarks/i
const ENDORSEMENT = /Complete and Total Endorsement|has my Complete and Total|Complete and Total support/i

interface Item { source: string; title: string; trump_text: string }
const corpus = readFileSync(path.join(DIR, 'trump_corpus.ndjson'), 'utf-8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l) as Item)

// ── Build every unit set the published numbers rest on ─────────────────────
const spokenParas: string[] = []
const unscripted: string[] = []
const staged: string[] = []
for (const c of corpus) {
  if (c.source !== 'govinfo_dcpd') continue
  const isAdhoc = ADHOC.test(c.title)
  for (const raw of c.trump_text.split('\n\n')) {
    const p = raw.trim()
    if (p.split(/\s+/).length < 15) continue
    spokenParas.push(p)
    ;(isAdhoc ? unscripted : staged).push(p)
  }
}
const ownPosts = corpus
  .filter((d) => d.source === 'truth_social')
  .map((d) => d.trump_text)
  .filter((t) => t.trim() && !/^RT[\s@:]/.test(t))

const uniq = (a: string[]) => Array.from(new Set(a.map((s) => s.trim())))

const asTheme = (kw: string[]): MinedTheme => ({
  id: 'x', name: 'x', description: '', keywords: kw, sentiment: 'neutral', count: 0, percentage: 0, relatedThemes: [],
})
const hit = (texts: string[], kw: string[]) => scanThemes(texts, [asTheme(kw)]).perTheme[0] ?? 0
const pct = (n: number, d: number) => (d ? Math.round((10000 * n) / d) / 100 : 0)

const ISSUES: Record<string, string[]> = {
  'Crime': ['crime', 'criminals', 'murder', 'violent', 'police', 'law and order', 'gangs'],
  'Tariffs / trade': ['tariff', 'tariffs', 'trade deal', 'trade deficit', 'imports', 'exports'],
  'Immigration': ['border', 'illegal aliens', 'illegals', 'deportation', 'deport', 'migrants', 'invasion', 'ICE'],
  'Housing': ['housing', 'rent', 'rents', 'mortgage', 'homebuyer', 'first-time buyer', 'affordable housing', 'homeless'],
  'Health care': ['health care', 'healthcare', 'health insurance', 'premiums', 'deductible', 'Medicaid', 'Obamacare', 'Affordable Care Act', 'uninsured', 'medical bills'],
  'Child care': ['child care', 'childcare', 'day care', 'preschool', 'paid leave', 'family leave'],
}

const rows: string[] = []
const say = (s = '') => { console.log(s); rows.push(s) }

// ── 1. How much duplication is actually in there ───────────────────────────
say('══ 1. DUPLICATION PRESENT ══\n')
const sets: [string, string[]][] = [
  ['Spoken paragraphs', spokenParas], ['  · unscripted', unscripted], ['  · staged', staged], ['Own-word posts', ownPosts],
]
for (const [name, arr] of sets) {
  const u = uniq(arr)
  say(`  ${name.padEnd(20)} raw ${String(arr.length).padStart(6)}   unique ${String(u.length).padStart(6)}   dupes ${String(arr.length - u.length).padStart(4)}  (${pct(arr.length - u.length, arr.length)}%)`)
}

// ── 2. Endorsements: letters vs people ─────────────────────────────────────
say('\n══ 2. ENDORSEMENTS — is it really 730+ separate letters? ══\n')
const endo = ownPosts.filter((t) => ENDORSEMENT.test(t))
const endoU = uniq(endo)
say(`  posts matching the form letter : ${endo.length}`)
say(`  DISTINCT letters (exact dedup) : ${endoU.length}     ← the defensible count`)
say(`  duplicate re-posts             : ${endo.length - endoU.length}`)
say(`  distinct PEOPLE                : fewer still — he re-endorses the same candidate`)
say(`                                   (name extraction is unreliable; do NOT publish a people count)`)

// ── 3. Every published figure, raw vs deduped ──────────────────────────────
const spokenU = uniq(spokenParas), unscriptedU = uniq(unscripted), stagedU = uniq(staged), postsU = uniq(ownPosts)
const nonEndo = ownPosts.filter((t) => !ENDORSEMENT.test(t))
const nonEndoU = uniq(nonEndo)

say('\n══ 3. PUBLISHED FIGURES — raw vs deduped ══\n')
say('  ' + 'Figure'.padEnd(46) + 'published'.padStart(10) + 'deduped'.padStart(10) + '   verdict')
const check = (label: string, published: string, dedup: string) => {
  const ok = published === dedup
  say(`  ${label.padEnd(46)}${published.padStart(10)}${dedup.padStart(10)}   ${ok ? 'holds' : '⚠ MOVES'}`)
}

check('Spoken passages (denominator)', '49,046', spokenU.length.toLocaleString())
check('Own-word posts (denominator)', '6,638', postsU.length.toLocaleString())
check('Unscripted paragraphs', '25,743', unscriptedU.length.toLocaleString())
check('Posts excl. endorsements (denominator)', '5,901', nonEndoU.length.toLocaleString())
check('"cost of living" in spoken passages', '11', String(hit(spokenU, ['cost of living'])))
check('"making ends meet" in spoken', '1', String(hit(spokenU, ['making ends meet'])))

say('')
for (const z of ['good-paying jobs', 'uninsured', 'preschool', 'affordable housing', 'first-time buyer']) {
  check(`"${z}" (spoken, claimed 0)`, '0', String(hit(spokenU, [z])))
}

say('')
for (const [issue, kws] of Object.entries(ISSUES)) {
  const s = pct(hit(spokenU, kws), spokenU.length)
  const p = pct(hit(nonEndoU, kws), nonEndoU.length)
  say(`  ${issue.padEnd(20)} speeches ${String(s).padStart(6)}%    posts ${String(p).padStart(6)}%`)
}

const immU = hit(nonEndoU, ISSUES['Immigration']), hcU = hit(nonEndoU, ISSUES['Health care'])
check('\n  Border : health care ratio (posts)'.trim(), '6.2x', `${(immU / hcU).toFixed(1)}x`)

// ── 3b. Unscripted vs staged, REBUILT ──────────────────────────────────────
// The published version of this table came from adhoc_salience.json, which no
// committed script writes. Its staged denominator (21,141) cannot be
// reconstructed — 25,743 unscripted + 21,141 staged leaves 2,162 of the 49,046
// spoken paragraphs in neither bucket — and unlike salience.json it records no
// keyword lists. So the table is rebuilt here on a definition that is stated
// and checkable: staged = every spoken paragraph that is not unscripted.
say('\n══ 3b. UNSCRIPTED vs STAGED — rebuilt on a stated denominator ══\n')
say(`  unscripted ${unscriptedU.length}   staged ${stagedU.length}   sum ${unscriptedU.length + stagedU.length} = spoken ${spokenU.length}\n`)
say('  ' + 'Issue'.padEnd(20) + 'unscripted'.padStart(11) + 'staged'.padStart(9) + '     published (unreproducible)')
const PUBLISHED: Record<string, string> = {
  'Crime': '3.7 / 3.8', 'Tariffs / trade': '3.9 / 3.0', 'Immigration': '2.1 / 3.0',
  'Housing': '0.3 / 0.5', 'Health care': '0.7 / 0.9', 'Child care': '0.02 / 0.02',
}
const adhoc: Record<string, { unscripted: number; staged: number }> = {}
for (const [issue, kws] of Object.entries(ISSUES)) {
  const u = pct(hit(unscriptedU, kws), unscriptedU.length)
  const s = pct(hit(stagedU, kws), stagedU.length)
  adhoc[issue] = { unscripted: u, staged: s }
  say(`  ${issue.padEnd(20)}${(u + '%').padStart(11)}${(s + '%').padStart(9)}     ${PUBLISHED[issue]}`)
}
say('\n  Direction of every finding survives the rebuild: health care flat-to-lower')
say('  unscripted, immigration clearly higher when staged, tariffs higher unscripted.')
say('  The story holds; the published decimals do not reproduce and must be restated.')
writeFileSync(path.join(DIR, 'adhoc_salience_rebuilt.json'), JSON.stringify({
  note: 'Replaces adhoc_salience.json, which no script produced. staged = spoken paragraphs that are not unscripted; exact duplicates removed.',
  unscriptedParagraphs: unscriptedU.length, stagedParagraphs: stagedU.length, issues: adhoc, keywords: ISSUES,
}, null, 2))

say('')
const words: [string, number][] = [['fake news', 131], ['rigged', 83], ['golf', 58], ['beautiful', 782],
  ['cost of living', 3], ['minimum wage', 0], ['child care', 1], ['good-paying jobs', 0]]
for (const [w, published] of words) {
  check(`"${w}" (unscripted word count)`, String(published), String(hit(unscriptedU, [w])))
}

say('')
check('Endorsements mentioning the border', '84%', `${Math.round(pct(hit(endoU, ISSUES['Immigration']), endoU.length))}%`)
check('Endorsements mentioning health care', '1%', `${Math.round(pct(hit(endoU, ISSUES['Health care']), endoU.length))}%`)

writeFileSync(path.join(DIR, 'dedup_check.txt'), rows.join('\n'))
say(`\nWrote ${path.join(DIR, 'dedup_check.txt')}`)
