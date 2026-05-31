/* eslint-disable */
// scripts/pm1-smoke.ts
//
// Phase 1 #11 / Phase 4 #25-27 smoke test — runs the Claude analytical pass
// against the stored PM-1 transcript and diffs the extracted Q&A pairs
// against the PM-1 PDF ground truth. Skips ASR + Sandbox (those have their
// own bills); this loop is for prompt + curator calibration.
//
// Why a script and not a vitest test: the inputs are large fixtures the user
// keeps out of the repo (transcript JSON from the real Whisper/Deepgram pass,
// PDF-derived ground truth). Setting fixture paths via env keeps PM-1's
// content out of version control. Cost per run ≈ $1 (Opus extract + Sonnet
// curator on a ~3hr transcript).
//
// Inputs:
//   PM1_TRANSCRIPT_PATH       path to JSON [TranscriptSegment, ...]
//   PM1_SETUP_PATH            path to JSON QaSetupInputs
//   PM1_GROUND_TRUTH_PATH     path to JSON { pairs: GroundTruthPair[] }
//   PM1_OUT_DIR               where to write the diff report (defaults to ./)
//   ANTHROPIC_API_KEY         standard
//
// Run: node_modules/.bin/tsx scripts/pm1-smoke.ts
//
// Match algorithm: greedy by question-text Jaccard ≥ 0.4. Topic / asker /
// panelist / typology accuracy are computed across matched pairs only.

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import path from 'path'

// .env.local loader (matches the pattern in scripts/_ingest_nowocats_*.ts).
const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '')
}

import { analyzeRecording } from '@/lib/recordings/analyze'
import type {
  NewExtraction,
  QaPairPayload,
  QaSetupInputs,
  QuestionTypology,
  TranscriptSegment,
} from '@/lib/recordings/types'

interface GroundTruthPair {
  question: string
  answer: string
  topic: string
  asker_name?: string | null
  panelist_name?: string | null
  typology: QuestionTypology
}

interface MatchedPair {
  ground_truth: GroundTruthPair
  extracted: NewExtraction
  similarity: number
}

interface SmokeReport {
  counts: {
    ground_truth: number
    extracted: number
    matched: number
    unmatched_ground_truth: number    // recall miss
    unmatched_extracted: number       // precision miss
  }
  similarity: { precision: number; recall: number; f1: number; threshold: number }
  per_field_accuracy_on_matched: {
    topic: number
    asker: number
    panelist: number
    typology: number
  }
  per_topic_recall: Array<{ topic: string; expected: number; matched: number }>
  cost_cents: number
  notes: string[]
}

const SIMILARITY_THRESHOLD = 0.4

async function main() {
  const transcriptPath = required('PM1_TRANSCRIPT_PATH')
  const setupPath = required('PM1_SETUP_PATH')
  const groundTruthPath = required('PM1_GROUND_TRUTH_PATH')
  const outDir = process.env.PM1_OUT_DIR || process.cwd()

  const transcript = readJson<TranscriptSegment[]>(transcriptPath)
  const setup = readJson<QaSetupInputs>(setupPath)
  const groundTruth = readJson<{ pairs: GroundTruthPair[] }>(groundTruthPath)

  if (!Array.isArray(transcript) || transcript.length === 0) {
    throw new Error(`${transcriptPath} must be a non-empty array of TranscriptSegment`)
  }
  if (!groundTruth?.pairs?.length) {
    throw new Error(`${groundTruthPath} must be { pairs: GroundTruthPair[] }`)
  }

  log(`Running analyzeRecording: ${transcript.length} segments, ${groundTruth.pairs.length} ground-truth pairs`)

  const result = await analyzeRecording({
    recording_id: 'pm1-smoke',
    org_id: 'pm1-smoke',
    session_type: 'qa',
    setup_inputs: setup,
    transcript,
  })

  log(`Extracted ${result.extractions.length} pairs (${result.total_cost_cents}¢ Claude)`)

  const report = score(groundTruth.pairs, result.extractions, result.total_cost_cents)

  const printable = formatReport(report)
  console.log('\n' + printable)

  mkdirSync(outDir, { recursive: true })
  const summaryPath = path.join(outDir, `pm1-smoke-${stamp()}.json`)
  const diffPath = path.join(outDir, `pm1-smoke-${stamp()}.md`)
  writeFileSync(summaryPath, JSON.stringify({ report, extractions: result.extractions }, null, 2))
  writeFileSync(diffPath, sideBySide(groundTruth.pairs, result.extractions, report))

  log(`Wrote ${summaryPath}`)
  log(`Wrote ${diffPath}`)

  // Non-zero exit if F1 below soak target so this can be called from a CI gate later.
  if (report.similarity.f1 < 0.9) {
    log(`F1 ${report.similarity.f1.toFixed(2)} below 0.90 target — calibration iteration needed.`)
    process.exit(2)
  }
}

// ── Scoring ──────────────────────────────────────────────────────────────────

function score(
  groundTruth: GroundTruthPair[],
  extracted: NewExtraction[],
  cost_cents: number,
): SmokeReport {
  const matched: MatchedPair[] = []
  const usedExtractedIdx = new Set<number>()
  const notes: string[] = []

  for (const gt of groundTruth) {
    let bestIdx = -1
    let bestSim = 0
    for (let i = 0; i < extracted.length; i++) {
      if (usedExtractedIdx.has(i)) continue
      const ex = extracted[i]
      const exPayload = ex.payload as QaPairPayload
      const sim = jaccard(normalize(gt.question), normalize(exPayload.question))
      if (sim > bestSim) {
        bestSim = sim
        bestIdx = i
      }
    }
    if (bestIdx >= 0 && bestSim >= SIMILARITY_THRESHOLD) {
      usedExtractedIdx.add(bestIdx)
      matched.push({ ground_truth: gt, extracted: extracted[bestIdx], similarity: bestSim })
    }
  }

  const tp = matched.length
  const fn = groundTruth.length - tp
  const fp = extracted.length - tp
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0

  const fieldHits = { topic: 0, asker: 0, panelist: 0, typology: 0 }
  for (const m of matched) {
    const ex = m.extracted.payload as QaPairPayload
    if (norm(m.extracted.topic) === norm(m.ground_truth.topic)) fieldHits.topic++
    if (norm(ex.asker_name) === norm(m.ground_truth.asker_name)) fieldHits.asker++
    if (norm(ex.panelist_name) === norm(m.ground_truth.panelist_name)) fieldHits.panelist++
    if (ex.question_typology === m.ground_truth.typology) fieldHits.typology++
  }

  const per_topic: SmokeReport['per_topic_recall'] = []
  const expectedByTopic = new Map<string, number>()
  const matchedByTopic = new Map<string, number>()
  for (const gt of groundTruth) {
    expectedByTopic.set(gt.topic, (expectedByTopic.get(gt.topic) ?? 0) + 1)
  }
  for (const m of matched) {
    const t = m.ground_truth.topic
    matchedByTopic.set(t, (matchedByTopic.get(t) ?? 0) + 1)
  }
  for (const [topic, expected] of Array.from(expectedByTopic.entries())) {
    per_topic.push({ topic, expected, matched: matchedByTopic.get(topic) ?? 0 })
  }
  per_topic.sort((a, b) => a.matched / a.expected - b.matched / b.expected)

  // Flagged-pair sanity check — curator should be flagging the false-positives, not the matches.
  const flaggedMatches = matched.filter(m => m.extracted.flagged_for_review).length
  if (flaggedMatches > 0) {
    notes.push(`${flaggedMatches}/${matched.length} matched pairs were curator-flagged — tighten curator prompt.`)
  }
  const unflaggedExtras = extracted
    .map((e, i) => ({ e, i }))
    .filter(x => !usedExtractedIdx.has(x.i) && !x.e.flagged_for_review).length
  if (unflaggedExtras > 0) {
    notes.push(`${unflaggedExtras} unmatched extractions were NOT curator-flagged — loosen curator detection or tighten extraction.`)
  }

  return {
    counts: {
      ground_truth: groundTruth.length,
      extracted: extracted.length,
      matched: tp,
      unmatched_ground_truth: fn,
      unmatched_extracted: fp,
    },
    similarity: { precision, recall, f1, threshold: SIMILARITY_THRESHOLD },
    per_field_accuracy_on_matched: {
      topic: tp > 0 ? fieldHits.topic / tp : 0,
      asker: tp > 0 ? fieldHits.asker / tp : 0,
      panelist: tp > 0 ? fieldHits.panelist / tp : 0,
      typology: tp > 0 ? fieldHits.typology / tp : 0,
    },
    per_topic_recall: per_topic,
    cost_cents,
    notes,
  }
}

// ── Formatting ───────────────────────────────────────────────────────────────

function formatReport(r: SmokeReport): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`
  const lines: string[] = []
  lines.push(`PM-1 smoke — ${r.counts.ground_truth} ground-truth pairs, ${r.counts.extracted} extracted, ${r.counts.matched} matched`)
  lines.push(``)
  lines.push(`  precision ${pct(r.similarity.precision)}  recall ${pct(r.similarity.recall)}  F1 ${pct(r.similarity.f1)}  (sim ≥ ${r.similarity.threshold})`)
  lines.push(``)
  lines.push(`  matched-pair field accuracy:`)
  lines.push(`    topic     ${pct(r.per_field_accuracy_on_matched.topic)}`)
  lines.push(`    asker     ${pct(r.per_field_accuracy_on_matched.asker)}`)
  lines.push(`    panelist  ${pct(r.per_field_accuracy_on_matched.panelist)}`)
  lines.push(`    typology  ${pct(r.per_field_accuracy_on_matched.typology)}`)
  lines.push(``)
  lines.push(`  weakest topics (lowest recall first):`)
  for (const t of r.per_topic_recall.slice(0, 5)) {
    lines.push(`    ${t.matched}/${t.expected}  ${t.topic}`)
  }
  if (r.notes.length > 0) {
    lines.push(``)
    lines.push(`  notes:`)
    for (const n of r.notes) lines.push(`    - ${n}`)
  }
  lines.push(``)
  lines.push(`  cost: ${(r.cost_cents / 100).toFixed(2)} USD`)
  return lines.join('\n')
}

function sideBySide(gt: GroundTruthPair[], ext: NewExtraction[], r: SmokeReport): string {
  const out: string[] = ['# PM-1 smoke diff', '']
  out.push(`Ground truth: ${gt.length}  ·  Extracted: ${ext.length}  ·  F1: ${(r.similarity.f1 * 100).toFixed(1)}%`)
  out.push('')
  out.push('## Ground truth vs best match')
  out.push('')
  const usedExtractedIdx = new Set<number>()
  for (const g of gt) {
    let bestIdx = -1
    let bestSim = 0
    for (let i = 0; i < ext.length; i++) {
      if (usedExtractedIdx.has(i)) continue
      const sim = jaccard(normalize(g.question), normalize((ext[i].payload as QaPairPayload).question))
      if (sim > bestSim) { bestSim = sim; bestIdx = i }
    }
    out.push(`### "${truncate(g.question, 80)}"`)
    out.push(`- expected topic: \`${g.topic}\`, asker: \`${g.asker_name ?? '-'}\`, typology: \`${g.typology}\``)
    if (bestIdx >= 0 && bestSim >= SIMILARITY_THRESHOLD) {
      usedExtractedIdx.add(bestIdx)
      const ep = ext[bestIdx].payload as QaPairPayload
      out.push(`- ✅ matched (sim ${(bestSim * 100).toFixed(0)}%): "${truncate(ep.question, 80)}"`)
      out.push(`  - extracted topic: \`${ext[bestIdx].topic}\`, asker: \`${ep.asker_name ?? '-'}\`, typology: \`${ep.question_typology}\`${ext[bestIdx].flagged_for_review ? ' ⚠ flagged' : ''}`)
    } else {
      out.push(`- ❌ no extracted match above ${(SIMILARITY_THRESHOLD * 100).toFixed(0)}%${bestIdx >= 0 ? ` (best was ${(bestSim * 100).toFixed(0)}%)` : ''}`)
    }
    out.push('')
  }
  out.push('## Extracted pairs with no ground-truth match')
  out.push('')
  for (let i = 0; i < ext.length; i++) {
    if (usedExtractedIdx.has(i)) continue
    const ep = ext[i].payload as QaPairPayload
    out.push(`- ${ext[i].flagged_for_review ? '⚠ flagged' : '🟡 unflagged'} · topic \`${ext[i].topic}\` · typology \`${ep.question_typology}\``)
    out.push(`  Q: ${truncate(ep.question, 120)}`)
    out.push(`  A: ${truncate(ep.answer, 120)}`)
  }
  return out.join('\n')
}

// ── String helpers ───────────────────────────────────────────────────────────

function normalize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2),
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let inter = 0
  for (const w of Array.from(a)) if (b.has(w)) inter++
  const union = a.size + b.size - inter
  return union > 0 ? inter / union : 0
}

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…'
}

// ── IO helpers ───────────────────────────────────────────────────────────────

function readJson<T>(p: string): T {
  return JSON.parse(readFileSync(path.resolve(p), 'utf-8')) as T
}

function required(name: string): string {
  const v = process.env[name]
  if (!v) {
    log(`Missing ${name}. Set it to the path of the fixture file.`)
    process.exit(1)
  }
  return v
}

function log(msg: string) {
  console.error(`[pm1-smoke] ${msg}`)
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

main().catch(err => {
  log(`FAILED: ${err instanceof Error ? err.stack : String(err)}`)
  process.exit(1)
})
