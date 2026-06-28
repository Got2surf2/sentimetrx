// Tests for Ask Ana's context formatter (lib/anaContext.ts). The load-bearing
// case for the cross-input "project preview": a COLLECTION pools rows from
// town-hall (recording) and agent (bot) members and formats them under
// source='collection' — the generic branch must label both shapes, not dump
// plumbing fields.

import { describe, it, expect } from 'vitest'
import { getSourceLabel, formatRowsForContext, TEXT_TRUNCATE } from '@/lib/anaContext'

describe('getSourceLabel', () => {
  it('labels recording and bot sources distinctly', () => {
    expect(getSourceLabel('recording')).toBe('town hall Q&A exchanges')
    expect(getSourceLabel('bot')).toBe('agent conversation turns')
  })
  it('uses a neutral label for a mixed collection (not "survey responses")', () => {
    expect(getSourceLabel('collection')).toBe('responses')
  })
})

describe('formatRowsForContext — recording (town hall Q&A) rows', () => {
  const row = { extraction_id: 'x1', response_text: 'q → a', question: 'When does Phase 2 start?', answer: 'Q3 of next year.', topic: 'Timeline', typology: 'ask', asker: 'Maria', panelist: 'PW Director', sentiment: 'neutral', confidence: 0.9, flagged: 'no', start_sec: 12 }

  it('formats as a labeled Q&A line', () => {
    const out = formatRowsForContext([row], 'recording')
    expect(out).toContain('Topic: Timeline')
    expect(out).toContain('Asker: Maria')
    expect(out).toContain('Answered by: PW Director')
    expect(out).toContain('Q: When does Phase 2 start?')
    expect(out).toContain('A: Q3 of next year.')
  })
  it('drops internal/bookkeeping fields', () => {
    const out = formatRowsForContext([row], 'recording')
    expect(out).not.toContain('extraction_id')
    expect(out).not.toContain('response_text')
    expect(out).not.toContain('confidence')
    expect(out).not.toContain('start_sec')
  })
  it('surfaces non-ask typology (commentary) but hides plain ask', () => {
    expect(formatRowsForContext([{ ...row, typology: 'commentary' }], 'recording')).toContain('Type: commentary')
    expect(formatRowsForContext([row], 'recording')).not.toContain('Type: ask')
  })
})

describe('formatRowsForContext — bot (agent turn) rows', () => {
  const row = { session_id: 's1', turn_number: 4, bot_message: 'How can I help?', user_message: 'We need a crosswalk on 5th.', sentiment: 'negative', sentiment_score: -0.6 }
  it('formats as an Agent/User exchange', () => {
    const out = formatRowsForContext([row], 'bot')
    expect(out).toContain('Agent: How can I help?')
    expect(out).toContain('User: We need a crosswalk on 5th.')
    expect(out).toContain('Sentiment: negative')
  })
  it('drops session/turn bookkeeping', () => {
    const out = formatRowsForContext([row], 'bot')
    expect(out).not.toContain('session_id')
    expect(out).not.toContain('turn_number')
    expect(out).not.toContain('sentiment_score')
  })
})

describe('formatRowsForContext — mixed collection (the project preview)', () => {
  it('formats both town-hall and agent rows coherently in one pool', () => {
    const rows = [
      { question: 'Budget for the rec center?', answer: 'Approved for FY26.', topic: 'Funding', typology: 'ask', asker: 'Tom' },
      { bot_message: 'What brings you in?', user_message: 'The trail extension is great.', sentiment: 'positive' },
    ]
    const out = formatRowsForContext(rows, 'collection').split('\n')
    expect(out[0]).toContain('Q: Budget for the rec center?')
    expect(out[0]).toContain('Topic: Funding')
    expect(out[1]).toContain('Agent: What brings you in?')
    expect(out[1]).toContain('User: The trail extension is great.')
  })
})

describe('formatRowsForContext — fallbacks', () => {
  it('returns "(no data)" for empty input', () => {
    expect(formatRowsForContext([], 'collection')).toBe('(no data)')
  })
  it('dumps unknown-shape rows minus noise fields', () => {
    const out = formatRowsForContext([{ rating: 5, review_text: 'Loved it', row_index: 7 }], 'google_reviews')
    expect(out).toContain('rating: 5')
    expect(out).toContain('review_text: Loved it')
    expect(out).not.toContain('row_index')
  })
  it('truncates long text fields', () => {
    const long = 'x'.repeat(TEXT_TRUNCATE + 50)
    const out = formatRowsForContext([{ question: long, answer: 'ok' }], 'recording')
    expect(out).toContain('...')
    expect(out.length).toBeLessThan(long.length + 100)
  })
})
