import { describe, it, expect } from 'vitest'
import { serializedFiltersEqual } from '@/lib/filterUtils'
import type { SerializedFilters } from '@/lib/filterUtils'

const cat = (values: string[], mode: 'include' | 'exclude' = 'include', excludeBlanks = false): SerializedFilters =>
  ({ region: { type: 'cat', mode, values, excludeBlanks } })

describe('serializedFiltersEqual (saved-view dirty flag)', () => {
  it('empty vs empty', () => {
    expect(serializedFiltersEqual({}, {})).toBe(true)
  })

  it('cat values are order-insensitive (Set-derived arrays)', () => {
    expect(serializedFiltersEqual(cat(['a', 'b', 'c']), cat(['c', 'a', 'b']))).toBe(true)
  })

  it('different cat values diverge', () => {
    expect(serializedFiltersEqual(cat(['a', 'b']), cat(['a', 'b', 'c']))).toBe(false)
  })

  it('different mode diverges', () => {
    expect(serializedFiltersEqual(cat(['a'], 'include'), cat(['a'], 'exclude'))).toBe(false)
  })

  it('different excludeBlanks diverges', () => {
    expect(serializedFiltersEqual(cat(['a'], 'include', false), cat(['a'], 'include', true))).toBe(false)
  })

  it('extra field on one side diverges', () => {
    const a: SerializedFilters = { ...cat(['a']) }
    const b: SerializedFilters = { ...cat(['a']), score: { type: 'range', values: [0, 5], includeBlanks: true } }
    expect(serializedFiltersEqual(a, b)).toBe(false)
  })

  it('range equality + divergence', () => {
    const a: SerializedFilters = { score: { type: 'range', values: [0, 5], includeBlanks: true } }
    const same: SerializedFilters = { score: { type: 'range', values: [0, 5], includeBlanks: true } }
    const diff: SerializedFilters = { score: { type: 'range', values: [0, 6], includeBlanks: true } }
    expect(serializedFiltersEqual(a, same)).toBe(true)
    expect(serializedFiltersEqual(a, diff)).toBe(false)
  })

  it('daterange equality + divergence', () => {
    const a: SerializedFilters = { d: { type: 'daterange', values: [1000, 2000], includeBlanks: false } }
    const same: SerializedFilters = { d: { type: 'daterange', values: [1000, 2000], includeBlanks: false } }
    const diff: SerializedFilters = { d: { type: 'daterange', values: [1000, 2001], includeBlanks: false } }
    expect(serializedFiltersEqual(a, same)).toBe(true)
    expect(serializedFiltersEqual(a, diff)).toBe(false)
  })

  it('same field name, different type diverges', () => {
    const a: SerializedFilters = { x: { type: 'range', values: [0, 1], includeBlanks: true } }
    const b: SerializedFilters = { x: { type: 'daterange', values: [0, 1], includeBlanks: true } }
    expect(serializedFiltersEqual(a, b)).toBe(false)
  })
})
