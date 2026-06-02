/* eslint-disable */
// Ruth's Chris taxonomy pilot — COVERAGE comparison: our classifier vs the
// client's existing vendor labels (the CSV `Classification` column).
//
// For each review we compare:
//   THEIRS  = the vendor's labels projected into our 7-axis model
//             (lib/taxonomyMapping.ts), minus quarantine buckets (TEST, etc.)
//   OURS    = our Tier-1 keyword classifier (deterministic, no AI)
//
// Reports: how much of the dataset each side tags, whether we reproduce what
// the vendor caught (recall), and how much MORE we add.
//
// Run: node_modules/.bin/tsx scripts/pilot-rc-coverage.ts [--limit N]   (default: all)

import { readFileSync } from 'fs'
import { classifyByKeyword } from '../lib/taxonomyKeywordMatcher'
import { mapLegacyLabels } from '../lib/taxonomyMapping'

const CSV_PATH = '/Users/sanjaypatel/Downloads/RC Verbatims 15-months ending 093025.csv'
const args = process.argv.slice(2)
function getFlag(n: string) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const limitArg = getFlag('--limit')
const limit = limitArg ? parseInt(limitArg, 10) : Infinity

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

function main() {
  const all = parseCSV(readFileSync(CSV_PATH, 'utf-8'))
  const h = all[0]
  const dIdx = h.indexOf('Description'), cIdx = h.indexOf('Classification')

  let reviews = 0
  let vendorTaggedReviews = 0        // >=1 usable (non-quarantine) vendor label
  let vendorOnlyQuarantine = 0       // had labels, but ALL were TEST/campaign/etc.
  let vendorNoLabels = 0             // no Classification value at all
  let oursTaggedReviews = 0          // >=1 of our assertions
  let testLeakReviews = 0            // tagged TEST by the vendor

  // recall of the vendor's usable labels
  let vendorAssertionPairs = 0       // total (review × axis:sub) the vendor asserted
  let weMatchedExact = 0             // ...we also asserted exact axis:sub
  let weMatchedAxis = 0             // ...we asserted at least the same axis

  // added coverage
  let reviewsVendorBlankWeTagged = 0 // vendor usably-untagged but we tagged

  let vendorLabelCount = 0, ourLabelCount = 0

  for (let i = 1; i < all.length && reviews < limit; i++) {
    const r = all[i]
    if (r.length <= dIdx) continue
    const text = (r[dIdx] ?? '').trim()
    if (!text) continue
    reviews++

    const rawTags = cIdx >= 0 ? splitTags(r[cIdx]) : []
    const legacy = mapLegacyLabels(rawTags)
    const vendorSet = new Set(legacy.assertions.map(key))
    const hadAnyLabel = rawTags.length > 0
    const isTest = legacy.quarantine.system_tags.some(t => t === 'test')
    if (isTest) testLeakReviews++

    const ours = classifyByKeyword(text).assertions
    const ourSet = new Set(ours.map(key))
    const ourAxes = new Set<string>(ours.map(a => a.axis))

    if (vendorSet.size > 0) vendorTaggedReviews++
    else if (hadAnyLabel) vendorOnlyQuarantine++
    else vendorNoLabels++

    if (ourSet.size > 0) oursTaggedReviews++

    vendorLabelCount += vendorSet.size
    ourLabelCount += ourSet.size

    for (const k of vendorSet) {
      vendorAssertionPairs++
      if (ourSet.has(k)) weMatchedExact++
      if (ourAxes.has(k.split(':')[0])) weMatchedAxis++
    }

    if (vendorSet.size === 0 && ourSet.size > 0) reviewsVendorBlankWeTagged++
  }

  const pct = (n: number, d: number) => `${(100 * n / Math.max(1, d)).toFixed(1)}%`
  console.log(`\n=== Coverage comparison — OUR classifier vs the vendor's labels ===`)
  console.log(`Reviews analyzed (non-empty): ${reviews}\n`)

  console.log(`VENDOR (their existing labels, projected into our 7 axes):`)
  console.log(`  Tagged with >=1 usable label:        ${vendorTaggedReviews}  (${pct(vendorTaggedReviews, reviews)})`)
  console.log(`  Labels were ONLY TEST/campaign/etc.:  ${vendorOnlyQuarantine}  (${pct(vendorOnlyQuarantine, reviews)})`)
  console.log(`  No label at all:                      ${vendorNoLabels}  (${pct(vendorNoLabels, reviews)})`)
  console.log(`  (Reviews the vendor stamped 'TEST':   ${testLeakReviews}  (${pct(testLeakReviews, reviews)}) — QA leak)`)
  console.log(`  Avg usable labels / review:           ${(vendorLabelCount / reviews).toFixed(2)}\n`)

  console.log(`OURS (Tier-1 keyword classifier, no AI):`)
  console.log(`  Tagged with >=1 label:                ${oursTaggedReviews}  (${pct(oursTaggedReviews, reviews)})`)
  console.log(`  Avg labels / review:                  ${(ourLabelCount / reviews).toFixed(2)}\n`)

  console.log(`RECALL — do we reproduce what the vendor caught?`)
  console.log(`  Vendor (review x axis:sub) labels:    ${vendorAssertionPairs}`)
  console.log(`  ...we matched exact axis:sub:          ${weMatchedExact}  (${pct(weMatchedExact, vendorAssertionPairs)})`)
  console.log(`  ...we matched at least the axis:       ${weMatchedAxis}  (${pct(weMatchedAxis, vendorAssertionPairs)})\n`)

  console.log(`ADDED COVERAGE — reviews the vendor left usably-untagged that WE tagged:`)
  console.log(`  ${reviewsVendorBlankWeTagged}  (${pct(reviewsVendorBlankWeTagged, reviews)} of all reviews)`)
  console.log(``)
  console.log(`Note: keyword tier only (free, deterministic). The shipping classifier`)
  console.log(`adds an AI tier on top, which raises recall + catches mixed polarity,`)
  console.log(`severity, and novel phrasings the vendor's flat labels miss entirely.`)
}

main()
