// @vitest-environment jsdom
// 2026-09-03 chart-options pass: the Time Series % share toggle and the
// drag-aware slot highlighting, exercised through the real ChartsModule.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor, screen } from '@testing-library/react'
import React from 'react'

const plotCalls: { traces: Record<string, unknown>[] }[] = []
vi.mock('plotly.js-dist-min', () => ({
  default: {
    newPlot: (_el: unknown, traces: Record<string, unknown>[]) => { plotCalls.push({ traces }) },
    purge: () => {},
    downloadImage: () => {},
  },
}))
// 3 rows of segment A and 1 of B on Jan 5; a quiet gap; 1 A + 1 B on Jan 15.
vi.mock('@/components/analyze/RowsContext', () => ({
  useRows: () => ({
    rows: [
      { d: '2025-01-05', seg: 'A' }, { d: '2025-01-05', seg: 'A' }, { d: '2025-01-05', seg: 'A' }, { d: '2025-01-05', seg: 'B' },
      { d: '2025-01-15', seg: 'A' }, { d: '2025-01-15', seg: 'B' },
    ],
    rowsLoaded: true, rowsLoading: false, fetchRows: () => {}, sampled: false,
    totalRows: 6, rowsTotalRows: 6, sampledCount: 0,
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
  { field: 'd', type: 'date', label: 'Day' },
  { field: 'seg', type: 'categorical', label: 'Segment' },
  { field: 'score', type: 'numeric', label: 'Score' },
] } as unknown as SchemaConfig

const analytics = {
  totalRows: 6, computedAt: '2026-09-03',
  fieldSummaries: {
    d: { type: 'date', nonNull: 6, counts: { '2025-01-05': 4, '2025-01-15': 2 } },
    seg: { type: 'categorical', nonNull: 6, counts: { A: 4, B: 2 } },
    score: { type: 'numeric', nonNull: 6, min: 1, max: 5, avg: 3, median: 3 },
  },
}

function mount() {
  return render(React.createElement(ChartsModule, {
    datasetId: 'd3', schema, analytics: analytics as never, themeModel: null, datasetSource: 'csv',
  }))
}

beforeEach(() => {
  plotCalls.length = 0
  sessionStorage.clear()
  global.fetch = vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })) as unknown as typeof fetch
})

describe('Time Series % share toggle', () => {
  beforeEach(() => {
    sessionStorage.setItem('activeChart_d3', JSON.stringify('timeseries'))
    sessionStorage.setItem('chartConfigs_d3', JSON.stringify({ timeseries: { date: 'd', metric: '', colorBy: 'seg' } }))
  })

  it('defaults to counts with zero-filled calendar buckets', async () => {
    mount()
    await waitFor(() => {
      const a = plotCalls.flatMap(c => c.traces).find(t => t.name === 'A')
      expect(a).toBeTruthy()
      // Jan 5 → Jan 15 daily = 11 buckets, quiet days a real 0
      expect((a!.x as string[]).length).toBe(11)
      const y = a!.y as number[]
      expect(y[0]).toBe(3)
      expect(y[1]).toBe(0)
      expect(y[10]).toBe(1)
    })
  })

  it('converts lines to per-bucket % shares that sum to 100', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('% share')).toBeTruthy())
    plotCalls.length = 0
    fireEvent.click(screen.getByText('% share'))
    await waitFor(() => {
      const traces = plotCalls.flatMap(c => c.traces)
      const a = traces.find(t => t.name === 'A'), b = traces.find(t => t.name === 'B')
      expect(a && b).toBeTruthy()
      const ay = a!.y as (number | null)[], by = b!.y as (number | null)[]
      expect(ay[0]).toBe(75)                    // 3 of 4 on Jan 5
      expect(by[0]).toBe(25)
      expect(ay[1]).toBeNull()                  // empty bucket = no share, not 0%
      expect(ay[10]).toBe(50)
    })
  })
})

describe('drag-aware slot highlighting', () => {
  it('marks viable slots "drop here" and dims incompatible ones', async () => {
    sessionStorage.setItem('activeChart_d3', JSON.stringify('timeseries'))
    mount()
    // Drag the categorical "Segment" — Break down by accepts it, Date Field must not.
    const field = await screen.findByTitle('Segment')
    fireEvent.dragStart(field, { dataTransfer: { setData: () => {}, effectAllowed: 'copy' } })
    await waitFor(() => {
      expect(screen.getByText(/drop here/i)).toBeTruthy()
      const dateLabel = screen.getByText(/^Date Field$/i)
      // The Date slot's wrapper is dimmed and inert for a categorical drag
      const wrapper = dateLabel.parentElement as HTMLElement
      expect(wrapper.style.opacity).toBe('0.3')
      expect(wrapper.style.pointerEvents).toBe('none')
    })
    fireEvent.dragEnd(field)
    await waitFor(() => expect(screen.queryByText(/drop here/i)).toBeNull())
  })
})
