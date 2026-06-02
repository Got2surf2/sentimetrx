/* eslint-disable */
// Casual Tex-Mex overlay — mine a keyword dictionary from the Chuy's reviews.
// Shared 6 axes (touchpoint/attribute/beverage/ambiance/context/outcome) from
// the core vocab; PRODUCT axis swapped to a casual Tex-Mex category set (the
// overlay). Phrases are mined from Chuy's actual reviews — same Path B method
// as the steakhouse run, applied to a casual brand.
//
// Run: node_modules/.bin/tsx scripts/chuys-mine.ts [--limit 1872] [--concurrency 8] [--out data/chuys-candidates.jsonl]

import { readFileSync, writeFileSync, appendFileSync } from 'fs'; import path from 'path'
const env = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const l of env.split('\n')) { const m = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g,'').replace(/\\n$/,'') }
import { createClient } from '@supabase/supabase-js'
import { TOUCHPOINT_SUBS, ATTRIBUTE_SUBS, AMBIANCE_SUBS, CONTEXT_SUBS, OUTCOME_SUBS, POLARITY_VALUES } from '../lib/taxonomyVocabulary'

const MODEL = 'claude-haiku-4-5-20251001'
const DATASET_NAME = "Chuy's — Google Reviews (last 30d)"
const args = process.argv.slice(2)
const getFlag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const limit = parseInt(getFlag('--limit') ?? '99999', 10)
const concurrency = parseInt(getFlag('--concurrency') ?? '8', 10)
const outPath = getFlag('--out') ?? 'data/chuys-candidates.jsonl'

// ── Casual Tex-Mex overlay vocab (PRODUCT + a couple of beverage adds) ───────
const CASUAL_PRODUCT = ['tacos','fajitas','enchiladas','burritos','quesadilla','nachos','queso','guacamole','chips and salsa','tamales','tortilla soup','rice and beans','combo','chimichanga','tostada','elote','kids','desserts','salsa','margarita food'] as const
const CASUAL_BEVERAGE = ['margarita','tequila','michelada','beer','sangria','cocktail','wine','coffee','soda'] as const
const VOCAB: Record<string, readonly string[]> = {
  touchpoint: TOUCHPOINT_SUBS, attribute: ATTRIBUTE_SUBS, product: CASUAL_PRODUCT,
  beverage: CASUAL_BEVERAGE, ambiance: AMBIANCE_SUBS, context: CONTEXT_SUBS, outcome: OUTCOME_SUBS,
}
const AXES = Object.keys(VOCAB)
const isValid = (axis: string, sub: string) => (VOCAB[axis] || []).includes(sub)

function buildSystem(): string {
  return `You extract keyword phrases from Chuy's (a casual Tex-Mex restaurant chain) Google reviews to build a deterministic keyword dictionary.

List EVERY phrase that maps to a sub-bucket of our closed 7-axis taxonomy. A "phrase" is a short verbatim span (1-6 words) copied EXACTLY from the review.

AXES and their CLOSED sub-bucket vocabulary (use ONLY these axis+sub pairs):
- touchpoint (who served): ${VOCAB.touchpoint.join(', ')}
- attribute (how they/it did): ${VOCAB.attribute.join(', ')}
- product (Tex-Mex food ordered): ${VOCAB.product.join(', ')}
- beverage (drinks): ${VOCAB.beverage.join(', ')}
- ambiance (the room): ${VOCAB.ambiance.join(', ')}
- context (when/where): ${VOCAB.context.join(', ')}
- outcome (return / value / improvement): ${VOCAB.outcome.join(', ')}

RULES:
1. Copy the phrase verbatim (lowercase ok, max 6 words). If you can't quote it exactly, drop it.
2. axis and sub MUST come from the lists above. Never invent a sub-bucket.
3. polarity = the sentiment THE PHRASE carries: pos | neg | neu. Category nouns ("tacos","queso") are neu.
4. For negation ("not great"), emit the unnegated core ("great") — the matcher flips on negation.
5. product axis: only when a Tex-Mex dish/food is NAMED. Do NOT infer from "the food was great".
6. Output STRICT JSON: { "phrases": [ { "phrase": "...", "axis": "...", "sub": "...", "polarity": "pos|neg|neu" } ] }
Return { "phrases": [] } if nothing maps.`
}
const SYSTEM = buildSystem()

async function callAnthropic(userMsg: string): Promise<{ text: string }> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 1500, system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: userMsg }] }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
  const d = await res.json()
  return { text: (d.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('') }
}
function tryParse(t: string): any { const x = t.trim(); const m = x.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i); try { return JSON.parse(m ? m[1] : x) } catch { return { phrases: [] } } }
function validate(parsed: any) {
  const out: any[] = []
  for (const p of (Array.isArray(parsed?.phrases) ? parsed.phrases : [])) {
    if (!p || typeof p.axis !== 'string' || !AXES.includes(p.axis) || typeof p.sub !== 'string' || typeof p.phrase !== 'string') continue
    const sub = p.sub.trim().toLowerCase(), phrase = p.phrase.trim()
    if (!isValid(p.axis, sub) || !phrase || phrase.split(/\s+/).length > 6) continue
    out.push({ phrase, axis: p.axis, sub, polarity: (POLARITY_VALUES as readonly string[]).includes(p.polarity) ? p.polarity : 'neu' })
  }
  return out
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Missing ANTHROPIC_API_KEY')
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: ds } = await s.from('datasets').select('id,row_count').eq('name', DATASET_NAME).order('row_count', { ascending: false }).limit(1)
  if (!ds || !ds.length) throw new Error(`dataset not found: ${DATASET_NAME}`)
  const datasetId = ds[0].id
  const rows: { text: string; rating: number | null }[] = []
  let from = 0
  for (;;) {
    const { data } = await s.from('dataset_rows_flat').select('data').eq('dataset_id', datasetId).range(from, from + 999)
    if (!data || !data.length) break
    for (const r of data) { const t = (r.data?.review_text ?? '').trim(); if (t) rows.push({ text: t, rating: r.data?.rating ?? null }) }
    from += 1000; if (data.length < 1000) break
  }
  const sample = rows.slice(0, limit)
  console.log(`Mining ${sample.length} Chuy's reviews (concurrency ${concurrency}, ~$${(sample.length*0.0017).toFixed(2)})...`)
  writeFileSync(outPath, '')
  let done = 0, failed = 0, phrases = 0
  let cursor = 0
  async function worker() {
    while (cursor < sample.length) {
      const row = sample[cursor++]
      try {
        const { text } = await callAnthropic(`${row.rating != null ? `Rating: ${row.rating}/5\n` : ''}Review:\n"""\n${row.text}\n"""`)
        const ph = validate(tryParse(text))
        appendFileSync(outPath, JSON.stringify({ phrases: ph }) + '\n')
        phrases += ph.length; done++
        if (done % 100 === 0) process.stderr.write(`  ${done}/${sample.length} (${phrases} phrases, ${failed} failed)\n`)
      } catch (e: any) { failed++ }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  console.log(`Done. ${done} mined (${phrases} phrases), ${failed} failed. → ${outPath}`)
}
main().catch(e => { console.error(e); process.exit(1) })
