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
  const { extractions } = input
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
  // Count by topic across the supplied agenda. Topics not in the agenda
  // (like "Other") are also counted but never marked flagged.
  const counts = new Map<string, number>()
  for (const e of extractions) {
    const t = e.topic ?? 'Other'
    counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  const out: CoverageReport['per_topic'] = []
  for (const topic of agenda) {
    const count = counts.get(topic) ?? 0
    out.push({ topic, count, flagged: count === 0 })
  }
  // Append non-agenda topics ("Other", anything else) without flagging.
  for (const [topic, count] of Array.from(counts.entries())) {
    if (!agenda.includes(topic)) out.push({ topic, count, flagged: false })
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
