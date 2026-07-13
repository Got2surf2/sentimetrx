import { describe, it, expect } from 'vitest'
import { applyFilters, deserializeFilters, type SerializedFilters } from '@/lib/filterUtils'

// Perf review §7 Brief F: app/api/share/analytics/route.ts carried a bespoke
// per-row `rowMatchesFilter` copy of the canonical applyFilters semantics. It
// was swept onto the shared path (deserializeFilters + applyFilters). This test
// is the regression guard: the ORIGINAL bespoke logic is inlined below as the
// oracle, and we assert the canonical path produces byte-identical row sets
// across the full cat/range/daterange matrix — so neither implementation can
// silently drift from the other in future.

type SerFilter = SerializedFilters[string]
function bespokeRowMatches(data: Record<string, unknown>, filters: SerializedFilters): boolean {
  return Object.entries(filters).every(([field, f]: [string, SerFilter]) => {
    const val = data[field]
    if (f.type === 'cat') {
      const isBlank = val == null || String(val).trim() === ''
      if (isBlank) return !f.excludeBlanks
      const str = String(val)
      if (f.mode === 'exclude') return !f.values.includes(str)
      return f.values.includes(str)
    }
    if (f.type === 'range') {
      const n = parseFloat(String(val ?? ''))
      if (isNaN(n)) return f.includeBlanks !== false
      return n >= f.values[0] && n <= f.values[1]
    }
    if (f.type === 'daterange') {
      if (val == null || String(val).trim() === '') return f.includeBlanks !== false
      const d = new Date(String(val))
      if (isNaN(d.getTime())) return f.includeBlanks !== false
      const ts = d.getTime()
      return ts >= f.values[0] && ts <= f.values[1]
    }
    return true
  })
}

const ROWS: Record<string, unknown>[] = [
  { city: 'Austin', score: '5', when: '2024-03-15' },
  { city: 'Dallas', score: '2', when: '2024-06-01' },
  { city: '', score: '', when: '' },                       // blanks across the board
  { city: 'Austin', score: '1.19E+2', when: 'not-a-date' },// sci-notation numeric, unparseable date
  { city: 'Houston', score: '4', when: '2023-12-31' },
  { city: null, score: null, when: null },                 // null across the board
]

const D0 = new Date('2024-01-01').getTime()
const D1 = new Date('2024-12-31').getTime()

const CASES: { name: string; sf: SerializedFilters }[] = [
  { name: 'cat include', sf: { city: { type: 'cat', mode: 'include', values: ['Austin'], excludeBlanks: false } } },
  { name: 'cat exclude', sf: { city: { type: 'cat', mode: 'exclude', values: ['Dallas'], excludeBlanks: false } } },
  { name: 'cat exclude + excludeBlanks', sf: { city: { type: 'cat', mode: 'exclude', values: ['Dallas'], excludeBlanks: true } } },
  { name: 'cat include + excludeBlanks', sf: { city: { type: 'cat', mode: 'include', values: ['Austin'], excludeBlanks: true } } },
  { name: 'range (incl blanks)', sf: { score: { type: 'range', values: [2, 5], includeBlanks: true } } },
  { name: 'range (excl blanks)', sf: { score: { type: 'range', values: [2, 5], includeBlanks: false } } },
  { name: 'range covers sci-notation 119', sf: { score: { type: 'range', values: [100, 200], includeBlanks: false } } },
  { name: 'daterange (incl blanks)', sf: { when: { type: 'daterange', values: [D0, D1], includeBlanks: true } } },
  { name: 'daterange (excl blanks)', sf: { when: { type: 'daterange', values: [D0, D1], includeBlanks: false } } },
  { name: 'empty filters', sf: {} },
]

describe('share/analytics filter parity (canonical vs deleted bespoke)', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const canonical = applyFilters(ROWS, deserializeFilters(c.sf))
      const oracle = Object.keys(c.sf).length === 0 ? ROWS : ROWS.filter(r => bespokeRowMatches(r, c.sf))
      expect(canonical).toEqual(oracle)
    })
  }
})
