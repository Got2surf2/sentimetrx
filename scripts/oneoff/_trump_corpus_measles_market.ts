/**
 * "Measles rose faster than the market — and he won't talk about it."
 *
 *   node_modules/.bin/tsx scripts/oneoff/_trump_corpus_measles_market.ts
 *
 * Owner's construct (2026-08-08). Three claims, and they are NOT equally strong:
 *
 *  1. THE CORPUS CLAIM — the strongest thing in the whole project. He talks
 *     about the stock market constantly and has said "measles" three times in
 *     nineteen months. Unfalsifiable, ours, needs no outside source.
 *  2. THE RATE CLAIM — measles +703% vs the market ~+33%. True, and by a wide
 *     margin, but see the health warning below.
 *  3. THE RFK CLAIM — factual public record, with one correction baked in.
 *
 * ⚠️ HEALTH WARNING ON THE RATE COMPARISON. A percentage change in disease
 * cases and a percentage change in an equity index are DIFFERENT UNITS. The
 * comparison works rhetorically — "the thing he brags about grew a third, the
 * thing he ignores grew sevenfold" — but it is not a statistical statement, and
 * an opponent can call it apples-to-oranges and be technically right. The
 * corpus claim cannot be attacked that way, which is why it should lead.
 *
 * ⚠️ CORRECTION TO THE DRAFT COPY: RFK Jr. was confirmed by the SENATE, 52-48.
 * House members had no vote. "Your Republican congress people confirmed him" is
 * FALSE in a House district and hands over an easy correction. Say "senators".
 *
 * ⚠️ VERIFICATION LIMITS: the CDC, S&P and Senate figures are all external and
 * came from search summaries, not verbatim reads. The market figure is also
 * approximate — the two published returns are calendar-year (from 1 Jan), not
 * from the 20 Jan inauguration, so it is stated as "about" and never to a
 * decimal. Confirm before publishing.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const DIR = path.join(homedir(), 'Downloads', 'trump-corpus')

/** EXTERNAL — none of this is our measurement. */
const EXT = {
  measles: { source: 'CDC — Measles Cases and Outbreaks (accessed 2026-08-08)', y2024: 285, y2025: 2289, y2026ToAug6: 2465 },
  market: {
    source: 'S&P 500 total return: +17.9% in 2025, +12.7% YTD 2026 (accessed 2026-08-08)',
    caveat: 'calendar-year figures from 1 Jan, NOT from the 20 Jan inauguration — state as "about"',
    y2025: 17.9, y2026ytd: 12.7,
  },
  rfk: {
    source: 'Senate roll call, 13 Feb 2025',
    vote: '52-48', chamber: 'SENATE, not the House',
    detail: '52 Republicans voted yes; McConnell was the only Republican voting no',
  },
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
  for (const t of texts) if (!seen.has(t)) { seen.add(t); units.push({ date: d, text: t }) }
}
const DAYS = new Set(units.map((u) => u.date)).size

const rx = (k: string) => new RegExp(`(?<![a-z])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
const find = (kws: string[]) => {
  const res = kws.map(rx)
  return units.filter((u) => { const l = u.text.toLowerCase(); return res.some((r) => r.test(l)) })
}
const stat = (kws: string[]) => { const h = find(kws); return { passages: h.length, days: new Set(h.map((x) => x.date)).size } }

const out: string[] = []
const say = (s = '') => { console.log(s); out.push(s) }

say(`DENOMINATOR: ${units.length.toLocaleString()} passages across ${DAYS} days on the record\n`)

say('══ 1. THE CORPUS CLAIM — lead with this ══\n')
const market = stat(['stock market'])
const marketWide = stat(['stock market', 'the market is', 'dow jones', 's&p', 'nasdaq', 'stocks are', '401'])
const measles = stat(['measles'])
const outbreak = stat(['outbreak'])
const autism = stat(['autism'])
const vax = stat(['vaccine', 'vaccination', 'mmr', 'immuniz'])
for (const [l, s] of [['"stock market"', market], ['stock market (incl. Dow/S&P/Nasdaq/401k)', marketWide],
  ['"measles"', measles], ['"outbreak"', outbreak], ['"autism"', autism], ['vaccines / MMR', vax]] as const) {
  say(`  ${l.padEnd(42)}${String(s.passages).padStart(5)} passages${String(s.days).padStart(5)} days`)
}
say(`\n  → ${Math.round(market.passages / measles.passages)}x more passages about the stock market than measles.`)
say(`  → stock market on ${Math.round((100 * market.days) / DAYS)}% of his days on the record; measles on ${Math.round((1000 * measles.days) / DAYS) / 10}%.`)

// The CONTENT of the three matters more than the count. Print them in full.
say('\n══ ALL THREE MEASLES MENTIONS, IN FULL — this is the real finding ══')
// Centre each excerpt on the matched word. Taking the first N characters
// truncated one of them BEFORE the word "measles" appeared, which makes the
// quote impossible to audit at a glance.
find(['measles']).forEach((u, i) => {
  const flat = u.text.replace(/\s+/g, ' ').trim()
  const at = flat.toLowerCase().indexOf('measles')
  const from = Math.max(0, at - 170)
  say(`\n  [${i + 1}] ${u.date}`)
  say(`      ${from > 0 ? '…' : ''}${flat.slice(from, at + 230)}…`)
})
say('\n  NOTE FOR ANYONE USING THIS: not one of the three addresses the outbreak.')
say('  One calls measles "not something new"; two argue for splitting the MMR shot.')

say('\n══ 2. THE RATE CLAIM — true, but the weaker form ══\n')
const measlesPct = Math.round(((EXT.measles.y2025 - EXT.measles.y2024) / EXT.measles.y2024) * 100)
const marketPct = Math.round((((1 + EXT.market.y2025 / 100) * (1 + EXT.market.y2026ytd / 100)) - 1) * 100)
say(`  Measles cases   ${EXT.measles.y2024} → ${EXT.measles.y2025}   = +${measlesPct}%   [${EXT.measles.source}]`)
say(`  S&P 500         +${EXT.market.y2025}% then +${EXT.market.y2026ytd}%   ≈ +${marketPct}% compounded`)
say(`                  ⚠ ${EXT.market.caveat}`)
say(`  → measles rose roughly ${Math.round(measlesPct / marketPct)}x faster than the market.`)
say('  ⚠ DIFFERENT UNITS. Rhetorically fine, statistically not a like-for-like.')
say('    Lead with the corpus claim; use this as the follow-up, never the opener.')

say('\n══ 3. THE RFK CLAIM — public record, with a correction ══\n')
say(`  Confirmed ${EXT.rfk.vote} on 13 Feb 2025. ${EXT.rfk.detail}.`)
say(`  ⚠ ${EXT.rfk.chamber}. "Your Republican CONGRESS PEOPLE confirmed him" is FALSE`)
say('    in a House district — House members get no confirmation vote. Say SENATORS.')

say('\n══ DRAFT COPY (corrected) ══\n')
const copy = [
  `He has talked about the stock market on ${market.days} separate days.`,
  `He has said the word "measles" three times in nineteen months — and not once to address the outbreak.`,
  ``,
  `Measles cases are up ${measlesPct}%. The market is up about ${marketPct}%.`,
  `Guess which number he mentions.`,
  ``,
  `Fifty-two Republican senators confirmed the man now running public health. One voted no.`,
  ``,
  `Is this what you voted for?`,
  `Go out and vote. Make your voice count.`,
]
copy.forEach((l) => say('  ' + l))

writeFileSync(path.join(DIR, 'measles_market.json'), JSON.stringify({
  denominator: { passages: units.length, days: DAYS },
  corpus: { market, marketWide, measles, outbreak, autism, vax },
  measlesMentions: find(['measles']).map((u) => ({ date: u.date, text: u.text.replace(/\s+/g, ' ').trim() })),
  external: EXT, measlesPct, marketPct, draftCopy: copy.filter(Boolean),
}, null, 2))
writeFileSync(path.join(DIR, 'measles_market.txt'), out.join('\n'))
say(`\nWrote ${path.join(DIR, 'measles_market.json')}`)
