/* eslint-disable */
// NEPA Phase 1b — substantive classification + issue coding + stance, via Claude
// Haiku. Reuses the lexical near-dup clustering (deterministic) and classifies
// ONE representative per cluster (copies share content), then propagates to
// members — so ~500 distinct texts cost ~50 batched calls, not 732. Produces the
// bottom of the funnel (distinct → substantive) + the issue/stance breakdown.
//
// Run: node --import tsx scripts/oneoff/_nepa_code.ts <corpus.json> <out.json>

import { readFileSync, writeFileSync } from 'node:fs'
for (const line of readFileSync('.env.local', 'utf-8').split('\n')) {
  const mm = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (mm && !process.env[mm[1]]) process.env[mm[1]] = mm[2].replace(/^["']|["']$/g, '')
}

const NEAR_DUP = 0.60, K = 5
type Comment = { letterid: string; first: string | null; last: string | null; organization: string | null; comment: string }

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

const ISSUES = ['access_roads', 'timber_logging', 'old_growth_large_trees', 'grazing', 'fire_fuels', 'salvage', 'wildlife', 'economics_jobs', 'tribal', 'recreation', 'water_fish', 'restoration_pace', 'process_standards', 'other']
type Coded = { substantive: boolean; issues: string[]; stance: 'oppose' | 'support' | 'mixed' | 'unclear' }

const SYS = `You code public comments on the USDA Forest Service Blue Mountains Forest Plan Revision Draft EIS. The proposed action (Alternative 2) would substantially INCREASE commercial logging and ELIMINATE the ~30-year "21-inch rule" that limits cutting large/old trees.

For each comment return JSON with:
- "substantive": true if it raises a specific fact, concern, or requested change tied to a plan element or resource (agencies must respond to these); false if it is a bare position or form-letter sentiment with no specific substance.
- "issues": array from EXACTLY these keys — ${ISSUES.join(', ')} — pick all that clearly apply (usually 1-3).
- "stance": "oppose" (opposes the plan / more logging / removing the 21-inch rule), "support" (favors more logging/active management), "mixed", or "unclear".

Return ONLY a JSON array, one object per numbered comment, in order. No prose.`

async function codeBatch(texts: string[]): Promise<Coded[]> {
  const key = process.env.ANTHROPIC_API_KEY!
  const body = texts.map((t, i) => `#${i + 1}: ${t.replace(/\s+/g, ' ').slice(0, 1400)}`).join('\n\n')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 2048, system: SYS, messages: [{ role: 'user', content: body }] }),
  })
  if (!res.ok) throw new Error('anthropic ' + res.status + ': ' + (await res.text()).slice(0, 200))
  const data = await res.json()
  let txt = (data.content?.[0]?.text || '').trim()
  const a = txt.indexOf('['), b = txt.lastIndexOf(']'); if (a >= 0 && b > a) txt = txt.slice(a, b + 1)
  const arr = JSON.parse(txt)
  return arr.map((o: any) => ({ substantive: !!o.substantive, issues: Array.isArray(o.issues) ? o.issues.filter((x: string) => ISSUES.includes(x)) : [], stance: ['oppose', 'support', 'mixed', 'unclear'].includes(o.stance) ? o.stance : 'unclear' }))
}

async function main() {
  const corpus = JSON.parse(readFileSync(process.argv[2], 'utf-8')) as { comments: Comment[]; reported_total?: number }
  const comments = corpus.comments
  const submitted = corpus.reported_total || comments.length // live CARA total (grows daily)
  const out = process.argv[3]
  const labels = clusterLabels(comments.map(c => shingles(c.comment)))
  const groups = new Map<number, number[]>()
  labels.forEach((l, i) => { const g = groups.get(l) || []; g.push(i); groups.set(l, g) })
  const clusters = [...groups.values()]
  // representative = longest member
  const reps = clusters.map(idxs => idxs.slice().sort((a, b) => comments[b].comment.length - comments[a].comment.length)[0])
  console.log(`[cluster] ${comments.length} comments → ${clusters.length} distinct → coding ${reps.length} representatives`)

  const coded: Coded[] = []
  const B = 10
  for (let i = 0; i < reps.length; i += B) {
    const batch = reps.slice(i, i + B).map(idx => comments[idx].comment)
    try { coded.push(...await codeBatch(batch)) }
    catch (e) { console.error(`  batch ${i} failed:`, (e as Error).message.slice(0, 120)); for (let k = 0; k < batch.length; k++) coded.push({ substantive: false, issues: [], stance: 'unclear' }) }
    if ((i + B) % 50 === 0 || i + B >= reps.length) console.log(`  …coded ${Math.min(i + B, reps.length)}/${reps.length}`)
  }

  // Aggregate. "voices" = distinct clusters; "volume" = weighted by cluster size.
  const issueVoices: Record<string, number> = {}, issueVolume: Record<string, number> = {}
  const issueSubstantive: Record<string, number> = {}
  let substantiveVoices = 0, substantiveVolume = 0
  const stanceVoices: Record<string, number> = { oppose: 0, support: 0, mixed: 0, unclear: 0 }
  clusters.forEach((idxs, ci) => {
    const c = coded[ci]; const size = idxs.length
    if (c.substantive) { substantiveVoices++; substantiveVolume += size }
    stanceVoices[c.stance]++
    for (const iss of c.issues) {
      issueVoices[iss] = (issueVoices[iss] || 0) + 1
      issueVolume[iss] = (issueVolume[iss] || 0) + size
      if (c.substantive) issueSubstantive[iss] = (issueSubstantive[iss] || 0) + 1
    }
  })

  const total = comments.length, distinct = clusters.length
  const held = Math.max(0, submitted - total)
  console.log(`\n════ FUNNEL ════`)
  console.log(`  ${submitted}   submitted (CARA)`)
  console.log(`  ${held.toString().padStart(3)}   held / not yet posted`)
  console.log(`  ${total}   available & analyzed`)
  console.log(`  ${distinct}   distinct voices        (near-dup removed ${total - distinct} copies, ${Math.round((total - distinct) / total * 100)}%)`)
  console.log(`  ${substantiveVoices}   substantive voices     (${Math.round(substantiveVoices / distinct * 100)}% of distinct — the must-respond set)`)
  console.log(`\n════ TOP ISSUES (by distinct voices) ════`)
  Object.entries(issueVoices).sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, v]) =>
    console.log(`  ${k.padEnd(22)} voices ${String(v).padStart(3)} · volume ${String(issueVolume[k]).padStart(3)} · substantive ${String(issueSubstantive[k] || 0).padStart(3)}`))
  console.log(`\n════ STANCE (distinct voices) ════`)
  console.log(`  oppose ${stanceVoices.oppose} · support ${stanceVoices.support} · mixed ${stanceVoices.mixed} · unclear ${stanceVoices.unclear}`)

  writeFileSync(out, JSON.stringify({ funnel: { submitted, held, available: total, distinct, substantiveVoices, substantiveVolume }, issueVoices, issueVolume, issueSubstantive, stanceVoices }, null, 2))
  console.log(`\n✔ wrote → ${out}`)
}
main().catch(e => { console.error(e); process.exit(1) })
