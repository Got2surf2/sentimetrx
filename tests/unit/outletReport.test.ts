// lib/outletReport — the per-outlet "vs peers" report + cross-outlet
// leaderboard, driven end-to-end through computeOutletReport /
// computeOutletLeaderboard with a fake service client serving synthetic flat
// rows. The lexicon, verbatim guard, and delta/verdict math all run REAL — the
// fixture reviews use words verified present in lib/sentimentLexicon.
//
// Fixture: a 2-outlet chain. Lake Nona (pA, 16 reviews) praises Service on 5★
// reviews; Tampa (pB, 14 reviews) pans Service on 1★ reviews. Both carry
// touchpoint:speed taxonomy assertions with matching polarity. Food exists but
// stays under the chain floor (MIN_N_CHAIN=20), so it must never surface.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const tables: Record<string, unknown[]> = {}

function builder(table: string) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'in', 'limit', 'neq']) b[m] = () => b
  b.range = (from: number, to: number) => Promise.resolve({ data: (tables[table] || []).slice(from, to + 1), error: null })
  b.maybeSingle = async () => ({ data: (tables[table] || [])[0] ?? null, error: null })
  b.single = async () => ({ data: (tables[table] || [])[0] ?? null, error: null })
  return b
}
vi.mock('@/lib/supabase/server', () => ({ createServiceRoleClient: () => ({ from: (t: string) => builder(t) }) }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))

import { computeOutletReport, computeOutletLeaderboard } from '@/lib/outletReport'

type Tx = { axis: string; sub: string; polarity: string; evidence: string }
let nextId = 0
function review(placeId: string, opts: {
  rating: number; text: string; month: number
  name?: string; city?: string; state?: string; address?: string
  owner?: boolean; tx?: Tx[]
}) {
  return {
    id: ++nextId,
    data: {
      place_id: placeId,
      location_name: opts.name, location_city: opts.city, location_state: opts.state, location_address: opts.address,
      rating: opts.rating,
      review_text: opts.text,
      review_date: `2026-${String(opts.month).padStart(2, '0')}-15`,
      owner_response: opts.owner ? 'Thanks for visiting!' : '',
      ...(opts.tx ? { _tx: { f: { review_text: { as: opts.tx } } } } : {}),
    },
  }
}

const A = { name: "Rubio's Coastal Grill Lake Nona", city: 'Orlando', state: 'FL', address: '123 Nona Blvd, Orlando' }
const B = { name: "Rubio's Coastal Grill", city: 'Tampa', state: 'FL', address: '9 Bay St, Tampa' }

function seed() {
  nextId = 0
  const rows: unknown[] = []
  // pA — 12 glowing 5★ Service reviews (+ speed:pos assertion) …
  for (let i = 0; i < 12; i++) {
    rows.push(review('pA', {
      ...A, rating: 5, month: (i % 6) + 1, owner: i % 2 === 0,
      text: 'The service was amazing and our waiter was wonderful.',
      tx: [
        { axis: 'touchpoint', sub: 'speed', polarity: 'pos', evidence: 'service was amazing' },
        // menu-item false-fire: without the DIRTY_NOISE filter, clean:neg would
        // clear every floor chain-wide (24 assertions, 12 per outlet, all polar)
        { axis: 'ambiance', sub: 'clean', polarity: 'neg', evidence: 'try the dirty cherry cola' },
      ],
    }))
  }
  // … + 4 positive 4★ Food reviews (Food stays under the 20-mention chain floor)
  for (let i = 0; i < 4; i++) {
    rows.push(review('pA', { ...A, rating: 4, month: i + 1, owner: i % 2 === 0, text: 'The food and tacos were delicious.' }))
  }
  // pB — 12 scathing 1★ Service reviews (+ speed:neg, and a "dirty soda"
  // clean:neg assertion that the noise filter must drop) …
  for (let i = 0; i < 12; i++) {
    rows.push(review('pB', {
      ...B, rating: 1, month: (i % 6) + 1,
      text: 'The service was terrible and the waiter was rude.',
      tx: [
        { axis: 'touchpoint', sub: 'speed', polarity: 'neg', evidence: 'service was terrible' },
        { axis: 'ambiance', sub: 'clean', polarity: 'neg', evidence: 'loved the dirty soda here' },
      ],
    }))
  }
  // … + 2 positive 5★ Food reviews
  for (let i = 0; i < 2; i++) {
    rows.push(review('pB', { ...B, rating: 5, month: i + 1, text: 'The tacos were delicious.' }))
  }
  tables['datasets'] = [{ name: "Rubio's Coastal Grill" }]
  tables['dataset_state'] = [{
    theme_model: { themes: [
      { name: 'Service', keywords: ['service', 'waiter'] },
      { name: 'Food', keywords: ['food', 'tacos'] },
    ] },
  }]
  tables['dataset_rows_flat'] = rows
}

beforeEach(seed)

describe('computeOutletReport — outlet options & selection', () => {
  it('lists both outlets sorted by review count, brand from the dataset name', async () => {
    const r = await computeOutletReport('d1')
    expect(r.brand).toBe("Rubio's Coastal Grill")
    expect(r.outlets.map((o) => o.placeId)).toEqual(['pA', 'pB']) // 16 > 14 reviews
    expect(r.outlets[0].label).toBe("Rubio's Coastal Grill Lake Nona — Orlando, FL")
    expect(r.outlets[0].sublabel).toBe('4.8★')
  })

  it('defaults to the biggest outlet and falls back there on an unknown placeId', async () => {
    expect((await computeOutletReport('d1')).selected?.placeId).toBe('pA')
    expect((await computeOutletReport('d1', 'nope')).selected?.placeId).toBe('pA')
  })

  it('names the outlet by its location-specific words, not City/State, when the name carries them', async () => {
    const r = await computeOutletReport('d1', 'pA')
    expect(r.selected?.name).toBe("Rubio's Coastal Grill Lake Nona")
    // pB's name is just the brand → falls back to City, State
    const rb = await computeOutletReport('d1', 'pB')
    expect(rb.selected?.name).toBe('Tampa, FL')
  })
})

describe('computeOutletReport — peer-relative themes & dimensions', () => {
  it('surfaces Service as the strong outlet’s strength with a premise-supporting quote', async () => {
    const s = (await computeOutletReport('d1', 'pA')).selected!
    expect(s.rank).toBe(1)
    expect(s.outletCount).toBe(2)
    expect(s.narrative).toContain('ranks #1 of 2')
    const strength = s.themes.strengths.find((d) => d.label === 'Service')
    expect(strength).toBeDefined()
    expect(strength!.delta).toBeGreaterThan(0.08)
    expect(strength!.quote).toContain('amazing') // the quote must carry the positive premise
    expect(s.themes.weaknesses).toHaveLength(0)
    // Dimensions: touchpoint:speed → label Speed, category Service (axis map)
    const dim = s.dimensions.strengths.find((d) => d.label === 'Speed')
    expect(dim).toBeDefined()
    expect(dim!.category).toBe('Service')
  })

  it('surfaces Service as the weak outlet’s weakness with a negative-premise quote', async () => {
    const s = (await computeOutletReport('d1', 'pB')).selected!
    expect(s.rank).toBe(2)
    const weak = s.themes.weaknesses.find((d) => d.label === 'Service')
    expect(weak).toBeDefined()
    expect(weak!.delta).toBeLessThan(-0.08)
    expect(weak!.quote).toContain('terrible')
    expect(s.themes.strengths).toHaveLength(0)
  })

  it('keeps Food below the chain floor — never a strength or weakness for either outlet', async () => {
    for (const pid of ['pA', 'pB']) {
      const s = (await computeOutletReport('d1', pid)).selected!
      const labels = [...s.themes.strengths, ...s.themes.weaknesses].map((d) => d.label)
      expect(labels).not.toContain('Food') // chain n=6 < MIN_N_CHAIN=20
    }
  })
})

describe('computeOutletReport — snapshot', () => {
  it('computes the rating distribution, shares, owner-response band, and theme verdicts', async () => {
    const snap = (await computeOutletReport('d1', 'pA')).selected!.snapshot
    expect(snap.fiveStarShare).toBeCloseTo(12 / 16)
    expect(snap.detractorShare).toBe(0)
    expect(snap.ownerResponseRate).toBeCloseTo(0.5)
    expect(snap.ownerResponseBand).toBe('Good — keep replying')
    expect(snap.dateRange).toBe('Jan 2026 – Jun 2026')
    // Service: 12 mentions ≥ floor, avg 5★, 0% ≤3★ → STRENGTH; Food (4 mentions) filtered
    expect(snap.themeTable).toEqual([{ theme: 'Service', mentions: 12, avgStar: 5, pctNegative: 0, read: 'STRENGTH' }])
    expect(snap.praiseVerbatims.some((v) => v.quote.includes('amazing'))).toBe(true)
  })

  it('marks the weak outlet’s Service theme FIX and captures the unhappy-guest quote', async () => {
    const sel = (await computeOutletReport('d1', 'pB')).selected!
    expect(sel.snapshot.themeTable).toEqual([{ theme: 'Service', mentions: 12, avgStar: 1, pctNegative: 1, read: 'FIX' }])
    expect(sel.lowQuotes.some((q) => q.theme === 'Service' && q.quote.includes('terrible'))).toBe(true)
  })

  it('reports no fleet position below the 200-review floor', async () => {
    const snap = (await computeOutletReport('d1', 'pA')).selected!.snapshot
    expect(snap.fleet).toBeNull()
  })
})

describe('computeOutletLeaderboard', () => {
  it('ranks outlets per item and applies the same stability floors', async () => {
    const lb = await computeOutletLeaderboard('d1')
    expect(lb.outletCount).toBe(2)
    expect(lb.defaultK).toBe(3)
    const service = lb.themes.find((t) => t.label === 'Service')
    expect(service).toBeDefined()
    expect(service!.qualifying).toBe(2)
    expect(service!.ranked.map((r) => r.placeId)).toEqual(['pA', 'pB']) // net +1 before net −1
    expect(lb.themes.map((t) => t.label)).not.toContain('Food') // under the chain floor
    const speed = lb.dimensions.find((d) => d.label === 'Speed')
    expect(speed).toBeDefined()
  })

  it('drops menu-item "dirty …" clean:neg noise before it can rank Clean', async () => {
    // 24 clean:neg assertions (12/outlet) clear every stability floor — only
    // the DIRTY_NOISE evidence filter keeps Clean off the board
    const lb = await computeOutletLeaderboard('d1')
    expect(lb.dimensions.map((d) => d.label)).not.toContain('Clean')
    expect(lb.dimensions.map((d) => d.label)).toContain('Speed') // same floors, real item ranks
  })
})
