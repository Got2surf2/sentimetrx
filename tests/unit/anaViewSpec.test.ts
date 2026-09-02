// set_view filter conversion: Ana's constrained specs become the app's live
// Filters shape; malformed entries drop silently (a partial view beats a
// failed handoff); open-ended ranges get sentinel bounds.
import { describe, it, expect } from 'vitest'
import { viewSpecFilters } from '@/lib/anaViewSpec'

describe('viewSpecFilters', () => {
  it('converts cat and range specs into live filters', () => {
    const f = viewSpecFilters([
      { field: 'State', type: 'cat', values: ['CA', 'AZ'] },
      { field: 'age', type: 'range', max: 35 },
    ])
    expect(f.State.type).toBe('cat')
    expect(Array.from((f.State as { values: Set<string> }).values)).toEqual(['CA', 'AZ'])
    expect((f.State as { mode: string }).mode).toBe('include')
    expect(f.age.type).toBe('range')
    expect((f.age as { values: [number, number] }).values[1]).toBe(35)
  })

  it('drops malformed entries without failing the handoff', () => {
    const f = viewSpecFilters([
      { field: '', type: 'cat', values: ['x'] },
      { field: 'ok', type: 'cat', values: [] },
      { field: 'range-no-bounds', type: 'range' },
      'not-an-object',
      { field: 'good', type: 'cat', values: ['y'] },
    ])
    expect(Object.keys(f)).toEqual(['good'])
  })
})
