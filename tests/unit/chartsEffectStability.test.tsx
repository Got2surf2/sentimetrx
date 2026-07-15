// @vitest-environment jsdom
// Guards the ChartsModule effect web against re-render loops — this is the file
// whose unmemoized effects once wedged the Statistics tab, and the 2026-07-14
// react-hooks warning sweep touched several of its effects (the regression
// effect's deps, useChartRows sync, the filtered-summary recompute). A loop
// throws "Maximum update depth exceeded" during act(), failing this test.
// Distinct from chartsMissingAnalytics.test.tsx: there rows are UNloaded; here
// they're LOADED with an ACTIVE FILTER, so the touched paths actually run.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import React from 'react'

const ROWS = [
  { _rowId: 1, 'Visit type': 'Dine in', rating: '5', '__mapped_Visit type__': 1 },
  { _rowId: 2, 'Visit type': 'To go', rating: '3', '__mapped_Visit type__': 2 },
  { _rowId: 3, 'Visit type': 'Dine in', rating: '4', '__mapped_Visit type__': 1 },
]

vi.mock('@/components/analyze/RowsContext', () => ({
  useRows: () => ({ rows: ROWS, rowsLoaded: true, rowsLoading: false, fetchRows: () => {}, sampled: false, totalRows: ROWS.length, sampledCount: ROWS.length }),
}))
// An ACTIVE filter → exercises useChartRows sync, _filteredRowIds, and
// recomputeFilteredSummaries (the touched paths).
vi.mock('@/components/analyze/FilterContext', () => ({
  useFilters: () => ({ effectiveFilters: { 'Visit type': { include: ['Dine in', 'To go'] } }, filters: {}, setFilters: () => {}, lockedFilters: null }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))
vi.mock('@/components/ui/LottieLoader', () => ({ default: () => null }))
vi.mock('@/lib/filterUtils', () => ({ applyFilters: (rows: unknown[]) => rows }))
// jsdom has no canvas/WebGL — stub Plotly so charts "render" without drawing.
vi.mock('plotly.js-dist-min', () => ({ default: { newPlot: () => Promise.resolve(), purge: () => {}, react: () => Promise.resolve() } }))

import type { SchemaConfig } from '@/lib/analyzeTypes'
import ChartsModule from '@/components/analyze/ChartsModule'

const LEAST = 'What did you like LEAST?'
const schema = { autoDetected: false, version: 1, fields: [
  { field: 'Visit type', type: 'categorical', label: 'Visit type', remapping: { 'Dine in': 1, 'To go': 2 } },
  { field: 'rating', type: 'numeric', sqt: 'rating', label: 'Rating' },
  { field: LEAST, type: 'open-ended', label: LEAST },
] } as unknown as SchemaConfig
const analytics = {
  totalRows: ROWS.length,
  fieldSummaries: {
    'Visit type': { type: 'categorical', nonNull: 3, counts: { 'Dine in': 2, 'To go': 1 }, topN: ['Dine in', 'To go'] },
    rating: { type: 'numeric', nonNull: 3, min: 3, max: 5, avg: 4, median: 4, stddev: 1, histogram: [{ min: 3, max: 4, count: 2 }, { min: 4, max: 5, count: 1 }] },
  },
}
const themeModel = { themes: [{ id: 't1', name: 'svc', keywords: ['x'], sentiment: 'neutral', count: 0, percentage: 0, description: '', relatedThemes: [] }], summary: '', fieldName: LEAST, fieldNames: [LEAST] }

describe('ChartsModule effect stability (loaded rows + active filter)', () => {
  beforeEach(() => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ counts: [], totalNonEmpty: 3, groups: {} }) })) as unknown as typeof fetch
  })

  it('renders and settles without a re-render loop', async () => {
    await act(async () => {
      render(React.createElement(ChartsModule, {
        datasetId: 'd1', schema, analytics: analytics as never,
        themeModel, datasetSource: 'csv', taxonomyEnabled: false,
      }))
      // let effects (useChartRows sync, theme-counts fetch, recompute) flush
      await Promise.resolve()
    })
    // Reaching here means no "Maximum update depth exceeded" throw during act().
    expect(true).toBe(true)
  })
})
