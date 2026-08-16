/* eslint-disable */
// Ruth's Chris taxonomy pilot — Path B Stage 2: keyword BUILD.
//
// Reads data/keyword-candidates.jsonl (from pilot-rc-keyword-mine.ts) and
// aggregates the per-review verbatim phrases into a frequency-floored learned
// keyword dictionary, emitted as lib/taxonomyKeywordsLearned.ts in the exact
// KeywordEntry[] shape the Tier-1 matcher consumes.
//
// Run: node_modules/.bin/tsx scripts/pilot-rc-keyword-build.ts [--in data/keyword-candidates.jsonl] [--min-count 3] [--out lib/taxonomyKeywordsLearned.ts]
//
// Aggregation:
//   1. Normalize phrase: lowercase, strip surrounding punctuation, collapse whitespace.
//   2. Count by (phrase, axis, sub, polarity).
//   3. Product guard: drop generic food-sentiment ("great food") misfiled on
//      the product axis — it belongs on attribute:flavor (emitted separately).
//   4. Frequency floor: drop (phrase,axis,sub) tuples whose TOTAL count < min-count.
//   5. Polarity resolve: per (phrase,axis,sub), keep the majority polarity;
//      keep a second polarity only if its share >= 30% AND its count >= 2.
//   6. Item assignment (product axis): if the phrase names a PRODUCT_ITEMS term,
//      set the entry's item field.
//   7. Group into KeywordEntry by (axis, sub, item).

import { readFileSync, writeFileSync } from 'fs'
import { PRODUCT_ITEMS, PRODUCT_SUBS, type Axis } from '../lib/taxonomyVocabulary'

const args = process.argv.slice(2)
function getFlag(name: string): string | undefined {
  const idx = args.indexOf(name)
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1]
  return undefined
}
const inPath = getFlag('--in') ?? 'data/keyword-candidates.jsonl'
const minCount = parseInt(getFlag('--min-count') ?? '3', 10)
const outPath = getFlag('--out') ?? 'lib/taxonomyKeywordsLearned.ts'

const MINORITY_KEEP_SHARE = 0.30
const MINORITY_MIN_COUNT = 2
const SEP = '\u001F'   // unit separator — cannot appear in phrase text

function normalizePhrase(p: string): string {
  return p
    .toLowerCase()
    .replace(/[.,!?;:'"()\[\]]+$/g, '')
    .replace(/^[.,!?;:'"()\[\]]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function reTerm(t: string): RegExp {
  // word-boundary match allowing a trailing plural 's' ("ribeyes" -> ribeye)
  return new RegExp(`(?<![a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?(?![a-z0-9])`, 'i')
}

// Longest product item named in the phrase, or null.
const ITEMS_BY_LEN = [...PRODUCT_ITEMS].sort((a, b) => b.length - a.length)
function detectItem(phrase: string): string | null {
  for (const it of ITEMS_BY_LEN) if (reTerm(it).test(phrase)) return it
  return null
}

// Generic food words that, alone, do NOT name a product. The LLM sometimes
// files "great food" / "food was delicious" under product:steak despite the
// mine prompt forbidding it; those belong on attribute:flavor. Drop such a
// product phrase UNLESS it also names a concrete product sub/item term (so
// "best steak dinner" survives).
const GENERIC_FOOD_WORDS = new Set([
  'food', 'foods', 'meal', 'meals', 'dish', 'dishes', 'everything',
  'cuisine', 'dinner', 'lunch', 'breakfast', 'plate', 'plates',
  'entree', 'entrees', 'appetizer', 'appetizers',
])
const PRODUCT_TERMS = [...PRODUCT_SUBS, ...PRODUCT_ITEMS]
function isGenericFoodPhrase(phrase: string): boolean {
  const words = phrase.toLowerCase().split(/[^a-z]+/).filter(Boolean)
  if (!words.some(w => GENERIC_FOOD_WORDS.has(w))) return false
  const hasConcrete = PRODUCT_TERMS.some(t => reTerm(t).test(phrase))
  return !hasConcrete
}

interface Candidate { phrase: string; axis: string; sub: string; polarity: string }

function main() {
  const lines = readFileSync(inPath, 'utf-8').split('\n').filter(l => l.trim())
  console.log(`Read ${lines.length} mined reviews from ${inPath}`)

  const counts = new Map<string, number>()
  let reviewsParsed = 0, rawPhrases = 0, droppedGenericProduct = 0
  for (const line of lines) {
    let obj: any
    try { obj = JSON.parse(line) } catch { continue }
    reviewsParsed++
    const phrases: Candidate[] = Array.isArray(obj.phrases) ? obj.phrases : []
    for (const p of phrases) {
      const norm = normalizePhrase(p.phrase ?? '')
      if (!norm) continue
      rawPhrases++
      if (p.axis === 'product' && isGenericFoodPhrase(norm)) { droppedGenericProduct++; continue }
      const key = [norm, p.axis, p.sub, p.polarity].join(SEP)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  console.log(`Parsed ${reviewsParsed} reviews, ${rawPhrases} raw phrase mentions, ${counts.size} distinct tuples`)
  console.log(`Dropped ${droppedGenericProduct} generic-food mentions misfiled on the product axis`)

  // Group polarities under (phrase, axis, sub)
  interface PolStat { polarity: string; count: number }
  const byPAS = new Map<string, { phrase: string; axis: string; sub: string; pols: PolStat[] }>()
  for (const [key, n] of counts) {
    const [phrase, axis, sub, polarity] = key.split(SEP)
    const pasKey = [phrase, axis, sub].join(SEP)
    let rec = byPAS.get(pasKey)
    if (!rec) { rec = { phrase, axis, sub, pols: [] }; byPAS.set(pasKey, rec) }
    rec.pols.push({ polarity, count: n })
  }

  // Frequency floor + polarity resolution.
  interface ResolvedPhrase { phrase: string; axis: string; sub: string; polarity: string; count: number }
  const resolved: ResolvedPhrase[] = []
  let droppedFloor = 0
  for (const rec of byPAS.values()) {
    const total = rec.pols.reduce((s, p) => s + p.count, 0)
    if (total < minCount) { droppedFloor++; continue }
    rec.pols.sort((a, b) => b.count - a.count)
    const majority = rec.pols[0]
    resolved.push({ phrase: rec.phrase, axis: rec.axis, sub: rec.sub, polarity: majority.polarity, count: majority.count })
    for (let i = 1; i < rec.pols.length; i++) {
      const p = rec.pols[i]
      if (p.polarity !== majority.polarity && p.count >= MINORITY_MIN_COUNT && p.count / total >= MINORITY_KEEP_SHARE) {
        resolved.push({ phrase: rec.phrase, axis: rec.axis, sub: rec.sub, polarity: p.polarity, count: p.count })
      }
    }
  }
  console.log(`After floor(min=${minCount}): ${resolved.length} phrase entries (${droppedFloor} tuples below floor)`)

  // Group into KeywordEntry by (axis, sub, item).
  interface OutPhrase { phrase: string; polarity: string; count: number }
  interface OutEntry { axis: string; sub: string; item?: string; phrases: OutPhrase[] }
  const entryMap = new Map<string, OutEntry>()
  for (const r of resolved) {
    const item = r.axis === 'product' ? detectItem(r.phrase) : null
    const ek = [r.axis, r.sub, item ?? ''].join(SEP)
    let e = entryMap.get(ek)
    if (!e) { e = { axis: r.axis, sub: r.sub, ...(item ? { item } : {}), phrases: [] }; entryMap.set(ek, e) }
    e.phrases.push({ phrase: r.phrase, polarity: r.polarity, count: r.count })
  }

  const AXIS_ORDER: Axis[] = ['touchpoint', 'attribute', 'product', 'beverage', 'ambiance', 'context', 'outcome']
  const entries = [...entryMap.values()].sort((a, b) => {
    const ai = AXIS_ORDER.indexOf(a.axis as Axis), bi = AXIS_ORDER.indexOf(b.axis as Axis)
    if (ai !== bi) return ai - bi
    if (a.sub !== b.sub) return a.sub.localeCompare(b.sub)
    return (a.item ?? '').localeCompare(b.item ?? '')
  })
  for (const e of entries) e.phrases.sort((a, b) => b.count - a.count)

  const totalPhrases = entries.reduce((s, e) => s + e.phrases.length, 0)
  const perAxis: Record<string, number> = {}
  for (const e of entries) perAxis[e.axis] = (perAxis[e.axis] ?? 0) + e.phrases.length

  // ── Emit TS ────────────────────────────────────────────────────────────────
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const out: string[] = []
  out.push(`// lib/taxonomyKeywordsLearned.ts`)
  out.push(`//`)
  out.push(`// MACHINE-GENERATED keyword dictionary — do not hand-edit; regenerate via`)
  out.push(`// scripts/pilot-rc-keyword-build.ts. Mined from real Ruth's Chris Google`)
  out.push(`// reviews (Path B), then frequency-floored. Same KeywordEntry[] shape as the`)
  out.push(`// hand-written lib/taxonomyKeywords.ts, consumed by lib/taxonomyKeywordMatcher.ts.`)
  out.push(`//`)
  out.push(`// Provenance: ${reviewsParsed} reviews mined, ${rawPhrases} raw mentions, min-count=${minCount}.`)
  out.push(`// Result: ${entries.length} entries, ${totalPhrases} phrases.`)
  out.push(`// Per-axis phrase counts: ${Object.entries(perAxis).map(([a, n]) => `${a}=${n}`).join(', ')}`)
  out.push(`// The trailing count comment on each phrase is its sample frequency (audit trail).`)
  out.push(``)
  out.push(`import type { KeywordEntry } from './taxonomyKeywords'`)
  out.push(``)
  out.push(`export const LEARNED_KEYWORD_DICTIONARY: KeywordEntry[] = [`)
  let curAxis = ''
  for (const e of entries) {
    if (e.axis !== curAxis) {
      out.push(`  // ${'─'.repeat(2)} ${e.axis.toUpperCase()} ${'─'.repeat(Math.max(0, 58 - e.axis.length))}`)
      curAxis = e.axis
    }
    out.push(`  { axis: '${e.axis}', sub: '${esc(e.sub)}',${e.item ? ` item: '${esc(e.item)}',` : ''} phrases: [`)
    for (const p of e.phrases) {
      out.push(`    { phrase: '${esc(p.phrase)}', polarity: '${p.polarity}' }, // ${p.count}`)
    }
    out.push(`  ]},`)
  }
  out.push(`]`)
  out.push(``)

  writeFileSync(outPath, out.join('\n'))
  console.log(`\nWrote ${outPath}`)
  console.log(`  ${entries.length} entries, ${totalPhrases} phrases`)
  console.log(`  per-axis: ${Object.entries(perAxis).map(([a, n]) => `${a}=${n}`).join(', ')}`)
}

main()
