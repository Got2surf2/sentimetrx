/**
 * Salience audit: how much of his own speech goes to each issue voters rank as
 * a priority.
 *
 *   node_modules/.bin/tsx scripts/oneoff/_trump_corpus_salience.ts
 *
 * Deliberately NOT built on the mined theme model. Two reasons:
 *  1. The question is about ABSENCE ("he never talks about X"), and a theme
 *     that was never mined simply does not exist in the model — you cannot
 *     measure a silence with a list of things that were found.
 *  2. The runaway-keyword audit showed some mined themes are carried by a
 *     single generic word ("Presidential Aircraft" is 54% the word
 *     "beautiful"), so their shares cannot support a public claim.
 *
 * Instead each issue gets an explicit, auditable keyword list, printed with the
 * results so any number can be traced to the words that produced it. Matching
 * is the product's own matcher (word-stem, phrases allow gaps).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { scanThemes, type MinedTheme } from '../../lib/themeMining'

const DIR = path.join(homedir(), 'Downloads', 'trump-corpus')
const MIN_WORDS = 15

/** Issue → words he would HAVE to use if he were talking about it. */
const ISSUES: Record<string, string[]> = {
  'Cost of living / prices': ['cost of living', 'grocery', 'groceries', 'affordable', 'affordability', 'prices are', 'price of', 'paycheck', 'household budget', 'making ends meet'],
  'Inflation': ['inflation', 'inflationary', 'cost of goods', 'consumer prices'],
  'Health care': ['health care', 'healthcare', 'health insurance', 'premiums', 'deductible', 'Medicaid', 'Obamacare', 'Affordable Care Act', 'uninsured', 'medical bills'],
  'Prescription drug costs': ['prescription', 'drug prices', 'drug costs', 'insulin', 'pharmacy', 'pharmaceutical prices'],
  'Housing affordability': ['housing', 'rent', 'rents', 'mortgage', 'homebuyer', 'first-time buyer', 'affordable housing', 'homeless'],
  'Wages / jobs': ['wages', 'wage', 'minimum wage', 'paycheck', 'take-home pay', 'good-paying jobs', 'salaries'],
  'Social Security / Medicare': ['Social Security', 'Medicare', 'retirement', 'seniors', 'pension'],
  'Child care / family costs': ['child care', 'childcare', 'day care', 'preschool', 'paid leave', 'family leave'],
  'Education / schools': ['public schools', 'teachers', 'classroom', 'student loans', 'tuition', 'college costs'],
  'Immigration / border': ['border', 'illegal aliens', 'illegals', 'deportation', 'deport', 'migrants', 'invasion', 'ICE'],
  'Crime / public safety': ['crime', 'criminals', 'murder', 'violent', 'police', 'law and order', 'gangs'],
  'Tariffs / trade': ['tariff', 'tariffs', 'trade deal', 'trade deficit', 'imports', 'exports'],
  'Democracy / rule of law': ['rigged', 'stolen election', 'witch hunt', 'deep state', 'lawfare', 'weaponized'],
  'Abortion / reproductive rights': ['abortion', 'pro-life', 'Roe', 'reproductive'],
  'Climate / energy costs': ['climate', 'global warming', 'clean energy', 'wind', 'solar', 'energy costs', 'electricity bills'],
  'Guns': ['guns', 'gun violence', 'Second Amendment', 'shooting', 'firearms'],
}

interface CorpusItem { source: string; trump_text: string; date: string }
const corpus = readFileSync(path.join(DIR, 'trump_corpus.ndjson'), 'utf-8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l) as CorpusItem)

function units(side: 'spoken' | 'posted') {
  const out: { text: string; month: string }[] = []
  for (const c of corpus) {
    const isSpoken = c.source === 'govinfo_dcpd'
    if ((side === 'spoken') !== isSpoken) continue
    const month = c.date.slice(0, 7)
    if (isSpoken) {
      for (const p of c.trump_text.split('\n\n').map((x) => x.trim())) {
        if (p.split(/\s+/).length >= MIN_WORDS) out.push({ text: p, month })
      }
    } else if (c.trump_text.trim() && !/^RT[\s@:]/.test(c.trump_text)) out.push({ text: c.trump_text, month })
  }
  return out
}

const asTheme = (name: string, keywords: string[]): MinedTheme => ({
  id: 'x', name, description: '', keywords, sentiment: 'neutral', count: 0, percentage: 0, relatedThemes: [],
})
const hits = (texts: string[], kw: string[]) => scanThemes(texts, [asTheme('x', kw)]).perTheme[0] ?? 0

const spoken = units('spoken')
const posted = units('posted')
const sText = spoken.map((u) => u.text)
const pText = posted.map((u) => u.text)

console.log(`Spoken paragraphs: ${sText.length}   Truth Social posts (own words): ${pText.length}\n`)
console.log('issue                            spoken%   posts%   spoken n   posts n')

const rows: Record<string, unknown>[] = []
for (const [issue, kw] of Object.entries(ISSUES)) {
  const sn = hits(sText, kw)
  const pn = hits(pText, kw)
  const sp = Math.round((1000 * sn) / sText.length) / 10
  const pp = Math.round((1000 * pn) / pText.length) / 10
  console.log(
    `${issue.padEnd(32)} ${String(sp).padStart(6)}%  ${String(pp).padStart(6)}%  ` +
    `${String(sn).padStart(8)}  ${String(pn).padStart(8)}`,
  )
  rows.push({ issue, keywords: kw, spokenPct: sp, postsPct: pp, spokenN: sn, postsN: pn })
}

// Per-keyword breakdown for the low-salience issues, so "he never talks about
// health care" can be checked word by word rather than taken on trust.
console.log('\nPer-keyword hits (spoken / posts) for the low-salience issues:')
for (const issue of ['Health care', 'Housing affordability', 'Prescription drug costs', 'Child care / family costs', 'Cost of living / prices', 'Wages / jobs']) {
  console.log(`\n  ${issue}`)
  for (const k of ISSUES[issue]) {
    console.log(`    ${k.padEnd(26)} ${String(hits(sText, [k])).padStart(6)} / ${String(hits(pText, [k])).padStart(5)}`)
  }
}

writeFileSync(path.join(DIR, 'salience.json'), JSON.stringify({
  spokenUnits: sText.length, postedUnits: pText.length, issues: rows,
}, null, 2))
console.log(`\nWrote ${path.join(DIR, 'salience.json')}`)
