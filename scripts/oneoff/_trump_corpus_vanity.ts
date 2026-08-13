/**
 * The obsession gap: things HE cares about that almost nobody else does,
 * measured against the things voters put at the top.
 *
 *   node_modules/.bin/tsx scripts/oneoff/_trump_corpus_vanity.ts
 *
 * WHY THIS REPLACES THE BORDER COMPARISON (owner, 2026-08-08): "he talks about
 * the border more than health care" does not land, because the border IS a real
 * voter priority — the comparison invites an argument he can win. The contrast
 * only bites when the other side of it is something no voter has ever ranked:
 * the ballroom, the Reflecting Pool, the Kennedy Center, windmills, the 2020
 * election. Nobody defends those as governing priorities.
 *
 * UNIT: a "passage" is one spoken paragraph (>=15 words) OR one post in his own
 * words. Exact duplicates removed, reposts excluded. One denominator, stated on
 * every line: 55,418 passages. Spoken and posted are also broken out, because a
 * paragraph and a post are not the same object and someone will ask.
 *
 * KEYWORD AUDIT IS MANDATORY HERE. Two terms were tested and DROPPED:
 *   - "gold" (408 hits) — overwhelmingly "golden age" (a slogan) and "liquid
 *     gold" (oil). It is not the gilded-Oval-Office story it looks like. This
 *     is the same failure mode as the "guns" issue that turned out to be 95%
 *     the phrase "Second Amendment".
 *   - "statue" (51) — mostly monuments policy, not self-commemoration.
 * "Kennedy Center" is kept but CLEANED: a chunk of hits use it as a vantage
 * point for the January 2025 DCA midair collision ("you could see it from
 * Kennedy Center"), which is not him talking about the arts centre. Those are
 * excluded by an explicit crash-context filter and the script reports how many.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const DIR = path.join(homedir(), 'Downloads', 'trump-corpus')

interface Item { source: string; trump_text: string }
const rows = readFileSync(path.join(DIR, 'trump_corpus.ndjson'), 'utf-8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l) as Item)

const spoken: string[] = []
const posted: string[] = []
for (const c of rows) {
  if (c.source === 'govinfo_dcpd') {
    for (const raw of c.trump_text.split('\n\n')) {
      const p = raw.trim()
      if (p.split(/\s+/).length >= 15) spoken.push(p)
    }
  } else if (c.trump_text.trim() && !/^RT[\s@:]/.test(c.trump_text)) {
    posted.push(c.trump_text.trim())
  }
}
const S = Array.from(new Set(spoken))
const P = Array.from(new Set(posted))
const ALL = [...S, ...P]

/** Word-boundary-ish match, lowercased. Kept deliberately simple and auditable. */
const rx = (kw: string) => new RegExp(`(?<![a-z])${kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
/** DCA-crash context that borrows "Kennedy Center" as a landmark, not a subject. */
const CRASH = /crash|collision|midair|mid-air|helicopter|black hawk|blackhawk|plane|aircraft|air traffic|control tower|kennedy center tape/i

function count(texts: string[], kws: string[], clean?: RegExp, deny?: RegExp): number {
  const res = kws.map(rx)
  return texts.filter((t) => {
    const low = t.toLowerCase()
    if (!res.some((r) => r.test(low))) return false
    if (clean && clean.test(t)) return false
    if (deny) {
      // Keep the passage only if something OTHER than a denied form matched.
      const stripped = low.replace(new RegExp(deny.source, 'gi'), ' ')
      if (!res.some((r) => r.test(stripped))) return false
    }
    return true
  }).length
}

interface Topic { name: string; kws: string[]; clean?: RegExp; deny?: RegExp }

/**
 * ⚠️ THE PREFIX-BLEED DEFECT (found 2026-08-08 by _trump_corpus_keyword_audit.ts).
 * The shared matcher is `(?<![a-z])keyword` — it guards the LEFT edge only, so
 * every keyword also matches longer words STARTING with it. Usually that is
 * wanted (tariff→tariffs, murder→murderers, deport→deportation are the same
 * topic). Sometimes it is not:
 *   golf → golfer/golfers/golfing — him praising Adam Scott or a kid at an
 *          event is NOT him talking about his own golf courses. 52 of the 248
 *          passages, and the published line "248 times he talked about his golf
 *          courses" was wrong because of it. Now 196.
 * `deny` drops a passage whose only claim to the topic is a blocked form.
 */

/** Things he returns to that essentially no voter ranks as a priority. */
const VANITY: Topic[] = [
  { name: 'The White House ballroom', kws: ['ballroom'] },
  { name: 'Windmills / wind turbines', kws: ['windmill', 'wind turbine'] },
  { name: 'The Kennedy Center', kws: ['kennedy center'], clean: CRASH },
  { name: 'The 2020 election', kws: ['rigged election', 'stolen election', '2020 election', 'election was rigged'] },
  { name: 'The Lincoln Memorial Reflecting Pool', kws: ['reflecting pool'] },
  { name: 'Golf and his properties', kws: ['golf', 'mar-a-lago', 'doral', 'turnberry'], deny: /golfer|golfing/i },
  { name: 'Winning a Nobel Prize', kws: ['nobel'] },
  { name: 'Renaming the Gulf and Denali', kws: ['gulf of america', 'denali', 'mount mckinley'] },
  { name: 'Teleprompters', kws: ['teleprompter'] },
  { name: 'A triumphal arch for Washington', kws: ['triumphal arch', 'arc de'] },
]

/** What voters actually put at the top. */
const KITCHEN: Topic[] = [
  { name: 'Child care', kws: ['child care', 'childcare', 'day care', 'preschool'] },
  { name: 'Affordable housing', kws: ['affordable housing', 'first-time buyer', 'homebuyer'] },
  { name: 'Being uninsured / medical bills', kws: ['uninsured', 'medical bills', 'premiums'] },
  { name: 'Wages and paychecks', kws: ['minimum wage', 'good-paying jobs', 'take-home pay', 'paycheck'] },
  { name: 'The cost of living', kws: ['cost of living', 'making ends meet', 'groceries', 'grocery bill'] },
]

const out: string[] = []
const say = (s = '') => { console.log(s); out.push(s) }

say(`DENOMINATOR: ${ALL.length.toLocaleString()} passages  (${S.length.toLocaleString()} spoken paragraphs + ${P.length.toLocaleString()} posts, deduped, reposts excluded)\n`)

const tally = (list: Topic[], heading: string) => {
  say(`══ ${heading} ══\n`)
  say('  ' + 'Topic'.padEnd(38) + 'total'.padStart(7) + 'spoken'.padStart(8) + 'posts'.padStart(7) + '   per-keyword')
  const res: Record<string, number> = {}
  for (const t of list) {
    const tot = count(ALL, t.kws, t.clean, t.deny)
    res[t.name] = tot
    const per = t.kws.map((k) => `${k}:${count(ALL, [k], t.clean, t.deny)}`).join(' ')
    say(`  ${t.name.padEnd(38)}${String(tot).padStart(7)}${String(count(S, t.kws, t.clean, t.deny)).padStart(8)}${String(count(P, t.kws, t.clean, t.deny)).padStart(7)}   ${per}`)
  }
  say('')
  return res
}

const V = tally(VANITY, 'THINGS HE CARES ABOUT THAT VOTERS DO NOT')
const K = tally(KITCHEN, 'THINGS VOTERS PUT AT THE TOP')

// Report what the Kennedy Center filter removed, so the cleaning is auditable.
const kcRaw = count(ALL, ['kennedy center'])
const kcClean = count(ALL, ['kennedy center'], CRASH)
say(`Kennedy Center cleaning: ${kcRaw} raw → ${kcClean} kept (${kcRaw - kcClean} dropped as DCA-crash landmark references)\n`)

// ── The comparisons ────────────────────────────────────────────────────────
say('══ THE CONTRASTS ══\n')
const PAIRS: [string, string][] = [
  ['The White House ballroom', 'Affordable housing'],
  ['The White House ballroom', 'Child care'],
  ['Windmills / wind turbines', 'Child care'],
  ['The Kennedy Center', 'Being uninsured / medical bills'],
  ['The 2020 election', 'Wages and paychecks'],
  ['The Lincoln Memorial Reflecting Pool', 'Affordable housing'],
  ['Golf and his properties', 'Child care'],
  ['Winning a Nobel Prize', 'Affordable housing'],
]
const comparisons = PAIRS.map(([a, b]) => {
  const an = V[a], bn = K[b]
  const ratio = bn ? Math.round((10 * an) / bn) / 10 : null
  say(`  ${String(an).padStart(4)} vs ${String(bn).padStart(4)}   ${(ratio === null ? 'infinite (he has never said it)' : `${ratio}x`).padEnd(32)} ${a}  vs  ${b}`)
  return { vanity: a, vanityN: an, kitchen: b, kitchenN: bn, ratio }
})

// ── Days in office ─────────────────────────────────────────────────────────
// "He talked about the ballroom on X% of his days in office" is a different and
// more intuitive unit than share-of-passages, and it is the one that pairs with
// an external time series. Denominator is CALENDAR DAYS since the inauguration,
// which is the honest one for that phrasing — but note the DCPD ~5-week lag
// means the last few weeks are posts-only, so a topic he only ever discusses in
// speeches is slightly understated at the tail.
const dayOf = new Map<string, string[]>()
for (const c of rows) {
  const d = c.date.slice(0, 10)
  const texts = c.source === 'govinfo_dcpd'
    ? c.trump_text.split('\n\n').map((x) => x.trim()).filter((p) => p.split(/\s+/).length >= 15)
    : (c.trump_text.trim() && !/^RT[\s@:]/.test(c.trump_text) ? [c.trump_text.trim()] : [])
  if (!texts.length) continue
  dayOf.set(d, [...(dayOf.get(d) ?? []), ...texts])
}
const days = [...dayOf.keys()].sort()
const INAUG = Date.UTC(2025, 0, 20)
const lastDay = Date.parse(days[days.length - 1] + 'T00:00:00Z')
const calendarDays = Math.round((lastDay - INAUG) / 86400000) + 1

say(`\n══ DAYS IN OFFICE ══\n`)
say(`  ${calendarDays} calendar days since the inauguration · he is on the record on ${days.length} of them\n`)
const daysWith = (t: Topic) => {
  const res = t.kws.map(rx)
  return days.filter((d) => (dayOf.get(d) ?? []).some((x) => {
    const l = x.toLowerCase()
    if (!res.some((r) => r.test(l))) return false
    if (t.clean && t.clean.test(x)) return false
    if (t.deny) {
      const stripped = l.replace(new RegExp(t.deny.source, 'gi'), ' ')
      if (!res.some((r) => r.test(stripped))) return false
    }
    return true
  })).length
}
const dayPct: Record<string, { days: number; pctOfTerm: number }> = {}
for (const t of [...VANITY, ...KITCHEN]) {
  const n = daysWith(t)
  dayPct[t.name] = { days: n, pctOfTerm: Math.round((1000 * n) / calendarDays) / 10 }
  say(`  ${t.name.padEnd(38)}${String(n).padStart(4)} days   ${String(dayPct[t.name].pctOfTerm).padStart(5)}% of days in office`)
}

writeFileSync(path.join(DIR, 'vanity_gap.json'), JSON.stringify({
  daysInOffice: { calendarDays, onRecordDays: days.length, byTopic: dayPct },
  denominator: { passages: ALL.length, spoken: S.length, posts: P.length },
  vanity: V, kitchen: K, comparisons,
  dropped: { gold: 'overwhelmingly "golden age" slogan and "liquid gold" (oil)', statue: 'monuments policy, not self-commemoration' },
}, null, 2))
writeFileSync(path.join(DIR, 'vanity_gap.txt'), out.join('\n'))
say(`\nWrote ${path.join(DIR, 'vanity_gap.json')}`)
