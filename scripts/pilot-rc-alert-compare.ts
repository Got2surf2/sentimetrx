/* eslint-disable */
// Critical-category check: do OUR classifier and the VENDOR agree on the
// food-safety and pests alerts? These are the highest-stakes tags (a missed
// food-poisoning review is the worst failure mode), so we compare them head to
// head on the full CSV and surface mismatches with the verbatim text for drill-
// down — exactly the side-by-side a prospect would want to scrutinise.
//
// OURS   = keyword classifier assertions with sub ∈ {food safety, pests}
// THEIRS = vendor labels (Classification col) projected via taxonomyMapping,
//          same subs (incl. the vendor's 'Alert - Food Safety' family).
//
// Run: node_modules/.bin/tsx scripts/pilot-rc-alert-compare.ts [--limit N] [--examples 8]

import { readFileSync } from 'fs'
import { classifyByKeyword } from '../lib/taxonomyKeywordMatcher'
import { mapLegacyLabels } from '../lib/taxonomyMapping'

const CSV_PATH = '/Users/sanjaypatel/Downloads/RC Verbatims 15-months ending 093025.csv'
const args = process.argv.slice(2)
const getFlag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const limit = getFlag('--limit') ? parseInt(getFlag('--limit')!, 10) : Infinity
const N_EX = getFlag('--examples') ? parseInt(getFlag('--examples')!, 10) : 6

function parseCSV(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else q = false } else field += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\r') {}
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else field += c
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows
}
const splitTags = (s: string) => (s || '').split(',').map(x => x.trim()).filter(Boolean)
const snip = (s: string, n = 150) => s.replace(/\s+/g, ' ').slice(0, n) + (s.length > n ? '…' : '')

const SUBS = ['food safety', 'pests'] as const
type Sub = typeof SUBS[number]

interface Ex { text: string; ours: string[]; theirsRaw: string[] }

function main() {
  const all = parseCSV(readFileSync(CSV_PATH, 'utf-8'))
  const h = all[0]
  const dIdx = h.indexOf('Description'), cIdx = h.indexOf('Classification')

  // per-sub tallies + example buckets
  const tally: Record<Sub, { ours: number; theirs: number; both: number; oursOnly: number; theirsOnly: number }> = {
    'food safety': { ours: 0, theirs: 0, both: 0, oursOnly: 0, theirsOnly: 0 },
    'pests':       { ours: 0, theirs: 0, both: 0, oursOnly: 0, theirsOnly: 0 },
  }
  const examples: Record<Sub, { oursOnly: Ex[]; theirsOnly: Ex[] }> = {
    'food safety': { oursOnly: [], theirsOnly: [] },
    'pests':       { oursOnly: [], theirsOnly: [] },
  }
  let reviews = 0

  for (let i = 1; i < all.length && reviews < limit; i++) {
    const r = all[i]
    if (r.length <= dIdx) continue
    const text = (r[dIdx] ?? '').trim()
    if (!text) continue
    reviews++

    const rawTags = cIdx >= 0 ? splitTags(r[cIdx]) : []
    const theirs = mapLegacyLabels(rawTags).assertions
    const ours = classifyByKeyword(text).assertions
    const ourSubs = new Set(ours.map(a => a.sub))
    const theirSubs = new Set(theirs.map(a => a.sub))

    for (const sub of SUBS) {
      const o = ourSubs.has(sub), t = theirSubs.has(sub)
      if (o) tally[sub].ours++
      if (t) tally[sub].theirs++
      if (o && t) tally[sub].both++
      else if (o && !t) {
        tally[sub].oursOnly++
        if (examples[sub].oursOnly.length < N_EX) examples[sub].oursOnly.push({ text: snip(text), ours: ours.filter(a => a.sub === sub).map(a => `${a.sub}/${a.severity}`), theirsRaw: rawTags })
      } else if (!o && t) {
        tally[sub].theirsOnly++
        if (examples[sub].theirsOnly.length < N_EX) examples[sub].theirsOnly.push({ text: snip(text), ours: ours.map(a => `${a.axis}:${a.sub}`), theirsRaw: rawTags })
      }
    }
  }

  const pct = (n: number, d: number) => `${(100 * n / Math.max(1, d)).toFixed(1)}%`
  console.log(`\n=== FOOD-SAFETY & PESTS ALERT AGREEMENT — ours vs vendor (${reviews} reviews) ===`)
  for (const sub of SUBS) {
    const t = tally[sub]
    const union = t.both + t.oursOnly + t.theirsOnly
    console.log(`\n${sub.toUpperCase()}`)
    console.log(`  Ours flagged:        ${t.ours}`)
    console.log(`  Vendor flagged:      ${t.theirs}`)
    console.log(`  BOTH agree:          ${t.both}  (${pct(t.both, union)} of all flagged by either)`)
    console.log(`  OURS only (we add):  ${t.oursOnly}`)
    console.log(`  VENDOR only (WE MISS): ${t.theirsOnly}  ← the risk on a critical category`)
  }

  for (const sub of SUBS) {
    console.log(`\n--- ${sub.toUpperCase()} · VENDOR-ONLY (reviews they flagged, we did NOT) ---`)
    if (!examples[sub].theirsOnly.length) console.log('  (none)')
    for (const e of examples[sub].theirsOnly) {
      console.log(`  • "${e.text}"`)
      console.log(`     vendor: [${e.theirsRaw.join(', ')}]   ours: [${e.ours.join(', ') || '—'}]`)
    }
    console.log(`\n--- ${sub.toUpperCase()} · OURS-ONLY (we flagged, vendor did NOT) ---`)
    if (!examples[sub].oursOnly.length) console.log('  (none)')
    for (const e of examples[sub].oursOnly) {
      console.log(`  • "${e.text}"`)
      console.log(`     ours: [${e.ours.join(', ')}]   vendor: [${e.theirsRaw.join(', ') || '—'}]`)
    }
  }
}
main()
