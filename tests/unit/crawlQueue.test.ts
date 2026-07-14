// P2d — pure queue/cursor math for the resumable super crawl.
import { describe, it, expect } from 'vitest'
import { takeBatch, mergeDiscovered, crawlIsDone } from '@/lib/botKnowledge/crawlQueue'

describe('takeBatch', () => {
  it('takes up to batchSize unvisited URLs and keeps the rest', () => {
    const { batch, rest } = takeBatch(['a', 'b', 'c', 'd'], [], 2, 300, 0)
    expect(batch).toEqual(['a', 'b'])
    expect(rest).toEqual(['c', 'd'])
  })
  it('skips already-visited queue entries', () => {
    const { batch, rest } = takeBatch(['a', 'b', 'c'], ['a'], 2, 300, 0)
    expect(batch).toEqual(['b', 'c'])
    expect(rest).toEqual([])
  })
  it('respects the remaining page budget', () => {
    // cap 5, already crawled 4 → only room for 1 more.
    const { batch, rest } = takeBatch(['a', 'b', 'c'], [], 20, 5, 4)
    expect(batch).toEqual(['a'])
    expect(rest).toEqual(['b', 'c'])
  })
  it('dedups repeated queue entries', () => {
    const { batch } = takeBatch(['a', 'a', 'b'], [], 5, 300, 0)
    expect(batch).toEqual(['a', 'b'])
  })
})

describe('mergeDiscovered', () => {
  it('appends only new links, skipping visited + already-queued', () => {
    const q = mergeDiscovered(['a'], ['x'], ['a', 'x', 'b', 'c'], 300, 0)
    expect(q).toEqual(['a', 'b', 'c'])
  })
  it('caps the queue at 2× remaining budget', () => {
    const q = mergeDiscovered([], [], ['a', 'b', 'c', 'd', 'e'], 2, 0) // room = 2 → max 4
    expect(q).toHaveLength(4)
  })
  it('stops growing when the budget is spent', () => {
    const q = mergeDiscovered(['a', 'b'], [], ['c', 'd'], 3, 3) // remaining 0 → maxQueue 0
    expect(q).toEqual(['a', 'b'])
  })
})

describe('crawlIsDone', () => {
  it('is done when the queue empties', () => {
    expect(crawlIsDone(0, 50, 300)).toBe(true)
  })
  it('is done when the page cap is reached', () => {
    expect(crawlIsDone(40, 300, 300)).toBe(true)
  })
  it('keeps running with work left under the cap', () => {
    expect(crawlIsDone(40, 120, 300)).toBe(false)
  })
})
