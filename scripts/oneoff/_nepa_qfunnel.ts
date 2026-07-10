/* eslint-disable */
// NEPA — combined SUBSTANTIVE + QUESTION pass, so the "open questions" layer nests
// correctly under the must-respond set in the funnel. One Haiku call per distinct
// cluster returns {substantive, questions:[{text,type,answerable}]}. Emits a
// funnel that narrows monotonically: distinct → substantive → substantive-with-an-
// answerable-question, plus the distinct-question concentration. Deterministic
// clustering is identical to _nepa_code.ts / _nepa_questions.ts.
//
// Run: node --import tsx scripts/oneoff/_nepa_qfunnel.ts <corpus.json> <out.json>

import { readFileSync, writeFileSync } from 'node:fs'
for (const line of readFileSync('.env.local', 'utf-8').split('\n')) {
  const mm = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (mm && !process.env[mm[1]]) process.env[mm[1]] = mm[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '')
}

const NEAR_DUP = 0.60, K = 5
type Comment = { letterid: string; comment: string }
const normalize = (t: string) => (t || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
function shingles(text: string, k = K): Set<string> {
  const w = normalize(text).split(' ').filter(Boolean); const s = new Set<string>()
  if (w.length < k) { if (w.length) s.add(w.join(' ')); return s }
  for (let i = 0; i + k <= w.length; i++) s.add(w.slice(i, i + k).join(' ')); return s
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0; const [sm, big] = a.size < b.size ? [a, b] : [b, a]; let x = 0
  for (const v of sm) if (big.has(v)) x++; return x / (a.size + b.size - x)
}
function clusterLabels(shs: Set<string>[], thr: number): number[] {
  const n = shs.length, p = Array.from({ length: n }, (_, i) => i)
  const find = (x: number): number => { while (p[x] !== x) { p[x] = p[p[x]]; x = p[x] } return x }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const si = shs[i].size, sj = shs[j].size; if (!si || !sj) continue
    if (Math.max(si, sj) > 3 * Math.min(si, sj)) continue
    if (jaccard(shs[i], shs[j]) >= thr) { const a = find(i), b = find(j); if (a !== b) p[a] = b }
  }
  return p.map((_, i) => find(i))
}

const QTYPES = ['process_deadline', 'science_data', 'alternative_specifics', 'effects_impact', 'access_recreation', 'economics_jobs', 'grazing_permits', 'wildlife_habitat', 'other'] as const
type Row = { substantive: boolean; questions: { text: string; type: string; answerable: boolean }[] }

const SYS = `You analyze public comments on the USDA Forest Service Blue Mountains Forest Plan Revision Draft EIS. Alternative 2 (the proposed action) would substantially INCREASE commercial logging and ELIMINATE the ~30-year "21-inch rule" limiting cutting of large/old trees. A 90-day comment period is open.

For each numbered comment return JSON:
- "substantive": true if it raises a specific fact, concern, or requested change tied to a plan element or resource (the agency must respond to these); false if it is a bare position or form-letter sentiment with no specific substance.
- "questions": array of the QUESTIONS embedded in the comment — the specific information requests a "response to comments" would have to address (explicit "?" AND implicit "it is unclear how…", "the DEIS never explains…"). Each = {"text": standalone rewrite, "type": one of ${QTYPES.join(', ')}, "answerable": true if a knowledgeable assistant with the published DEIS/alternatives/process rules could answer it with FACTS, false if rhetorical, a value judgment, a demand, or about info not in the record}.

Return ONLY a JSON array, one object per numbered comment IN ORDER: [{"substantive":bool,"questions":[...]}, ...]. One entry per comment even if questions is empty. No prose.`

async function codeBatch(texts: string[]): Promise<Row[]> {
  const key = process.env.ANTHROPIC_API_KEY!
  const body = texts.map((t, i) => `#${i + 1}: ${t.replace(/\s+/g, ' ').slice(0, 1500)}`).join('\n\n')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 4096, system: SYS, messages: [{ role: 'user', content: body }] }),
  })
  if (!res.ok) throw new Error('anthropic ' + res.status + ': ' + (await res.text()).slice(0, 200))
  const data = await res.json()
  let txt = (data.content?.[0]?.text || '').trim()
  const a = txt.indexOf('['), b = txt.lastIndexOf(']'); if (a >= 0 && b > a) txt = txt.slice(a, b + 1)
  const arr = JSON.parse(txt)
  return arr.map((o: any) => ({
    substantive: !!o?.substantive,
    questions: Array.isArray(o?.questions) ? o.questions.filter((q: any) => q && typeof q.text === 'string' && q.text.trim())
      .map((q: any) => ({ text: String(q.text).trim(), type: (QTYPES as readonly string[]).includes(q.type) ? q.type : 'other', answerable: !!q.answerable })) : [],
  }))
}

async function main() {
  const corpus = JSON.parse(readFileSync(process.argv[2], 'utf-8')) as { comments: Comment[]; reported_total?: number }
  const comments = corpus.comments
  const submitted = corpus.reported_total || comments.length
  const out = process.argv[3]
  const labels = clusterLabels(comments.map(c => shingles(c.comment)), NEAR_DUP)
  const groups = new Map<number, number[]>()
  labels.forEach((l, i) => { const g = groups.get(l) || []; g.push(i); groups.set(l, g) })
  const clusters = [...groups.values()]
  const reps = clusters.map(idxs => idxs.slice().sort((a, b) => comments[b].comment.length - comments[a].comment.length)[0])
  console.log(`[cluster] ${comments.length} → ${clusters.length} distinct → coding ${reps.length} reps`)

  const rows: Row[] = []
  const B = 10
  for (let i = 0; i < reps.length; i += B) {
    const batch = reps.slice(i, i + B).map(idx => comments[idx].comment)
    try { rows.push(...await codeBatch(batch)) }
    catch (e) { console.error(`  batch ${i} failed:`, (e as Error).message.slice(0, 120)); for (let k = 0; k < batch.length; k++) rows.push({ substantive: false, questions: [] }) }
    if ((i + B) % 100 === 0 || i + B >= reps.length) console.log(`  …coded ${Math.min(i + B, reps.length)}/${reps.length}`)
  }

  const distinct = clusters.length
  let substantive = 0, substantiveWithAnsQ = 0, voicesAnsQ = 0
  const typeVoices: Record<string, number> = {}
  const answerable: { text: string; type: string; weight: number }[] = []
  clusters.forEach((idxs, ci) => {
    const r = rows[ci] || { substantive: false, questions: [] }
    const size = idxs.length
    const ans = r.questions.filter(q => q.answerable)
    if (r.substantive) substantive++
    if (ans.length) voicesAnsQ++
    if (r.substantive && ans.length) substantiveWithAnsQ++
    for (const q of r.questions) typeVoices[q.type] = (typeVoices[q.type] || 0) + 1
    for (const q of ans) answerable.push({ text: q.text, type: q.type, weight: size })
  })

  // Concentration: sort answerable questions by frequency; how much volume the top-K cover.
  const byFreq = answerable.slice().sort((a, b) => b.weight - a.weight)
  const totalAnsVolume = answerable.reduce((s, q) => s + q.weight, 0)
  const top25Volume = byFreq.slice(0, 25).reduce((s, q) => s + q.weight, 0)

  const funnel = { submitted, held: Math.max(0, submitted - comments.length), available: comments.length, distinct, substantive, answerableQuestions: substantiveWithAnsQ }
  console.log(`\n════ NESTED FUNNEL ════`)
  console.log(`  ${submitted} submitted → ${comments.length} available → ${distinct} distinct → ${substantive} substantive → ${substantiveWithAnsQ} pose an answerable question`)
  console.log(`  (answerable-question-bearing among ALL distinct: ${voicesAnsQ})`)
  console.log(`  pct of substantive that pose an answerable question: ${Math.round(substantiveWithAnsQ / substantive * 100)}%`)
  console.log(`\n════ CONCENTRATION ════`)
  console.log(`  total answerable-question volume: ${totalAnsVolume}; top-25 distinct questions cover ${top25Volume} (${Math.round(top25Volume / totalAnsVolume * 100)}%)`)
  console.log(`\n════ TYPES ════`)
  Object.entries(typeVoices).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k.padEnd(22)} ${v}`))

  writeFileSync(out, JSON.stringify({ funnel, voicesAnsQ, pctSubstantiveWithAnsQ: Math.round(substantiveWithAnsQ / substantive * 100), typeVoices, totalAnsVolume, top25Volume, topQuestions: byFreq.slice(0, 30) }, null, 2))
  console.log(`\n✔ wrote → ${out}`)
}
main().catch(e => { console.error(e); process.exit(1) })
