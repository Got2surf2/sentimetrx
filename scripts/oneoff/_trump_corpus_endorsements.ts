/**
 * The endorsement-boilerplate correction, made reproducible.
 *
 *   node_modules/.bin/tsx scripts/oneoff/_trump_corpus_endorsements.ts
 *
 * WHY THIS SCRIPT EXISTS: the report's headline post figures — immigration
 * 5.1%, crime 6.4%, the 5.5x immigration-to-health-care ratio — are all
 * *endorsement-excluded*, but no script produced them. They were computed
 * once, by hand, mid-session. A number nobody can regenerate cannot be
 * defended when a reporter asks how it was made, and the raw alternative
 * (immigration 14.4%) is the exact figure we retracted. So the correction
 * gets a script like every other number in the report.
 *
 * WHAT THE CORRECTION IS: 700+ posts are candidate-endorsement form letters
 * running a fixed checklist -- "Strong on Borders, Crime, the Military, the
 * Second Amendment." They are one template pasted per candidate, so counting
 * each as an instance of him discussing the border measures how many people he
 * endorsed, not what he talks about.
 *
 * ONE DENOMINATOR PER FRAME. Excluding endorsements removes them from the
 * numerator AND the denominator. Reporting a corrected immigration share
 * against the uncorrected 6,638-post base mixes two frames in one table, which
 * is the mistake this whole report is built to avoid. Both frames print below;
 * a figure may be quoted from either, never from both at once.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { scanThemes, type MinedTheme } from '../../lib/themeMining'

const DIR = path.join(homedir(), 'Downloads', 'trump-corpus')

interface Item { source: string; trump_text: string }

/**
 * The template's signature line. Trump's endorsements close on a fixed
 * formula; matching the formula itself (rather than "endorse", which he also
 * uses in ordinary speech) keeps this a template test, not a topic test.
 */
const ENDORSEMENT = /Complete and Total Endorsement|has my Complete and Total|Complete and Total support/i

const posts = readFileSync(path.join(DIR, 'trump_corpus.ndjson'), 'utf-8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l) as Item)
  .filter((d) => d.source === 'truth_social')
  .map((d) => d.trump_text)
  .filter((t) => t.trim() && !/^RT[\s@:]/.test(t)) // his own words only

const endorsements = posts.filter((t) => ENDORSEMENT.test(t))
const nonEndorsements = posts.filter((t) => !ENDORSEMENT.test(t))

// Same issue definitions as _trump_corpus_salience.ts — one matcher everywhere.
const ISSUES: Record<string, string[]> = {
  'Immigration / border': ['border', 'illegal aliens', 'illegals', 'deportation', 'deport', 'migrants', 'invasion', 'ICE'],
  'Crime / public safety': ['crime', 'criminals', 'murder', 'violent', 'police', 'law and order', 'gangs'],
  'Guns': ['guns', 'gun violence', 'Second Amendment', 'shooting', 'firearms'],
  'Tariffs / trade': ['tariff', 'tariffs', 'trade deal', 'trade deficit', 'imports', 'exports'],
  'Cost of living / prices': ['cost of living', 'grocery', 'groceries', 'affordable', 'affordability', 'prices are', 'price of', 'paycheck', 'household budget', 'making ends meet'],
  'Inflation': ['inflation', 'inflationary', 'cost of goods', 'consumer prices'],
  'Health care': ['health care', 'healthcare', 'health insurance', 'premiums', 'deductible', 'Medicaid', 'Obamacare', 'Affordable Care Act', 'uninsured', 'medical bills'],
  'Social Security / Medicare': ['Social Security', 'Medicare', 'retirement', 'seniors', 'pension'],
  'Prescription drug costs': ['prescription', 'drug prices', 'drug costs', 'insulin', 'pharmacy', 'pharmaceutical prices'],
  'Housing affordability': ['housing', 'rent', 'rents', 'mortgage', 'homebuyer', 'first-time buyer', 'affordable housing', 'homeless'],
  'Wages / jobs': ['wages', 'wage', 'minimum wage', 'paycheck', 'take-home pay', 'good-paying jobs', 'salaries'],
  'Education / schools': ['public schools', 'teachers', 'classroom', 'student loans', 'tuition', 'college costs'],
  'Child care / family costs': ['child care', 'childcare', 'day care', 'preschool', 'paid leave', 'family leave'],
}

const asTheme = (kw: string[]): MinedTheme => ({
  id: 'x', name: 'x', description: '', keywords: kw, sentiment: 'neutral', count: 0, percentage: 0, relatedThemes: [],
})
const hit = (texts: string[], kw: string[]) => scanThemes(texts, [asTheme(kw)]).perTheme[0] ?? 0
const pct = (n: number, d: number) => (d ? Math.round((10000 * n) / d) / 100 : 0)

console.log('══ FRAMES ══')
console.log(`  All posts in his own words (reposts removed) : ${posts.length}`)
console.log(`  Endorsement form letters                     : ${endorsements.length}`)
console.log(`  EXCLUDING endorsements  ← report's frame     : ${nonEndorsements.length}\n`)

// ── What the template itself contains ──────────────────────────────────────
// This is the "his own endorsement letter tells you what he cares about"
// table. Denominator is the endorsements themselves, and it is a checklist
// audit, not an attention measure -- keep it labelled as such.
console.log('══ INSIDE THE ENDORSEMENT TEMPLATE (denominator = the endorsements) ══\n')
const inTemplate: Record<string, number> = {}
for (const [issue, kws] of Object.entries(ISSUES)) {
  const n = hit(endorsements, kws)
  inTemplate[issue] = pct(n, endorsements.length)
  console.log(`  ${issue.padEnd(28)} ${String(n).padStart(4)}  ${String(inTemplate[issue]).padStart(6)}%`)
}

// ── The salience table, both frames, side by side ──────────────────────────
console.log('\n══ POST SALIENCE — both frames (quote from ONE, never mixed) ══\n')
console.log(`  ${'Issue'.padEnd(28)} ${'raw n'.padStart(6)} ${'raw %'.padStart(7)}   ${'excl n'.padStart(6)} ${'excl %'.padStart(7)}`)
const table: Record<string, { rawN: number; rawPct: number; exclN: number; exclPct: number }> = {}
for (const [issue, kws] of Object.entries(ISSUES)) {
  const rawN = hit(posts, kws)
  const exclN = hit(nonEndorsements, kws)
  const row = { rawN, rawPct: pct(rawN, posts.length), exclN, exclPct: pct(exclN, nonEndorsements.length) }
  table[issue] = row
  const moved = Math.abs(row.rawPct - row.exclPct) >= 1 ? '  ← moved' : ''
  console.log(`  ${issue.padEnd(28)} ${String(rawN).padStart(6)} ${String(row.rawPct).padStart(6)}%   ${String(exclN).padStart(6)} ${String(row.exclPct).padStart(6)}%${moved}`)
}

// ── The headline ratio, from raw counts in ONE frame ───────────────────────
console.log('\n══ HEADLINE RATIO — immigration vs health care ══\n')
for (const [label, set] of [['RAW (inflated, do NOT publish)', posts], ['EXCLUDING endorsements (publish this)', nonEndorsements]] as const) {
  const imm = hit(set, ISSUES['Immigration / border'])
  const hc = hit(set, ISSUES['Health care'])
  console.log(`  ${label.padEnd(38)} ${imm} vs ${hc}  =  ${(imm / hc).toFixed(1)}x   (n=${set.length})`)
}

writeFileSync(path.join(DIR, 'endorsement_correction.json'), JSON.stringify({
  ownWordPosts: posts.length,
  endorsements: endorsements.length,
  nonEndorsements: nonEndorsements.length,
  insideTemplatePct: inTemplate,
  salience: table,
}, null, 2))
console.log(`\nWrote ${path.join(DIR, 'endorsement_correction.json')}`)
