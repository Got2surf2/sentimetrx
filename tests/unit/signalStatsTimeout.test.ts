import { describe, it, expect, vi } from 'vitest'

// Sentry caught `count_nonempty_rows failed … canceling statement due to
// statement timeout` on GET /signal-stats for a 27,234-row dataset — i.e. BELOW
// the 50K sampling cap, on the exact path. countNonEmptyRows throws rather than
// swallowing to 0 (good: no cache poisoning), but the throw propagated out of
// the route and blanked the whole metric strip. It must degrade to the sampled
// path instead, which is already labelled in the UI.

const sampled = {
  recordsPerField: [900], recordsSubstantivePerField: [800],
  perTheme: [120], perThemeSubstantive: [110],
  union: 300, unionSubstantive: 280, scanned: 27234,
}
vi.mock('@/lib/sampledSignalCounts', () => ({
  SIGNAL_SAMPLE_CAP: 50000,
  sampledSignalCounts: vi.fn(async () => sampled),
  scaleSampledCount: (n: number) => n,
}))
const timeout = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' })
let nonEmptyBehaviour: () => Promise<number> = async () => 1000
vi.mock('@/lib/nonEmptyCount', () => ({ countNonEmptyRows: () => nonEmptyBehaviour() }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
vi.mock('@/lib/datasetAnalytics', () => ({ mergeDatasetAnalytics: vi.fn(), deleteDatasetAnalyticsKey: vi.fn() }))

const { computeSignalStatsRaw } = await import('@/lib/signalStats')

function svc(rowCount: number) {
  return {
    from: (t: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => t === 'datasets'
            ? { data: { id: 'd1', source: 'upload' }, error: null }
            : { data: null, error: null },
          maybeSingle: async () => ({ data: null, error: null }),
        }),
        in: async () => ({ data: [{ id: 'd1', row_count: rowCount }], error: null }),
      }),
    }),
    rpc: async () => ({ data: 5, error: null }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal SupabaseClient stand-in for this unit
  } as any
}
const MODEL = { themes: [{ id: 't1', keywords: ['steak'] }], fieldNames: ['review_text'] }

describe('signal stats: exact path timing out below the cap', () => {
  it('falls back to the sampled path and flags it, instead of throwing', async () => {
    nonEmptyBehaviour = async () => { throw timeout }
    const out = await computeSignalStatsRaw(svc(27234), 'd1', MODEL)
    expect(out.sampled).toBe(true)
    expect(out.records).toBe(900)          // came from the sampled counts
    expect(out.substantiveRecords).toBe(800)
  })

  it('still throws on a non-timeout error — only timeouts degrade', async () => {
    nonEmptyBehaviour = async () => { throw new Error('permission denied for relation') }
    await expect(computeSignalStatsRaw(svc(27234), 'd1', MODEL)).rejects.toThrow(/permission denied/)
  })

  it('leaves the healthy exact path alone (not flagged as sampled)', async () => {
    nonEmptyBehaviour = async () => 1000
    const out = await computeSignalStatsRaw(svc(27234), 'd1', MODEL)
    expect(out.sampled).toBeUndefined()
    expect(out.records).toBe(1000)
  })
})
