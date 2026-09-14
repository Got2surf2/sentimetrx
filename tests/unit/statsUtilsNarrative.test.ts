// lib/statsUtils.ts — the parts tests/unit/statsUtils.test.ts does not reach:
// the normality/diagnostic helpers (probit, Shapiro-Wilk, F distribution, VIF
// and collinearity pruning), the formatters, and every bottom-line narrative
// generator in both voices. Narratives are what the Statistics tab prints
// under each result, so each branch (significant / not / null) is pinned.
import { describe, it, expect } from 'vitest'
import {
  probit, normCDF, shapiroWilk, fDistP, vif, pruneCollinear, olsRegression,
  formatDecimal2, formatDecimal4, formatNumber, formatPValue, fmt2, fmt4, fmtN, fmtP,
  sigTooltip, descBL, corrBL, ttestBL, anovaBL, mwBL, chiBL, regrBL,
  descBL_naive, corrBL_naive, ttestBL_naive, anovaBL_naive, mwBL_naive, chiBL_naive,
  mulberry32,
  type ANOVAResult, type ChiSquareResult, type RegressionResult, type MannWhitneyResult, type DescStats,
} from '@/lib/statsUtils'

describe('probit / normCDF', () => {
  it('probit inverts normCDF at the textbook quantiles and clamps the tails', () => {
    expect(probit(0.5)).toBeCloseTo(0, 6)
    expect(probit(0.975)).toBeCloseTo(1.96, 2)
    expect(probit(0.025)).toBeCloseTo(-1.96, 2)
    expect(probit(0.999)).toBeCloseTo(3.09, 1)        // tail branch (|y| ≥ 0.42)
    expect(normCDF(probit(0.8))).toBeCloseTo(0.8, 3)
    expect(probit(0)).toBe(-8)
    expect(probit(1)).toBe(8)
  })
})

describe('shapiroWilk', () => {
  it('guards n<3 and constant samples', () => {
    expect(shapiroWilk([1, 2])).toEqual({ W: NaN, p: NaN })
    expect(shapiroWilk([4, 4, 4, 4])).toEqual({ W: 1, p: 1 })
  })
  it('scores a near-normal sample high and a heavy-tailed one lower', () => {
    const normalish = [-2.1, -1.4, -0.9, -0.5, -0.2, 0, 0.2, 0.5, 0.9, 1.4, 2.1]
    const skewed = [1, 1, 1, 1, 1, 1, 1, 2, 3, 20, 80]
    const a = shapiroWilk(normalish), b = shapiroWilk(skewed)
    expect(a.W).toBeGreaterThan(0.95)
    expect(a.p).toBeGreaterThan(0.05)
    expect(b.W).toBeLessThan(a.W)
    expect(b.W).toBeLessThanOrEqual(1)
    // The p-value is Royston's log-normal approximation — coarse at n=11, so
    // only its range is pinned here; W ordering is the load-bearing claim.
    expect(b.p).toBeGreaterThanOrEqual(0); expect(b.p).toBeLessThanOrEqual(1)
  })
})

describe('fDistP', () => {
  it('F=0 is p=1, a large F is tiny, and the large-df2 path routes through chi-square', () => {
    expect(fDistP(0, 2, 30)).toBeCloseTo(1, 6)
    expect(fDistP(50, 2, 30)).toBeLessThan(0.001)
    expect(fDistP(3, 2, 30)).toBeGreaterThan(0.05)
    const viaChi = fDistP(2.5, 3, 5000)
    expect(viaChi).toBeGreaterThan(0.05)
    expect(viaChi).toBeLessThan(0.1)
  })
})

describe('vif / pruneCollinear', () => {
  const n = 40
  const x1 = Array.from({ length: n }, (_, i) => Math.sin(i) * 10)
  const x2 = Array.from({ length: n }, (_, i) => Math.cos(i * 1.7) * 3)
  const dup = x1.map(v => v * 2 + 1)      // perfectly collinear with x1
  const rows = (cols: number[][]) => Array.from({ length: n }, (_, i) => cols.map(c => c[i]))

  it('single predictor → VIF 1; independent predictors ≈ 1; a perfect twin → Infinity', () => {
    expect(vif(rows([x1]), ['x1'])).toEqual([{ name: 'x1', vif: 1 }])
    const ok = vif(rows([x1, x2]), ['x1', 'x2'])
    expect(ok[0].vif).toBeLessThan(1.5)
    expect(ok[1].vif).toBeLessThan(1.5)
    const bad = vif(rows([x1, dup, x2]), ['x1', 'dup', 'x2'])
    expect(bad.find(v => v.name === 'dup')!.vif).toBe(Infinity)
  })
  it('pruneCollinear drops one of the twins and keeps the independent predictor', () => {
    const res = pruneCollinear(rows([x1, dup, x2]), ['x1', 'dup', 'x2'])
    expect(res.dropped).toHaveLength(1)
    expect(['x1', 'dup']).toContain(res.dropped[0].name)
    expect(res.keptNames).toContain('x2')
    expect(res.keptNames).toHaveLength(2)
    expect(res.keptIdx).toHaveLength(2)
    const clean = pruneCollinear(rows([x1, x2]), ['x1', 'x2'])
    expect(clean.dropped).toEqual([])
    expect(clean.keptNames).toEqual(['x1', 'x2'])
  })
})

describe('formatters', () => {
  it('decimal / number / p-value formatters and their aliases', () => {
    expect(formatDecimal2(3.14159)).toBe('3.14')
    expect(formatDecimal4(3.14159)).toBe('3.1416')
    expect(formatDecimal2(NaN)).toBe('—')
    expect(formatNumber(NaN)).toBe('—')
    expect(formatNumber(12345)).toBe('1.235e+4')
    expect(formatNumber(0.0001)).toBe('1.000e-4')
    expect(formatNumber(123.456)).toBe('123.5')
    expect(formatNumber(12.3456)).toBe('12.35')
    expect(formatNumber(1.23456)).toBe('1.235')
    expect(formatPValue(NaN)).toBe('—')
    expect(formatPValue(0.0001)).toBe('p < 0.001')
    expect(formatPValue(0.0421)).toBe('p = 0.042')
    expect(fmt2).toBe(formatDecimal2); expect(fmt4).toBe(formatDecimal4); expect(fmtN).toBe(formatNumber); expect(fmtP).toBe(formatPValue)
  })
  it('sigTooltip is empty for ns and spells out over/under-representation', () => {
    expect(sigTooltip(null, 'G', 'T')).toBe('')
    expect(sigTooltip({ dir: 'ns', z: 1, p1: 0.1, p2: 0.1 }, 'G', 'T')).toBe('')
    expect(sigTooltip({ dir: 'over', z: 2.34, p1: 0.4, p2: 0.2 }, 'Millennials', 'Price')).toBe('40% of Millennials mention Price, vs 20% in all other groups — significantly over-represented (z=2.3, p<0.05)')
    expect(sigTooltip({ dir: 'under', z: 3.01, p1: 0.1, p2: 0.3 }, 'G', 'T')).toMatch(/under-represented \(z=3\.0/)
  })
})

describe('bottom-line narratives — expert voice', () => {
  const desc: DescStats = { n: 120, mn: 3.4, sd: 1.1, med: 3.5, skew: 0.1, sw: { W: 0.98, p: 0.4 } }
  it('descBL: symmetric + normal, skewed + non-normal, and no Shapiro-Wilk', () => {
    expect(descBL('Rating', desc)).toBe('Rating has 120 valid observations. Mean = 3.40, SD = 1.10, median = 3.50. The distribution is approximately symmetric and appears normally distributed (Shapiro-Wilk W=0.98, p = 0.400)')
    expect(descBL('R', { ...desc, skew: 1.2, sw: { W: 0.8, p: 0.0005 } })).toMatch(/positively skewed and departs from normality \(Shapiro-Wilk W=0\.80, p < 0\.001\)/)
    expect(descBL('R', { ...desc, skew: -0.9, sw: null })).toMatch(/negatively skewed\.$/)
  })
  it('corrBL: strength ladder, direction, and the non-significant sentence', () => {
    expect(corrBL('A', 'B', 0.05, 0.9, 50, 'Pearson')).toBe('No significant Pearson correlation between A and B (r=0.05, p = 0.900, n=50).')
    expect(corrBL('A', 'B', 0.65, 0.001, 50, 'Pearson')).toMatch(/strong positive Pearson correlation .* Higher A is associated with higher B\./)
    expect(corrBL('A', 'B', -0.2, 0.01, 50, 'Spearman')).toMatch(/weak negative Spearman correlation .* Higher A is associated with lower B\./)
    expect(corrBL('A', 'B', 0.4, 0.01, 50, 'Pearson')).toMatch(/moderate positive/)
    expect(corrBL('A', 'B', 0.8, 0.01, 50, 'Pearson')).toMatch(/very strong positive/)
    expect(corrBL('A', 'B', 0.05, 0.01, 50, 'Pearson')).toMatch(/negligible positive/)
  })
  it('ttestBL: null, ns, and significant with effect-size words', () => {
    expect(ttestBL(null, 'x')).toBe('')
    expect(ttestBL({ t: 0.4, df: 38, p: 0.7, ma: 3.1, mb: 3.0, d: 0.1 }, 'Score')).toBe('No significant difference in Score between the two groups (t=0.40, df=38.00, p = 0.700). Means: 3.10 vs 3.00.')
    expect(ttestBL({ t: 4.2, df: 38, p: 0.0001, ma: 4.0, mb: 3.0, d: 0.9 }, 'Score')).toMatch(/Significant difference .* First group has higher mean \(4\.00 vs 3\.00\)\. Effect size is large \(Cohen's d = 0\.90\)\./)
    expect(ttestBL({ t: -2.5, df: 38, p: 0.02, ma: 3.0, mb: 4.0, d: -0.3 }, 'Score')).toMatch(/Second group has higher mean .* Effect size is small/)
    expect(ttestBL({ t: 2.5, df: 38, p: 0.02, ma: 4, mb: 3, d: 0.6 }, 'S')).toMatch(/medium/)
    expect(ttestBL({ t: 2.5, df: 38, p: 0.02, ma: 4, mb: 3, d: 0.1 }, 'S')).toMatch(/negligible/)
  })
  const anova = (over: Partial<ANOVAResult>): ANOVAResult => ({ F: 5, dfB: 2, dfW: 57, p: 0.01, eta2: 0.15, SSB: 1, SSW: 1, MSB: 1, MSW: 1, groupStats: {}, pairwise: [], k: 3, N: 60, ...over })
  it('anovaBL: null, ns with η², significant with pairwise list', () => {
    expect(anovaBL(null, 'x')).toBe('')
    expect(anovaBL(anova({ p: 0.3, eta2: 0.005 }), 'Score')).toBe('No significant difference in Score across 3 groups (F=5.00, df=2,57, p = 0.300, η²=0.01).')
    const sig = anovaBL(anova({ pairwise: [{ a: 'A', b: 'B', t: 3, df: 38, p: 0.01, ma: 4, mb: 3, pAdj: 0.02 }, { a: 'A', b: 'C', t: 1, df: 38, p: 0.4, ma: 4, mb: 3.8, pAdj: 0.9 }] }), 'Score')
    expect(sig).toMatch(/Significant difference in Score across 3 groups .* Effect size is large \(η²=0\.15\)\. Significant pairwise differences: A vs B\./)
    expect(anovaBL(anova({ eta2: 0.03 }), 'S')).toMatch(/small/)
    expect(anovaBL(anova({ eta2: 0.1 }), 'S')).toMatch(/medium/)
  })
  const mw: MannWhitneyResult = { U: 1234.5, z: 2.4, p: 0.016, na: 50, nb: 50 }
  it('mwBL: null / ns / significant', () => {
    expect(mwBL(null, 'x', 'a', 'b')).toBe('')
    expect(mwBL({ ...mw, p: 0.3 }, 'Score', 'East', 'West')).toMatch(/^No significant difference in Score between East and West \(U=1234\.5, z=2\.40, p = 0\.300\)\.$/)
    expect(mwBL(mw, 'Score', 'East', 'West')).toMatch(/^Significant difference in Score between East and West/)
  })
  const chi = (over: Partial<ChiSquareResult>): ChiSquareResult => ({ chi2: 12.3, df: 2, p: 0.002, V: 0.35, N: 200, rows: [], cols: [], table: {}, rowSums: {}, colSums: {}, ...over })
  it('chiBL: null / ns / significant with Cramér’s V ladder', () => {
    expect(chiBL(null, 'a', 'b')).toBe('')
    expect(chiBL(chi({ p: 0.5 }), 'Region', 'Theme')).toBe('No significant association between Region and Theme (χ²=12.30, df=2, p = 0.500, N=200).')
    expect(chiBL(chi({}), 'Region', 'Theme')).toMatch(/The association is moderate \(Cramér’s V=0\.35\)\./)
    expect(chiBL(chi({ V: 0.05 }), 'R', 'T')).toMatch(/negligible/)
    expect(chiBL(chi({ V: 0.2 }), 'R', 'T')).toMatch(/weak/)
    expect(chiBL(chi({ V: 0.6 }), 'R', 'T')).toMatch(/strong/)
  })
  const regr = (over: Partial<RegressionResult>): RegressionResult => ({
    coefs: [
      { name: '(Intercept)', beta: 1, se: 0.1, t: 10, p: 0.0001, ci: [0.8, 1.2] },
      { name: 'price', beta: -0.5, se: 0.1, t: -5, p: 0.0001, ci: [-0.7, -0.3] },
      { name: 'wait', beta: 0.02, se: 0.1, t: 0.2, p: 0.8, ci: [-0.2, 0.2] },
    ],
    R2: 0.42, R2adj: 0.4, F: 20, Fp: 0.0001, n: 100, p: 0.0001, SSE: 1, SST: 1, MSE: 1, yhat: [], resid: [], names: [], vcov: [], ...over,
  })
  it('regrBL: null, non-significant model, significant with aliased predictors, none significant', () => {
    expect(regrBL(null, 'y')).toBe('')
    expect(regrBL(regr({ Fp: 0.4, F: 1.1, R2: 0.03 }), 'Rating')).toBe('The model is not significant (F=1.10, p = 0.400), explaining only 3% of variance in Rating.')
    expect(regrBL(regr({}), 'Rating', { price: 'Menu price' })).toBe('The model explains 42% of variance in Rating (R²=0.42, adj.R²=0.40, F=20.00, p < 0.001). Significant predictors: Menu price (β=-0.50, p < 0.001).')
    const none = regr({}); none.coefs = [none.coefs[0], { ...none.coefs[2] }]
    expect(regrBL(none, 'Rating')).toMatch(/No individual predictors reached significance\.$/)
  })
})

describe('bottom-line narratives — plain-English voice', () => {
  const desc: DescStats = { n: 1200, mn: 3.4, sd: 1.1, med: 3.5, skew: 0.1, sw: { W: 0.98, p: 0.4 } }
  it('descBL_naive: symmetric/bell, positive skew/uneven, negative skew/no SW', () => {
    expect(descBL_naive('Rating', desc)).toBe('Rating had 1,200 answers. The average score was 3.40 and the middle answer was 3.50. Scores were clustered around the middle, typically varying by about ±1.10 from the average. Scores follow a reasonably bell-shaped distribution.')
    expect(descBL_naive('R', { ...desc, skew: 1.5, sw: { W: 0.8, p: 0.001 } })).toMatch(/skewed toward lower values .* Scores don't follow a typical bell curve/)
    expect(descBL_naive('R', { ...desc, skew: -1.5, sw: null })).toMatch(/skewed toward higher values .* from the average\.$/)
  })
  it('corrBL_naive: ns sentence vs strength + direction sentence', () => {
    expect(corrBL_naive('A', 'B', 0.3, 0.2, 50)).toMatch(/^We checked whether A and B go together\. The answer is: not really\./)
    expect(corrBL_naive('A', 'B', 0.65, 0.001, 50)).toBe("There's a strong connection between A and B — when one is higher, the other tends to be higher too. This pattern is unlikely to be a coincidence (seen across 50 observations).")
    expect(corrBL_naive('A', 'B', -0.15, 0.01, 50)).toMatch(/a weak connection .* the other tends to be lower/)
    expect(corrBL_naive('A', 'B', 0.05, 0.01, 50)).toMatch(/almost no connection/)
    expect(corrBL_naive('A', 'B', 0.4, 0.01, 50)).toMatch(/a moderate connection/)
    expect(corrBL_naive('A', 'B', 0.9, 0.01, 50)).toMatch(/a very strong connection/)
  })
  it('ttestBL_naive: null / ns / significant with size words in both directions', () => {
    expect(ttestBL_naive(null, 'x')).toBe('')
    expect(ttestBL_naive({ t: 0.4, df: 38, p: 0.7, ma: 3.1, mb: 3.0, d: 0.1 }, 'Score')).toMatch(/no meaningful difference between them/)
    expect(ttestBL_naive({ t: 4, df: 38, p: 0.001, ma: 4, mb: 3, d: 0.9 }, 'Score')).toBe('There is a real difference in Score — the first group scores higher on average (4.00 vs 3.00). The gap is quite a big difference.')
    expect(ttestBL_naive({ t: -4, df: 38, p: 0.001, ma: 3, mb: 4, d: -0.1 }, 'Score')).toMatch(/the second group scores higher .* tiny \(barely noticeable in practice\)/)
    expect(ttestBL_naive({ t: 2, df: 38, p: 0.01, ma: 4, mb: 3, d: 0.3 }, 'S')).toMatch(/small but real/)
    expect(ttestBL_naive({ t: 2, df: 38, p: 0.01, ma: 4, mb: 3, d: 0.6 }, 'S')).toMatch(/a noticeable difference/)
  })
  const anova = (over: Partial<ANOVAResult>): ANOVAResult => ({ F: 5, dfB: 2, dfW: 57, p: 0.01, eta2: 0.15, SSB: 1, SSW: 1, MSB: 1, MSW: 1, groupStats: {}, pairwise: [], k: 3, N: 60, ...over })
  it('anovaBL_naive: null / ns / significant with up to three pairs', () => {
    expect(anovaBL_naive(null, 'x')).toBe('')
    expect(anovaBL_naive(anova({ p: 0.3 }), 'Score')).toBe('We compared 3 groups on Score. No meaningful differences — the variation looks like normal randomness.')
    const pw = ['A', 'B', 'C', 'D'].map((b, i) => ({ a: 'Z', b, t: 3, df: 1, p: 0.01, ma: 1, mb: 0, pAdj: 0.01 * (i + 1) }))
    expect(anovaBL_naive(anova({ pairwise: pw }), 'Score')).toBe("The groups are genuinely different on Score — which group someone's in explains a large chunk of the variation. In particular, these pairs stand out: Z vs A, Z vs B, Z vs C.")
    expect(anovaBL_naive(anova({ eta2: 0.005 }), 'S')).toMatch(/a tiny chunk/)
    expect(anovaBL_naive(anova({ eta2: 0.03 }), 'S')).toMatch(/a small chunk/)
    expect(anovaBL_naive(anova({ eta2: 0.1 }), 'S')).toMatch(/a moderate chunk/)
  })
  it('mwBL_naive and chiBL_naive: null / ns / significant', () => {
    const mw: MannWhitneyResult = { U: 1, z: 2.4, p: 0.016, na: 5, nb: 5 }
    expect(mwBL_naive(null, 'x', 'a', 'b')).toBe('')
    expect(mwBL_naive({ ...mw, p: 0.5 }, 'Score', 'East', 'West')).toMatch(/^We compared East and West on Score using a non-parametric test\./)
    expect(mwBL_naive(mw, 'Score', 'East', 'West')).toBe('There is a real difference in Score between East and West. This holds up even without assuming the data follows a bell curve.')
    const chi: ChiSquareResult = { chi2: 12.3, df: 2, p: 0.002, V: 0.35, N: 200, rows: [], cols: [], table: {}, rowSums: {}, colSums: {} }
    expect(chiBL_naive(null, 'a', 'b')).toBe('')
    expect(chiBL_naive({ ...chi, p: 0.5 }, 'Region', 'Theme')).toMatch(/^We checked if Region and Theme are connected\. They don't appear to be/)
    expect(chiBL_naive(chi, 'Region', 'Theme')).toBe('Region and Theme are noticeably related to each other. How people answer one question tends to go with how they answer the other. This is not just coincidence (based on 200 people).')
    expect(chiBL_naive({ ...chi, V: 0.05 }, 'R', 'T')).toMatch(/barely related/)
    expect(chiBL_naive({ ...chi, V: 0.2 }, 'R', 'T')).toMatch(/weakly related/)
    expect(chiBL_naive({ ...chi, V: 0.7 }, 'R', 'T')).toMatch(/strongly related/)
  })
})

describe('mulberry32', () => {
  it('is deterministic per seed, in [0,1), and differs across seeds', () => {
    const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43)
    const sa = Array.from({ length: 5 }, () => a()), sb = Array.from({ length: 5 }, () => b()), sc = Array.from({ length: 5 }, () => c())
    expect(sa).toEqual(sb)
    expect(sa).not.toEqual(sc)
    for (const v of sa) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1) }
  })
})

describe('olsRegression drives vif (sanity on the shared path)', () => {
  it('a perfect fit reports R2 = 1', () => {
    const X = Array.from({ length: 20 }, (_, i) => [i])
    const y = X.map(([x]) => 3 * x + 2)
    expect(olsRegression(y, X, ['x'])!.R2).toBeCloseTo(1, 6)
  })
})
