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

describe('buildCompareModel — brand_360', () => {
  it('has no primary and keeps input order', async () => {
    const m = await buildCompareModel('One Brand', 'brand_360', [ruths, capital], 'x', { synthesize: false })
    expect(m.primary).toBeNull()
    expect(m.columns[0].name).toBe("Ruth's Chris")
    expect(m.purpose).toBe('brand_360')
  })
})
