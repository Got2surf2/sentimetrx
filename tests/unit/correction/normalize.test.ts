// tests/unit/correction/normalize.test.ts
//
// The shared deterministic normalizer (lib/correction/normalize) — the primitive
// consumed directly by the agent What-We-Heard readout, the survey export, and
// (via an adapter) Town Hall. Locks the variant→canonical replacement contract:
// whole-word, case-insensitive, longest-variant-first, canonical never replaced,
// category carried through but ignored by the replacer.

import { describe, it, expect } from 'vitest'
import { buildReplacements, normalizeText, type GlossaryEntry } from '@/lib/correction/normalize'

const g = (canonical: string, aliases: string[], category?: string): GlossaryEntry => ({ canonical, aliases, category })

describe('buildReplacements / normalizeText', () => {
  it('replaces variants with the canonical, case-insensitively', () => {
    const repl = buildReplacements([g('NOWOCATS', ['no what cats', 'nowocat'])])
    expect(normalizeText('We love No What Cats and nowocat.', repl)).toBe('We love NOWOCATS and NOWOCATS.')
  })

  it('is whole-word only (no mid-word replacement)', () => {
    const repl = buildReplacements([g('SR 429', ['429'])])
    // "429" as a standalone token is replaced; embedded in another token it is not
    expect(normalizeText('Take 429 north', repl)).toBe('Take SR 429 north')
    expect(normalizeText('order #4290', repl)).toBe('order #4290')
  })

  it('applies the longest variant first so a shorter overlapping variant cannot grab the prefix', () => {
    // 'Big Lake Park' (→ BLP) must be tried before 'Big Lake' (→ Big Lake Reservoir);
    // shorter-first would yield "Big Lake Reservoir Park".
    const repl = buildReplacements([g('Big Lake Reservoir', ['Big Lake']), g('BLP', ['Big Lake Park'])])
    expect(normalizeText('visit Big Lake Park today', repl)).toBe('visit BLP today')
  })

  it('never rewrites a surface equal to the canonical (case-insensitive)', () => {
    const repl = buildReplacements([g('NOWOCATS', ['NOWOCATS', 'nowocats'])])
    // no replacement pairs are produced for a variant that equals the canonical
    expect(repl).toHaveLength(0)
    expect(normalizeText('NOWOCATS met', repl)).toBe('NOWOCATS met')
  })

  it('returns no replacements for an empty / null glossary (identity)', () => {
    expect(buildReplacements([])).toEqual([])
    expect(buildReplacements(null)).toEqual([])
    const repl = buildReplacements(undefined)
    expect(normalizeText('untouched', repl)).toBe('untouched')
  })

  it('ignores the optional category field (carried through, not used by the replacer)', () => {
    const repl = buildReplacements([g('US 441', ['441'], 'place')])
    expect(normalizeText('on 441', repl)).toBe('on US 441')
  })

  it('escapes regex metacharacters in variants', () => {
    const repl = buildReplacements([g('C Sharp', ['C++ ish'])])  // '+' must be escaped, not treated as quantifier
    expect(normalizeText('I use C++ ish daily', repl)).toBe('I use C Sharp daily')
  })
})
