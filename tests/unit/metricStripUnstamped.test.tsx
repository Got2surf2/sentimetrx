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

  it('suppresses the substantive share rather than claiming 100%', async () => {
    const { container } = await strip({ ...BASE, substantiveRecords: 0, inThemesSubstantive: 0, themeFitPctSubstantive: 0, themeFitBandSubstantive: 'Diffuse' })
    expect(container.textContent).not.toMatch(/substantive/)
  })

  // Signals are counted on the substantive base too (2026-09-03), so an
  // unstamped dataset reports zero of them for the same reason — nothing was
  // measured. Rendering "0 signals · 0.00 per comment" repeats exactly the
  // verdict-on-unmeasured-data bug this file exists to prevent.
  it('suppresses signals entirely rather than reporting an unmeasured zero', async () => {
    const { container } = await strip({
      ...BASE, signals: 0, signalRatio: 0,
      substantiveRecords: 0, inThemesSubstantive: 0, themeFitPctSubstantive: 0, themeFitBandSubstantive: 'Diffuse',
    })
    expect(container.textContent).not.toMatch(/signals/)
    expect(container.textContent).not.toMatch(/per comment/)
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
    expect(container.textContent).toMatch(/82% substantive/)
    expect(screen.getByText('30%')).toBeTruthy()
  })
})

// The coverage trio (owner 2026-09-03): total rows -> carry a comment ->
// that comment is substantive. Each tier renders only where it was measured.
describe('DatasetMetricStrip — coverage trio + signals', () => {
  const STAMPED = {
    ...BASE, substantiveRecords: 40000, inThemesSubstantive: 12000,
    themeFitPctSubstantive: 30, themeFitBandSubstantive: 'Mixed' as const,
  }

  it('renders all three tiers when totalRows is present', async () => {
    // 70,000 rows -> 49,033 wrote (70%) -> 40,000 substantive (82% of those).
    // Deliberately different percentages so a tier swap can't pass by accident.
    const { container } = await strip({ ...STAMPED, totalRows: 70000 })
    expect(screen.getByText('40,000')).toBeTruthy()          // tier 3, the lead
    expect(container.textContent).toMatch(/70% of 70,000 wrote/)  // tiers 1+2
    expect(container.textContent).toMatch(/82% substantive/)
  })

  it('drops tier 1 rather than faking it when totalRows is absent', async () => {
    // Caches written before the trio landed have no totalRows.
    const { container } = await strip(STAMPED)
    expect(container.textContent).not.toMatch(/wrote/)
    expect(container.textContent).toMatch(/82% substantive/)
  })

  it('drops tier 1 when a stale row_count sits below the comment count', async () => {
    // datasets.row_count is a stored column; a stale one under the measured
    // comment count would render "110% wrote".
    const { container } = await strip({ ...STAMPED, totalRows: 100 })
    expect(container.textContent).not.toMatch(/wrote/)
  })

  it('shows signals with the ratio to two decimals', async () => {
    const { container } = await strip({ ...STAMPED, totalRows: 60000, signals: 22000, signalRatio: 0.55 })
    expect(screen.getByText('22,000')).toBeTruthy()
    expect(container.textContent).toMatch(/0\.55 per comment/)
  })

  it('shows the signals count alone when the ratio is unmeasured', async () => {
    const { container } = await strip({ ...STAMPED, signals: 22000, signalRatio: null })
    expect(screen.getByText('22,000')).toBeTruthy()
    expect(container.textContent).not.toMatch(/per comment/)
  })
})
