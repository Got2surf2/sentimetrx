// lib/americanize — output-side American-English enforcement. Explicit pairs
// only: the dangerous lookalikes (franchise, surprise, hour, tour) must never
// be touched.
import { describe, it, expect } from 'vitest'
import { americanize } from '@/lib/americanize'

describe('americanize', () => {
  it('converts common British spellings, preserving case', () => {
    expect(americanize('The Colour scheme penalised behaviour whilst travelling.'))
      .toBe('The Color scheme penalized behavior while traveling.')
    expect(americanize('Monetisation and Grey Defence')).toBe('Monetization and Gray Defense')
  })
  it('never touches lookalike words or American text', () => {
    const safe = 'The franchise advertise surprise hour tour four analyzes organization practice program'
    expect(americanize(safe)).toBe(safe)
  })
  it('handles metric units and -re words', () => {
    expect(americanize('3.8 centimetres per year, a litre at the centre'))
      .toBe('3.8 centimeters per year, a liter at the center')
  })
})
