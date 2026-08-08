/**
 * The external contrast: measles against the ballroom.
 *
 *   node_modules/.bin/tsx scripts/oneoff/_trump_corpus_measles.ts
 *
 * Owner asked for a metric that pairs an outside consequence with his personal
 * attention: "X% more measles under Trump 2.0 while he talked about his
 * ballroom Y% of his days in office."
 *
 * ⚠️ TWO RULES THIS SCRIPT EXISTS TO ENFORCE ⚠️
 *
 * 1. THE CDC FIGURES ARE EXTERNAL DATA, NOT OUR MEASUREMENT. They are hard-coded
 *    below with their source and access date and are never derived, adjusted or
 *    interpolated. Everything else in this project is computed from the corpus;
 *    this is the one place a number comes from outside, and it is labelled as
 *    such wherever it appears.
 *
 * 2. NEVER DIVIDE THE TWO SIDES. A measles count and an attention share are
 *    different units on different populations — dividing them is exactly the
 *    poll-percentage-over-attention-share error this project already retracted
 *    once. They are placed SIDE BY SIDE. The reader draws the line; the document
 *    does not draw it for them, because a causal claim ("his ballroom talk caused
 *    measles") is the one an opponent can actually win.
 *
 * ⚠️ VERIFICATION LIMIT — READ BEFORE PUBLISHING. cdc.gov returns HTTP 403 to
 * our fetcher, so these figures were taken from search summaries of CDC pages,
 * NOT from a verbatim read of the page. They are internally consistent and match
 * the known shape of the 2025 Texas outbreak, but they are ONE step removed from
 * the source. Open the URL below and confirm the two numbers by eye before this
 * goes to anyone outside.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const DIR = path.join(homedir(), 'Downloads', 'trump-corpus')

/** CDC, "Measles Cases and Outbreaks". Accessed 2026-08-08. NOT our data. */
const CDC = {
  source: 'CDC — Measles Cases and Outbreaks',
  url: 'https://www.cdc.gov/measles/data-research/index.html',
  accessed: '2026-08-08',
  asOf: '2026-08-06',
  verbatimRead: false, // cdc.gov 403s our fetcher; confirm by eye before publishing
  cases: { 2019: 1274, 2020: 13, 2021: 49, 2022: 121, 2023: 58, 2024: 285, 2025: 2289, 2026: 2465 },
  outbreaks: { 2024: 16, 2025: 48, 2026: 38 },
}

/** Corpus side — read from the file the vanity script writes, never retyped. */
const vanity = JSON.parse(readFileSync(path.join(DIR, 'vanity_gap.json'), 'utf-8')) as {
  daysInOffice: { calendarDays: number; byTopic: Record<string, { days: number; pctOfTerm: number }> }
}
const ballroom = vanity.daysInOffice.byTopic['The White House ballroom']
const childCare = vanity.daysInOffice.byTopic['Child care']
const DAYS = vanity.daysInOffice.calendarDays

const pctChange = (from: number, to: number) => Math.round(((to - from) / from) * 100)
const times = (from: number, to: number) => Math.round((to / from) * 10) / 10

const out: string[] = []
const say = (s = '') => { console.log(s); out.push(s) }

say('══ EXTERNAL: CDC measles (NOT our measurement) ══\n')
say(`  source: ${CDC.source} — ${CDC.url}`)
say(`  accessed ${CDC.accessed}; figures as of ${CDC.asOf}`)
say(`  ⚠ verbatim page read: ${CDC.verbatimRead ? 'yes' : 'NO — cdc.gov 403s our fetcher, confirm by eye'}\n`)
for (const [y, n] of Object.entries(CDC.cases)) say(`   ${y}  ${String(n).padStart(5)} cases`)

say('\n══ THE CHANGE UNDER TRUMP 2.0 (inaugurated 20 Jan 2025) ══\n')
say(`  CASES     2024: ${CDC.cases[2024]}  →  2025: ${CDC.cases[2025]}   = ${times(CDC.cases[2024], CDC.cases[2025])}x, ${pctChange(CDC.cases[2024], CDC.cases[2025])}% increase`)
say(`  CASES     2026 year-to-date (${CDC.asOf}): ${CDC.cases[2026]} — already ABOVE the whole of 2025`)
say(`  OUTBREAKS 2024: ${CDC.outbreaks[2024]}  →  2025: ${CDC.outbreaks[2025]}   = ${times(CDC.outbreaks[2024], CDC.outbreaks[2025])}x, ${pctChange(CDC.outbreaks[2024], CDC.outbreaks[2025])}% increase`)
say('')
say('  ⚠ WORD CHOICE MATTERS: "outbreaks" tripled (16→48). "cases" rose eightfold')
say('    (285→2,289). They are different CDC measures — use the word that matches')
say('    the number. The owner\'s draft said "outbreaks"; the 703% figure is CASES.')

say('\n══ THE JUXTAPOSITION (side by side — never divided) ══\n')
say(`  Measles cases up ${pctChange(CDC.cases[2024], CDC.cases[2025])}% (${CDC.cases[2024]} → ${CDC.cases[2025]}), and 2026 is already higher again.`)
say(`  Over the same ${DAYS} days he talked about his ballroom on ${ballroom.days} of them — ${ballroom.pctOfTerm}% of his days in office.`)
say(`  He mentioned child care on ${childCare.days}.`)

say('\n══ DRAFT COPY ══\n')
const copy = [
  `Measles cases in this country are up ${pctChange(CDC.cases[2024], CDC.cases[2025])}% since he took office — from ${CDC.cases[2024]} in 2024 to ${CDC.cases[2025].toLocaleString()} in 2025, and ${CDC.cases[2026].toLocaleString()} already this year.`,
  `He spent ${ballroom.pctOfTerm}% of his days in office talking about his new ballroom.`,
  ``,
  `Is this what you voted for?`,
  ``,
  `And every Republican in Congress watched him do it.`,
  ``,
  `Is this why you voted for them?`,
]
copy.forEach((l) => say('  ' + l))

writeFileSync(path.join(DIR, 'measles_contrast.json'), JSON.stringify({
  external: CDC,
  corpus: { daysInOffice: DAYS, ballroomDays: ballroom, childCareDays: childCare },
  casesPctChange2024to2025: pctChange(CDC.cases[2024], CDC.cases[2025]),
  outbreaksPctChange2024to2025: pctChange(CDC.outbreaks[2024], CDC.outbreaks[2025]),
  draftCopy: copy.filter(Boolean),
}, null, 2))
say(`\nWrote ${path.join(DIR, 'measles_contrast.json')}`)
writeFileSync(path.join(DIR, 'measles_contrast.txt'), out.join('\n'))
