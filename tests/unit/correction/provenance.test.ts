// tests/unit/correction/provenance.test.ts
//
// Entity-catalog source authority + provenance (owner requirement, 2026-06-27).
// Strict gating: only official records (crawl/document) or a human (manual) may
// set/override a canonical; UGC (survey/conversation/transcript/review) never
// does.

import { describe, it, expect } from 'vitest'
import {
  isAuthoritative, canSetCanonical, chooseCanonical, mergeProvenance, hasAuthoritativeSource,
} from '@/lib/correction/provenance'

describe('authority tiers', () => {
  it('crawl/document/manual are authoritative; UGC is not', () => {
    expect(isAuthoritative('manual')).toBe(true)
    expect(isAuthoritative('document')).toBe(true)
    expect(isAuthoritative('crawl')).toBe(true)
    expect(isAuthoritative('transcript')).toBe(false)
    expect(isAuthoritative('conversation')).toBe(false)
    expect(isAuthoritative('survey')).toBe(false)
    expect(isAuthoritative('review')).toBe(false)
    expect(isAuthoritative('discovered')).toBe(false)
    expect(isAuthoritative(undefined)).toBe(false)
  })
})

describe('canSetCanonical (strict)', () => {
  it('UGC can never set the canonical', () => {
    expect(canSetCanonical('survey', null)).toBe(false)
    expect(canSetCanonical('transcript', 'document')).toBe(false)
    expect(canSetCanonical('review', 'review')).toBe(false)
  })
  it('an official/manual source sets it when nothing owns it yet', () => {
    expect(canSetCanonical('document', null)).toBe(true)
    expect(canSetCanonical('manual', null)).toBe(true)
  })
  it('an equal-or-higher authority overrides; a lower one does not', () => {
    expect(canSetCanonical('manual', 'document')).toBe(true)   // human beats doc
    expect(canSetCanonical('document', 'crawl')).toBe(true)    // doc >= crawl
    expect(canSetCanonical('crawl', 'document')).toBe(false)   // crawl < doc
    expect(canSetCanonical('document', 'manual')).toBe(false)  // doc < manual
  })
})

describe('chooseCanonical', () => {
  it('an authoritative source CORRECTS a UGC-owned canonical', () => {
    const out = chooseCanonical({ canonical: 'Nowocats', source: 'survey' }, { canonical: 'NOWOCATS', kind: 'document' })
    expect(out).toEqual({ canonical: 'NOWOCATS', source: 'document' })
  })
  it('UGC cannot overwrite an authoritative canonical', () => {
    const out = chooseCanonical({ canonical: 'NOWOCATS', source: 'document' }, { canonical: 'no what cats', kind: 'transcript' })
    expect(out).toEqual({ canonical: 'NOWOCATS', source: 'document' })
  })
  it('new entity is owned by whoever first observed it (even UGC, provisionally)', () => {
    expect(chooseCanonical(null, { canonical: 'Round Lake Rd', kind: 'survey' }))
      .toEqual({ canonical: 'Round Lake Rd', source: 'survey' })
  })
  it('a re-observation by an authoritative source upgrades the owning authority', () => {
    const out = chooseCanonical({ canonical: 'US 441', source: 'survey' }, { canonical: 'US 441', kind: 'document' })
    expect(out.canonical).toBe('US 441')
    expect(out.source).toBe('document')
  })
})

describe('mergeProvenance', () => {
  it('accumulates counts and caps de-duped refs per kind', () => {
    let p = mergeProvenance(null, 'document', { id: 'doc1', title: 'Style Guide' }, 1)
    p = mergeProvenance(p, 'document', { id: 'doc1', title: 'Style Guide' }, 1)   // dup ref
    p = mergeProvenance(p, 'survey', null, 120)
    expect(p.document.count).toBe(2)
    expect(p.document.refs).toHaveLength(1)          // dup not added twice
    expect(p.survey.count).toBe(120)
    expect(p.survey.refs).toHaveLength(0)
  })
})

describe('hasAuthoritativeSource', () => {
  it('true when the owner OR any provenance kind is authoritative', () => {
    expect(hasAuthoritativeSource('document', {})).toBe(true)
    expect(hasAuthoritativeSource('survey', { document: { count: 1, refs: [] } })).toBe(true)
    expect(hasAuthoritativeSource('survey', { review: { count: 9, refs: [] } })).toBe(false)
    expect(hasAuthoritativeSource('discovered', {})).toBe(false)
  })
})
