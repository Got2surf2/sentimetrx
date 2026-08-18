// The Outlet Deep-Dive PDF is typeset from a payload the BROWSER posts back
// (lib/outletPdfPayload.ts). These cover the parser's contract: it rejects only
// when the document has no subject, and it coerces everything else rather than
// failing — because the builder interpolates these numbers into unquoted CSS.
import { describe, it, expect } from 'vitest'
import { parseOutletPdfPayload } from '@/lib/outletPdfPayload'

const OUTLET = 'ChIJabc123'

function minimal(over: Record<string, unknown> = {}) {
  return { brand: 'Ruths Chris', selected: { placeId: OUTLET }, ...over }
}

describe('parseOutletPdfPayload', () => {
  it('rejects a non-object body', () => {
    expect(parseOutletPdfPayload(null, OUTLET)).toBeNull()
    expect(parseOutletPdfPayload('nope', OUTLET)).toBeNull()
    expect(parseOutletPdfPayload([], OUTLET)).toBeNull()
  })

  it('rejects a body whose placeId is not the requested outlet', () => {
    // The URL is what the route authorised; a mismatched body would produce a
    // document titled with one location's data under another's request.
    expect(parseOutletPdfPayload(minimal(), 'ChIJsomethingelse')).toBeNull()
    expect(parseOutletPdfPayload(minimal({ selected: { placeId: '' } }), '')).toBeNull()
  })

  it('accepts a minimal body and fills every missing field', () => {
    const p = parseOutletPdfPayload(minimal(), OUTLET)
    expect(p).not.toBeNull()
    expect(p!.selected.snapshot.distribution).toEqual([])
    expect(p!.selected.reviews).toBe(0)
    expect(p!.plan).toBeNull()
    expect(p!.levers).toEqual([])
    expect(p!.whatIf).toBeNull()
  })

  it('coerces non-finite and wrong-typed numbers to 0', () => {
    const p = parseOutletPdfPayload(minimal({
      networkSize: 'lots',
      selected: { placeId: OUTLET, rating: null, reviews: Number.NaN, chainRating: '4.5' },
    }), OUTLET)!
    expect(p.networkSize).toBe(0)
    expect(p.selected.rating).toBe(0)
    expect(p.selected.reviews).toBe(0)
    expect(p.selected.chainRating).toBe(0)
  })

  it('drops malformed array elements instead of throwing', () => {
    const p = parseOutletPdfPayload(minimal({
      selected: {
        placeId: OUTLET,
        snapshot: { themeTable: [{ theme: 'Service', read: 'FIX', mentions: 3 }, null, 'junk', 42] },
      },
    }), OUTLET)!
    expect(p.selected.snapshot.themeTable).toHaveLength(1)
    expect(p.selected.snapshot.themeTable[0].theme).toBe('Service')
  })

  it('narrows an unknown READ verdict to SOLID', () => {
    const p = parseOutletPdfPayload(minimal({
      selected: { placeId: OUTLET, snapshot: { themeTable: [{ theme: 'X', read: '<script>' }] } },
    }), OUTLET)!
    expect(p.selected.snapshot.themeTable[0].read).toBe('SOLID')
  })

  it('caps oversized arrays and strings', () => {
    const p = parseOutletPdfPayload(minimal({
      selected: {
        placeId: OUTLET,
        narrative: 'x'.repeat(5000),
        trend: Array.from({ length: 500 }, (_, i) => ({ month: '2026-01', networkAvg: i })),
      },
    }), OUTLET)!
    expect(p.selected.narrative).toHaveLength(2000)
    expect(p.selected.trend).toHaveLength(200)
  })

  it('pads what-if rate vectors to the theme count and drops out-of-range indices', () => {
    // projectRecovery indexes currentRate by the theme indices in reviews13; a
    // short vector or a stray index would NaN the whole projection.
    const p = parseOutletPdfPayload(minimal({
      whatIf: { themes: ['a', 'b', 'c'], currentRate: [0.1], reviews13: [[0, 2, 99], [1]] },
    }), OUTLET)!
    expect(p.whatIf!.currentRate).toEqual([0.1, 0, 0])
    expect(p.whatIf!.medianRate).toHaveLength(3)
    expect(p.whatIf!.reviews13).toEqual([[0, 2], [1]])
  })

  it('drops a plan with no priorities rather than rendering an empty section', () => {
    expect(parseOutletPdfPayload(minimal({ plan: { priorities: [], keepDoing: 'x' } }), OUTLET)!.plan).toBeNull()
    const p = parseOutletPdfPayload(minimal({
      plan: { priorities: [{ tag: 'T', title: 'Do it', theme: 'Service', actions: ['a', 7] }], keepDoing: 'ok' },
    }), OUTLET)!
    expect(p.plan!.priorities[0].actions).toEqual(['a'])
  })
})
