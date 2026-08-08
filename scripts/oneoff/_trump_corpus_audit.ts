/**
 * Audit every number that appears in the report.
 *
 *   node_modules/.bin/tsx scripts/oneoff/_trump_corpus_audit.ts
 *
 * Direction of error matters and is asymmetric here:
 *  - On LOW-salience issues ("he never talks about health care") a false
 *    positive OVERSTATES his attention, making the claim conservative. Safe.
 *  - On HIGH-salience issues ("14% of his posts are immigration") a false
 *    positive INFLATES the claim. Not safe — so those keywords get checked
 *    individually and their matched passages sampled by eye.
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { scanThemes, type MinedTheme } from '../../lib/themeMining'

const DIR = path.join(homedir(), 'Downloads', 'trump-corpus')
const MIN_WORDS = 15

interface CorpusItem { source: string; trump_text: string; date: string }
const corpus = readFileSync(path.join(DIR, 'trump_corpus.ndjson'), 'utf-8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l) as CorpusItem)

function units(side: 'spoken' | 'posted') {
  const out: string[] = []
  for (const c of corpus) {
    const isSpoken = c.source === 'govinfo_dcpd'
    if ((side === 'spoken') !== isSpoken) continue
    if (isSpoken) {
      for (const p of c.trump_text.split('\n\n').map((x) => x.trim())) {
        if (p.split(/\s+/).length >= MIN_WORDS) out.push(p)
      }
    } else if (c.trump_text.trim() && !/^RT[\s@:]/.test(c.trump_text)) out.push(c.trump_text)
  }
  return out
}
const S = units('spoken')
const P = units('posted')

const asTheme = (kw: string[]): MinedTheme => ({
  id: 'x', name: 'x', description: '', keywords: kw, sentiment: 'neutral', count: 0, percentage: 0, relatedThemes: [],
})
const hit = (texts: string[], kw: string[]) => scanThemes(texts, [asTheme(kw)]).perTheme[0] ?? 0
const pct = (n: number, d: number) => Math.round((10000 * n) / d) / 100

console.log(`DENOMINATORS  spoken paragraphs = ${S.length}   posts (own words) = ${P.length}\n`)

// ── 1. Every "zero / once" claim in the report, stated exactly ──────────────
console.log('── ABSOLUTE CLAIMS ──')
for (const phrase of ['good-paying jobs', 'uninsured', 'preschool', 'affordable housing',
  'first-time buyer', 'minimum wage', 'cost of living', 'making ends meet', 'witch hunt']) {
  console.log(`  "${phrase}"`.padEnd(28) + `spoken ${String(hit(S, [phrase])).padStart(5)}   posts ${String(hit(P, [phrase])).padStart(4)}`)
}

// ── 2. High-salience issues: per-keyword, to catch inflators ────────────────
const HIGH: Record<string, string[]> = {
  'Immigration / border': ['border', 'illegal aliens', 'illegals', 'deportation', 'deport', 'migrants', 'invasion', 'ICE'],
  'Crime / public safety': ['crime', 'criminals', 'murder', 'violent', 'police', 'law and order', 'gangs'],
  'Guns': ['guns', 'gun violence', 'Second Amendment', 'shooting', 'firearms'],
  'Health care': ['health care', 'healthcare', 'health insurance', 'premiums', 'deductible', 'Medicaid', 'Obamacare', 'Affordable Care Act', 'uninsured', 'medical bills'],
}
console.log('\n── HIGH-SALIENCE KEYWORD BREAKDOWN (posts) ──')
for (const [issue, kws] of Object.entries(HIGH)) {
  const total = hit(P, kws)
  console.log(`\n  ${issue}: ${total} posts (${pct(total, P.length)}%)`)
  for (const k of kws) {
    const n = hit(P, [k])
    console.log(`    ${k.padEnd(22)} ${String(n).padStart(5)}  ${total ? Math.round((100 * n) / total) : 0}% of issue`)
  }
}

// ── 3. Eyeball the riskiest matches ────────────────────────────────────────
console.log('\n── SAMPLED MATCHES for keywords most likely to be false positives ──')
for (const k of ['ICE', 'shooting', 'violent', 'border']) {
  const matches = P.filter((t) => (scanThemes([t], [asTheme([k])]).perTheme[0] ?? 0) > 0)
  console.log(`\n  "${k}" — ${matches.length} posts. First 3:`)
  for (const m of matches.slice(0, 3)) console.log(`    · ${m.replace(/\s+/g, ' ').slice(0, 125)}`)
}

// ── 4. The headline ratio, from raw counts not rounded percentages ─────────
console.log('\n── HEADLINE RATIO ──')
const imm = hit(P, HIGH['Immigration / border'])
const hc = hit(P, HIGH['Health care'])
console.log(`  posts matching immigration: ${imm} (${pct(imm, P.length)}%)`)
console.log(`  posts matching health care: ${hc} (${pct(hc, P.length)}%)`)
console.log(`  ratio from RAW COUNTS: ${(imm / hc).toFixed(1)}×   (from rounded pcts: ${(14.4 / 0.9).toFixed(1)}×)`)
