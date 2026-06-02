/* eslint-disable */
// Ruth's Chris taxonomy pilot — Path B keyword-tier LIFT measurement.
//
// Runs the deterministic keyword tier over a deterministic sample of real
// reviews with (a) the hand-written dictionary only and (b) the hand-written
// + learned merged dictionary, and reports the chip-count lift. Pure, no AI,
// no DB. Validates acceptance criterion #2 (measurably more keyword coverage).
//
// Run: node_modules/.bin/tsx scripts/pilot-rc-keyword-lift.ts [--limit 500] [--seed 7]

import { readFileSync } from 'fs'
import { classifyByKeyword } from '../lib/taxonomyKeywordMatcher'
import { KEYWORD_DICTIONARY } from '../lib/taxonomyKeywords'
import { LEARNED_KEYWORD_DICTIONARY } from '../lib/taxonomyKeywordsLearned'

const CSV_PATH = '/Users/sanjaypatel/Downloads/RC Verbatims 15-months ending 093025.csv'
const args = process.argv.slice(2)
function getFlag(n: string) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const limit = parseInt(getFlag('--limit') ?? '500', 10)
const seed = parseInt(getFlag('--seed') ?? '7', 10)

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
function mulberry32(a: number) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
function shuffle<T>(arr: T[], s: number): T[] { const r = mulberry32(s); const o = arr.slice(); for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [o[i], o[j]] = [o[j], o[i]] } return o }

const MERGED = [...KEYWORD_DICTIONARY, ...LEARNED_KEYWORD_DICTIONARY]

function main() {
  const all = parseCSV(readFileSync(CSV_PATH, 'utf-8'))
  const dIdx = all[0].indexOf('Description')
  const pool: string[] = []
  for (let i = 1; i < all.length; i++) { const d = (all[i][dIdx] ?? '').trim(); if (d) pool.push(d) }
  // Use a DIFFERENT seed than the mine (seed=1) so we measure on held-out reviews.
  const sample = shuffle(pool, seed).slice(0, limit)

  let baseAssertions = 0, mergedAssertions = 0
  let baseReviewsWithHit = 0, mergedReviewsWithHit = 0
  for (const text of sample) {
    const base = classifyByKeyword(text, KEYWORD_DICTIONARY).assertions.length
    const merged = classifyByKeyword(text, MERGED).assertions.length
    baseAssertions += base; mergedAssertions += merged
    if (base > 0) baseReviewsWithHit++
    if (merged > 0) mergedReviewsWithHit++
  }

  const n = sample.length
  console.log(`Keyword-tier lift over ${n} held-out reviews (seed=${seed}):\n`)
  console.log(`  Dictionary size:   hand-written ${KEYWORD_DICTIONARY.reduce((s,e)=>s+e.phrases.length,0)} phrases  →  merged ${MERGED.reduce((s,e)=>s+e.phrases.length,0)} phrases`)
  console.log(`  Total assertions:  ${baseAssertions}  →  ${mergedAssertions}   (${(mergedAssertions / Math.max(1, baseAssertions)).toFixed(2)}x)`)
  console.log(`  Avg per review:    ${(baseAssertions / n).toFixed(2)}  →  ${(mergedAssertions / n).toFixed(2)}`)
  console.log(`  Reviews w/ >=1 hit: ${baseReviewsWithHit} (${(100*baseReviewsWithHit/n).toFixed(0)}%)  →  ${mergedReviewsWithHit} (${(100*mergedReviewsWithHit/n).toFixed(0)}%)`)
}

main()
