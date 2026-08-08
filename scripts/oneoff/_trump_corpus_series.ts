/**
 * Measure each mined theme month by month, and audit for runaway keywords.
 *
 *   node_modules/.bin/tsx scripts/oneoff/_trump_corpus_series.ts
 *
 * Reads the themes produced by _trump_corpus_mine.ts and re-measures them
 * against the corpus with the product's own matcher. Kept separate from mining
 * so the series can be recomputed without paying for the AI calls again.
 *
 * Two safeguards, both from things that actually went wrong:
 *  - scanThemes keys perTheme by ARRAY INDEX, not theme.id. Indexing by id
 *    returns undefined and yields an all-zero series that looks like real data.
 *  - A single over-broad keyword can carry a whole theme (a "theme" at 7% that
 *    is really one generic word matching everything). Per-keyword hit counts are
 *    reported so an inflated theme is visible rather than inferred.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { scanThemes, type MinedTheme } from '../../lib/themeMining'

const DIR = path.join(homedir(), 'Downloads', 'trump-corpus')
const MIN_WORDS = 15

interface MinedOut { name: string; themes: MinedTheme[] }
interface CorpusItem { source: string; trump_text: string; date: string; word_count: number }

const mined = JSON.parse(readFileSync(path.join(DIR, 'themes.json'), 'utf-8')) as MinedOut[]
const corpus = readFileSync(path.join(DIR, 'trump_corpus.ndjson'), 'utf-8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l) as CorpusItem)

/** Unit of analysis per side: paragraphs for spoken, whole posts for Truth. */
function unitsFor(side: 'spoken' | 'posted'): { text: string; month: string }[] {
  const out: { text: string; month: string }[] = []
  for (const c of corpus) {
    const isSpoken = c.source === 'govinfo_dcpd'
    if ((side === 'spoken') !== isSpoken) continue
    const month = c.date.slice(0, 7)
    if (isSpoken) {
      for (const p of c.trump_text.split('\n\n').map((x) => x.trim())) {
        if (p.split(/\s+/).length >= MIN_WORDS) out.push({ text: p, month })
      }
    } else if (c.trump_text.trim() && !/^RT[\s@:]/.test(c.trump_text)) {
      out.push({ text: c.trump_text, month })
    }
  }
  return out
}

// ThemeScan.perTheme is a plain number[] aligned to the themes array — NOT a
// map keyed by theme.id, and NOT Sets. `.size` on it is undefined, which
// silently produces an all-zero series that looks like real measurement.
const hits = (texts: string[], t: MinedTheme) => scanThemes(texts, [t]).perTheme[0] ?? 0

const report: Record<string, unknown> = {}

for (const side of ['spoken', 'posted'] as const) {
  const set = mined.find((m) => (side === 'spoken' ? /Spoken/ : /Truth/).test(m.name))
  if (!set) continue
  const units = unitsFor(side)
  const months = [...new Set(units.map((u) => u.month))].sort()
  const allTexts = units.map((u) => u.text)

  console.log(`\n═══ ${set.name} — ${units.length} units, ${months.length} months ═══`)

  const rows: { name: string; overall: number; series: Record<string, number>; top: string }[] = []
  for (const t of set.themes) {
    const overall = Math.round((1000 * hits(allTexts, t)) / allTexts.length) / 10

    // Runaway-keyword audit: how much of the theme rides on its top keyword?
    const per = t.keywords.map((k) => ({
      k, n: hits(allTexts, { ...t, keywords: [k] }),
    })).sort((a, b) => b.n - a.n)
    const total = hits(allTexts, t)
    const topShare = total ? Math.round((100 * per[0].n) / total) : 0

    const series: Record<string, number> = {}
    for (const m of months) {
      const inM = units.filter((u) => u.month === m)
      if (inM.length < 20) continue // too few units to report a share
      series[m] = Math.round((100 * hits(inM.map((u) => u.text), t)) / inM.length)
    }
    rows.push({ name: t.name, overall, series, top: `${per[0].k} (${topShare}% of theme)` })
  }

  rows.sort((a, b) => b.overall - a.overall)
  const shown = months.filter((_, i) => i % 3 === 0)
  console.log(`\n  theme                                overall  ${shown.map((m) => m.slice(2)).join(' ')}`)
  for (const r of rows) {
    console.log(
      `  ${r.name.slice(0, 34).padEnd(34)} ${String(r.overall).padStart(6)}%  ` +
      shown.map((m) => String(r.series[m] ?? 0).padStart(5)).join(' '),
    )
  }
  console.log('\n  top keyword per theme (share of that theme\'s matches):')
  for (const r of rows) console.log(`    ${r.name.slice(0, 34).padEnd(34)} ${r.top}`)

  report[side] = { units: units.length, months, themes: rows }
}

writeFileSync(path.join(DIR, 'theme_series.json'), JSON.stringify(report, null, 2))
console.log(`\nWrote ${path.join(DIR, 'theme_series.json')}`)
