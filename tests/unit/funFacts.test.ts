// lib/funFacts — the building screen's "Did you know?" pool. Guards the
// list's hygiene, not its truth (truth is enforced editorially: only
// well-documented facts, written in our own words — see the module header).
import { describe, it, expect } from 'vitest'
import { FUN_FACTS } from '@/lib/funFacts'

describe('FUN_FACTS', () => {
  it('is a large pool of unique, well-formed one-liners', () => {
    expect(FUN_FACTS.length).toBeGreaterThanOrEqual(100)
    expect(new Set(FUN_FACTS.map(f => f.toLowerCase())).size).toBe(FUN_FACTS.length)
    for (const f of FUN_FACTS) {
      expect(f.trim().length).toBeGreaterThan(20)
      expect(f.trim().length).toBeLessThan(220)   // one crisp sentence, fits the screen
      expect(f).not.toMatch(/<|>/)                // no markup — text is written raw into the doc
    }
  })

  it('contains none of the famous myths we deliberately excluded', () => {
    const all = FUN_FACTS.join(' ').toLowerCase()
    expect(all).not.toContain('goldfish')
    expect(all).not.toContain('great wall')
  })
})
