// Tests for the comparison engine (lib/projectCompare.ts) — the competitive +
// brand-360 reports. Exercised with synthesize:false so the deterministic
// matrix/primary logic is locked without a network call.

import { describe, it, expect } from 'vitest'
import { buildCompareModel } from '@/lib/projectCompare'
import type { ProjectInputModel } from '@/lib/projectReport'

type ThemeTuple = [string, number, string, number | null]
function input(id: string, name: string, themes: Array<ThemeTuple>, dimensions: Array<ThemeTuple> = []): ProjectInputModel {
  const map = (ts: Array<ThemeTuple>) => ts.map(([label, count, sentiment, avgRating]) => ({ label, count, sentiment, avgRating, samples: [] }))
  return {
    source: { id, kind: 'reviews', name, date: null, badge: name, rowCount: 100 },
    presentation: null, qa: [], commentary: [],
    themes: map(themes), dimensions: map(dimensions),
    entities: [], sentiment: { positive: 0, neutral: 0, negative: 0 },
  }
}

const ruths = input('r', "Ruth's Chris", [['Service', 1800, 'positive', 4.5], ['Food', 1400, 'mixed', 4.1]])
const capital = input('c', 'Capital Grille', [['Service', 1200, 'mixed', 4.0], ['Food', 7000, 'mixed', 4.2]])
const tabla = input('t', 'Tabla', [['Food', 4900, 'positive', 4.6]])

describe('buildCompareModel — competitive (deterministic)', () => {
  it('designates the primary, orders it first, and labels the model', async () => {
    const m = await buildCompareModel('Steakhouses', 'competitive', [capital, ruths, tabla], 'x', { synthesize: false, primaryId: 'r' })
    expect(m.primary).toBe("Ruth's Chris")
    expect(m.columns[0].name).toBe("Ruth's Chris") // reordered first
    expect(m.purpose).toBe('competitive')
  })

  it('defaults the primary to the first input when none is designated', async () => {
    const m = await buildCompareModel('Steakhouses', 'competitive', [capital, ruths], 'x', { synthesize: false })
    expect(m.primary).toBe('Capital Grille')
  })

  it('builds matrix cells with per-column count + dominant sentiment + avg rating', async () => {
    const m = await buildCompareModel('Steakhouses', 'competitive', [ruths, capital, tabla], 'x', { synthesize: false, primaryId: 'r' })
    const food = m.rows.find(r => r.theme.toLowerCase() === 'food')!
    expect(food.cells["Ruth's Chris"]).toMatchObject({ present: true, count: 1400, sentiment: 'mixed', avgRating: 4.1 })
    expect(food.cells['Tabla']).toMatchObject({ present: true, count: 4900, sentiment: 'positive' })
    // Service didn't surface for Tabla
    const service = m.rows.find(r => r.theme.toLowerCase() === 'service')!
    expect(service.cells['Tabla'].present).toBe(false)
  })

  it('sorts rows by total volume across columns', async () => {
    const m = await buildCompareModel('Steakhouses', 'competitive', [ruths, capital, tabla], 'x', { synthesize: false, primaryId: 'r' })
    // Food (1400+7000+4900) > Service (1800+1200) → Food first
    expect(m.rows[0].theme.toLowerCase()).toBe('food')
  })
})

describe('buildCompareModel — Dimensions matrix', () => {
  it('builds a second matrix over dimensions when inputs carry them', async () => {
    const a = input('a', 'Brand A', [['Service', 100, 'positive', 4.5]], [['Service: Wait Time', 60, 'negative', 3.1], ['Food: Steak', 80, 'positive', 4.6]])
    const b = input('b', 'Brand B', [['Service', 90, 'mixed', 4.0]], [['Service: Wait Time', 40, 'mixed', 3.8]])
    const m = await buildCompareModel('Set', 'competitive', [a, b], 'x', { synthesize: false, primaryId: 'a' })
    expect(m.dimensionRows.length).toBe(2)
    const wait = m.dimensionRows.find(r => r.theme === 'Service: Wait Time')!
    expect(wait.cells['Brand A']).toMatchObject({ present: true, count: 60, avgRating: 3.1 })
    expect(wait.cells['Brand B']).toMatchObject({ present: true, count: 40 })
    // Food: Steak only surfaced for Brand A
    const steak = m.dimensionRows.find(r => r.theme === 'Food: Steak')!
    expect(steak.cells['Brand B'].present).toBe(false)
  })

  it('leaves dimensionRows empty when no input has dimensions', async () => {
    const m = await buildCompareModel('Set', 'competitive', [ruths, capital], 'x', { synthesize: false })
    expect(m.dimensionRows).toEqual([])
  })
})

describe('buildCompareModel — significance (two-proportion z-test)', () => {
  // Big samples: a real gap is significant, a tiny gap is not.
  const big = (id: string, name: string, n: number, themes: Array<ThemeTuple>) => {
    const m = input(id, name, themes)
    m.source.rowCount = n
    return m
  }
  it('flags a real gap significant and a trivial gap as ns; focus cell is null', async () => {
    // Focus 53% (7800/14721) vs competitor 36% (3140/8654) → significant 'down'.
    // Parity 17% (2526/14721) vs 16% (1380/8654) → still significant at this n,
    // so use a genuinely tiny gap to get 'ns': 17.0% vs 16.9%.
    const focus = big('f', 'Focus', 14721, [['Service', 7800, 'positive', 4.5], ['Parity', 2503, 'positive', 4.4]])
    const comp  = big('c', 'Comp',  8654,  [['Service', 3140, 'positive', 4.0], ['Parity', 1462, 'positive', 4.2]])
    const m = await buildCompareModel('Set', 'competitive', [focus, comp], 'x', { synthesize: false, primaryId: 'f' })
    const service = m.rows.find(r => r.theme === 'Service')!
    expect(service.cells['Focus'].sig).toBeNull()       // focus column never flagged
    expect(service.cells['Comp'].sig).toBe('down')        // 36% << 53%
    const parity = m.rows.find(r => r.theme === 'Parity')!
    // 2503/14721 = 17.00% vs 1462/8654 = 16.89% → not significant
    expect(parity.cells['Comp'].sig).toBe('ns')
  })

  it('does not compute significance for brand_360 (no focus)', async () => {
    const m = await buildCompareModel('One Brand', 'brand_360', [ruths, capital], 'x', { synthesize: false })
    for (const r of m.rows) for (const c of Object.values(r.cells)) expect(c.sig).toBeUndefined()
  })
})

describe('buildCompareModel — brand_360', () => {
  it('has no primary and keeps input order', async () => {
    const m = await buildCompareModel('One Brand', 'brand_360', [ruths, capital], 'x', { synthesize: false })
    expect(m.primary).toBeNull()
    expect(m.columns[0].name).toBe("Ruth's Chris")
    expect(m.purpose).toBe('brand_360')
  })
})
