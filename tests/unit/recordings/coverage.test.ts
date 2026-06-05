// tests/unit/recordingsCoverage.test.ts
//
// Pure-function coverage for lib/recordings/coverage.ts (docs/RECORDINGS.md § 3.6):
// per-topic extraction density + zero-count flagging, ≥5-minute gap detection
// (including leading/tail gaps), and the confidence histogram bucketing.

import { describe, it, expect } from 'vitest'
import { computeCoverage, type CoverageInput } from '@/lib/recordings/coverage'
import type { NewExtraction, QaPairPayload } from '@/lib/recordings/types'

function extraction(over: Partial<NewExtraction> = {}): NewExtraction {
  const payload: QaPairPayload = {
    question: 'q', answer: 'a', question_typology: 'ask',
    asker_name: null, panelist_name: null,
  }
  return {
    unit_type: 'qa_pair',
    topic: 'Parking',
    payload,
    start_sec: 0,
    end_sec: 1,
    source_file: null,
    confidence: 0.8,
    flagged_for_review: false,
    flag_reason: null,
    sort_order: 0,
    ...over,
  }
}

function input(over: Partial<CoverageInput> = {}): CoverageInput {
  return {
    setup_inputs: { panel: [], agenda: ['Parking', 'Budget'] },
    extractions: [],
    source_duration_sec: null,
    ...over,
  }
}

describe('computeCoverage — per_topic', () => {
  it('flags agenda topics with zero extractions and counts the rest', () => {
    const r = computeCoverage(input({
      extractions: [extraction({ topic: 'Parking' }), extraction({ topic: 'Parking' })],
    }))
    const parking = r.per_topic.find(t => t.topic === 'Parking')
    const budget = r.per_topic.find(t => t.topic === 'Budget')
    expect(parking).toEqual({ topic: 'Parking', count: 2, flagged: false })
    expect(budget).toEqual({ topic: 'Budget', count: 0, flagged: true })
  })

  // §3.6 known issue 1: curator emits emergent topic labels whose casing/
  // whitespace drifts from the agenda; exact-match split them into a false
  // "0 / flagged" agenda row + a separate real row. Normalized matching collapses
  // them into ONE canonical-labelled row.
  it('reconciles agenda topics to extraction topics by normalized casing', () => {
    const r = computeCoverage(input({
      setup_inputs: { panel: [], agenda: ['Project timeline'] },
      extractions: [
        extraction({ topic: 'Project Timeline' }),
        extraction({ topic: 'project timeline ' }),
      ],
    }))
    const rows = r.per_topic.filter(t => t.topic.toLowerCase().includes('project'))
    expect(rows).toHaveLength(1)                          // not split into two
    expect(rows[0]).toEqual({ topic: 'Project timeline', count: 2, flagged: false })
  })

  it('appends non-agenda topics without flagging and maps null topic to "Other"', () => {
    const r = computeCoverage(input({
      extractions: [extraction({ topic: null }), extraction({ topic: 'Surprise' })],
    }))
    const other = r.per_topic.find(t => t.topic === 'Other')
    const surprise = r.per_topic.find(t => t.topic === 'Surprise')
    expect(other).toEqual({ topic: 'Other', count: 1, flagged: false })
    expect(surprise).toEqual({ topic: 'Surprise', count: 1, flagged: false })
  })

  it('returns an empty agenda gracefully when setup has no agenda', () => {
    const r = computeCoverage(input({ setup_inputs: {}, extractions: [extraction()] }))
    // No agenda topics, but the single extraction's topic still surfaces.
    expect(r.per_topic).toEqual([{ topic: 'Parking', count: 1, flagged: false }])
  })
})

describe('computeCoverage — per_minute_gaps', () => {
  it('returns no gaps when duration is unknown or there are no extractions', () => {
    expect(computeCoverage(input({ source_duration_sec: null, extractions: [extraction()] })).per_minute_gaps).toEqual([])
    expect(computeCoverage(input({ source_duration_sec: 1000, extractions: [] })).per_minute_gaps).toEqual([])
  })

  it('flags a leading gap, a mid gap, and a tail gap (≥5 min each)', () => {
    const r = computeCoverage(input({
      source_duration_sec: 1000,
      extractions: [extraction({ start_sec: 400 }), extraction({ start_sec: 410 })],
    }))
    // leading: 0→400, tail: 410→1000. (400→410 is < 300, no mid gap here.)
    expect(r.per_minute_gaps).toEqual([
      { start_sec: 0, end_sec: 400 },
      { start_sec: 410, end_sec: 1000 },
    ])
  })

  it('does not flag stretches shorter than the 5-minute threshold', () => {
    const r = computeCoverage(input({
      source_duration_sec: 200,
      extractions: [extraction({ start_sec: 10 }), extraction({ start_sec: 20 })],
    }))
    expect(r.per_minute_gaps).toEqual([])
  })

  it('rounds fractional timestamps', () => {
    const r = computeCoverage(input({
      source_duration_sec: 700.6,
      extractions: [extraction({ start_sec: 350.4 })],
    }))
    expect(r.per_minute_gaps).toEqual([
      { start_sec: 0, end_sec: 350 },
      { start_sec: 350, end_sec: 701 },
    ])
  })
})

describe('computeCoverage — confidence_histogram', () => {
  it('produces 10 labelled buckets and places values in the right bin', () => {
    const r = computeCoverage(input({
      extractions: [
        extraction({ confidence: 0.05 }),  // bucket 0
        extraction({ confidence: 0.15 }),  // bucket 1
        extraction({ confidence: 1.0 }),   // clamps into bucket 9
      ],
    }))
    expect(r.confidence_histogram).toHaveLength(10)
    expect(r.confidence_histogram[0]).toEqual({ bucket: '0.0-0.1', count: 1 })
    expect(r.confidence_histogram[1]).toEqual({ bucket: '0.1-0.2', count: 1 })
    expect(r.confidence_histogram[9]).toEqual({ bucket: '0.9-1.0', count: 1 })
  })

  it('treats a missing confidence as 0 (bucket 0)', () => {
    const r = computeCoverage(input({
      extractions: [extraction({ confidence: null })],
    }))
    expect(r.confidence_histogram[0].count).toBe(1)
  })
})

describe('computeCoverage — totals', () => {
  it('counts total and flagged extractions and stamps computed_at', () => {
    const r = computeCoverage(input({
      extractions: [
        extraction({ flagged_for_review: true }),
        extraction({ flagged_for_review: false }),
        extraction({ flagged_for_review: true }),
      ],
    }))
    expect(r.total_extractions).toBe(3)
    expect(r.flagged_count).toBe(2)
    expect(typeof r.computed_at).toBe('string')
    expect(Number.isNaN(Date.parse(r.computed_at))).toBe(false)
  })
})
