import { describe, it, expect } from 'vitest'
import {
  slugify, eligibleEntityFields, buildEntityQuery, buildThemeQuery,
} from '@/lib/entityFilter'
import type { SchemaConfig } from '@/lib/analyzeTypes'

// Pure read-side helpers. slugify must stay byte-for-byte equivalent to the
// SQL public.slugify() (it's the entity-catalog join key), so these cases
// double as a regression guard against drift.

describe('entityFilter — slugify', () => {
  it('lowercases, strips one leading article, and underscores runs', () => {
    expect(slugify('The Quick Brown Fox')).toBe('quick_brown_fox')
    expect(slugify('A cat')).toBe('cat')
    expect(slugify('an Apple')).toBe('apple')
  })

  it('strips apostrophes and collapses punctuation', () => {
    expect(slugify("O'Brien's Pub")).toBe('obriens_pub')
    expect(slugify('  Hello!!  World  ')).toBe('hello_world')
  })

  it('handles empty / nullish input', () => {
    expect(slugify('')).toBe('')
    expect(slugify(undefined as unknown as string)).toBe('')
  })
})

describe('entityFilter — eligibleEntityFields', () => {
  it('keeps open-ended fields not opted out of extraction', () => {
    const schema = {
      fields: [
        { field: 'comment', type: 'open-ended' },
        { field: 'rating', type: 'numeric' },
        { field: 'notes', type: 'open-ended', entityExtraction: false },
      ],
      autoDetected: true, version: 1,
    } as SchemaConfig
    expect(eligibleEntityFields(schema)).toEqual(['comment'])
  })

  it('returns [] for non-schema input', () => {
    expect(eligibleEntityFields(null)).toEqual([])
    expect(eligibleEntityFields({})).toEqual([])
  })
})

describe('entityFilter — query construction', () => {
  it('buildEntityQuery quotes + dedupes canonical and aliases', () => {
    expect(buildEntityQuery('Acme', ['Acme Inc', 'acme'])).toBe('"Acme" OR "Acme Inc"')
    expect(buildEntityQuery('Bob', ['', 'B'])).toBe('"Bob"') // sub-2-char variants dropped
    expect(buildEntityQuery('A', [])).toBe('')               // canonical too short
  })

  it('buildThemeQuery ORs keyword phrases or returns null', () => {
    expect(buildThemeQuery(['wait', 'slow service'])).toBe('"wait" OR "slow service"')
    expect(buildThemeQuery([])).toBeNull()
    expect(buildThemeQuery(['a'])).toBeNull()  // all sub-2-char
  })
})
