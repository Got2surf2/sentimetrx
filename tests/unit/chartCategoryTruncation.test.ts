import { describe, it, expect } from 'vitest'
import { topCategoryKeys } from '@/components/analyze/ChartsModule'

// topCategoryKeys is the shared subset selector for every capped categorical
// chart (bar, treemap, bubbles, waterfall, funnel; stacked/average bars and
// the crosstab use the same top-by-count rule inline). The subset must ALWAYS
// be the top-N by count — the 2026-09-03 audit found charts slicing after
// smartOrder (alphabetical for nominal fields), silently dropping the largest
// categories while the title badge claimed "Showing top N of M".

describe('topCategoryKeys', () => {
  it('keeps the biggest categories, not the alphabetically first', () => {
    const counts: Record<string, number> = {
      'Aardvark Cafe': 1, 'Beacon Diner': 2, 'Cactus Grill': 3,
      'Zebra Lounge': 900, 'Yardhouse': 800, 'Waterfront': 700,
    }
    const { keys, total } = topCategoryKeys(counts, 3)
    expect(keys).toEqual(['Zebra Lounge', 'Yardhouse', 'Waterfront'])
    expect(total).toBe(6)
  })

  it('breaks count ties alphabetically for a stable order', () => {
    const { keys } = topCategoryKeys({ b: 5, a: 5, c: 5 }, 2)
    expect(keys).toEqual(['a', 'b'])
  })

  it('returns everything (count-desc) when under the cap', () => {
    const { keys, total } = topCategoryKeys({ low: 1, high: 10 }, 30)
    expect(keys).toEqual(['high', 'low'])
    expect(total).toBe(2)
  })

  it('handles empty counts', () => {
    const { keys, total } = topCategoryKeys({}, 30)
    expect(keys).toEqual([])
    expect(total).toBe(0)
  })
})
