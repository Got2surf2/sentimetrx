/**
 * "The economy is great" — what he said, against what the official measure said.
 *
 *   node_modules/.bin/tsx scripts/oneoff/_trump_corpus_economy_claims.ts
 *
 * Owner asked how often he claims the economy is great when it isn't. This is a
 * stronger class of claim than the silence gap, because these are FALSIFIABLE
 * FACTUAL ASSERTIONS, not absences. "There is no inflation" is either true or it
 * is not, and BLS settles it.
 *
 * ⚠️ SAME TWO RULES AS THE MEASLES CONTRAST ⚠️
 *  1. BLS figures are EXTERNAL, hard-coded with source and access date, never
 *     derived or adjusted. Everything else here is counted from the corpus.
 *  2. The two are placed SIDE BY SIDE and never divided. "He said it on N days;
 *     the official 12-month rate was X%" is two sourced facts. A ratio between a
 *     day-count and a percentage would be meaningless.
 *
 * ⚠️ VERIFICATION LIMIT: bls.gov, like cdc.gov, is not directly readable by our
 * fetcher, so these came from search summaries of BLS pages rather than verbatim
 * reads. Confirm the headline rates by eye before this goes to anyone outside.
 *
 * A NOTE ON FAIRNESS, because it decides whether the claim survives contact:
 * "no inflation" is counted as a phrase HE USED, not as a claim we have proven
 * he meant literally — some instances are about a specific good. That is why the
 * script prints sampled matches: the count is only usable if the samples read
 * the way the headline implies. Check them before quoting the number.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const DIR = path.join(homedir(), 'Downloads', 'trump-corpus')

/** BLS Consumer Price Index. Accessed 2026-08-08. NOT our data. */
const BLS = {
  source: 'BLS — Consumer Price Index',
  url: 'https://www.bls.gov/cpi/',
  accessed: '2026-08-08',
  verbatimRead: false,
  cpi12mo: [
    { asOf: 'Dec 2025', pct: 2.7, note: 'CPI-U, 12-month, unadjusted' },
    { asOf: 'May 2026', pct: 4.2, note: 'largest 12-month increase since April 2023' },
    { asOf: 'Jun 2026', pct: 3.5, note: 'all items, before seasonal adjustment' },
  ],
  foodAtHome12mo: { asOf: 'Jun 2026', pct: 2.7 },
}

interface Item { source: string; trump_text: string; date: string }
const rows = readFileSync(path.join(DIR, 'trump_corpus.ndjson'), 'utf-8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l) as Item)

const seen = new Set<string>()
const units: { date: string; text: string }[] = []
for (const c of rows) {
  const d = c.date.slice(0, 10)
  const texts = c.source === 'govinfo_dcpd'
    ? c.trump_text.split('\n\n').map((x) => x.trim()).filter((p) => p.split(/\s+/).length >= 15)
    : (c.trump_text.trim() && !/^RT[\s@:]/.test(c.trump_text) ? [c.trump_text.trim()] : [])
  for (const t of texts) { if (!seen.has(t)) { seen.add(t); units.push({ date: d, text: t }) } }
}

const rx = (k: string) => new RegExp(`(?<![a-z])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
const hits = (kws: string[]) => {
  const res = kws.map(rx)
  return units.filter((u) => { const l = u.text.toLowerCase(); return res.some((r) => r.test(l)) })
}

const out: string[] = []
const say = (s = '') => { console.log(s); out.push(s) }

say(`DENOMINATOR: ${units.length.toLocaleString()} passages across ${new Set(units.map((u) => u.date)).size} days on the record\n`)

/**
 * ⚠️ THE TRAP THAT NEARLY SHIPPED. A bare "no inflation" match returns 106
 * passages / 75 days, and it reads like 75 days of him denying present-day
 * inflation. The sampled matches say otherwise: most are PAST TENSE about his
 * first term — "when I left, we had no inflation", "I had almost no inflation" —
 * which is a boast about 2017-2020, not a false claim about now. Publishing 75
 * would have been indefensible the moment anyone opened the quotes.
 *
 * Only PRESENT-TENSE assertions count: "there is no inflation", "we have no
 * inflation". Past-tense and conditional forms are excluded outright.
 */
const PAST_TENSE = /\b(had|left|was|were|used to|would have|before|when i (came|left)|last (year|administration))\b/i
const presentTenseOnly = (kws: string[]) => hits(kws).filter((u) => !PAST_TENSE.test(u.text))

const CLAIMS: [string, string[]][] = [
  ['"There is no inflation" (present tense only)', ['there is no inflation', "there's no inflation", 'we have no inflation', 'have no inflation', 'is no inflation']],
  ['"Prices are down / coming down"', ['prices are down', 'prices are coming down', 'prices coming down', 'costs are down']],
  ['"Groceries are down"', ['groceries are down']],
  ['"The greatest economy" (ever / in history)', ['greatest economy', 'best economy', 'strongest economy', 'hottest economy']],
  ['"A golden age"', ['golden age']],
  ['"Booming"', ['booming']],
]
say('══ HIS ECONOMIC CLAIMS ══\n')
say('  ' + 'Claim'.padEnd(46) + 'passages'.padStart(9) + 'days'.padStart(7))
const claims: Record<string, { passages: number; days: number }> = {}
for (const [label, kws] of CLAIMS) {
  const h = label.includes('present tense') ? presentTenseOnly(kws) : hits(kws)
  const days = new Set(h.map((x) => x.date)).size
  claims[label] = { passages: h.length, days }
  say(`  ${label.padEnd(46)}${String(h.length).padStart(9)}${String(days).padStart(7)}`)
}

say('\n══ WHAT BLS SAID OVER THE SAME PERIOD (external) ══\n')
say(`  source: ${BLS.source} — ${BLS.url} (accessed ${BLS.accessed})`)
say(`  ⚠ verbatim page read: ${BLS.verbatimRead ? 'yes' : 'NO — confirm by eye before publishing'}\n`)
for (const c of BLS.cpi12mo) say(`   CPI, 12-month, ${c.asOf.padEnd(9)} +${c.pct}%   ${c.note}`)
say(`   Food at home, 12-month, ${BLS.foodAtHome12mo.asOf}  +${BLS.foodAtHome12mo.pct}%`)
say('\n  Inflation was never zero at any point in this period. The lowest reading')
say('  above is +2.7% and the highest is +4.2%.')

// The count is only usable if the matches read the way the headline implies.
say('\n══ SAMPLED MATCHES — read these before quoting the number ══')
for (const [label, kws] of [CLAIMS[0], CLAIMS[2]] as [string, string[]][]) {
  say(`\n  ${label}`)
  const sample = label.includes('present tense') ? presentTenseOnly(kws) : hits(kws)
  for (const u of sample.slice(0, 4)) {
    const l = u.text.toLowerCase()
    const i = kws.map(rx).map((r) => l.search(r)).filter((x) => x >= 0)[0] ?? 0
    say(`    · ${u.date}  ${u.text.slice(Math.max(0, i - 60), i + 95).replace(/\s+/g, ' ').trim()}`)
  }
}

say('\n══ DRAFT COPY ══\n')
const copy = [
  `He said, in the present tense, that there is "no inflation" on ${claims['"There is no inflation" (present tense only)'].days} separate days.`,
  `Inflation never once hit zero. It ran between 2.7% and 4.2%.`,
  ``,
  `He said groceries were coming down on ${claims['"Groceries are down"'].days} days. Grocery prices rose ${BLS.foodAtHome12mo.pct}% over the year.`,
]
copy.forEach((l) => say('  ' + l))

writeFileSync(path.join(DIR, 'economy_claims.json'), JSON.stringify({
  denominator: { passages: units.length, days: new Set(units.map((u) => u.date)).size },
  claims, external: BLS, draftCopy: copy.filter(Boolean),
}, null, 2))
writeFileSync(path.join(DIR, 'economy_claims.txt'), out.join('\n'))
say(`\nWrote ${path.join(DIR, 'economy_claims.json')}`)
