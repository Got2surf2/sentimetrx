// lib/recordings/coverage.ts
//
// Compute the post-analysis coverage report. Per docs/RECORDINGS.md § 3.6:
//   - per-agenda-topic extraction density (topics with 0 = flagged)
//   - per-minute extraction density (5+ minute gaps with 0 extractions = flagged)
//   - confidence histogram (bottom decile pulls auto-flags)
//
// Pure function — no I/O. Caller writes the result to recordings.coverage_report.

import type {
  NewExtraction,
  CoverageReport,
  QaSetupInputs,
  SetupInputs,
} from '@/lib/recordings/types'

export interface CoverageInput {
  setup_inputs: SetupInputs | Record<string, unknown>
  extractions: NewExtraction[]
  source_duration_sec: number | null
}

const GAP_THRESHOLD_SEC = 5 * 60          // ≥5 minutes with 0 extractions = gap flag
const HISTOGRAM_BUCKETS = 10              // 0.0-0.1, 0.1-0.2, ..., 0.9-1.0

export function computeCoverage(input: CoverageInput): CoverageReport {
  // Coverage describes Q&A extraction across the meeting. action_item rows are
  // synthesis-derived (confidence 0, no real time span, no topic) — counting
  // them pollutes the confidence histogram with a fake low-confidence spike and
  // inflates the totals. Only qa_pairs represent meeting coverage.
  const extractions = input.extractions.filter(e => e.unit_type === 'qa_pair')
  const agenda = topicsFromSetup(input.setup_inputs)

  return {
    per_topic: perTopic(extractions, agenda),
    per_minute_gaps: perMinuteGaps(extractions, input.source_duration_sec),
    confidence_histogram: confidenceHistogram(extractions),
    flagged_count: extractions.filter(e => e.flagged_for_review).length,
    total_extractions: extractions.length,
    computed_at: new Date().toISOString(),
  }
}

function topicsFromSetup(setup: SetupInputs | Record<string, unknown>): string[] {
  const qa = setup as Partial<QaSetupInputs>
  return Array.isArray(qa.agenda) ? qa.agenda : []
}

function perTopic(extractions: NewExtraction[], agenda: string[]): CoverageReport['per_topic'] {
  // Count by topic, reconciling agenda topics to extraction topics by a
  // NORMALIZED key (trim + lowercase). Extraction is topic-agnostic and the
  // curator emits *emergent* labels whose casing/whitespace drifts from the raw
  // agenda strings — so exact-equality matching split e.g. agenda "Project
  // timeline" (→ false ⚠️ "0 / flagged") from the real "Project Timeline" (9)
  // into two rows. Normalizing collapses them; we emit the canonical agenda
  // label and only append a topic in the second loop when it's genuinely absent
  // from the agenda after normalization. (docs/RECORDINGS.md §3.6 known issue 1)
  const norm = (t: string) => t.trim().toLowerCase()
  const counts = new Map<string, number>()
  for (const e of extractions) {
    const k = norm(e.topic ?? 'Other')
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const out: CoverageReport['per_topic'] = []
  const agendaKeys = new Set<string>()
  for (const topic of agenda) {
    const k = norm(topic)
    agendaKeys.add(k)
    const count = counts.get(k) ?? 0
    out.push({ topic, count, flagged: count === 0 })   // canonical agenda label
  }
  // Append emergent / non-agenda topics ("Other", etc.) once, keeping their
  // display casing, never flagged.
  const appended = new Set<string>()
  for (const e of extractions) {
    const label = e.topic ?? 'Other'
    const k = norm(label)
    if (agendaKeys.has(k) || appended.has(k)) continue
    appended.add(k)
    out.push({ topic: label, count: counts.get(k) ?? 0, flagged: false })
  }
  return out
}

function perMinuteGaps(
  extractions: NewExtraction[],
  durationSec: number | null,
): CoverageReport['per_minute_gaps'] {
  if (!durationSec || extractions.length === 0) return []
  const sorted = extractions
    .filter(e => typeof e.start_sec === 'number')
    .map(e => e.start_sec as number)
    .sort((a, b) => a - b)
  if (sorted.length === 0) return []

  const gaps: CoverageReport['per_minute_gaps'] = []
  let prev = 0
  for (const ts of sorted) {
    if (ts - prev >= GAP_THRESHOLD_SEC) {
      gaps.push({ start_sec: Math.round(prev), end_sec: Math.round(ts) })
    }
    prev = ts
  }
  // Tail gap from last extraction to end of audio.
  if (durationSec - prev >= GAP_THRESHOLD_SEC) {
    gaps.push({ start_sec: Math.round(prev), end_sec: Math.round(durationSec) })
  }
  return gaps
}

function confidenceHistogram(extractions: NewExtraction[]): CoverageReport['confidence_histogram'] {
  const buckets = new Array(HISTOGRAM_BUCKETS).fill(0) as number[]
  for (const e of extractions) {
    const c = typeof e.confidence === 'number' ? e.confidence : 0
    const idx = Math.min(HISTOGRAM_BUCKETS - 1, Math.max(0, Math.floor(c * HISTOGRAM_BUCKETS)))
    buckets[idx] += 1
  }
  return buckets.map((count, i) => ({
    bucket: `${(i / HISTOGRAM_BUCKETS).toFixed(1)}-${((i + 1) / HISTOGRAM_BUCKETS).toFixed(1)}`,
    count,
  }))
}
