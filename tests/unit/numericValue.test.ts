import { describe, it, expect } from 'vitest'
import { toNumericOrNull } from '@/lib/numericValue'

// toNumericOrNull is the client twin of the SQL numeric filter (sql/182:
// btrim + tolerant regex) and the field-type classifier (Number(v.trim())).
// These cases lock that three-way parity — the mismatch that produced the
// "No groups found." bug when a numeric field carried decorated values.
describe('toNumericOrNull — SQL/classifier parity', () => {
  it('accepts clean and tolerant numeric forms (what the classifier types numeric)', () => {
    expect(toNumericOrNull('5')).toBe(5)
    expect(toNumericOrNull(' 5')).toBe(5)      // stray leading space — the live bug
    expect(toNumericOrNull('5 ')).toBe(5)
    expect(toNumericOrNull('4.5')).toBe(4.5)
    expect(toNumericOrNull('.5')).toBe(0.5)
    expect(toNumericOrNull('5.')).toBe(5)
    expect(toNumericOrNull('1e3')).toBe(1000)
    expect(toNumericOrNull('-2')).toBe(-2)
    expect(toNumericOrNull(4)).toBe(4)
  })

  it('rejects non-numeric decoration (excluded by SQL and by Number())', () => {
    expect(toNumericOrNull('1,000')).toBeNull()   // parseFloat would wrongly return 1
    expect(toNumericOrNull('4.5abc')).toBeNull()  // parseFloat would wrongly return 4.5
    expect(toNumericOrNull('4/5')).toBeNull()
    expect(toNumericOrNull('4 stars')).toBeNull()
    expect(toNumericOrNull('★★★★')).toBeNull()
    expect(toNumericOrNull('Infinity')).toBeNull()
    expect(toNumericOrNull('')).toBeNull()
    expect(toNumericOrNull('   ')).toBeNull()
    expect(toNumericOrNull(null)).toBeNull()
    expect(toNumericOrNull(undefined)).toBeNull()
  })
})
