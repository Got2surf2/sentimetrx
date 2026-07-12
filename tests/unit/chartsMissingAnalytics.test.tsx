// @vitest-environment jsdom
// Regression (prod 2026-07-12): a dataset whose analytics blob has NO
// fieldSummaries/totalRows (script-seeded scale-test copies; any dataset whose
// compute failed) crashed ChartsModule at render — unguarded
// `analytics.fieldSummaries[...]` derefs (the 785K [SCALE TEST] hit it on the
// remapped-fields summary build) — surfacing as the route error boundary.
// Charts/Stats must render their degraded states instead of throwing.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'

vi.mock('@/components/analyze/RowsContext', () => ({
  useRows: () => ({ rows: [], rowsLoaded: false, rowsLoading: true, fetchRows: () => {}, sampled: false, totalRows: 785638, rowsTotalRows: 785638, sampledCount: 0 }),
}))
vi.mock('@/components/analyze/FilterContext', () => ({
  useFilters: () => ({ effectiveFilters: {}, filters: {}, setFilters: () => {}, lockedFilters: null }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))
// jsdom has no canvas — lottie-web throws unhandled errors on render
vi.mock('@/components/ui/LottieLoader', () => ({ default: () => null }))

import type { SchemaConfig } from '@/lib/analyzeTypes'
import ChartsModule from '@/components/analyze/ChartsModule'
import StatsModule from '@/components/analyze/StatsModule'

const MOST = 'What did you like MOST?'
const LEAST = 'What did you like LEAST?'
const themes = (p: string) => [{ id: 't1', name: p + ' theme', keywords: ['x'], sentiment: 'neutral', count: 0, percentage: 0, description: '', relatedThemes: [] }]
const state = {
  schema_config: { autoDetected: false, version: 1, fields: [
    { field: 'Visit type', type: 'categorical', label: 'Visit type', remapping: { 'Dine in': 1, 'To go': 2 } },
    { field: 'rating', type: 'numeric', sqt: 'rating', label: 'Rating' },
    { field: MOST, type: 'open-ended', label: MOST },
    { field: LEAST, type: 'open-ended', label: LEAST },
  ] } as unknown as SchemaConfig,
  // the failure shape: signal-stats caches only — no fieldSummaries, no totalRows
  analytics: { signal_stats: { records: 1 }, signal_stats_by_field: {} },
  theme_model: {
    themes: themes(LEAST), summary: '', fieldName: LEAST, fieldNames: [LEAST],
    fields: {
      [MOST]:  { themes: themes(MOST),  summary: '', fieldName: MOST,  fieldNames: [MOST] },
      [LEAST]: { themes: themes(LEAST), summary: '', fieldName: LEAST, fieldNames: [LEAST] },
    },
  },
}

describe('analytics without fieldSummaries/totalRows', () => {
  it('ChartsModule renders without throwing', () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })) as unknown as typeof fetch
    expect(() => render(
      React.createElement(ChartsModule, {
        datasetId: 'd1', schema: state.schema_config,
        analytics: state.analytics as never, themeModel: state.theme_model,
        datasetSource: 'csv', taxonomyEnabled: true,
      })
    )).not.toThrow()
  })

  it('StatsModule renders without throwing', () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })) as unknown as typeof fetch
    expect(() => render(
      React.createElement(StatsModule, {
        datasetId: 'd1', schema: state.schema_config,
        themeModel: state.theme_model, datasetSource: 'csv', taxonomyEnabled: true,
      })
    )).not.toThrow()
  })
})
