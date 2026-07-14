// Substantive/"usefulness" flag — the versioned scorer + the ingest stamp.
// scoreUsefulness is the single source of truth (v1 = isSubstantiveText);
// stampRowSubstantive is what every dataset_rows_flat insert path applies, and
// what the backfill mirrors, so its per-field map + version must stay exact.
import { describe, it, expect } from 'vitest'
import {
  scoreUsefulness,
  substantiveFieldsFor,
  stampRowSubstantive,
  USEFULNESS_VERSION,
} from '@/lib/usefulness'

describe('scoreUsefulness (v1 = isSubstantiveText)', () => {
  it('passes real feedback, fails non-answers', () => {
    expect(scoreUsefulness('The service was slow and the food came out cold')).toBe(true)
    expect(scoreUsefulness('cold food slow service dirty table')).toBe(true) // >=5 words
    expect(scoreUsefulness('Nothing')).toBe(false)
    expect(scoreUsefulness('N/A')).toBe(false)
    expect(scoreUsefulness('all good')).toBe(false)
  })
})

describe('substantiveFieldsFor', () => {
  it('keeps only the true keys among the given fields', () => {
    const data = { MOST: 'loved the atmosphere and staff', LEAST: 'N/A', rating: '5' }
    expect(substantiveFieldsFor(data, ['MOST', 'LEAST'])).toEqual({ MOST: true })
  })
  it('returns an empty map when nothing scores', () => {
    expect(substantiveFieldsFor({ a: 'no', b: '' }, ['a', 'b'])).toEqual({})
  })
})

describe('stampRowSubstantive (ingest stamp)', () => {
  it('scores every non-_ field, stamps the version, preserves the row', () => {
    const row = {
      dataset_id: 'd1',
      row_index: 7,
      data: {
        MOST: 'the servers were attentive and kind',
        LEAST: 'Nothing',
        _tx: { f: {} }, // reserved — must be ignored
      },
    }
    const out = stampRowSubstantive(row)
    expect(out.substantive).toEqual({ MOST: true })
    expect(out.substantive_v).toBe(USEFULNESS_VERSION)
    // original fields intact
    expect(out.dataset_id).toBe('d1')
    expect(out.row_index).toBe(7)
    expect(out.data).toBe(row.data)
  })

  it('preserves extra row keys like dedup_key (reviewSync path)', () => {
    const out = stampRowSubstantive({ dataset_id: 'd', row_index: 0, data: { text: 'x' }, dedup_key: 'k' })
    expect(out.dedup_key).toBe('k')
    expect(out.substantive).toEqual({})
  })
})
