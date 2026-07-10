/* eslint-disable */
// NEPA Phase 1a — dedup / near-dup clustering + template-delta on the real
// Blue Mountains corpus. Uses a LEXICAL near-duplicate method (word-shingle
// Jaccard union-find) — deterministic, free, no API, and exactly right for
// form-letter detection ("these are literally the same words"). For the big
// clusters it extracts the shared TEMPLATE and each member's unique DELTA (the
// personal paragraph appended to a form letter). Prints real funnel numbers.
//
// Run: node --import tsx scripts/oneoff/_nepa_analyze.ts <corpus.json> <out.json>

import { readFileSync, writeFileSync } from 'node:fs'

const NEAR_DUP = 0.60 // shingle-Jaccard threshold: "same campaign / near-duplicate"
const EXACT = 0.98    // effectively identical
const K = 5           // shingle size (word 5-grams)

type Comment = { letterid: string; first: string | null; last: string | null; organization: string | null; comment: string }

const normalize = (t: string) => (t || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

function shingles(text: string): Set<string> {
  const w = normalize(text).split(' ').filter(Boolean)
  const s = new Set<string>()
  if (w.length < K) { if (w.length) s.add(w.join(' ')); return s }
  for (let i = 0; i + K <= w.length; i++) s.add(w.slice(i, i + K).join(' '))
  return s
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  const [small, big] = a.size < b.size ? [a, b] : [b, a]
  let inter = 0
  for (const x of small) if (big.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

// Lexical union-find over shingle-Jaccard. Length-bucket prefilter keeps it fast.
function cluster(shs: Set<string>[], thr: number): number[] {
  const n = shs.length
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    // cheap prefilter: sizes within 3x (near-dups have comparable shingle counts)
    const si = shs[i].size, sj = shs[j].size
    if (!si || !sj) continue
    if (Math.max(si, sj) > 3 * Math.min(si, sj)) continue
    if (jaccard(shs[i], shs[j]) >= thr) union(i, j)
  }
  return parent.map((_, i) => find(i))
}

const sentences = (t: string) => t.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 12)
const normSent = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

// Template = sentences shared by a majority of members; delta = the rest.
function templateDelta(members: Comment[]) {
  const counts = new Map<string, { raw: string; n: number }>()
  for (const m of members) for (const s of sentences(m.comment)) {
    const k = normSent(s); if (!k) continue
    const e = counts.get(k) || { raw: s, n: 0 }; e.n++; counts.set(k, e)
  }
  const maj = Math.max(2, Math.ceil(members.length * 0.5))
  const template = [...counts.values()].filter(e => e.n >= maj).map(e => e.raw)
  const templateSet = new Set([...counts.entries()].filter(([, e]) => e.n >= maj).map(([k]) => k))
  const deltas = members.map(m => ({
    name: [m.first, m.last].filter(Boolean).join(' ') || m.organization || m.letterid,
    delta: sentences(m.comment).filter(s => !templateSet.has(normSent(s))),
  })).filter(d => d.delta.length)
  return { template, templateSentenceCount: template.length, membersWithDelta: deltas.length, deltas }
}

async function main() {
  const corpusPath = process.argv[2], outPath = process.argv[3]
  const { comments } = JSON.parse(readFileSync(corpusPath, 'utf-8')) as { comments: Comment[] }
  console.log(`[corpus] ${comments.length} comments`)

  const shs = comments.map(c => shingles(c.comment))
  const labels = cluster(shs, NEAR_DUP)

  const groups = new Map<number, number[]>()
  labels.forEach((lab, i) => { const g = groups.get(lab) || []; g.push(i); groups.set(lab, g) })
  const clusters = [...groups.values()].sort((a, b) => b.length - a.length)

  const multi = clusters.filter(c => c.length > 1)
  const inMulti = multi.reduce((s, c) => s + c.length, 0)
  const singletons = clusters.filter(c => c.length === 1).length
  const uniqueVoices = clusters.length // one canonical per cluster
  console.log(`\n─── DEDUP / CAMPAIGN STRUCTURE (cosine ≥ ${NEAR_DUP}) ───`)
  console.log(`total comments:        ${comments.length}`)
  console.log(`distinct clusters:     ${clusters.length}  (= unique "voices")`)
  console.log(`singletons:            ${singletons}`)
  console.log(`multi-member clusters: ${multi.length}  covering ${inMulti} comments (${Math.round(inMulti / comments.length * 100)}%)`)
  console.log(`redundant copies:      ${comments.length - uniqueVoices}  (${Math.round((comments.length - uniqueVoices) / comments.length * 100)}% of the pile is duplication)`)
  console.log(`\nTop campaigns:`)
  const campaignReport = multi.slice(0, 10).map(idxs => {
    const members = idxs.map(i => comments[i])
    const rep = members.slice().sort((a, b) => b.comment.length - a.comment.length)[0]
    const td = templateDelta(members)
    console.log(`  ×${idxs.length.toString().padStart(3)}  “${rep.comment.replace(/\s+/g, ' ').slice(0, 80)}…”  (${td.membersWithDelta} personalized)`)
    return { size: idxs.length, sample: rep.comment.slice(0, 400), personalized: td.membersWithDelta, templateSentenceCount: td.templateSentenceCount,
      deltaExamples: td.deltas.filter(d => d.delta.join(' ').length > 40).slice(0, 3).map(d => ({ name: d.name, delta: d.delta.join(' ').slice(0, 300) })) }
  })

  // A concrete template-delta showcase from the biggest personalized campaign.
  const showcase = campaignReport.find(c => c.deltaExamples.length) || null
  if (showcase) {
    console.log(`\n─── TEMPLATE-DELTA SHOWCASE (campaign of ${showcase.size}) ───`)
    console.log(`TEMPLATE (shared): “${showcase.sample.slice(0, 160)}…”`)
    for (const d of showcase.deltaExamples) console.log(`  + ${d.name}: “${d.delta.slice(0, 160)}…”`)
  }

  writeFileSync(outPath, JSON.stringify({
    total: comments.length, nearDupThreshold: NEAR_DUP,
    distinctClusters: clusters.length, singletons, multiMemberClusters: multi.length,
    commentsInMultiClusters: inMulti, redundantCopies: comments.length - uniqueVoices,
    campaigns: campaignReport,
  }, null, 2))
  console.log(`\n✔ wrote analysis → ${outPath}`)
}

main().catch(e => { console.error(e); process.exit(1) })
