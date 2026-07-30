import { describe, expect, it } from 'vitest'
import { buildAttribution } from '@/lib/agentStudy'

const open = (source?: string | null, medium?: string | null, campaign?: string | null) => ({ source, medium, campaign })

describe('buildAttribution', () => {
  it('groups opens and conversations on the (source, medium, campaign) tuple', () => {
    const rows = buildAttribution(
      [open('postcard', 'qr', 'sr436'), open('postcard', 'qr', 'sr436'), open('meeting', 'qr', 'sr436')],
      [open('postcard', 'qr', 'sr436')],
    )
    expect(rows).toHaveLength(2)
    const postcard = rows.find(r => r.source === 'postcard')!
    expect(postcard.opens).toBe(2)
    expect(postcard.conversations).toBe(1)
    expect(postcard.conversionPct).toBe(50)
  })

  it('treats distinct campaigns under one source as separate buckets', () => {
    const rows = buildAttribution([open('postcard', 'qr', 'sr436'), open('postcard', 'qr', 'us441')], [])
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r.campaign).sort()).toEqual(['sr436', 'us441'])
  })

  // Reconciliation: a breakdown whose parts don't sum to the whole is worse
  // than no breakdown, so untagged traffic gets its own row rather than being
  // dropped.
  it('keeps untagged traffic as its own row so columns reconcile to the total', () => {
    const rows = buildAttribution([open('postcard'), open(null, null, null), open()], [open(null, null, null)])
    const untagged = rows.find(r => !r.source && !r.medium && !r.campaign)!
    expect(untagged.opens).toBe(2)
    expect(untagged.conversations).toBe(1)
    expect(rows.reduce((n, r) => n + r.opens, 0)).toBe(3)
  })

  it('normalizes blank and whitespace-only tags to the untagged bucket', () => {
    const rows = buildAttribution([open('', '   ', null), open(null, null, null)], [])
    expect(rows).toHaveLength(1)
    expect(rows[0].opens).toBe(2)
    expect(rows[0].source).toBeNull()
  })

  it('trims surrounding whitespace so " qr " and "qr" are one bucket', () => {
    const rows = buildAttribution([open('postcard', ' qr '), open('postcard', 'qr')], [])
    expect(rows).toHaveLength(1)
    expect(rows[0].medium).toBe('qr')
    expect(rows[0].opens).toBe(2)
  })

  it('sorts busiest-first by opens, then conversations', () => {
    const rows = buildAttribution(
      [open('a'), open('b'), open('b'), open('c'), open('c')],
      [open('c'), open('c'), open('c')],
    )
    expect(rows.map(r => r.source)).toEqual(['c', 'b', 'a'])
  })

  // A blocked/lost beacon can leave a bucket with conversations but no opens.
  // Printing 140% (or dividing by zero) reads as a bug to whoever sees it.
  it('reports no rate when a bucket has conversations but zero opens', () => {
    const rows = buildAttribution([], [open('email')])
    expect(rows[0].opens).toBe(0)
    expect(rows[0].conversations).toBe(1)
    expect(rows[0].conversionPct).toBeNull()
  })

  it('caps the rate at 100% when conversations exceed opens', () => {
    const rows = buildAttribution([open('email')], [open('email'), open('email')])
    expect(rows[0].conversionPct).toBe(100)
  })

  it('returns an empty list when the agent has no traffic at all', () => {
    expect(buildAttribution([], [])).toEqual([])
  })
})
