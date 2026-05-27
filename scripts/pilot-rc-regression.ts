/* eslint-disable */
// Ruth's Chris taxonomy pilot — regression test.
//
// Runs the LLM classifier on the 5 anchor reviews defined in
// project_rc_taxonomy_pilot.md § "Five real reviews used for slide 15"
// and asserts that key expected assertions appear. The classifier MUST
// produce these or the pilot fails.
//
// Run: node_modules/.bin/tsx scripts/pilot-rc-regression.ts
//
// Bypasses lib/ai.ts (which has 'server-only') by calling Anthropic
// directly with the same prompts; result goes through parseExtractorOutput
// from lib/taxonomyExtractor.ts.
//
// Exit code 0 on full pass, 1 on any failure.

import { readFileSync } from 'fs'
import path from 'path'

const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '')
}

import {
  buildSystemPrompt,
  buildUserMessage,
  parseExtractorOutput,
  type ExtractorResult,
} from '../lib/taxonomyExtractor'
import { classifyByKeyword, mergeAssertions } from '../lib/taxonomyKeywordMatcher'
import type { Assertion } from '../lib/taxonomyVocabulary'

const MODEL = 'claude-haiku-4-5-20251001'

async function callAnthropic(system: string, userMsg: string): Promise<{ text: string; model: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content: userMsg }],
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const text = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
  return { text, model: data.model || MODEL }
}

async function classify(input: { review_text: string; review_rating?: number | null }): Promise<ExtractorResult> {
  const system = buildSystemPrompt()
  const userMsg = buildUserMessage(input)
  const { text, model } = await callAnthropic(system, userMsg)
  return parseExtractorOutput(text, model)
}

type Expectation = {
  axis: string
  sub: string
  polarity?: 'pos' | 'neg' | 'neu'
  severity?: 'normal' | 'alert' | 'crisis'
}

type Forbidden = { axis: string; sub: string }

interface Case {
  name: string
  rating: number
  text: string
  must: Expectation[]
  mustNot?: Forbidden[]
}

const cases: Case[] = [
  {
    name: '★5 Raymond — server praise + intent to return',
    rating: 5,
    text: `Raymond was an excellent server. Very professional and made our anniversary dinner memorable. We will absolutely be back.`,
    must: [
      { axis: 'touchpoint', sub: 'server', polarity: 'pos' },
      { axis: 'attribute',  sub: 'professional', polarity: 'pos' },
      { axis: 'outcome',    sub: 'return', polarity: 'pos' },
    ],
    mustNot: [
      { axis: 'product', sub: 'steak' },
    ],
  },
  {
    name: '★2 $700 day-old baked potato',
    rating: 2,
    text: `Spent $700 for two people. The baked potato was clearly day-old — cold in the middle, dried out skin. For this price point I expected better. Not worth what we paid.`,
    must: [
      { axis: 'product',   sub: 'sides', polarity: 'neg' },
      { axis: 'attribute', sub: 'temp', polarity: 'neg' },
      { axis: 'outcome',   sub: 'expensive', polarity: 'neg' },
    ],
  },
  {
    name: '★1 Food poisoning + Olive Garden mention',
    rating: 1,
    text: `Our server was actually very nice but I got food poisoning from the steak. Spent all night sick. I will say I had a great experience at Olive Garden last week — comparing the two, this was much worse.`,
    must: [
      { axis: 'touchpoint', sub: 'server',     polarity: 'pos' },
      { axis: 'attribute',  sub: 'food safety', polarity: 'neg', severity: 'crisis' },
    ],
    mustNot: [
      { axis: 'product', sub: 'pasta' },
    ],
  },
  {
    name: '★1 Carpets + gnats + Burger King — false-alarm guard',
    rating: 1,
    text: `The carpets were filthy and there were gnats flying around our table. I'd rather eat at Burger King. Will not be coming back.`,
    must: [
      { axis: 'ambiance',  sub: 'clean', polarity: 'neg' },
      { axis: 'attribute', sub: 'pests', polarity: 'neg', severity: 'alert' },
      { axis: 'outcome',   sub: 'not-recommend', polarity: 'neg' },
    ],
    mustNot: [
      { axis: 'attribute', sub: 'food safety' },
      { axis: 'product', sub: 'apps' },
    ],
  },
  {
    name: '★1 30 min late + loud + food good — mixed polarity',
    rating: 1,
    text: `We were seated 30 minutes after our reservation time. The dining room was extremely loud — couldn't hear the table. That said, the food itself was actually quite good. Won't be back though.`,
    must: [
      { axis: 'touchpoint', sub: 'host',   polarity: 'neg' },
      { axis: 'attribute',  sub: 'speed',  polarity: 'neg' },
      { axis: 'ambiance',   sub: 'noise',  polarity: 'neg' },
      { axis: 'attribute',  sub: 'flavor', polarity: 'pos' },
    ],
    mustNot: [
      // The word "food" alone must NOT trigger product:steak — steakhouse context
      // is background knowledge, not textual evidence.
      { axis: 'product', sub: 'steak' },
    ],
  },
  {
    name: '★1 "food was HORRIBLE" — no dish named, must NOT infer steak',
    rating: 1,
    text: `The food was HORRIBLE! It tasted like frozen food.`,
    must: [
      { axis: 'attribute', sub: 'flavor', polarity: 'neg' },
    ],
    mustNot: [
      { axis: 'product', sub: 'steak' },
      { axis: 'product', sub: 'beef' },
      { axis: 'product', sub: 'seafood' },
    ],
  },
  {
    name: '★1 "Food was good" but service was bad — no dish named',
    rating: 1,
    text: `Food was good. But I had the worst service ever at such a fancy restaurant. My family was so disappointed.`,
    must: [
      { axis: 'attribute',  sub: 'flavor', polarity: 'pos' },
      { axis: 'touchpoint', sub: 'server', polarity: 'neg' },
    ],
    mustNot: [
      { axis: 'product', sub: 'steak' },
      { axis: 'product', sub: 'beef' },
    ],
  },
]

function match(a: Assertion, e: Expectation): boolean {
  if (a.axis !== e.axis) return false
  if (a.sub  !== e.sub) return false
  if (e.polarity && a.polarity !== e.polarity) return false
  if (e.severity && a.severity !== e.severity) return false
  return true
}

function chip(a: Assertion): string {
  const src = a.source === 'both' ? '✓' : a.source === 'llm' ? 'ⁱ' : ''
  const sev = a.severity !== 'normal' ? `[${a.severity}]` : ''
  const pol = a.polarity === 'pos' ? '+' : a.polarity === 'neg' ? '−' : '·'
  return `${a.axis}:${a.sub}${a.item ? '·' + a.item : ''} ${pol}${src}${sev}`
}

async function runCase(c: Case): Promise<{ pass: boolean; details: string[] }> {
  const details: string[] = []

  // Run all three tiers so the demo can compare.
  const kw = classifyByKeyword(c.text)
  const llmResult = await classify({ review_text: c.text, review_rating: c.rating })
  const hybrid = mergeAssertions(kw.assertions, llmResult.assertions)

  details.push(`  Keyword tier (${kw.assertions.length}): ${kw.assertions.map(chip).join('  |  ') || '—'}`)
  details.push(`  AI tier      (${llmResult.assertions.length}): ${llmResult.assertions.map(chip).join('  |  ') || '—'}`)
  details.push(`  HYBRID merge (${hybrid.length}): ${hybrid.map(chip).join('  |  ') || '—'}`)
  if (llmResult.unmapped_subs.length) {
    details.push(`  Unmapped (AI tier dropped): ${llmResult.unmapped_subs.map(u => u.axis+':'+u.sub).join(', ')}`)
  }

  // Pass/fail is judged on the hybrid output — that's what production ships.
  const result = { assertions: hybrid }
  let pass = true

  for (const e of c.must) {
    const hit = result.assertions.some(a => match(a, e))
    const tag = `${e.axis}:${e.sub}${e.polarity ? ' ('+e.polarity+')' : ''}${e.severity ? ' ['+e.severity+']' : ''}`
    if (hit) details.push(`  ✓ has ${tag}`)
    else { details.push(`  ✗ MISSING ${tag}`); pass = false }
  }

  for (const f of (c.mustNot ?? [])) {
    const hit = result.assertions.some(a => a.axis === f.axis && a.sub === f.sub)
    const tag = `${f.axis}:${f.sub}`
    if (!hit) details.push(`  ✓ no ${tag}`)
    else { details.push(`  ✗ UNWANTED ${tag}`); pass = false }
  }

  return { pass, details }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Missing ANTHROPIC_API_KEY')

  console.log("Ruth's Chris taxonomy classifier — 5-review regression\n")

  let passed = 0
  let failed = 0

  for (const c of cases) {
    console.log(`▸ ${c.name}`)
    try {
      const { pass, details } = await runCase(c)
      for (const d of details) console.log(d)
      if (pass) { console.log('  ── PASS'); passed++ }
      else      { console.log('  ── FAIL'); failed++ }
    } catch (e: any) {
      console.log(`  ── ERROR: ${e.message ?? e}`)
      failed++
    }
    console.log('')
  }

  console.log(`\n${passed}/${cases.length} passed.`)
  if (failed > 0) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
