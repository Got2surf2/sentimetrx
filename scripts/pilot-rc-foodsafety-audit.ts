/* eslint-disable */
// Independent audit of the VENDOR's food-safety alerts: of every review the
// vendor tagged 'Alert - Food Safety' / 'Food Safety', how many describe an
// ACTUAL food-safety hazard? An LLM judge (Haiku) reads each with a strict,
// conservative rubric (ambiguous → counts as legitimate, so the false-alarm
// rate is a defensible LOWER bound). Gives a quotable "X% of the incumbent's
// food-safety alerts are false alarms" for the pitch — judged by a neutral
// third model, not our own classifier (no circularity).
//
// Run: node_modules/.bin/tsx scripts/pilot-rc-foodsafety-audit.ts [--limit N]

import { readFileSync } from 'fs'
// Load .env.local (callAI needs ANTHROPIC_API_KEY). Plain split parser, no regex.
for (const line of readFileSync('.env.local', 'utf-8').split('\n')) {
  const eq = line.indexOf('=')
  if (eq <= 0) continue
  const key = line.slice(0, eq).trim()
  let val = line.slice(eq + 1).trim()
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
  if (key && !process.env[key]) process.env[key] = val
}
import { mapLegacyLabels } from '../lib/taxonomyMapping'
import { callAI } from '../lib/ai'

const CSV_PATH = '/Users/sanjaypatel/Downloads/RC Verbatims 15-months ending 093025.csv'
const args = process.argv.slice(2)
const getFlag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const limit = getFlag('--limit') ? parseInt(getFlag('--limit')!, 10) : Infinity
const BATCH = 15

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
const clean = (s: string) => { let o = ''; for (const c of s) { const k = c.charCodeAt(0); o += (k < 32 || k === 127) ? ' ' : c } return o.split(' ').filter(Boolean).join(' ') }

const SYSTEM =
  'You are a food-safety auditor for a restaurant chain. For each review decide if it describes a GENUINE food-safety hazard. ' +
  'fs=true ONLY if it mentions: foodborne illness (got sick, food poisoning, vomiting, diarrhea, hospitalized); a foreign object/contaminant IN food or drink (hair, glass, plastic, metal, screw, bug/insect/pest in the food); raw or dangerously undercooked food; or spoiled/rotten/moldy/expired food. ' +
  'fs=false for: bad taste or quality, slow/rude service, price, noise/decor, dirty floor/bathroom/table (general cleanliness with NO food contamination), or anything that is not a direct food-safety hazard. ' +
  'When genuinely ambiguous, choose fs=true (be conservative). Return ONLY JSON, no prose: {"verdicts":[{"i":<index>,"fs":true|false}]}'

async function judge(batch: { i: number; text: string }[]): Promise<Record<number, boolean>> {
  const body = batch.map(b => `[${b.i}] ${b.text.slice(0, 600)}`).join('\n\n')
  const res = await callAI({ tier: 'fast', maxTokens: 1500, timeoutMs: 60000, system: SYSTEM, messages: [{ role: 'user', content: body }] })
  const m = res.text.match(/\{[\s\S]*\}/)
  const out: Record<number, boolean> = {}
  if (m) { try { for (const v of (JSON.parse(m[0]).verdicts || [])) out[v.i] = !!v.fs } catch {} }
  return out
}

async function main() {
  const all = parseCSV(readFileSync(CSV_PATH, 'utf-8'))
  const h = all[0]
  const dIdx = h.indexOf('Description'), cIdx = h.indexOf('Classification')

  // Collect every review the vendor flagged food-safety.
  const flagged: { i: number; text: string }[] = []
  for (let i = 1; i < all.length; i++) {
    const r = all[i]; if (r.length <= dIdx) continue
    const text = clean(r[dIdx] ?? ''); if (!text) continue
    const theirs = mapLegacyLabels(cIdx >= 0 ? splitTags(r[cIdx]) : []).assertions
    if (theirs.some(a => a.sub === 'food safety')) flagged.push({ i: flagged.length, text })
  }
  const work = flagged.slice(0, Number.isFinite(limit) ? limit : flagged.length)
  process.stderr.write(`Vendor food-safety-flagged reviews: ${flagged.length}; judging ${work.length}…\n`)

  const verdict: Record<number, boolean> = {}
  for (let i = 0; i < work.length; i += BATCH) {
    Object.assign(verdict, await judge(work.slice(i, i + BATCH)))
    process.stderr.write(`  …${Math.min(i + BATCH, work.length)}/${work.length}\r`)
  }

  const judged = work.filter(w => verdict[w.i] !== undefined)
  const real = judged.filter(w => verdict[w.i] === true).length
  const falseAlarm = judged.length - real
  const pct = (n: number) => (100 * n / Math.max(1, judged.length)).toFixed(1)
  // 95% Wald CI on the false-alarm proportion
  const p = falseAlarm / Math.max(1, judged.length)
  const ci = 1.96 * Math.sqrt(p * (1 - p) / Math.max(1, judged.length)) * 100

  console.log(`\n\n=== VENDOR FOOD-SAFETY ALERT AUDIT (independent Haiku judge, conservative rubric) ===`)
  console.log(`Reviews the vendor flagged food-safety:  ${flagged.length}`)
  console.log(`Judged:                                   ${judged.length}`)
  console.log(`  Genuine food-safety hazard:             ${real}  (${pct(real)}%)`)
  console.log(`  FALSE ALARM (no food-safety content):   ${falseAlarm}  (${pct(falseAlarm)}% ± ${ci.toFixed(1)})`)
  console.log(`\nReading: ~${pct(falseAlarm)}% of the incumbent vendor's food-safety alerts contain no actual food-safety hazard.`)

  console.log(`\n--- Sample FALSE ALARMS (vendor flagged food-safety, judge says no) ---`)
  let shown = 0
  for (const w of judged) { if (verdict[w.i] === false && shown < 8) { console.log(`  • "${w.text.slice(0, 130)}…"`); shown++ } }
  console.log(`\n--- Sample GENUINE (vendor flagged, judge agrees) ---`)
  shown = 0
  for (const w of judged) { if (verdict[w.i] === true && shown < 5) { console.log(`  • "${w.text.slice(0, 130)}…"`); shown++ } }
}
main().catch(e => { console.error(e); process.exit(1) })
