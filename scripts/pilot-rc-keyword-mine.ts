/* eslint-disable */
// Ruth's Chris taxonomy pilot — Path B Stage 1: keyword MINE.
//
// Reads the 43K-review CSV directly (the source of truth — the pilot dataset
// in the DB only holds a 50-row smoke sample, so we sample from the file),
// draws a deterministic seeded sample of N reviews, and asks Haiku to extract
// every verbatim phrase that maps to a (axis, sub) in our closed 7-axis vocab.
// Output is one JSONL row per review → data/keyword-candidates.jsonl.
//
// Stage 2 (pilot-rc-keyword-build.ts) aggregates this into a learned keyword
// dictionary (lib/taxonomyKeywordsLearned.ts). Mining once and persisting the
// JSONL lets us re-tune the build threshold for free.
//
// Run: node_modules/.bin/tsx scripts/pilot-rc-keyword-mine.ts [--limit 5000] [--concurrency 4] [--seed 1] [--out data/keyword-candidates.jsonl]
//
// Cost (Haiku 4.5): ~$0.0017/review → 5000 ≈ $8.50, 2000 ≈ $3.40, 20 ≈ $0.03.

import { readFileSync, writeFileSync, appendFileSync } from 'fs'
import path from 'path'

const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '')
}

import { AXIS_VOCAB, AXES, POLARITY_VALUES, isValidAxisSub, type Axis } from '../lib/taxonomyVocabulary'

const MODEL = 'claude-haiku-4-5-20251001'
const CSV_PATH = '/Users/sanjaypatel/Downloads/RC Verbatims 15-months ending 093025.csv'

// ── args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
function getFlag(name: string): string | undefined {
  const idx = args.indexOf(name)
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1]
  return undefined
}
const limit = parseInt(getFlag('--limit') ?? '5000', 10)
const concurrency = parseInt(getFlag('--concurrency') ?? '4', 10)
const seed = parseInt(getFlag('--seed') ?? '1', 10)
const outPath = getFlag('--out') ?? 'data/keyword-candidates.jsonl'

// ── RFC4180 parser (same logic as scripts/pilot-rc-ingest.ts) ────────────────
function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else { inQuotes = false }
      } else { field += c }
    } else {
      if (c === '"') { inQuotes = true }
      else if (c === ',') { row.push(field); field = '' }
      else if (c === '\r') { /* swallow */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
      else { field += c }
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

// ── seeded PRNG (mulberry32) for reproducible sampling ───────────────────────
function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function seededShuffle<T>(arr: T[], s: number): T[] {
  const rng = mulberry32(s)
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// ── mine prompt ──────────────────────────────────────────────────────────────
function buildMineSystemPrompt(): string {
  const v = AXIS_VOCAB
  return `You extract keyword phrases from Ruth's Chris Steak House Google reviews to build a deterministic keyword dictionary.

For the review you are given, list EVERY phrase that maps to a sub-bucket of our closed 7-axis taxonomy. A "phrase" is a short verbatim span (1–6 words) copied EXACTLY from the review — never paraphrase or invent words.

AXES and their CLOSED sub-bucket vocabulary (you may ONLY use these axis+sub pairs):
- touchpoint (who served): ${v.touchpoint.join(', ')}
- attribute (how they/it did): ${v.attribute.join(', ')}
- product (food ordered): ${v.product.join(', ')}
- beverage (drinks): ${v.beverage.join(', ')}
- ambiance (the room): ${v.ambiance.join(', ')}
- context (when/where): ${v.context.join(', ')}
- outcome (will they return / value / improvement): ${v.outcome.join(', ')}

RULES:
1. Copy the phrase verbatim from the review. Lowercase is fine. Max 6 words. If you cannot quote it exactly, drop it.
2. axis and sub MUST come from the lists above. Never invent a sub-bucket.
3. polarity is the sentiment THE PHRASE ITSELF carries: pos | neg | neu. Category nouns ("ribeye", "sommelier") are neu — context is not your job here. Sentiment words ("delicious", "rude") carry their polarity.
4. For NEGATED sentiment ("not great", "wasn't good"), emit the UNNEGATED core phrase ("great", "good") with its normal polarity — the runtime matcher flips on negation. Do NOT emit the negation word as part of the phrase.
5. product axis: only emit when the review NAMES a food category or dish. Do NOT infer product:steak from "the food was great" — that is forbidden.
6. One phrase can map to only one axis+sub. If a review repeats a concept, emit the clearest single phrase for it (duplicates across reviews are aggregated later — within one review, dedupe).
7. Output STRICT JSON, no markdown, no commentary.

OUTPUT SHAPE:
{ "phrases": [ { "phrase": "<verbatim ≤6 words>", "axis": "<one of 7>", "sub": "<closed-vocab sub>", "polarity": "pos|neg|neu" } ] }

Return { "phrases": [] } if nothing maps.`
}

const SYSTEM = buildMineSystemPrompt()

async function callAnthropic(userMsg: string): Promise<{ text: string; stopReason: string }> {
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
      max_tokens: 1500,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMsg }],
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const text = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
  return { text, stopReason: data.stop_reason || 'end_turn' }
}

function tryParse(text: string): any {
  const t = text.trim()
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  try { return JSON.parse(m ? m[1] : t) } catch { return { phrases: [] } }
}

interface MinedPhrase { phrase: string; axis: Axis; sub: string; polarity: string }

function validatePhrases(parsed: any): MinedPhrase[] {
  const list: any[] = Array.isArray(parsed?.phrases) ? parsed.phrases : []
  const out: MinedPhrase[] = []
  for (const p of list) {
    if (!p || typeof p !== 'object') continue
    const axis = p.axis
    if (!(AXES as readonly string[]).includes(axis)) continue
    if (typeof p.sub !== 'string') continue
    const sub = p.sub.trim().toLowerCase()
    if (!isValidAxisSub(axis as Axis, sub)) continue
    if (typeof p.phrase !== 'string') continue
    const phrase = p.phrase.trim()
    if (!phrase || phrase.split(/\s+/).length > 6) continue
    const polarity = (POLARITY_VALUES as readonly string[]).includes(p.polarity) ? p.polarity : 'neu'
    out.push({ phrase, axis: axis as Axis, sub, polarity })
  }
  return out
}

interface SampleRow { csv_index: number; description: string; rating: number | null }

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Missing ANTHROPIC_API_KEY')

  console.log(`Reading ${CSV_PATH}...`)
  const allRows = parseCSV(readFileSync(CSV_PATH, 'utf-8'))
  const header = allRows[0]
  const dIdx = header.indexOf('Description')
  const rIdx = header.indexOf('ReviewRating')
  if (dIdx < 0) throw new Error('Missing Description column')

  // Build candidate pool: non-empty descriptions only.
  const pool: SampleRow[] = []
  for (let i = 1; i < allRows.length; i++) {
    const r = allRows[i]
    if (r.length <= dIdx) continue
    const desc = (r[dIdx] ?? '').trim()
    if (!desc) continue
    const ratingRaw = rIdx >= 0 ? r[rIdx] : ''
    const rating = ratingRaw && /^\d+$/.test(ratingRaw.trim()) ? parseInt(ratingRaw.trim(), 10) : null
    pool.push({ csv_index: i, description: desc, rating })
  }
  console.log(`Non-empty reviews in pool: ${pool.length}`)

  const sample = seededShuffle(pool, seed).slice(0, limit)
  console.log(`Sampling ${sample.length} reviews (seed=${seed}, concurrency=${concurrency})`)
  console.log(`Est. spend: ~$${(sample.length * 0.0017).toFixed(2)}`)

  // Fresh output file.
  writeFileSync(outPath, '')

  let processed = 0, failed = 0, totalPhrases = 0
  const startTime = Date.now()

  async function mineOne(row: SampleRow): Promise<void> {
    const userMsg = `${row.rating != null ? `Rating: ${row.rating}/5\n` : ''}Review:\n"""\n${row.description}\n"""`
    try {
      const { text, stopReason } = await callAnthropic(userMsg)
      const phrases = validatePhrases(tryParse(text))
      if (stopReason === 'max_tokens') {
        console.warn(`  csv#${row.csv_index}: TRUNCATED at max_tokens (${row.description.length} chars, ${phrases.length} parsed)`)
      }
      appendFileSync(outPath, JSON.stringify({ csv_index: row.csv_index, rating: row.rating, phrases }) + '\n')
      totalPhrases += phrases.length
      processed++
      if (processed % 50 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0)
        console.log(`  ${processed}/${sample.length}  (${elapsed}s, ${totalPhrases} phrases, ${failed} failed)`)
      }
    } catch (e: any) {
      failed++
      console.error(`  csv#${row.csv_index} failed: ${e.message ?? e}`)
    }
  }

  let cursor = 0
  async function worker() {
    while (cursor < sample.length) {
      const myIdx = cursor++
      await mineOne(sample[myIdx])
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\nDone. ${processed} mined (${totalPhrases} raw phrases), ${failed} failed in ${elapsed}s.`)
  console.log(`Output: ${outPath}`)
}

main().catch(e => { console.error(e); process.exit(1) })
