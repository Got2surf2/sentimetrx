/* eslint-disable */
// Ruth's Chris pilot — pull concrete example reviews for the client deck,
// bucketed by how our Tier-1 classifier compares to the vendor's labels.
//
//   1 MATCH        — we captured everything the vendor's usable labels caught
//   2 VENDOR_MORE  — vendor caught >=2 usable axis:subs we missed (TEST excluded)
//   3 WE_MISSED    — we produced ZERO labels but the vendor had usable labels
//
// Run: node_modules/.bin/tsx scripts/pilot-rc-examples.ts [--per 6] [--maxlen 260]

import { readFileSync } from 'fs'
import { classifyByKeyword } from '../lib/taxonomyKeywordMatcher'
import { mapLegacyLabels } from '../lib/taxonomyMapping'

const CSV_PATH = '/Users/sanjaypatel/Downloads/RC Verbatims 15-months ending 093025.csv'
const args = process.argv.slice(2)
const getFlag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const per = parseInt(getFlag('--per') ?? '6', 10)
const maxlen = parseInt(getFlag('--maxlen') ?? '260', 10)

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
const key = (a: { axis: string; sub: string }) => `${a.axis}:${a.sub}`

interface Ex { text: string; rating: string; vendor: string[]; ours: string[]; missed: string[] }

function main() {
  const all = parseCSV(readFileSync(CSV_PATH, 'utf-8'))
  const h = all[0]
  const dIdx = h.indexOf('Description'), cIdx = h.indexOf('Classification'), rIdx = h.indexOf('ReviewRating')

  const match: Ex[] = [], vendorMore: Ex[] = [], weMissed: Ex[] = []

  for (let i = 1; i < all.length; i++) {
    if (match.length >= per && vendorMore.length >= per && weMissed.length >= per) break
    const r = all[i]
    if (r.length <= dIdx) continue
    const text = (r[dIdx] ?? '').trim()
    if (!text || text.length > maxlen || text.length < 40) continue

    const legacy = mapLegacyLabels(cIdx >= 0 ? splitTags(r[cIdx]) : [])
    const vendorSet = new Set(legacy.assertions.map(key))
    if (vendorSet.size === 0) continue   // need a usable vendor label to compare

    const ours = classifyByKeyword(text).assertions
    const ourSet = new Set(ours.map(key))
    const missed = [...vendorSet].filter(k => !ourSet.has(k))

    const ex: Ex = {
      text, rating: rIdx >= 0 ? r[rIdx] : '',
      vendor: [...vendorSet].sort(),
      ours: [...ourSet].sort(),
      missed: missed.sort(),
    }

    if (missed.length === 0 && match.length < per) { match.push(ex); continue }
    if (ourSet.size === 0 && weMissed.length < per) { weMissed.push(ex); continue }
    if (missed.length >= 2 && ourSet.size > 0 && vendorMore.length < per) { vendorMore.push(ex); continue }
  }

  const show = (title: string, xs: Ex[]) => {
    console.log(`\n${'='.repeat(70)}\n${title}\n${'='.repeat(70)}`)
    xs.forEach((e, n) => {
      console.log(`\n[${n + 1}] (${e.rating}/5)  "${e.text}"`)
      console.log(`    VENDOR: ${e.vendor.join(', ')}`)
      console.log(`    OURS:   ${e.ours.join(', ') || '(none)'}`)
      if (e.missed.length) console.log(`    WE MISSED: ${e.missed.join(', ')}`)
    })
  }
  show('BUCKET 1 — MATCH (we captured all the vendor caught)', match)
  show('BUCKET 2 — VENDOR CAUGHT MORE (>=2 usable labels we missed; TEST excluded)', vendorMore)
  show('BUCKET 3 — WE MISSED (we produced nothing; vendor had usable labels)', weMissed)
}

main()
