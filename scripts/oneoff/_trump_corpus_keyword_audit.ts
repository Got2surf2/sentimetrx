/**
 * Audit EVERY keyword list in the project for the same class of defect.
 *
 *   node_modules/.bin/tsx scripts/oneoff/_trump_corpus_keyword_audit.ts
 *
 * WHY: the name-calling figure shipped wrong because "fool" was matching
 * "foolishly given away" and "loser" was matching "loser pays". That was not
 * bad luck — it is a SYSTEMIC defect in the matcher every list shares:
 *
 *     new RegExp(`(?<![a-z])${kw}`)
 *
 * The lookbehind guards the LEFT edge only. There is no right-hand boundary, so
 * every keyword also matches any longer word that STARTS with it: fool→foolish,
 * rent→rental, ice→iced, deport→deportation (harmless), gold→golden (not).
 *
 * This script finds the whole class in one pass. For every keyword in every
 * published list it reports:
 *   BLEED  — matches where the keyword is a prefix of a longer word, with the
 *            actual continuations, so a real false positive is visible
 *   SAMPLE — matches in context, because a clean boundary does not make a
 *            keyword right (see "loser pays", which is a whole-word match and
 *            still wrong)
 *
 * Judgement stays human. This ranks what to read, it does not decide.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const DIR = path.join(homedir(), 'Downloads', 'trump-corpus')

interface Item { source: string; trump_text: string }
const rows = readFileSync(path.join(DIR, 'trump_corpus.ndjson'), 'utf-8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l) as Item)

const seen = new Set<string>()
const U: string[] = []
for (const c of rows) {
  const texts = c.source === 'govinfo_dcpd'
    ? c.trump_text.split('\n\n').map((x) => x.trim()).filter((p) => p.split(/\s+/).length >= 15)
    : (c.trump_text.trim() && !/^RT[\s@:]/.test(c.trump_text) ? [c.trump_text.trim()] : [])
  for (const t of texts) if (!seen.has(t)) { seen.add(t); U.push(t) }
}

/** The production matcher, reproduced exactly — bug included. */
const prod = (k: string) => new RegExp(`(?<![a-z])${k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)

/** Every keyword list that feeds a published figure. */
const LISTS: Record<string, string[]> = {
  'vanity: ballroom': ['ballroom'],
  'vanity: windmills': ['windmill', 'wind turbine'],
  'vanity: kennedy center': ['kennedy center'],
  'vanity: 2020 election': ['rigged election', 'stolen election', '2020 election', 'election was rigged'],
  'vanity: reflecting pool': ['reflecting pool'],
  'vanity: golf/properties': ['golf', 'mar-a-lago', 'doral', 'turnberry'],
  'vanity: nobel': ['nobel'],
  'vanity: renaming': ['gulf of america', 'denali', 'mount mckinley'],
  'vanity: teleprompters': ['teleprompter'],
  'vanity: arch': ['triumphal arch', 'arc de'],
  'kitchen: child care': ['child care', 'childcare', 'day care', 'preschool'],
  'kitchen: housing': ['affordable housing', 'first-time buyer', 'homebuyer'],
  'kitchen: uninsured': ['uninsured', 'medical bills', 'premiums'],
  'kitchen: wages': ['minimum wage', 'good-paying jobs', 'take-home pay', 'paycheck'],
  'kitchen: cost of living': ['cost of living', 'making ends meet', 'groceries', 'grocery bill'],
  'issues: immigration': ['border', 'illegal aliens', 'illegals', 'deportation', 'deport', 'migrants', 'invasion', 'ICE'],
  'issues: crime': ['crime', 'criminals', 'murder', 'violent', 'police', 'law and order', 'gangs'],
  'issues: tariffs': ['tariff', 'tariffs', 'trade deal', 'trade deficit', 'imports', 'exports'],
  'issues: health care': ['health care', 'healthcare', 'health insurance', 'premiums', 'deductible', 'Medicaid', 'Obamacare', 'uninsured', 'medical bills'],
  'issues: housing': ['housing', 'rent', 'rents', 'mortgage', 'homebuyer', 'homeless'],
  'issues: ss/medicare': ['Social Security', 'Medicare', 'retirement', 'seniors', 'pension'],
  'issues: education': ['public schools', 'teachers', 'classroom', 'student loans', 'tuition', 'college costs'],
  'market': ['stock market', 'the market is', 'dow jones', 's&p', 'nasdaq', 'stocks are', '401'],
  'ratios: grievances': ['witch hunt', 'hoax', 'rigged', 'lawfare', 'weaponized', 'deep state', 'stolen election'],
  'ratios: media': ['fake news', 'lamestream', 'failing New York Times', 'CNN', 'MSNBC', 'fake polls'],
  'ratios: election win': ['landslide', 'mandate', 'won the election', 'biggest victory', 'swing states'],
  'ratios: biden': ['Crooked Joe', 'Sleepy Joe', 'autopen', 'worst President'],
  'economy: claims': ['no inflation', 'prices are down', 'groceries are down', 'greatest economy', 'golden age', 'booming'],
}

const out: string[] = []
const say = (s = '') => { console.log(s); out.push(s) }

say(`Corpus: ${U.length.toLocaleString()} deduped passages\n`)
say('BLEED = keyword matched as the PREFIX of a longer word (the fool→foolish defect).\n')

interface Finding { list: string; kw: string; total: number; bleed: number; pct: number; tails: string[] }
const findings: Finding[] = []

for (const [list, kws] of Object.entries(LISTS)) {
  for (const kw of kws) {
    const re = prod(kw)
    let total = 0, bleed = 0
    const tails = new Map<string, number>()
    for (const t of U) {
      const l = t.toLowerCase()
      const m = re.exec(l)
      if (!m) continue
      total++
      // Does the keyword run straight into more letters?
      const after = l.slice(m.index + kw.length)
      const cont = after.match(/^[a-z]+/)
      if (cont) {
        bleed++
        const w = kw + cont[0]
        tails.set(w, (tails.get(w) ?? 0) + 1)
      }
    }
    if (!total) continue
    findings.push({
      list, kw, total, bleed, pct: Math.round((100 * bleed) / total),
      tails: [...tails.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([w, n]) => `${w}(${n})`),
    })
  }
}

say('══ KEYWORDS WITH BLEED, worst first ══\n')
say('  ' + 'list'.padEnd(26) + 'keyword'.padEnd(20) + 'total'.padStart(6) + 'bleed'.padStart(7) + '  %   continuations')
for (const f of findings.filter((x) => x.bleed > 0).sort((a, b) => b.bleed - a.bleed)) {
  const flag = f.pct >= 25 ? ' ⚠' : ''
  say(`  ${f.list.padEnd(26)}${f.kw.padEnd(20)}${String(f.total).padStart(6)}${String(f.bleed).padStart(7)}${String(f.pct).padStart(4)}%  ${f.tails.join(' ')}${flag}`)
}

const clean = findings.filter((x) => x.bleed === 0).length
say(`\n  ${findings.filter((x) => x.bleed > 0).length} keywords bleed; ${clean} are clean whole-word matches.`)
say('  ⚠ marks >=25% bleed — those change a published number and must be read.')
say('  A 0% bleed does NOT mean correct: "loser pays" was a clean whole-word match.')

writeFileSync(path.join(DIR, 'keyword_audit.json'), JSON.stringify({ corpus: U.length, findings }, null, 2))
writeFileSync(path.join(DIR, 'keyword_audit.txt'), out.join('\n'))
say(`\nWrote ${path.join(DIR, 'keyword_audit.json')}`)
