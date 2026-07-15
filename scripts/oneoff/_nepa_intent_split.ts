/* eslint-disable */
// NEPA — the "two sides of CARA" split. Classifies each distinct submitted comment
// by its PRIMARY intent: is the person mainly (a) asking a QUESTION / seeking to
// understand the plan (better served by a real-time Ask agent), (b) stating a
// POSITION for the record (the formal comment channel), or (c) BOTH. Grounds the
// two-sided pitch: how much of today's formal comment burden is really people who
// just wanted an answer. Reuses the deterministic near-dup clustering; classifies
// one representative per cluster; aggregates by voices and by volume.
//
// Run: node --import tsx scripts/oneoff/_nepa_intent_split.ts <corpus.json> <out.json>

import { readFileSync, writeFileSync } from 'node:fs'
for (const line of readFileSync('.env.local', 'utf-8').split('\n')) {
  const mm = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (mm && !process.env[mm[1]]) process.env[mm[1]] = mm[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '')
}

const NEAR_DUP = 0.60, K = 5
type Comment = { letterid: string; comment: string }
const normalize = (t: string) => (t || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
function shingles(text: string): Set<string> {
  const w = normalize(text).split(' ').filter(Boolean); const s = new Set<string>()
  if (w.length < K) { if (w.length) s.add(w.join(' ')); return s }
  for (let i = 0; i + K <= w.length; i++) s.add(w.slice(i, i + K).join(' ')); return s
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0; const [sm, big] = a.size < b.size ? [a, b] : [b, a]; let x = 0
  for (const v of sm) if (big.has(v)) x++; return x / (a.size + b.size - x)
}
function clusterLabels(shs: Set<string>[]): number[] {
  const n = shs.length, p = Array.from({ length: n }, (_, i) => i)
  const find = (x: number): number => { while (p[x] !== x) { p[x] = p[p[x]]; x = p[x] } return x }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const si = shs[i].size, sj = shs[j].size; if (!si || !sj) continue
    if (Math.max(si, sj) > 3 * Math.min(si, sj)) continue
    if (jaccard(shs[i], shs[j]) >= NEAR_DUP) { const a = find(i), b = find(j); if (a !== b) p[a] = b }
  }
  return p.map((_, i) => find(i))
}

type Intent = 'question' | 'position' | 'both'
const SYS = `You classify public comments on the USDA Forest Service Blue Mountains Forest Plan Revision Draft EIS by the commenter's PRIMARY intent. Think about what the person most wants:

- "question": they are mainly trying to UNDERSTAND the plan — asking what an alternative does, whether something is included, how a rule works, what the deadline is. Someone who would have been well served by getting a real-time answer.
- "position": they are mainly stating a VIEW or requesting a specific OUTCOME for the record — "I oppose more logging", "retain the 21-inch rule", "reduce grazing". They want their stance recorded.
- "both": the comment substantively does both — it asks real questions AND takes clear positions.

For each numbered comment return JSON: {"intent": "question"|"position"|"both"}.
Return ONLY a JSON array, one object per numbered comment IN ORDER. No prose.`

async function classifyBatch(texts: string[]): Promise<Intent[]> {
  const key = process.env.ANTHROPIC_API_KEY!
  const body = texts.map((t, i) => `#${i + 1}: ${t.replace(/\s+/g, ' ').slice(0, 1400)}`).join('\n\n')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1536, system: SYS, messages: [{ role: 'user', content: body }] }),
  })
  if (!res.ok) throw new Error('anthropic ' + res.status + ': ' + (await res.text()).slice(0, 160))
  const data = await res.json()
  let txt = (data.content?.[0]?.text || '').trim()
  const a = txt.indexOf('['), b = txt.lastIndexOf(']'); if (a >= 0 && b > a) txt = txt.slice(a, b + 1)
  return JSON.parse(txt).map((o: any) => (['question', 'position', 'both'].includes(o?.intent) ? o.intent : 'position'))
}

async function main() {
  const corpus = JSON.parse(readFileSync(process.argv[2], 'utf-8')) as { comments: Comment[]; reported_total?: number }
  const comments = corpus.comments
  const out = process.argv[3]
  const labels = clusterLabels(comments.map(c => shingles(c.comment)))
  const groups = new Map<number, number[]>()
  labels.forEach((l, i) => { const g = groups.get(l) || []; g.push(i); groups.set(l, g) })
  const clusters = [...groups.values()]
  const reps = clusters.map(idxs => idxs.slice().sort((a, b) => comments[b].comment.length - comments[a].comment.length)[0])
  console.log(`[cluster] ${comments.length} → ${clusters.length} distinct → classifying intent of ${reps.length} reps`)

  const intents: Intent[] = []
  const B = 10
  for (let i = 0; i < reps.length; i += B) {
    const batch = reps.slice(i, i + B).map(idx => comments[idx].comment)
    try { intents.push(...await classifyBatch(batch)) }
    catch (e) { console.error(`  batch ${i} failed:`, (e as Error).message.slice(0, 100)); for (let k = 0; k < batch.length; k++) intents.push('position') }
    if ((i + B) % 100 === 0 || i + B >= reps.length) console.log(`  …classified ${Math.min(i + B, reps.length)}/${reps.length}`)
  }

  const voices = { question: 0, position: 0, both: 0 }
  const volume = { question: 0, position: 0, both: 0 }
  clusters.forEach((idxs, ci) => { const it = intents[ci]; voices[it]++; volume[it] += idxs.length })
  const vTot = clusters.length, volTot = comments.length
  const pct = (x: number, t: number) => Math.round(x / t * 100)

  console.log(`\n════ TWO SIDES OF CARA — intent split ════`)
  console.log(`  distinct voices: ${vTot}   (of ${volTot} submitted)`)
  console.log(`  ── SIDE A · question (wants an answer):  voices ${voices.question} (${pct(voices.question, vTot)}%) · volume ${volume.question} (${pct(volume.question, volTot)}%)`)
  console.log(`  ── SIDE B · position (wants on record):  voices ${voices.position} (${pct(voices.position, vTot)}%) · volume ${volume.position} (${pct(volume.position, volTot)}%)`)
  console.log(`  ── BOTH · asks AND positions:            voices ${voices.both} (${pct(voices.both, vTot)}%) · volume ${volume.both} (${pct(volume.both, volTot)}%)`)
  console.log(`  ANSWER-SEEKING (question + both):        ${voices.question + voices.both} voices (${pct(voices.question + voices.both, vTot)}%) — the Side-A opportunity`)

  writeFileSync(out, JSON.stringify({ distinct: vTot, submitted: volTot, voices, volume,
    pctVoices: { question: pct(voices.question, vTot), position: pct(voices.position, vTot), both: pct(voices.both, vTot) },
    pctVolume: { question: pct(volume.question, volTot), position: pct(volume.position, volTot), both: pct(volume.both, volTot) },
    answerSeekingVoices: voices.question + voices.both, pctAnswerSeeking: pct(voices.question + voices.both, vTot) }, null, 2))
  console.log(`\n✔ wrote → ${out}`)
}
main().catch(e => { console.error(e); process.exit(1) })
