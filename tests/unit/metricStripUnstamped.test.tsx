// @vitest-environment jsdom
// The metric strip must not assert a substantive count it hasn't measured.
//
// A dataset ingested outside the stamping path (direct-write script, legacy
// import) has `substantive` unstamped, which counts as zero. Before 2026-08-13
// the strip rendered that as "0 comments · 0% of 49,033 answered · Diffuse 0%"
// — a damning verdict on the data that also flatly contradicted the theme cards
// below, which counted the same rows in the thousands.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import React from 'react'

vi.mock('@/components/ui/LottieLoader', () => ({ default: () => null }))

import DatasetMetricStrip from '@/components/analyze/DatasetMetricStrip'

const BASE = {
  records: 49033,
  signals: 22000,
  inThemes: 12000,
  themeFitPct: 24,
  themeFitBand: 'Mixed' as const,
  themeCount: 6,
}

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

// The strip fetches its own stats, so drive it through the endpoint.
async function strip(stats: Record<string, unknown>) {
  fetchMock.mockResolvedValue({ ok: true, json: async () => stats })
  let r!: ReturnType<typeof render>
  await act(async () => { r = render(<DatasetMetricStrip datasetId="d1" embedded />) })
  return r
}

describe('DatasetMetricStrip — substantive flag unstamped', () => {
  it('falls back to the answered count instead of showing 0 comments', async () => {
    await strip({ ...BASE, substantiveRecords: 0, inThemesSubstantive: 0, themeFitPctSubstantive: 0, themeFitBandSubstantive: 'Diffuse' })
    expect(screen.getByText('49,033')).toBeTruthy()
    expect(screen.queryByText('0')).toBeNull()
  })

  it('suppresses the "% of N answered" share rather than claiming 100%', async () => {
    const { container } = await strip({ ...BASE, substantiveRecords: 0, inThemesSubstantive: 0, themeFitPctSubstantive: 0, themeFitBandSubstantive: 'Diffuse' })
    expect(container.textContent).not.toMatch(/% of 49,033 answered/)
  })

  it('uses the all-based theme fit, not the empty substantive one', async () => {
    await strip({ ...BASE, substantiveRecords: 0, inThemesSubstantive: 0, themeFitPctSubstantive: 0, themeFitBandSubstantive: 'Diffuse' })
    expect(screen.getByText('24%')).toBeTruthy()
    expect(screen.getByText('Mixed')).toBeTruthy()
    expect(screen.queryByText('Diffuse')).toBeNull()
  })

  it('still prefers the substantive numbers when the flag IS stamped', async () => {
    const { container } = await strip({ ...BASE, substantiveRecords: 40000, inThemesSubstantive: 12000, themeFitPctSubstantive: 30, themeFitBandSubstantive: 'Mixed' })
    expect(screen.getByText('40,000')).toBeTruthy()
    expect(container.textContent).toMatch(/82% of 49,033 answered/)
    expect(screen.getByText('30%')).toBeTruthy()
  })
})
