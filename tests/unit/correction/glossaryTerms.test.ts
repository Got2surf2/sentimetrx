// tests/unit/correction/glossaryTerms.test.ts
//
// glossaryTerms — the pure helper that extracts the canonical strings a glossary
// feeds to the AI polish prompt (case-insensitively de-duped, order preserved).
// (resolveBrandGlossary itself is server-only / DB-backed and is covered at the
// route layer; this locks the pure projection.)

import { describe, it, expect } from 'vitest'
import { glossaryTerms } from '@/lib/correction/glossary'

describe('glossaryTerms', () => {
  it('returns canonicals in order, case-insensitively de-duped', () => {
    expect(glossaryTerms([
      { canonical: 'NOWOCATS', aliases: ['no what cats'] },
      { canonical: 'US 441', aliases: [] },
      { canonical: 'nowocats', aliases: [] },   // dup of the first (case-insensitive)
    ])).toEqual(['NOWOCATS', 'US 441'])
  })

  it('drops blank canonicals and returns [] for an empty list', () => {
    expect(glossaryTerms([])).toEqual([])
    expect(glossaryTerms([{ canonical: '   ', aliases: [] }, { canonical: 'Real', aliases: [] }])).toEqual(['Real'])
  })
})
