// @vitest-environment jsdom
// Distribution fallback (2026-09-03 audit): a numeric summary with NO
// histogram used to feed [min, avg, median, max] to Plotly AS DATA POINTS —
// Plotly derived quartiles from those 4 numbers, a fabricated distribution.
// The fallback now builds a real box from the rows (DistRowsFallbackInner).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import React from 'react'

const plotCalls: { traces: Record<string, unknown>[] }[] = []
vi.mock('plotly.js-dist-min', () => ({
  default: {
    newPlot: (_el: unknown, traces: Record<string, unknown>[]) => { plotCalls.push({ traces }) },
    purge: () => {},
    downloadImage: () => {},
  },
}))
vi.mock('@/components/analyze/RowsContext', () => ({
  useRows: () => ({
    rows: [{ score: '2' }, { score: '3' }, { score: '4' }, { score: '5' }, { score: 'n/a' }],
    rowsLoaded: true, rowsLoading: false, fetchRows: () => {}, sampled: false,
    totalRows: 5, rowsTotalRows: 5, sampledCount: 0,
  }),
}))
vi.mock('@/components/analyze/FilterContext', () => ({
  useFilters: () => ({ effectiveFilters: {}, filters: {}, setFilters: () => {}, lockedFilters: null }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))
vi.mock('@/components/ui/LottieLoader', () => ({ default: () => null }))

import type { SchemaConfig } from '@/lib/analyzeTypes'
import ChartsModule from '@/components/analyze/ChartsModule'

const schema = { autoDetected: false, version: 1, fields: [
  { field: 'score', type: 'numeric', label: 'Score' },
] } as unknown as SchemaConfig

// Summary WITHOUT a histogram — the fallback shape.
const analytics = {
  totalRows: 5, computedAt: '2026-09-03',
  fieldSummaries: { score: { type: 'numeric', nonNull: 4, min: 2, max: 5, avg: 3.5, median: 3.5 } },
}

describe('distribution fallback without histogram', () => {
  beforeEach(() => {
    plotCalls.length = 0
    sessionStorage.clear()
    sessionStorage.setItem('activeChart_d2', JSON.stringify('distribution'))
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })) as unknown as typeof fetch
  })

  it('hands Plotly the RAW numeric values, not 4 summary stats', async () => {
    render(React.createElement(ChartsModule, {
      datasetId: 'd2', schema, analytics: analytics as never, themeModel: null, datasetSource: 'csv',
    }))
    await waitFor(() => {
      const box = plotCalls.flatMap(c => c.traces).find(t => t.type === 'box')
      expect(box).toBeTruthy()
      // Real row values (the non-numeric 'n/a' dropped) — not [min, avg, median, max].
      expect(box!.y).toEqual([2, 3, 4, 5])
      expect(box!.boxpoints).toBe('outliers')
    })
  })
})
