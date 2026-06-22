import { describe, it, expect } from 'vitest'
import { rankPrimaryDateField } from '@/lib/datasetUtils'
import type { SchemaFieldConfig } from '@/lib/analyzeTypes'

// Minimal date-field factory — only the fields the ranker reads.
function dateField(field: string, nonNullCount: number, distinct: number): SchemaFieldConfig {
  return {
    field,
    type: 'date',
    nonNullCount,
    values: Array.from({ length: distinct }, (_, i) => `2026-01-${String((i % 28) + 1).padStart(2, '0')}`),
  }
}

describe('rankPrimaryDateField', () => {
  it('returns undefined when there are no date fields', () => {
    const fields: SchemaFieldConfig[] = [
      { field: 'comment', type: 'open-ended' },
      { field: 'rating', type: 'numeric' },
    ]
    expect(rankPrimaryDateField(fields)).toBeUndefined()
  })

  it('prefers an analytical date over an operational one regardless of column order', () => {
    const fields = [
      dateField('updated_at', 1000, 200),   // operational, listed first
      dateField('submitted_at', 1000, 200), // analytical
    ]
    expect(rankPrimaryDateField(fields)).toBe('submitted_at')
  })

  it('breaks ties on fill rate when semantics match', () => {
    const fields = [
      dateField('created_at', 400, 50),
      dateField('event_date', 950, 50),
    ]
    expect(rankPrimaryDateField(fields)).toBe('event_date')
  })

  it('drops a constant column (single distinct value) as a time axis', () => {
    const fields = [
      dateField('imported_at', 1000, 1),    // constant — same value every row
      dateField('response_date', 600, 120),
    ]
    expect(rankPrimaryDateField(fields)).toBe('response_date')
  })

  it('falls back to a constant column only when every candidate is constant', () => {
    const fields = [dateField('imported_at', 1000, 1)]
    expect(rankPrimaryDateField(fields)).toBe('imported_at')
  })
})
