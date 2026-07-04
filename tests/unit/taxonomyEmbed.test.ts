import { describe, it, expect } from 'vitest'
import { buildFieldBlock, blockAxisSubs, isReservedRowKey, stripReservedRowKeys } from '@/lib/taxonomyEmbed'
import type { Assertion } from '@/lib/taxonomyVocabulary'

const A = (axis: string, sub: string, severity = 'normal', polarity = 'neg'): Assertion =>
  ({ axis, sub, polarity, confidence: 0.9, severity } as Assertion)

describe('buildFieldBlock', () => {
  it('projects assertions into per-axis sorted sub arrays, omitting empty axes', () => {
    const block = buildFieldBlock(
      [A('product', 'steak'), A('product', 'apps'), A('touchpoint', 'server'), A('product', 'steak')],
      { version: 'v3', by: 'keyword', model: 'keyword-tier' },
    )
    expect(block.a.product).toEqual(['apps', 'steak'])   // deduped + sorted
    expect(block.a.touchpoint).toEqual(['server'])
    expect(block.a).not.toHaveProperty('beverage')       // empty axes omitted
    expect(block.as).toHaveLength(4)                     // assertions kept verbatim
    expect(block.v).toBe('v3')
    expect(block.by).toBe('keyword')
    expect(block.m).toBe('keyword-tier')
    expect(typeof block.at).toBe('string')
  })

  it('collects alert/crisis subs into al', () => {
    const block = buildFieldBlock(
      [A('attribute', 'pests', 'alert'), A('attribute', 'food safety', 'crisis'), A('product', 'steak', 'normal')],
      { version: 'v3', by: 'keyword', model: 'keyword-tier' },
    )
    expect(block.al).toEqual(['food safety', 'pests'])
  })

  it('empty assertions → tagless block (converges the pending nudge)', () => {
    const block = buildFieldBlock([], { version: 'v3', by: 'keyword', model: 'keyword-tier' })
    expect(block.a).toEqual({})
    expect(block.al).toEqual([])
    expect(block.as).toEqual([])
  })
})

describe('blockAxisSubs', () => {
  it('tolerates missing blocks and axes', () => {
    expect(blockAxisSubs(null, 'product')).toEqual([])
    expect(blockAxisSubs(undefined, 'product')).toEqual([])
    const block = buildFieldBlock([A('product', 'steak')], { version: 'v3', by: 'k', model: 'm' })
    expect(blockAxisSubs(block, 'product')).toEqual(['steak'])
    expect(blockAxisSubs(block, 'beverage')).toEqual([])
  })
})

describe('reserved row keys', () => {
  it('_tx is reserved; ordinary keys are not', () => {
    expect(isReservedRowKey('_tx')).toBe(true)
    expect(isReservedRowKey('review_text')).toBe(false)
    expect(isReservedRowKey('_collection_label')).toBe(false)  // runtime-injected, not blob-reserved
  })

  it('stripReservedRowKeys removes _tx without touching other keys (and copies)', () => {
    const row = { review_text: 'great', rating: 5, _tx: { f: {} } }
    const out = stripReservedRowKeys(row)
    expect(out).toEqual({ review_text: 'great', rating: 5 })
    expect(row._tx).toBeDefined()                       // original not mutated
  })

  it('stripReservedRowKeys is a no-op passthrough when nothing reserved', () => {
    const row = { a: 1 }
    expect(stripReservedRowKeys(row)).toBe(row)         // same reference, no copy
  })
})
