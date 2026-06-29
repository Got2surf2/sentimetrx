import { describe, it, expect } from 'vitest'
import { availableReports, hasAnyReport, type ReportContext } from '@/lib/reportCatalog'

const ctx = (p: Partial<ReportContext>): ReportContext => ({ isCollection: false, aiEnabled: true, adHocEnabled: true, ...p })

describe('availableReports — single dataset', () => {
  it('offers the Full report + ad-hoc for a plain dataset', () => {
    const ids = availableReports(ctx({ source: 'upload' })).map(r => r.id)
    expect(ids).toEqual(['deck', 'ad-hoc'])
  })

  it('adds Operational Review for restaurant (google_reviews) data', () => {
    const ids = availableReports(ctx({ source: 'google_reviews' })).map(r => r.id)
    expect(ids).toContain('operational-review')
  })

  it('Dimensions proxy is suppressible', () => {
    const ids = availableReports(ctx({ source: 'google_reviews', taxonomySuppressed: true })).map(r => r.id)
    expect(ids).not.toContain('operational-review')
  })

  it('explicit taxonomy_enabled qualifies a non-google_reviews dataset', () => {
    const ids = availableReports(ctx({ source: 'upload', taxonomyEnabled: true })).map(r => r.id)
    expect(ids).toContain('operational-review')
  })

  it('drops the deck (and ad-hoc) when AI is off', () => {
    const ids = availableReports(ctx({ source: 'upload', aiEnabled: false })).map(r => r.id)
    expect(ids).toEqual([])
  })

  it('the deck supports pptx + html and both filter scopes', () => {
    const deck = availableReports(ctx({ source: 'upload' })).find(r => r.id === 'deck')!
    expect(deck.formats).toEqual(['pptx', 'html'])
    expect(deck.scopes).toEqual(['full', 'in-view'])
    expect(deck.launch('d1', 'html')).toEqual({ url: '/api/datasets/d1/export/html', method: 'POST' })
    expect(deck.launch('d1', 'pptx').url).toBe('/api/datasets/d1/export/pptx')
  })
})

describe('availableReports — collection', () => {
  it('an untyped (legacy) collection offers all three synthesis reports + ad-hoc', () => {
    const ids = availableReports(ctx({ isCollection: true, collectionPurpose: null, memberCount: 3 })).map(r => r.id)
    expect(ids).toEqual(['community', 'competitive', 'brand-360', 'ad-hoc'])
  })

  it('a competitive collection offers only the competitive report + ad-hoc', () => {
    const ids = availableReports(ctx({ isCollection: true, collectionPurpose: 'competitive', memberCount: 4 })).map(r => r.id)
    expect(ids).toEqual(['competitive', 'ad-hoc'])
  })

  it('hides the competitive report when there are < 2 members', () => {
    const ids = availableReports(ctx({ isCollection: true, collectionPurpose: 'competitive', memberCount: 1 })).map(r => r.id)
    expect(ids).not.toContain('competitive')
  })

  it('project reports launch html via GET and pdf via POST with the purpose', () => {
    const comp = availableReports(ctx({ isCollection: true, collectionPurpose: 'competitive', memberCount: 2 })).find(r => r.id === 'competitive')!
    expect(comp.formats).toEqual(['pdf', 'html'])
    expect(comp.launch('c1', 'html')).toEqual({ url: '/api/collections/c1/project-report?purpose=competitive', method: 'GET' })
    expect(comp.launch('c1', 'pdf')).toEqual({ url: '/api/collections/c1/project-report/pdf', method: 'POST', body: { purpose: 'competitive' } })
  })

  it('ad-hoc on a collection is full-scope only', () => {
    const adhoc = availableReports(ctx({ isCollection: true, collectionPurpose: 'community', memberCount: 2 })).find(r => r.id === 'ad-hoc')!
    expect(adhoc.scopes).toEqual(['full'])
    expect(adhoc.launch('c1', 'pdf').url).toBe('/api/collections/c1/ad-hoc-report')
  })
})

describe('ad-hoc gating', () => {
  it('is hidden until its endpoint is enabled', () => {
    const ids = availableReports(ctx({ source: 'upload', adHocEnabled: false })).map(r => r.id)
    expect(ids).toEqual(['deck'])
  })
})

describe('hasAnyReport', () => {
  it('false when AI is off on a plain dataset', () => {
    expect(hasAnyReport(ctx({ source: 'upload', aiEnabled: false }))).toBe(false)
  })
  it('true for a collection', () => {
    expect(hasAnyReport(ctx({ isCollection: true, memberCount: 2 }))).toBe(true)
  })
})
