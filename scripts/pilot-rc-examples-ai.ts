/* eslint-disable */
// Run keyword tier vs hybrid (keyword + AI) on a curated set of example
// reviews for the client deck — to show the AI tier recovers what the
// deterministic keyword tier misses.
//
// Run: node_modules/.bin/tsx scripts/pilot-rc-examples-ai.ts

import { readFileSync } from 'fs'
import path from 'path'
const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '')
}
import { buildSystemPrompt, buildUserMessage, parseExtractorOutput } from '../lib/taxonomyExtractor'
import { classifyByKeyword, mergeAssertions } from '../lib/taxonomyKeywordMatcher'

const MODEL = 'claude-haiku-4-5-20251001'
async function callAI(system: string, user: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 2000, system, messages: [{ role: 'user', content: user }] }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
  const d = await res.json()
  return (d.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
}

const EXAMPLES: { tag: string; rating: number; text: string }[] = [
  { tag: 'VENDOR-MORE', rating: 1, text: `Waited 40 mins and never got my steak, drink was horrible and the manager was unhelpful. Never again, and I used to love this place.` },
  { tag: 'VENDOR-MORE', rating: 1, text: `Peter the manager was terrible — he was a jerk to my kid because he had his hands in his pockets, made a nasty comment, and when we asked about it he laughed at us and was even more rude.` },
  { tag: 'WE-MISSED', rating: 1, text: `I was at a work meeting and my husband came to pick me up. They chased my husband out of the parking lot and called the police on him. Worst place ever!!!` },
  { tag: 'WE-MISSED', rating: 1, text: `Sat at the bar that had 5 people working behind it for 5 minutes and didn't even get a hello. Got up and walked out.` },
]

const chip = (a: any) => `${a.axis}:${a.sub}${a.item ? '·' + a.item : ''}${a.polarity === 'pos' ? '+' : a.polarity === 'neg' ? '−' : '·'}${a.severity !== 'normal' ? '[' + a.severity + ']' : ''}`

async function main() {
  const system = buildSystemPrompt()
  for (const e of EXAMPLES) {
    const kw = classifyByKeyword(e.text)
    const ai = parseExtractorOutput(await callAI(system, buildUserMessage({ review_text: e.text, review_rating: e.rating })), MODEL)
    const hybrid = mergeAssertions(kw.assertions, ai.assertions)
    console.log(`\n[${e.tag}] (${e.rating}/5) "${e.text}"`)
    console.log(`  KEYWORD: ${kw.assertions.map(chip).join('  ') || '(none)'}`)
    console.log(`  HYBRID:  ${hybrid.map(chip).join('  ')}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
