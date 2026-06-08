import { describe, it, expect } from 'vitest'
import {
  sanitizeColumnName, mergeRowBatches, applySchema, computeFieldStats,
  autoDetectSchema, mergeSchemaStats,
  flattenCustomQuestions, flattenPsychographics, flattenDemographics, flattenUrlParams,
} from '@/lib/datasetUtils'
import type { SchemaConfig, DatasetRowBatch } from '@/lib/analyzeTypes'
import type { SurveyPayload, StudyConfig } from '@/lib/types'

const batch = (batch_index: number, rows: Record<string, unknown>[]): DatasetRowBatch => ({
  id: 'b' + batch_index, dataset_id: 'd', rows, row_count: rows.length,
  batch_index, source_ref: null, created_at: '2026-01-01',
})

describe('datasetUtils — column name + batch helpers', () => {
  it('sanitizeColumnName slugs, trims underscores, and caps length', () => {
    expect(sanitizeColumnName('Hello World!')).toBe('hello_world')
    expect(sanitizeColumnName('  Foo--Bar  ')).toBe('foo_bar')
    expect(sanitizeColumnName('___x___')).toBe('x')
    expect(sanitizeColumnName('a'.repeat(100)).length).toBe(64)
  })

  it('mergeRowBatches concatenates in batch_index order', () => {
    const merged = mergeRowBatches([batch(1, [{ id: 2 }]), batch(0, [{ id: 1 }])])
    expect(merged).toEqual([{ id: 1 }, { id: 2 }])
  })
})

describe('datasetUtils — computeFieldStats type detection', () => {
  it('detects numeric (non-unique) with min/max/avg', () => {
    const s = computeFieldStats('rating', [5, 4, 5, 4, 5, 3])
    expect(s.type).toBe('numeric')
    expect(s.min).toBe(3)
    expect(s.max).toBe(5)
  })

  it('detects id by name and by all-unique-numeric', () => {
    expect(computeFieldStats('id', ['a', 'b', 'c']).type).toBe('id')
    expect(computeFieldStats('order_no', [10, 11, 12, 13]).type).toBe('id') // unique numeric, n>3
  })

  it('detects categorical with a sorted distinct-value list', () => {
    const s = computeFieldStats('color', ['red', 'blue', 'red', 'green', 'blue'])
    expect(s.type).toBe('categorical')
    expect(s.values).toEqual(['blue', 'green', 'red'])
  })

  it('detects open-ended for long prose', () => {
    const s = computeFieldStats('comment', ['this is a genuinely long open ended comment about quality'])
    expect(s.type).toBe('open-ended')
  })

  it('returns ignore for all-empty columns', () => {
    const s = computeFieldStats('blank', [null, '', undefined])
    expect(s.type).toBe('ignore')
    expect(s.nonNullCount).toBe(0)
  })
})

describe('datasetUtils — schema detection & merging', () => {
  it('autoDetectSchema maps every column and flags the first open-ended as primary', () => {
    const schema = autoDetectSchema([
      { name: 'Alice', feedback: 'the product was wonderful and exceeded my expectations greatly' },
      { name: 'Bob', feedback: 'shipping was slow but support resolved everything in the end nicely' },
    ])
    expect(schema.fields.map(f => f.field)).toEqual(['name', 'feedback'])
    expect(schema.primaryTextField).toBe('feedback')
    expect(schema.autoDetected).toBe(true)
  })

  it('autoDetectSchema overrides date by column-name and tags sections by prefix', () => {
    const schema = autoDetectSchema([{ created_at: '2024-01-01', psycho_openness: 'high' }])
    const byField = Object.fromEntries(schema.fields.map(f => [f.field, f]))
    expect(byField['created_at'].type).toBe('date')
    expect(byField['psycho_openness'].section).toBe('psychographic')
  })

  it('autoDetectSchema on no rows returns an empty schema', () => {
    expect(autoDetectSchema([])).toEqual({ fields: [], autoDetected: true, version: 1 })
  })

  it('mergeSchemaStats unions categorical values and widens numeric range', () => {
    const schema: SchemaConfig = {
      fields: [
        { field: 'cat', type: 'categorical', values: ['a'] },
        { field: 'n', type: 'numeric', min: 5, max: 10 },
      ],
      autoDetected: false, version: 1,
    }
    const merged = mergeSchemaStats(schema, [{ cat: 'b', n: 1 }, { cat: 'c', n: 20 }])
    const byField = Object.fromEntries(merged.fields.map(f => [f.field, f]))
    expect(byField['cat'].values).toEqual(['a', 'b', 'c'])
    expect(byField['n'].min).toBe(1)
    expect(byField['n'].max).toBe(20)
  })
})

describe('datasetUtils — applySchema', () => {
  it('hides flagged fields, coerces numerics, and relabels output keys', () => {
    const schema: SchemaConfig = {
      fields: [
        { field: 'secret', type: 'open-ended', hidden: true },
        { field: 'n', type: 'numeric' },
        { field: 'name', type: 'categorical', label: 'Full Name' },
      ],
      autoDetected: false, version: 1,
    }
    const out = applySchema([{ secret: 'x', n: '5', name: 'Alice' }], schema)
    expect(out[0]).not.toHaveProperty('secret')
    expect(out[0].n).toBe(5)
    expect(out[0].full_name).toBe('Alice')
  })
})

describe('datasetUtils — survey payload flatteners', () => {
  it('prefixes psychographic / demographic / url-param keys', () => {
    const payload = {
      psychographics: { Openness: 'high' },
      demographics: { Age: '30' },
      urlParams: { utm_source: 'email' },
    } as unknown as SurveyPayload
    expect(flattenPsychographics(payload)).toEqual({ psycho_openness: 'high' })
    expect(flattenDemographics(payload)).toEqual({ demo_age: '30' })
    expect(flattenUrlParams(payload)).toEqual({ url_utm_source: 'email' })
    expect(flattenPsychographics(null)).toEqual({})
  })

  it('flattenCustomQuestions slugs labels and joins array answers', () => {
    const payload = { customAnswers: { q1: 'yes', q2: ['a', 'b'] } } as unknown as SurveyPayload
    const config = {
      questions: [
        { id: 'q1', prompt: 'Q One' },
        { id: 'q2', exportLabel: 'Q Two' },
      ],
    } as unknown as StudyConfig
    expect(flattenCustomQuestions(payload, config)).toEqual({ q_one: 'yes', q_two: 'a, b' })
  })
})
