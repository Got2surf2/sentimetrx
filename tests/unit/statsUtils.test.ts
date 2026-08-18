import { describe, it, expect } from 'vitest'
import {
  mean, variance, std, median, quantile, skewness, kurtosis,
  pearsonR, spearmanR, welchTTest, welchTTestFromStats, oneWayANOVA, anovaFromStats,
  mannWhitneyU, normCDF, tDist2p, chiSqP, chiSquareStat, chiSquareFromTable,
  olsRegression, getNum, bootstrapCI,
  formatDecimal2, formatDecimal4, formatNumber, formatPValue, sigLabel, sigTest,
  corrBL, ttestBL, deterministicSubsample, mulberry32,
} from '@/lib/statsUtils'

// Pure statistical engine — reference values verified by hand / against the
// textbook formulas the functions implement (Welch, Fisher-Pearson G1/G2,
// type-7 quantile, two-proportion z). No mocking; fully deterministic except
// bootstrapCI (Math.random), which is exercised only on its deterministic
// small-n short-circuit.

describe('statsUtils — descriptive stats', () => {
  it('mean / variance / std / median', () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3)
    expect(mean([])).toBeNaN()
    expect(variance([1, 2, 3, 4, 5])).toBeCloseTo(2.5, 10)      // sample (ddof=1)
    expect(variance([1, 2, 3, 4, 5], 0)).toBeCloseTo(2, 10)      // population
    expect(variance([5])).toBeNaN()
    expect(std([1, 2, 3, 4, 5])).toBeCloseTo(Math.sqrt(2.5), 10)
    expect(median([1, 2, 3, 4, 5])).toBe(3)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([])).toBeNaN()
  })

  it('quantile uses type-7 linear interpolation', () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3)
    expect(quantile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 10)
    expect(quantile([1, 2, 3, 4, 5], 0)).toBe(1)
    expect(quantile([1, 2, 3, 4, 5], 1)).toBe(5)
  })

  it('skewness / kurtosis (unbiased) — symmetric data', () => {
    expect(skewness([1, 2, 3, 4, 5])).toBeCloseTo(0, 10)
    expect(kurtosis([1, 2, 3, 4, 5])).toBeCloseTo(-1.2, 1)   // platykurtic
    expect(skewness([1, 2])).toBe(0)   // n<3 guard
    expect(kurtosis([1, 2, 3])).toBe(0) // n<4 guard
  })
})

describe('statsUtils — correlation', () => {
  it('pearsonR: perfect positive / negative', () => {
    const pos = pearsonR([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])
    expect(pos.r).toBeCloseTo(1, 10)
    expect(pos.p).toBeCloseTo(0, 6)
    expect(pos.n).toBe(5)
    const neg = pearsonR([1, 2, 3, 4, 5], [10, 8, 6, 4, 2])
    expect(neg.r).toBeCloseTo(-1, 10)
  })

  it('pearsonR: n<3 and zero-variance guards', () => {
    expect(pearsonR([1, 2], [3, 4]).r).toBeNaN()
    expect(pearsonR([1, 1, 1, 1], [2, 3, 4, 5]).r).toBeNaN() // dx=0
  })

  it('spearmanR captures monotonic non-linear relationship', () => {
    expect(spearmanR([1, 2, 3, 4, 5], [1, 4, 9, 16, 25]).r).toBeCloseTo(1, 10)
  })
})

describe('statsUtils — group comparison', () => {
  it('welchTTest: identical groups → t≈0, p≈1', () => {
    const r = welchTTest([1, 2, 3, 4, 5], [1, 2, 3, 4, 5])!
    expect(r.t).toBeCloseTo(0, 10)
    expect(r.p).toBeCloseTo(1, 6)
  })

  it('welchTTest: clearly separated groups → significant', () => {
    const r = welchTTest([1, 2, 3, 4, 5], [11, 12, 13, 14, 15])!
    expect(r.t).toBeLessThan(0)
    expect(r.p).toBeLessThan(0.001)
    expect(r.na).toBe(5)
    expect(r.nb).toBe(5)
  })

  it('welchTTest: too-small samples return null', () => {
    expect(welchTTest([1], [2, 3])).toBeNull()
  })

  it('welchTTestFromStats mirrors the raw-data version', () => {
    const r = welchTTestFromStats(
      { mean: 3, sd: Math.sqrt(2.5), n: 5 },
      { mean: 13, sd: Math.sqrt(2.5), n: 5 },
    )!
    expect(r.p).toBeLessThan(0.001)
    expect(r.ma).toBe(3)
    expect(r.mb).toBe(13)
  })

  it('oneWayANOVA: three separated groups → significant', () => {
    const r = oneWayANOVA({ a: [1, 2, 3], b: [4, 5, 6], c: [7, 8, 9] })!
    expect(r.k).toBe(3)
    expect(r.N).toBe(9)
    expect(r.p).toBeLessThan(0.05)
    expect(r.eta2).toBeGreaterThan(0.5)
    expect(r.pairwise.length).toBe(3)
  })

  it('oneWayANOVA / anovaFromStats: <2 groups → null', () => {
    expect(oneWayANOVA({ a: [1, 2, 3] })).toBeNull()
    expect(anovaFromStats({ a: { mean: 1, sd: 1, n: 3 } })).toBeNull()
  })

  it('mannWhitneyU: complete separation → significant; empty → null', () => {
    const r = mannWhitneyU([1, 2, 3, 4, 5], [11, 12, 13, 14, 15])!
    expect(r.U).toBe(0)
    expect(r.p).toBeLessThan(0.05)
    expect(mannWhitneyU([], [1, 2])).toBeNull()
  })
})

describe('statsUtils — distributions & chi-square', () => {
  it('normCDF matches the standard-normal Φ(z)', () => {
    // Regression guard for the 2026-06-08 fix: normCDF must be Φ(z), not the
    // previously-shipped Φ(z·√2). Reference values are standard z-table entries.
    expect(normCDF(0)).toBeCloseTo(0.5, 6)
    expect(normCDF(1)).toBeCloseTo(0.8413, 3)
    expect(normCDF(1.96)).toBeCloseTo(0.975, 3)
    expect(normCDF(-1.96)).toBeCloseTo(0.025, 3)
    expect(normCDF(2.576)).toBeCloseTo(0.995, 3)
    expect(normCDF(-1.5)).toBeCloseTo(1 - normCDF(1.5), 6) // symmetry
  })

  it('tDist2p / chiSqP edge values', () => {
    expect(tDist2p(0, 10)).toBeCloseTo(1, 6)
    expect(chiSqP(0, 1)).toBe(1)
  })

  it('chiSquareStat builds a contingency table from rows', () => {
    const data = [
      { region: 'N', churn: 'yes' }, { region: 'N', churn: 'yes' },
      { region: 'S', churn: 'no' }, { region: 'S', churn: 'no' },
    ]
    const r = chiSquareStat('region', 'churn', data)!
    expect(r).not.toBeNull()
    expect(r.rows.sort()).toEqual(['N', 'S'])
    expect(r.N).toBe(4)
    expect(r.V).toBeGreaterThanOrEqual(0)
    expect(r.V).toBeLessThanOrEqual(1)
  })

  it('chiSquareStat: <2 rows or cols → null', () => {
    expect(chiSquareStat('a', 'b', [{ a: 'x', b: 'p' }, { a: 'x', b: 'p' }])).toBeNull()
  })

  it('chiSquareFromTable: perfect association is highly significant', () => {
    const r = chiSquareFromTable(
      { x: { p: 10, q: 0 }, y: { p: 0, q: 10 } },
      ['x', 'y'], ['p', 'q'],
    )!
    expect(r.df).toBe(1)
    expect(r.N).toBe(20)
    expect(r.p).toBeLessThan(0.001)
  })
})

describe('statsUtils — regression', () => {
  it('olsRegression recovers a perfect linear model y = 2x + 1', () => {
    const r = olsRegression([3, 5, 7, 9, 11], [[1], [2], [3], [4], [5]], ['x'])!
    expect(r.R2).toBeCloseTo(1, 8)
    expect(r.coefs[0].name).toBe('Intercept')
    expect(r.coefs[0].beta).toBeCloseTo(1, 6)
    expect(r.coefs[1].beta).toBeCloseTo(2, 6)
  })

  it('olsRegression: mismatched / empty input → null', () => {
    expect(olsRegression([1, 2], [[1]], ['x'])).toBeNull()
    expect(olsRegression([], [], ['x'])).toBeNull()
  })
})

describe('statsUtils — helpers & formatting', () => {
  it('getNum parses comma-thousands and drops non-numerics', () => {
    expect(getNum('v', [{ v: '1,000' }, { v: '2' }, { v: 'abc' }, { v: '' }])).toEqual([1000, 2])
  })

  it('bootstrapCI short-circuits for n<10', () => {
    const r = bootstrapCI([1, 2, 3])
    expect(r.n).toBe(3)
    expect(r.meanCI[0]).toBeNaN()
    expect(r.nIter).toBe(2000)
  })

  it('bootstrapCI produces ordered finite CIs for n>=10', () => {
    const r = bootstrapCI(Array.from({ length: 20 }, (_, i) => i + 1), 200)
    expect(Number.isFinite(r.meanCI[0])).toBe(true)
    expect(r.meanCI[0]).toBeLessThanOrEqual(r.meanCI[1])
    expect(r.nIter).toBe(200)
  })

  it('number / decimal / p-value formatters', () => {
    expect(formatDecimal2(3.14159)).toBe('3.14')
    expect(formatDecimal2(NaN)).toBe('—')
    expect(formatDecimal4(1.23456)).toBe('1.2346')
    expect(formatNumber(50)).toBe('50.00')
    expect(formatNumber(150)).toBe('150.0')
    expect(formatNumber(5)).toBe('5.000')
    expect(formatNumber(NaN)).toBe('—')
    expect(formatPValue(0.0001)).toBe('p < 0.001')
    expect(formatPValue(0.04)).toBe('p = 0.040')
    expect(formatPValue(NaN)).toBe('—')
  })

  it('sigLabel star bands', () => {
    expect(sigLabel(0.0001).stars).toBe('***')
    expect(sigLabel(0.005).stars).toBe('**')
    expect(sigLabel(0.03).stars).toBe('*')
    expect(sigLabel(0.5).stars).toBe('ns')
  })

  it('sigTest two-proportion z-test', () => {
    const over = sigTest(20, 100, 30, 300)!
    expect(over.dir).toBe('over')
    expect(over.z).toBeGreaterThan(1.96)
    // sample too small → null
    expect(sigTest(5, 10, 3, 20)).toBeNull()
  })

  it('bottom-line generators branch on significance', () => {
    expect(corrBL('A', 'B', 0.8, 0.001, 50, 'Pearson')).toMatch(/strong .*positive/)
    expect(corrBL('A', 'B', 0.05, 0.5, 50, 'Pearson')).toMatch(/No significant/)
    expect(ttestBL(null, 'score')).toBe('')
    expect(ttestBL({ d: 0.1, p: 0.5, t: 0.2, df: 8, ma: 3, mb: 3.1 }, 'score')).toMatch(/No significant/)
  })
})

// ── Deterministic subsampling (2026-08-18) ──────────────────────────────────
// The Statistics module subsamples above its cap. That selection MUST be stable:
// React may discard and recompute a useMemo at any time, and the old
// Math.random() shuffle would have re-drawn the sample and silently changed
// every statistic on screen. Same rows + cap ⇒ same sample, always.
describe('deterministicSubsample', () => {
  const items = Array.from({ length: 500 }, (_v, i) => i)

  it('returns the identical sample on every call (the load-bearing property)', () => {
    const a = deterministicSubsample(items, 50)
    const b = deterministicSubsample(items, 50)
    const c = deterministicSubsample(items.slice(), 50) // fresh array, same content
    expect(a).toEqual(b)
    expect(a).toEqual(c)
  })

  it('returns the input untouched when it already fits the cap', () => {
    const small = [1, 2, 3]
    expect(deterministicSubsample(small, 10)).toBe(small)
    expect(deterministicSubsample(small, 3)).toBe(small)
  })

  it('returns exactly `cap` items, all drawn from the input, with no duplicates', () => {
    const out = deterministicSubsample(items, 50)
    expect(out).toHaveLength(50)
    expect(new Set(out).size).toBe(50)
    for (const v of out) expect(items).toContain(v)
  })

  it('actually samples rather than just taking a contiguous slice', () => {
    const out = deterministicSubsample(items, 50)
    const head = items.slice(0, 50)
    const tail = items.slice(-50)
    expect(out).not.toEqual(head)
    expect(out).not.toEqual(tail)
  })

  it('changes the selection when the cap changes', () => {
    expect(deterministicSubsample(items, 50)).not.toEqual(deterministicSubsample(items, 51).slice(0, 50))
  })

  it('is total on degenerate caps', () => {
    expect(deterministicSubsample(items, 0)).toBe(items)
    expect(deterministicSubsample(items, -5)).toBe(items)
    expect(deterministicSubsample([], 10)).toEqual([])
  })
})

describe('mulberry32', () => {
  it('is reproducible for a given seed and varies across seeds', () => {
    const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43)
    const seqA = [a(), a(), a()]
    expect(seqA).toEqual([b(), b(), b()])
    expect(seqA).not.toEqual([c(), c(), c()])
  })

  it('stays within [0, 1)', () => {
    const r = mulberry32(7)
    for (let i = 0; i < 2000; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})
