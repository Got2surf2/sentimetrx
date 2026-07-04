// Tests for lib/townhallAnalytics.computeSessionAnalytics — the session
// detail analytics pipeline extracted from the legacy route and now shared
// with the new-substrate adapter. Load-bearing semantics: seed themes count
// AI-tagged turns first and supplement with keyword hits, organic themes
// match keywords first, sentiment_score is preferred with lexicon backfill,
// and time bucketing pins to the caller's bucket or auto-selects.

import { describe, it, expect } from 'vitest'
import { computeSessionAnalytics, type AnalyticsTurn } from '@/lib/townhallAnalytics'

const T = (over: Partial<AnalyticsTurn>): AnalyticsTurn => ({
  user_message: null, user_message_en: null, theme_id: null,
  created_at: '2026-07-01T10:00:00Z', skipped: false,
  sentiment: null, sentiment_score: null,
  ...over,
})

const THEMES = [
  { id: 'th-parking', label: 'Parking', source: 'guide', state: 'active', keywords: ['parking', 'garage'], sentiment: null },
  { id: 'th-organic', label: 'Sidewalks', source: 'auto_detected', state: 'active', keywords: ['sidewalk', 'crosswalk'], sentiment: null },
  { id: 'th-dismissed', label: 'Noise', source: 'guide', state: 'dismissed', keywords: ['noise'], sentiment: null },
]

const TURNS: AnalyticsTurn[] = [
  T({ user_message: 'The parking garage is always full and terrible.', theme_id: 'th-parking', created_at: '2026-07-01T10:00:00Z', sentiment_score: -0.6 }),
  T({ user_message: 'I love the new garage lighting, great work.', theme_id: null, created_at: '2026-07-01T10:20:00Z', sentiment_score: 0.7 }),
  T({ user_message: 'Sidewalk near the school is cracked and unsafe.', theme_id: null, created_at: '2026-07-01T11:05:00Z' }),
  T({ user_message: 'More crosswalk signals please.', theme_id: 'th-organic', created_at: '2026-07-01T11:40:00Z', sentiment_score: 0.1 }),
  T({ user_message: 'This is a skipped one.', skipped: true }),
  T({ user_message: null, user_message_en: null }),
]

describe('computeSessionAnalytics', () => {
  const { enrichedThemes, analytics } = computeSessionAnalytics({ turns: TURNS, themes: THEMES })

  it('seed theme counts AI-tagged turns and supplements with untagged keyword hits', () => {
    const parking = enrichedThemes.find(t => t.id === 'th-parking')
    // 1 tagged turn; the untagged "garage lighting" text matches a keyword
    // and lands in quotes (supplement) without inflating response_count.
    expect(parking.response_count).toBe(1)
    expect(parking.match_count).toBe(1)
    expect(parking.example_quotes.length).toBe(2)
    expect(parking.quote_matches.some((q: { match: string }) => q.match === 'AI-assigned')).toBe(true)
    expect(parking.quote_matches.some((q: { match: string }) => q.match.startsWith('keyword:'))).toBe(true)
    expect(parking.top_keywords.map((k: { word: string }) => k.word)).toContain('parking')
  })

  it('organic theme counts keyword matches plus untagged AI-tagged turns', () => {
    const organic = enrichedThemes.find(t => t.id === 'th-organic')
    // "Sidewalk near the school" (keyword) + "More crosswalk signals"
    // (keyword, also tagged) — counted once each.
    expect(organic.match_count).toBe(2)
    expect(organic.response_count).toBe(2)
  })

  it('skipped and empty turns are excluded from totals', () => {
    expect(analytics.total_responses).toBe(4)
  })

  it('sentiment trend prefers stored scores and backfills missing ones', () => {
    expect(analytics.sentiment_trend.length).toBe(4)
    expect(analytics.sentiment_trend[0].score).toBe(-0.6)     // stored
    expect(analytics.sentiment_trend[1].score).toBe(0.7)      // stored
    expect(typeof analytics.sentiment_trend[2].score).toBe('number') // backfilled from lexicon
    const last = analytics.sentiment_trend[3]
    expect(last.cumulative).toBeCloseTo((analytics.sentiment_trend.reduce((s, p) => s + p.score, 0)) / 4, 1)
  })

  it('dismissed themes are excluded from time series but still enriched', () => {
    expect(analytics.topic_frequency.map(t => t.theme_id)).not.toContain('th-dismissed')
    expect(enrichedThemes.find(t => t.id === 'th-dismissed')).toBeTruthy()
  })

  it('buckets responses over time (auto: hour for a 2h span)', () => {
    expect(analytics.time_bucket).toBe('hour')
    const total = analytics.responses_over_time.reduce((s, b) => s + b.count, 0)
    expect(total).toBe(4)
    expect(analytics.responses_over_time.length).toBeGreaterThanOrEqual(2)
  })

  it('honors a pinned bucket param', () => {
    const pinned = computeSessionAnalytics({ turns: TURNS, themes: THEMES, bucketParam: 'day' })
    expect(pinned.analytics.time_bucket).toBe('day')
    expect(pinned.analytics.responses_over_time.length).toBe(1)
  })

  it('sentiment breakdown covers all responses', () => {
    const b = analytics.sentiment_breakdown
    expect(b.positive + b.negative + b.mixed + b.neutral).toBe(4)
  })

  it('empty session returns a well-formed shell', () => {
    const empty = computeSessionAnalytics({ turns: [], themes: THEMES })
    expect(empty.analytics.total_responses).toBe(0)
    expect(empty.analytics.sentiment_trend).toEqual([])
    expect(empty.enrichedThemes.length).toBe(3)
    expect(empty.enrichedThemes[0].example_quotes).toEqual([])
  })
})
