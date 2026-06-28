// Tests for the comparison engine (lib/projectCompare.ts) — the competitive +
// brand-360 reports. Exercised with synthesize:false so the deterministic
// matrix/primary logic is locked without a network call.

import { describe, it, expect } from 'vitest'
import { buildCompareModel } from '@/lib/projectCompare'
import type { ProjectInputModel } from '@/lib/projectReport'

function input(id: string, name: string, themes: Array<[string, number, string, number | null]>): ProjectInputModel {
  return {
    source: { id, kind: 'reviews', name, date: null, badge: name, rowCount: 100 },
    presentation: null, qa: [], commentary: [],
    themes: themes.map(([label, count, sentiment, avgRating]) => ({ label, count, sentiment, avgRating, samples: [] })),
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

describe('buildCompareModel — brand_360', () => {
  it('has no primary and keeps input order', async () => {
    const m = await buildCompareModel('One Brand', 'brand_360', [ruths, capital], 'x', { synthesize: false })
    expect(m.primary).toBeNull()
    expect(m.columns[0].name).toBe("Ruth's Chris")
    expect(m.purpose).toBe('brand_360')
  })
})
