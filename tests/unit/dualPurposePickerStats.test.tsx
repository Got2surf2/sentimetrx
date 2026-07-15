// @vitest-environment jsdom
// Stats-side mirror of the dual-purpose Likert picker unification (2026-07-15).
// On a panel that lists BOTH numeric and categorical fields (Group Tests), an
// auto-quant Likert must appear ONCE in the sidebar — the raw categorical entry,
// dual-flagged — not once as the raw and again as its "(score)" numeric twin.
// The twin id stays reachable via numeric selects; a numeric slot resolves a
// dropped dual field to the twin. Guards the sidebar dedup at the call site.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act, fireEvent } from '@testing-library/react'
import React from 'react'

vi.mock('@/components/analyze/RowsContext', () => ({
  useRows: () => ({ rows: [], rowsLoaded: true, rowsLoading: false, fetchRows: () => {}, sampled: false, totalRows: 0, sampledCount: 0 }),
}))
vi.mock('@/components/analyze/FilterContext', () => ({
  useFilters: () => ({ effectiveFilters: {}, filters: {}, setFilters: () => {}, lockedFilters: null }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))
vi.mock('@/components/ui/LottieLoader', () => ({ default: () => null }))
vi.mock('@/lib/filterUtils', () => ({ applyFilters: (rows: unknown[]) => rows }))
vi.mock('plotly.js-dist-min', () => ({ default: { newPlot: () => Promise.resolve(), purge: () => {}, react: () => Promise.resolve() } }))

import type { SchemaConfig } from '@/lib/analyzeTypes'
import StatsModule from '@/components/analyze/StatsModule'

const schema = { autoDetected: false, version: 1, fields: [
  { field: 'Visit type', type: 'categorical', label: 'Visit type', remapping: { 'Dine in': 1, 'To go': 2 } },
  { field: 'rating', type: 'numeric', sqt: 'rating', label: 'Rating' },
] } as unknown as SchemaConfig

describe('Dual-purpose Likert picker (Stats, Group Tests panel)', () => {
  beforeEach(() => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })) as unknown as typeof fetch
  })

  it('shows the dual-purpose field ONCE in the sidebar (twin deduped when raw is present)', async () => {
    let container!: HTMLElement
    await act(async () => {
      const r = render(React.createElement(StatsModule, {
        datasetId: 'd1', schema, themeModel: null, datasetSource: 'csv', taxonomyEnabled: false,
      }))
      container = r.container
      await Promise.resolve()
    })

    // Switch to Group Tests — the panel whose sidebar lists numeric + categorical.
    const groupBtn = Array.from(container.querySelectorAll('button')).find((b) => (b.textContent || '').includes('Group Tests'))
    expect(groupBtn).toBeTruthy()
    await act(async () => { fireEvent.click(groupBtn!); await Promise.resolve() })

    const chips = Array.from(container.querySelectorAll('div[draggable="true"]')).map((c) => c.textContent || '')
    const visitChips = chips.filter((t) => t.includes('Visit type'))
    // One draggable chip for the dual field; no separate "(score)" twin chip.
    expect(visitChips.length).toBe(1)
    expect(chips.some((t) => t.includes('(score)'))).toBe(false)
  })
})
