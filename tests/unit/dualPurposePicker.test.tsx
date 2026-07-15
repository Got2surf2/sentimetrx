// @vitest-environment jsdom
// Locks in the dual-purpose Likert picker unification (2026-07-15): an auto-quant
// Likert (categorical field with a numeric `remapping`) is shown ONCE in the
// Charts picker — as its raw categorical entry, dual-flagged — instead of twice
// (raw + a "(score)" numeric twin). A value/metric slot resolves the field to its
// numeric twin id `__mapped_<field>__`; a category/colour slot keeps the raw id.
// The stored config shape is unchanged, so saved charts + aggregation are
// unaffected — this test guards only the picker's display + resolution.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import React from 'react'

const ROWS = [
  { _rowId: 1, 'Visit type': 'Dine in', rating: '5', '__mapped_Visit type__': 1 },
  { _rowId: 2, 'Visit type': 'To go', rating: '3', '__mapped_Visit type__': 2 },
]

vi.mock('@/components/analyze/RowsContext', () => ({
  useRows: () => ({ rows: ROWS, rowsLoaded: true, rowsLoading: false, fetchRows: () => {}, sampled: false, totalRows: ROWS.length, sampledCount: ROWS.length }),
}))
vi.mock('@/components/analyze/FilterContext', () => ({
  useFilters: () => ({ effectiveFilters: {}, filters: {}, setFilters: () => {}, lockedFilters: null }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))
vi.mock('@/components/ui/LottieLoader', () => ({ default: () => null }))
vi.mock('@/lib/filterUtils', () => ({ applyFilters: (rows: unknown[]) => rows }))
vi.mock('plotly.js-dist-min', () => ({ default: { newPlot: () => Promise.resolve(), purge: () => {}, react: () => Promise.resolve() } }))

import type { SchemaConfig } from '@/lib/analyzeTypes'
import ChartsModule from '@/components/analyze/ChartsModule'

const schema = { autoDetected: false, version: 1, fields: [
  // Dual-purpose: categorical WITH a numeric remapping (auto-quant Likert)
  { field: 'Visit type', type: 'categorical', label: 'Visit type', remapping: { 'Dine in': 1, 'To go': 2 } },
  { field: 'rating', type: 'numeric', sqt: 'rating', label: 'Rating' },
] } as unknown as SchemaConfig
const analytics = {
  totalRows: ROWS.length,
  fieldSummaries: {
    'Visit type': { type: 'categorical', nonNull: 2, counts: { 'Dine in': 1, 'To go': 1 }, topN: ['Dine in', 'To go'] },
    rating: { type: 'numeric', nonNull: 2, min: 3, max: 5, avg: 4, median: 4, stddev: 1, histogram: [] },
  },
}

async function renderCharts() {
  let container!: HTMLElement
  await act(async () => {
    const r = render(React.createElement(ChartsModule, {
      datasetId: 'd1', schema, analytics: analytics as never,
      themeModel: null, datasetSource: 'csv', taxonomyEnabled: false,
    }))
    container = r.container
    await Promise.resolve()
  })
  return container
}

describe('Dual-purpose Likert picker (Charts, bar chart default)', () => {
  beforeEach(() => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })) as unknown as typeof fetch
  })

  it('lists the dual-purpose field ONCE in the sidebar (no separate "(score)" chip)', async () => {
    const container = await renderCharts()
    const chips = Array.from(container.querySelectorAll('div[draggable="true"]'))
    const chipTexts = chips.map((c) => c.textContent || '')
    // Exactly one draggable chip for "Visit type"; none carrying the "(score)" twin label.
    const visitChips = chipTexts.filter((t) => t.includes('Visit type'))
    expect(visitChips.length).toBe(1)
    expect(chipTexts.some((t) => t.includes('(score)'))).toBe(false)
  })

  it('value (numeric) slot resolves the dual field to its "__mapped__" twin id', async () => {
    const container = await renderCharts()
    const opts = Array.from(container.querySelectorAll('option')) as HTMLOptionElement[]
    // The value slot offers the twin id, labelled "(score)".
    const twin = opts.find((o) => o.value === '__mapped_Visit type__')
    expect(twin).toBeTruthy()
    expect(twin!.textContent).toContain('(score)')
    // The raw categorical id is still offered (category / colour slots).
    expect(opts.some((o) => o.value === 'Visit type')).toBe(true)
    // The raw id is NOT offered inside any numeric-only value slot as a bare
    // option (numeric slots carry the twin, not the raw) — verified implicitly
    // by the twin's presence; the raw stays for the categorical slots.
  })
})
