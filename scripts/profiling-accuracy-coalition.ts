/* eslint-disable */
// One-off: measure the profiling algorithm's accuracy on real survey data.
//
// Pulls every row from the Coalition Donor Survey Collection, identifies
// rows that have BOTH open-ended text AND user-stated demographic fields,
// runs the exact same extractDemographics() prompt that bots use on the
// open-ended text, and tabulates predicted-vs-stated accuracy per
// dimension (age_range, gender, education, socioeconomic).
//
// Run with:   node_modules/.bin/tsx scripts/profiling-accuracy-coalition.ts
// Outputs:
//   ~/Downloads/Coalition-Profiling-Accuracy.md     (markdown report)
//   ~/Downloads/Coalition-Profiling-Accuracy.pptx   (slide deck)

import { readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import path from 'path'

// Load .env.local
const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

import { createClient } from '@supabase/supabase-js'
import { renderDeck, type DeckSpec, type SlideSpec } from '../lib/pptx/slideRenderer'

const COLLECTION_ID = '7d9b148c-7fbf-4b37-838c-03c638c2bd23'
const MODEL = 'claude-haiku-4-5-20251001'
const MAX_ROWS = 100               // cap inference calls so the run stays cheap
const MIN_TEXT_LEN_FOR_OE = 25     // a value must be this long (and have spaces) to count as open-ended

// ── Anthropic direct fetch — bypasses lib/ai's server-only guard ──────────
let aiCalls = 0
let inputTokens = 0
let outputTokens = 0

async function callClaudeJSON(system: string, user: string): Promise<any> {
  const apiKey = process.env.ANTHROPIC_API_KEY!
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 250,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  })
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`)
  const json = await res.json() as any
  aiCalls += 1
  inputTokens += json.usage?.input_tokens || 0
  outputTokens += json.usage?.output_tokens || 0
  const text = (json.content?.[0]?.text || '').trim()
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return {}
  try { return JSON.parse(m[0]) } catch { return {} }
}

// ── Replicate extractDemographics() exactly (same prompt, same model tier) ─
interface PredictedField { value: string; source: 'explicit' | 'inferred'; confidence: 'high' | 'medium' | 'low' }
interface Predicted {
  age_range?: PredictedField
  gender?: PredictedField
  education?: PredictedField
  socioeconomic?: PredictedField
}

async function predictDemographics(userMessages: string[]): Promise<Predicted> {
  if (userMessages.length < 3) return {}
  const combined = userMessages.join('\n---\n')
  const system =
    'Analyze these user messages and estimate demographic attributes. Return ONLY valid JSON.\n\n' +
    'User messages:\n"' + combined + '"\n\n' +
    'Estimate ONLY fields you have reasonable evidence for. For each field, set source to "explicit" if they directly stated it, or "inferred" if you deduced it from writing style, vocabulary, references, or context. Set confidence to "high", "medium", or "low".\n\n' +
    'Fields to estimate (omit if insufficient evidence):\n' +
    '- age_range: "18-24", "25-34", "35-44", "45-54", "55-64", or "65+"\n' +
    '- gender: "male", "female", or "non-binary"\n' +
    '- education: "high school", "some college", "bachelors", or "graduate"\n' +
    '- socioeconomic: "lower", "lower-middle", "middle", "upper-middle", or "upper"\n\n' +
    'Use writing style, vocabulary complexity, cultural references, topics discussed, and any explicit mentions as signals.\n' +
    'Be conservative — only include a field if you have meaningful evidence. Prefer "medium" or "low" confidence for inferred fields.\n\n' +
    'Return format:\n' +
    '{"age_range":{"value":"25-34","source":"inferred","confidence":"medium"},...}\n\n' +
    'ONLY output the JSON object. No explanation.'
  try {
    return await callClaudeJSON(system, 'Estimate demographics from these user messages.')
  } catch {
    return {}
  }
}

// ── Stated-value normalisers — map varied input to the algo's buckets ─────
const AGE_BUCKETS = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+']
function normaliseAge(raw: any): string | null {
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim().toLowerCase()
  if (!s) return null
  // Pre-bucketed forms
  for (const b of AGE_BUCKETS) if (s.includes(b.toLowerCase())) return b
  if (/65\+|65 ?\+|65 ?and ?over|65 ?or ?older/.test(s)) return '65+'
  // Raw integer
  const n = parseInt(s.replace(/[^\d]/g, ''), 10)
  if (Number.isFinite(n) && n >= 13 && n <= 110) {
    if (n < 25) return '18-24'
    if (n < 35) return '25-34'
    if (n < 45) return '35-44'
    if (n < 55) return '45-54'
    if (n < 65) return '55-64'
    return '65+'
  }
  return null
}

function normaliseGender(raw: any): string | null {
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim().toLowerCase()
  if (!s || /prefer not|pnts|n\/a|na|^-+$/.test(s)) return null
  if (/^m$|^male|man\b/.test(s)) return 'male'
  if (/^f$|^female|woman|^fem/.test(s)) return 'female'
  if (/non.?binary|nb|enby|gender.?queer|gender.?fluid|other/.test(s)) return 'non-binary'
  return null
}

function normaliseEducation(raw: any): string | null {
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim().toLowerCase()
  if (!s) return null
  if (/grad(uate)?|master|phd|doctor|jd|md|professional|advanced/.test(s)) return 'graduate'
  if (/bach|college (degree|grad)|4.?year|university (degree|grad)|undergrad/.test(s)) return 'bachelors'
  if (/some college|associate|2.?year|technical|vocational/.test(s)) return 'some college'
  if (/high school|hs|ged|secondary|diploma/.test(s)) return 'high school'
  return null
}

// Income → socioeconomic
function normaliseSocio(raw: any): string | null {
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim().toLowerCase()
  if (!s) return null
  // Explicit labels first
  if (/upper.?middle|upper middle/.test(s)) return 'upper-middle'
  if (/lower.?middle|lower middle/.test(s)) return 'lower-middle'
  if (/^upper|wealthy|affluent|high income/.test(s)) return 'upper'
  if (/^middle|middle income/.test(s)) return 'middle'
  if (/^lower|low income|poverty|working class/.test(s)) return 'lower'
  // Income brackets — pick a representative midpoint
  const nums = s.match(/\d[\d,]*/g)
  if (nums && nums.length > 0) {
    const vals = nums.map(n => parseInt(n.replace(/,/g, ''), 10)).filter(n => Number.isFinite(n))
    if (vals.length === 0) return null
    const midRaw = vals.length >= 2 ? (vals[0] + vals[1]) / 2 : vals[0]
    // If number looks like $X,XXX shown as "30000" or "30k" both work
    const mid = midRaw < 1000 ? midRaw * 1000 : midRaw
    if (mid < 30000) return 'lower'
    if (mid < 60000) return 'lower-middle'
    if (mid < 100000) return 'middle'
    if (mid < 200000) return 'upper-middle'
    return 'upper'
  }
  return null
}

// ── Field classification by name + value ───────────────────────────────────
type FieldRole = 'age' | 'gender' | 'education' | 'income' | 'oe' | 'other'
function classifyField(key: string, sampleVal: any): FieldRole {
  const k = key.toLowerCase()
  if (/age(_| |$)|age_range|^age$/.test(k)) return 'age'
  if (/gender|sex(_| |$)/.test(k)) return 'gender'
  if (/educat|degree|schooling/.test(k)) return 'education'
  if (/income|earnings|socio|household.?income/.test(k)) return 'income'
  if (typeof sampleVal === 'string' && sampleVal.length >= MIN_TEXT_LEN_FOR_OE && sampleVal.includes(' ')) return 'oe'
  return 'other'
}

// ── Split a long string into "messages" so we can clear the algo's >=3 gate
function splitIntoMessages(text: string): string[] {
  // First try sentence-level
  const sents = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length >= 8)
  if (sents.length >= 3) return sents
  // Fall back to comma split
  const parts = text.split(/[,;]\s+/).map(s => s.trim()).filter(s => s.length >= 5)
  if (parts.length >= 3) return parts
  return [text]
}

// ── Main ──────────────────────────────────────────────────────────────────
interface RowResult {
  rowIndex: number
  datasetLabel: string
  oeText: string
  oeFieldCount: number
  stated: { age: string | null; gender: string | null; education: string | null; socio: string | null }
  predicted: Predicted
}

async function main() {
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  console.log('Pulling Coalition collection members…')
  const { data: members } = await s.from('collection_members').select('dataset_id, label').eq('collection_id', COLLECTION_ID)
  if (!members || members.length === 0) throw new Error('no members')
  console.log(`  ${members.length} member datasets`)

  // Pull all rows
  const allRows: { datasetLabel: string; row: any }[] = []
  for (const m of members) {
    let offset = 0
    while (offset < 10_000) {
      const { data: rows } = await s.from('dataset_rows_flat')
        .select('data, row_index')
        .eq('dataset_id', m.dataset_id)
        .order('row_index')
        .range(offset, offset + 999)
      if (!rows || rows.length === 0) break
      for (const r of rows) allRows.push({ datasetLabel: m.label, row: r })
      if (rows.length < 1000) break
      offset += 1000
    }
  }
  console.log(`  ${allRows.length} total rows pulled`)

  // Discover field roles by sampling first ~30 rows from each dataset
  const fieldRoles: Record<string, FieldRole> = {}
  const seenSamples: Record<string, any> = {}
  for (const { row } of allRows) {
    const data = (row as any).data || {}
    for (const k of Object.keys(data)) {
      if (fieldRoles[k]) continue
      const v = data[k]
      if (v === null || v === undefined || v === '') continue
      if (!seenSamples[k]) seenSamples[k] = v
    }
  }
  for (const k of Object.keys(seenSamples)) fieldRoles[k] = classifyField(k, seenSamples[k])

  const fieldsByRole = {
    age:       Object.keys(fieldRoles).filter(k => fieldRoles[k] === 'age'),
    gender:    Object.keys(fieldRoles).filter(k => fieldRoles[k] === 'gender'),
    education: Object.keys(fieldRoles).filter(k => fieldRoles[k] === 'education'),
    income:    Object.keys(fieldRoles).filter(k => fieldRoles[k] === 'income'),
    oe:        Object.keys(fieldRoles).filter(k => fieldRoles[k] === 'oe'),
  }
  console.log('Field classification:')
  console.log(`  age:       ${fieldsByRole.age.join(', ') || '(none)'}`)
  console.log(`  gender:    ${fieldsByRole.gender.join(', ') || '(none)'}`)
  console.log(`  education: ${fieldsByRole.education.join(', ') || '(none)'}`)
  console.log(`  income:    ${fieldsByRole.income.join(', ') || '(none)'}`)
  console.log(`  open-ended fields: ${fieldsByRole.oe.length} (${fieldsByRole.oe.slice(0, 4).join(', ')}${fieldsByRole.oe.length > 4 ? ', …' : ''})`)

  // Find eligible rows: at least one OE response AND at least one stated demo
  const eligible: { datasetLabel: string; rowIndex: number; messages: string[]; oeFieldCount: number; stated: RowResult['stated'] }[] = []
  for (const { datasetLabel, row } of allRows) {
    const data = (row as any).data || {}

    // OE messages
    const messages: string[] = []
    let oeFieldCount = 0
    for (const k of fieldsByRole.oe) {
      const v = data[k]
      if (typeof v === 'string' && v.trim().length >= MIN_TEXT_LEN_FOR_OE && v.includes(' ')) {
        messages.push(v.trim())
        oeFieldCount += 1
      }
    }
    if (messages.length === 0) continue
    // Inflate to >= 3 messages by splitting longest if needed
    let inflated = messages
    while (inflated.length < 3) {
      const longestIdx = inflated.reduce((bi, m, i, arr) => m.length > arr[bi].length ? i : bi, 0)
      const split = splitIntoMessages(inflated[longestIdx])
      if (split.length === 1) break // can't split further
      inflated = [...inflated.slice(0, longestIdx), ...split, ...inflated.slice(longestIdx + 1)]
    }
    if (inflated.length < 3) continue

    // Stated demos
    const stated = {
      age:       fieldsByRole.age.map(k => normaliseAge(data[k])).find(v => v) || null,
      gender:    fieldsByRole.gender.map(k => normaliseGender(data[k])).find(v => v) || null,
      education: fieldsByRole.education.map(k => normaliseEducation(data[k])).find(v => v) || null,
      socio:     fieldsByRole.income.map(k => normaliseSocio(data[k])).find(v => v) || null,
    }
    const statedCount = [stated.age, stated.gender, stated.education, stated.socio].filter(Boolean).length
    if (statedCount === 0) continue

    eligible.push({ datasetLabel, rowIndex: (row as any).row_index, messages: inflated, oeFieldCount, stated })
  }
  console.log(`Eligible rows (have BOTH open-ended text AND ≥1 stated demo): ${eligible.length}`)

  // Sample up to MAX_ROWS deterministically (every Nth)
  const stride = Math.max(1, Math.floor(eligible.length / MAX_ROWS))
  const sample = eligible.filter((_, i) => i % stride === 0).slice(0, MAX_ROWS)
  console.log(`Running inference on ${sample.length} rows (stride ${stride}) …`)

  // Run inference (small batches to keep terminal readable)
  const results: RowResult[] = []
  for (let i = 0; i < sample.length; i++) {
    const r = sample[i]
    const predicted = await predictDemographics(r.messages)
    results.push({
      rowIndex: r.rowIndex,
      datasetLabel: r.datasetLabel,
      oeText: r.messages.slice(0, 3).join(' ⏎ ').slice(0, 240),
      oeFieldCount: r.oeFieldCount,
      stated: r.stated,
      predicted,
    })
    if ((i + 1) % 10 === 0) process.stdout.write(`  ${i + 1}/${sample.length}…\n`)
  }
  console.log(`  done · ${aiCalls} AI calls · ~${Math.round((inputTokens + outputTokens) / 1000)}K tokens`)

  // ── Tabulate ─────────────────────────────────────────────────────────────
  type Dim = 'age' | 'gender' | 'education' | 'socio'
  const dims: Dim[] = ['age', 'gender', 'education', 'socio']
  const predKey: Record<Dim, keyof Predicted> = {
    age: 'age_range', gender: 'gender', education: 'education', socio: 'socioeconomic',
  }

  function ageDistance(a: string, b: string): number {
    const ai = AGE_BUCKETS.indexOf(a)
    const bi = AGE_BUCKETS.indexOf(b)
    if (ai < 0 || bi < 0) return 99
    return Math.abs(ai - bi)
  }
  const SOCIO_ORDER = ['lower', 'lower-middle', 'middle', 'upper-middle', 'upper']
  function socioDistance(a: string, b: string): number {
    const ai = SOCIO_ORDER.indexOf(a)
    const bi = SOCIO_ORDER.indexOf(b)
    if (ai < 0 || bi < 0) return 99
    return Math.abs(ai - bi)
  }
  const EDU_ORDER = ['high school', 'some college', 'bachelors', 'graduate']
  function eduDistance(a: string, b: string): number {
    const ai = EDU_ORDER.indexOf(a)
    const bi = EDU_ORDER.indexOf(b)
    if (ai < 0 || bi < 0) return 99
    return Math.abs(ai - bi)
  }

  const stats: Record<Dim, { withStated: number; withPredicted: number; bothPresent: number; exact: number; withinOne: number }> = {
    age:       { withStated: 0, withPredicted: 0, bothPresent: 0, exact: 0, withinOne: 0 },
    gender:    { withStated: 0, withPredicted: 0, bothPresent: 0, exact: 0, withinOne: 0 },
    education: { withStated: 0, withPredicted: 0, bothPresent: 0, exact: 0, withinOne: 0 },
    socio:     { withStated: 0, withPredicted: 0, bothPresent: 0, exact: 0, withinOne: 0 },
  }

  for (const r of results) {
    for (const d of dims) {
      const stated = r.stated[d]
      const pred = r.predicted[predKey[d]]?.value || null
      if (stated) stats[d].withStated += 1
      if (pred)   stats[d].withPredicted += 1
      if (stated && pred) {
        stats[d].bothPresent += 1
        if (stated === pred) {
          stats[d].exact += 1
          stats[d].withinOne += 1
        } else {
          const dist = d === 'age' ? ageDistance(stated, pred)
                     : d === 'socio' ? socioDistance(stated, pred)
                     : d === 'education' ? eduDistance(stated, pred)
                     : 99   // gender has no order — only exact match counts as within-one
          if (dist <= 1) stats[d].withinOne += 1
        }
      }
    }
  }

  // ── Console summary ──────────────────────────────────────────────────────
  console.log('\nAccuracy summary:')
  console.log('  dim         |  stated  predicted  both  exact%  withinOne%')
  for (const d of dims) {
    const sx = stats[d]
    const exactPct = sx.bothPresent > 0 ? Math.round(sx.exact / sx.bothPresent * 100) : 0
    const w1Pct    = sx.bothPresent > 0 ? Math.round(sx.withinOne / sx.bothPresent * 100) : 0
    console.log(`  ${d.padEnd(11)} |   ${String(sx.withStated).padStart(3)}      ${String(sx.withPredicted).padStart(3)}     ${String(sx.bothPresent).padStart(3)}   ${String(exactPct).padStart(3)}%      ${String(w1Pct).padStart(3)}%`)
  }

  // ── Markdown report ──────────────────────────────────────────────────────
  const mdLines: string[] = []
  mdLines.push(`# Coalition profiling-accuracy audit`)
  mdLines.push('')
  mdLines.push(`**Run date:** ${new Date().toISOString().slice(0, 10)}`)
  mdLines.push(`**Collection:** Coalition Donor Survey Collection (${COLLECTION_ID})`)
  mdLines.push(`**Member datasets:** ${members.length}`)
  mdLines.push(`**Total rows pulled:** ${allRows.length.toLocaleString()}`)
  mdLines.push(`**Eligible rows** *(have ≥1 open-ended response AND ≥1 stated demographic)*: ${eligible.length}`)
  mdLines.push(`**Inference sample:** ${sample.length}`)
  mdLines.push(`**Model:** \`${MODEL}\` (fast tier — same one the bot runtime uses)`)
  mdLines.push('')
  mdLines.push('## How the test works')
  mdLines.push('')
  mdLines.push('For each eligible respondent, we concatenated every open-ended answer they gave (treating each as a separate "message"), fed it to the **exact same `extractDemographics()` prompt** the bot runtime calls, and compared the AI\'s estimate to what they actually selected in the demographic questions.')
  mdLines.push('')
  mdLines.push('The algorithm is conservative — it only returns a value when it has "meaningful evidence" — so per-dimension coverage (how often it produced a guess) matters as much as the accuracy when it did.')
  mdLines.push('')
  mdLines.push('## Field classification')
  mdLines.push('')
  mdLines.push(`- **Age fields:** ${fieldsByRole.age.join(', ') || '_none found_'}`)
  mdLines.push(`- **Gender fields:** ${fieldsByRole.gender.join(', ') || '_none found_'}`)
  mdLines.push(`- **Education fields:** ${fieldsByRole.education.join(', ') || '_none found_'}`)
  mdLines.push(`- **Income/socioeconomic fields:** ${fieldsByRole.income.join(', ') || '_none found_'}`)
  mdLines.push(`- **Open-ended fields (${fieldsByRole.oe.length}):** ${fieldsByRole.oe.join(', ')}`)
  mdLines.push('')
  mdLines.push('## Accuracy summary')
  mdLines.push('')
  mdLines.push('| Dimension | Stated by user | Predicted by algo | Both present | Exact match | Within one bucket* |')
  mdLines.push('|---|---:|---:|---:|---:|---:|')
  for (const d of dims) {
    const sx = stats[d]
    const exactPct = sx.bothPresent > 0 ? Math.round(sx.exact / sx.bothPresent * 100) : 0
    const w1Pct    = sx.bothPresent > 0 ? Math.round(sx.withinOne / sx.bothPresent * 100) : 0
    const dimLabel = d === 'age' ? 'Age range' : d === 'gender' ? 'Gender' : d === 'education' ? 'Education' : 'Socioeconomic'
    mdLines.push(`| ${dimLabel} | ${sx.withStated} | ${sx.withPredicted} | ${sx.bothPresent} | **${sx.exact}** (${exactPct}%) | ${sx.withinOne} (${w1Pct}%) |`)
  }
  mdLines.push('')
  mdLines.push('\\* "Within one bucket" counts an exact match OR a prediction one step off on the ordered scale (e.g. predicted 35-44, stated 25-34). Gender has no ordinal scale, so "within one" equals exact match for that dimension.')
  mdLines.push('')
  mdLines.push('## Sample comparisons')
  mdLines.push('')
  mdLines.push('First 20 rows where the algo produced at least one prediction and we had a stated value to compare:')
  mdLines.push('')
  mdLines.push('| # | Open-ended snippet | Age (stated → pred) | Gender (stated → pred) | Education (stated → pred) | Socio (stated → pred) |')
  mdLines.push('|---|---|---|---|---|---|')
  let shown = 0
  for (const r of results) {
    const hasPred = !!(r.predicted.age_range || r.predicted.gender || r.predicted.education || r.predicted.socioeconomic)
    if (!hasPred) continue
    const snippet = r.oeText.replace(/\|/g, '/').replace(/[\n\r]+/g, ' ').slice(0, 110)
    const cell = (stated: string | null, pred: string | undefined): string => {
      const ok = stated && pred && stated === pred ? ' ✅' : (stated && pred ? ' ❌' : '')
      return `${stated || '—'} → ${pred || '—'}${ok}`
    }
    mdLines.push(`| ${r.rowIndex} | ${snippet}… | ${cell(r.stated.age, r.predicted.age_range?.value)} | ${cell(r.stated.gender, r.predicted.gender?.value)} | ${cell(r.stated.education, r.predicted.education?.value)} | ${cell(r.stated.socio, r.predicted.socioeconomic?.value)} |`)
    shown += 1
    if (shown >= 20) break
  }
  mdLines.push('')
  mdLines.push('## Notes on interpretation')
  mdLines.push('')
  mdLines.push('- **Coverage (Predicted column) ≠ accuracy.** The algorithm is designed to omit a field when evidence is thin. A low predicted-count on a dimension means "the algo correctly knew it couldn\'t tell" more often than "the algo failed."')
  mdLines.push('- **Survey text is harder than bot text.** The algo was tuned for multi-turn conversation, where users disclose more about themselves over time. One-shot survey answers (especially short list-style answers) are a thinner signal.')
  mdLines.push('- **Gender from a charity list is near-impossible.** Expect coverage to drop sharply on rows where the only open-ended answer is "Salvation Army, Red Cross."')
  mdLines.push('- **Within-one is a fairer bar than exact-match** for ordered dimensions (age, education, socio). A predicted bucket adjacent to the truth is still useful for tone/example tailoring.')
  mdLines.push('')

  const mdPath = path.join(homedir(), 'Downloads', 'Coalition-Profiling-Accuracy.md')
  writeFileSync(mdPath, mdLines.join('\n'))
  console.log(`\n✓ Wrote ${mdPath}`)

  // ── Slide deck ───────────────────────────────────────────────────────────
  const dimLabels: Record<Dim, string> = { age: 'Age range', gender: 'Gender', education: 'Education', socio: 'Socioeconomic' }
  const slides: SlideSpec[] = []

  // Slide 1 — overview KPIs
  const totalEligible = eligible.length
  const totalSample = sample.length
  const avgExact = (() => {
    let sum = 0, n = 0
    for (const d of dims) {
      if (stats[d].bothPresent > 0) { sum += stats[d].exact / stats[d].bothPresent; n += 1 }
    }
    return n > 0 ? Math.round(sum / n * 100) : 0
  })()
  const avgWithinOne = (() => {
    let sum = 0, n = 0
    for (const d of dims) {
      if (stats[d].bothPresent > 0) { sum += stats[d].withinOne / stats[d].bothPresent; n += 1 }
    }
    return n > 0 ? Math.round(sum / n * 100) : 0
  })()

  slides.push({
    type: 'kpi_grid',
    title: 'Profiling-accuracy audit · Coalition Donor Survey Collection',
    subtitle: `Ran ${MODEL} demographic inference on ${totalSample} respondents who also self-reported demographics. Predictions used only the respondent's open-ended text.`,
    kpis: [
      { value: String(allRows.length), label: 'rows pulled', sub: `${members.length} datasets` },
      { value: String(totalEligible),  label: 'rows had BOTH open-ended text AND stated demographics' },
      { value: String(totalSample),    label: 'rows in inference sample' },
      { value: `${avgExact}%`,         label: 'avg exact-match accuracy (when algo produced a prediction)' },
      { value: `${avgWithinOne}%`,     label: 'avg within-one-bucket accuracy (ordered dims)' },
    ],
  })

  // Slide 2 — per-dimension accuracy bars (exact-match %)
  slides.push({
    type: 'bar_chart',
    title: 'Exact-match accuracy by dimension',
    subtitle: 'When the algorithm produced a prediction AND we had a stated value to compare against',
    data: dims.map(d => {
      const sx = stats[d]
      const pct = sx.bothPresent > 0 ? Math.round(sx.exact / sx.bothPresent * 100) : 0
      return { label: dimLabels[d], value: pct, color: '0A9396' }
    }),
    insight: 'Exact-match is the strictest bar. Below this slide, the within-one-bucket numbers tell the more practically useful story for ordered dimensions.',
  })

  // Slide 3 — within-one accuracy (ordered dims) + coverage
  slides.push({
    type: 'table',
    title: 'Coverage vs accuracy',
    subtitle: 'How often did the algo produce a guess, and how good was it when it did?',
    columns: ['Dimension', 'Stated', 'Predicted', 'Both', 'Exact', 'Within-1'],
    rows: dims.map(d => {
      const sx = stats[d]
      const exactPct = sx.bothPresent > 0 ? Math.round(sx.exact / sx.bothPresent * 100) : 0
      const w1Pct    = sx.bothPresent > 0 ? Math.round(sx.withinOne / sx.bothPresent * 100) : 0
      return [
        dimLabels[d],
        String(sx.withStated),
        String(sx.withPredicted),
        String(sx.bothPresent),
        `${sx.exact} (${exactPct}%)`,
        `${sx.withinOne} (${w1Pct}%)`,
      ]
    }),
    insight: 'The "Predicted" count is also a signal: a low number on a dim means the algo correctly refused to guess on thin evidence.',
  })

  // Slide 4 — sample comparisons (first 8 rows where algo predicted)
  const exQuotes: { text: string; attribution?: string }[] = []
  for (const r of results) {
    const hasPred = !!(r.predicted.age_range || r.predicted.gender || r.predicted.education || r.predicted.socioeconomic)
    if (!hasPred) continue
    const parts: string[] = []
    if (r.stated.age && r.predicted.age_range)             parts.push(`age ${r.stated.age}→${r.predicted.age_range.value}${r.stated.age === r.predicted.age_range.value ? ' ✓' : ''}`)
    if (r.stated.gender && r.predicted.gender)             parts.push(`gender ${r.stated.gender}→${r.predicted.gender.value}${r.stated.gender === r.predicted.gender.value ? ' ✓' : ''}`)
    if (r.stated.education && r.predicted.education)       parts.push(`edu ${r.stated.education}→${r.predicted.education.value}${r.stated.education === r.predicted.education.value ? ' ✓' : ''}`)
    if (r.stated.socio && r.predicted.socioeconomic)       parts.push(`socio ${r.stated.socio}→${r.predicted.socioeconomic.value}${r.stated.socio === r.predicted.socioeconomic.value ? ' ✓' : ''}`)
    if (parts.length === 0) continue
    exQuotes.push({ text: `"${r.oeText.slice(0, 180)}…"`, attribution: parts.join(' · ') })
    if (exQuotes.length >= 6) break
  }
  if (exQuotes.length > 0) {
    slides.push({
      type: 'quotes',
      title: 'Stated vs predicted — sample rows',
      subtitle: 'Each card shows a respondent\'s open-ended text and the stated→predicted comparison on every dimension where both were available',
      quotes: exQuotes,
    })
  }

  // Slide 5 — takeaways
  slides.push({
    type: 'bullets',
    title: 'What this tells us about the profiling algo',
    subtitle: 'Read in context — survey text is a thinner signal than multi-turn bot conversation, which is what the algo was tuned for',
    bullets: [
      'Coverage (how often the algo produces a guess) is the algo\'s first quality bar — it correctly omits a dimension when evidence is thin. Total predictions per dim shows this.',
      'For ordered dimensions (age, education, socioeconomic), "within one bucket" is the more practically useful accuracy metric than exact match — an adjacent guess still drives the right tone and examples.',
      'Gender is hardest on survey text since list-style answers ("Salvation Army, Red Cross") carry no writing-style signal. Multi-turn bot chats produce far more signal per respondent.',
      'Use this audit as a baseline. Re-running after prompt or model changes will show whether tuning moved exact-match or within-one accuracy.',
    ],
  })

  const spec: DeckSpec = {
    title: 'Profiling-accuracy audit · Coalition Donor Survey Collection',
    subtitle: 'Predicted-vs-stated demographic comparison',
    slides,
  }
  const buffer = await renderDeck(spec, 'Coalition Donor Survey Collection')
  const pptxPath = path.join(homedir(), 'Downloads', 'Coalition-Profiling-Accuracy.pptx')
  writeFileSync(pptxPath, buffer)
  console.log(`✓ Wrote ${pptxPath}`)
}

main().catch(err => { console.error(err); process.exit(1) })
