/* eslint-disable */
// NEPA Phase 2 — QUESTION EXTRACTION. Over the live Blue Mountains comment corpus,
// pull the *questions* embedded in comments: the explicit and implicit information
// requests a response-to-comments would have to address. Reuses the deterministic
// near-dup clustering from _nepa_code.ts (classify one representative per cluster,
// propagate to members by size). Distinguishes answerable INFORMATION questions
// (a knowledgeable assistant with the DEIS + process docs could answer factually)
// from bare positions / rhetorical asks. Then clusters the questions themselves
// into distinct question-themes with frequency, so we can test a subset against the
// live assistant.
//
// Run: node --import tsx scripts/oneoff/_nepa_questions.ts <corpus.json> <out.json>

import { readFileSync, writeFileSync } from 'node:fs'
for (const line of readFileSync('.env.local', 'utf-8').split('\n')) {
  const mm = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (mm && !process.env[mm[1]]) process.env[mm[1]] = mm[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '')
}

const NEAR_DUP = 0.60, K = 5
type Comment = { letterid: string; first: string | null; last: string | null; organization: string | null; comment: string }

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
type QType = typeof QTYPES[number]
type Q = { text: string; type: QType; answerable: boolean }
type Extracted = { questions: Q[] }

const SYS = `You analyze public comments on the USDA Forest Service Blue Mountains Forest Plan Revision Draft EIS. The proposed action (Alternative 2) would substantially INCREASE commercial logging and ELIMINATE the ~30-year "21-inch rule" limiting the cutting of large/old trees. A 90-day comment period is open.

Your job: extract the QUESTIONS embedded in each comment — the specific information requests a Forest Service "response to comments" would have to address. Include BOTH explicit questions (ending in "?") AND implicit ones ("I want to know whether…", "It is unclear how…", "The DEIS never explains…").

For each question return JSON:
- "text": the question rewritten as a clear, standalone question (resolve pronouns; keep it faithful).
- "type": ONE of — ${QTYPES.join(', ')}.
- "answerable": true if a knowledgeable assistant with the published DEIS, the alternatives, and the Forest Service process rules could answer it with FACTS (e.g. "what does the 21-inch rule do", "when is the deadline", "does Alt 2 close road X", "how much would harvest increase"). false if it is rhetorical, a value judgment, a demand, or asks about information not in the record (e.g. "why do you hate the forest", "who's paying you off", "will you actually listen").

Return ONLY a JSON array, one object per numbered comment: [{"questions": [...]}, ...], SAME order, one entry per comment even if its questions array is empty. No prose.`

async function extractBatch(texts: string[]): Promise<Extracted[]> {
  const key = process.env.ANTHROPIC_API_KEY!
  const body = texts.map((t, i) => `#${i + 1}: ${t.replace(/\s+/g, ' ').slice(0, 1600)}`).join('\n\n')
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
    questions: Array.isArray(o?.questions) ? o.questions
      .filter((q: any) => q && typeof q.text === 'string' && q.text.trim())
      .map((q: any) => ({ text: String(q.text).trim(), type: (QTYPES as readonly string[]).includes(q.type) ? q.type : 'other', answerable: !!q.answerable })) : [],
  }))
}

async function main() {
  const corpus = JSON.parse(readFileSync(process.argv[2], 'utf-8')) as { comments: Comment[]; reported_total?: number }
  const comments = corpus.comments
  const out = process.argv[3]
  const labels = clusterLabels(comments.map(c => shingles(c.comment)), NEAR_DUP)
  const groups = new Map<number, number[]>()
  labels.forEach((l, i) => { const g = groups.get(l) || []; g.push(i); groups.set(l, g) })
  const clusters = [...groups.values()]
  const reps = clusters.map(idxs => idxs.slice().sort((a, b) => comments[b].comment.length - comments[a].comment.length)[0])
  console.log(`[cluster] ${comments.length} comments → ${clusters.length} distinct → extracting questions from ${reps.length} representatives`)

  const extracted: Extracted[] = []
  const B = 8
  for (let i = 0; i < reps.length; i += B) {
    const batch = reps.slice(i, i + B).map(idx => comments[idx].comment)
    try { extracted.push(...await extractBatch(batch)) }
    catch (e) { console.error(`  batch ${i} failed:`, (e as Error).message.slice(0, 120)); for (let k = 0; k < batch.length; k++) extracted.push({ questions: [] }) }
    if ((i + B) % 80 === 0 || i + B >= reps.length) console.log(`  …extracted ${Math.min(i + B, reps.length)}/${reps.length}`)
  }

  // Per-cluster aggregation. "voices" = distinct clusters; "volume" = cluster-size-weighted.
  let commentsWithQVoices = 0, commentsWithQVolume = 0
  let commentsWithAnswerableVoices = 0, commentsWithAnswerableVolume = 0
  let totalQVoices = 0, totalAnswerableVoices = 0
  const typeVoices: Record<string, number> = {}
  const allQuestions: { text: string; type: QType; weight: number }[] = [] // answerable only, weighted by cluster size
  clusters.forEach((idxs, ci) => {
    const size = idxs.length
    const qs = extracted[ci]?.questions || []
    const ans = qs.filter(q => q.answerable)
    if (qs.length) { commentsWithQVoices++; commentsWithQVolume += size }
    if (ans.length) { commentsWithAnswerableVoices++; commentsWithAnswerableVolume += size }
    totalQVoices += qs.length; totalAnswerableVoices += ans.length
    for (const q of qs) typeVoices[q.type] = (typeVoices[q.type] || 0) + 1
    for (const q of ans) allQuestions.push({ text: q.text, type: q.type, weight: size })
  })

  // Cluster the answerable questions themselves into distinct question-themes (loose shingle match).
  const qsh = allQuestions.map(q => shingles(q.text, 3))
  const qlabels = clusterLabels(qsh, 0.34)
  const qgroups = new Map<number, number[]>()
  qlabels.forEach((l, i) => { const g = qgroups.get(l) || []; g.push(i); qgroups.set(l, g) })
  const distinctQuestions = [...qgroups.values()].map(idxs => {
    const rep = idxs.slice().sort((a, b) => allQuestions[a].text.length - allQuestions[b].text.length)[Math.floor(idxs.length / 2)] // median-length rep
    const count = idxs.reduce((s, i) => s + allQuestions[i].weight, 0)
    return { text: allQuestions[rep].text, type: allQuestions[rep].type, count, distinctSources: idxs.length }
  }).sort((a, b) => b.count - a.count)

  const distinct = clusters.length
  console.log(`\n════ QUESTION LAYER ════`)
  console.log(`  distinct comments (voices):            ${distinct}`)
  console.log(`  …that embed ≥1 question:               ${commentsWithQVoices}  (${Math.round(commentsWithQVoices / distinct * 100)}% of voices; ${commentsWithQVolume} by volume)`)
  console.log(`  …that embed ≥1 ANSWERABLE question:    ${commentsWithAnswerableVoices}  (${Math.round(commentsWithAnswerableVoices / distinct * 100)}% of voices; ${commentsWithAnswerableVolume} by volume)`)
  console.log(`  total questions (voice-level):          ${totalQVoices}  · answerable: ${totalAnswerableVoices}`)
  console.log(`  distinct answerable question-themes:    ${distinctQuestions.length}`)
  console.log(`\n════ QUESTION TYPES (voice-level) ════`)
  Object.entries(typeVoices).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k.padEnd(22)} ${String(v).padStart(4)}`))
  console.log(`\n════ TOP DISTINCT ANSWERABLE QUESTIONS ════`)
  distinctQuestions.slice(0, 25).forEach((q, i) => console.log(`  ${String(i + 1).padStart(2)}. [${q.type}] ×${q.count}  ${q.text}`))

  writeFileSync(out, JSON.stringify({
    total: comments.length, distinct,
    commentsWithQVoices, commentsWithQVolume, commentsWithAnswerableVoices, commentsWithAnswerableVolume,
    totalQVoices, totalAnswerableVoices, typeVoices, distinctQuestions,
  }, null, 2))
  console.log(`\n✔ wrote → ${out}`)
}
main().catch(e => { console.error(e); process.exit(1) })
