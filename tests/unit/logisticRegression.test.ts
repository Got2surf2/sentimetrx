import { describe, it, expect } from 'vitest'
import { logisticRegression, vif, pruneCollinear, pearsonR } from '@/lib/statsUtils'

describe('logisticRegression', () => {
  it('intercept-only recovers logit(mean(y)) exactly', () => {
    // 3 ones, 1 zero → p=0.75 → intercept = ln(0.75/0.25) = ln 3 ≈ 1.0986
    const r = logisticRegression([1, 1, 1, 0], [[], [], [], []], [])!
    expect(r).not.toBeNull()
    expect(r.coefs[0].name).toBe('Intercept')
    expect(r.coefs[0].beta).toBeCloseTo(Math.log(3), 4)
    expect(r.coefs[0].or).toBeCloseTo(3, 3)
    expect(r.converged).toBe(true)
    expect(r.nPos).toBe(3)
    expect(r.nNeg).toBe(1)
  })

  it('recovers a positive effect and converges on non-separable data', () => {
    const x = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5]
    const y = [0, 0, 0, 1, 0, 1, 1, 1, 1, 1]
    const r = logisticRegression(y, x.map((v) => [v]), ['x'])!
    expect(r.converged).toBe(true)
    expect(r.separation).toBe(false)
    const bx = r.coefs[1]
    expect(bx.beta).toBeGreaterThan(0)     // higher x → higher P(y=1)
    expect(bx.or).toBeGreaterThan(1)        // odds ratio > 1
    expect(bx.or).toBeCloseTo(Math.exp(bx.beta), 6)
    // McFadden pseudo-R² in (0,1); LR test significant-ish
    expect(r.pseudoR2).toBeGreaterThan(0)
    expect(r.pseudoR2).toBeLessThan(1)
    expect(r.aic).toBeGreaterThan(0)
  })

  it('flags perfect separation instead of returning garbage silently', () => {
    // x<=3 → 0, x>=4 → 1 : perfectly separable → coefficients diverge
    const x = [1, 2, 3, 4, 5, 6]
    const y = [0, 0, 0, 1, 1, 1]
    const r = logisticRegression(y, x.map((v) => [v]), ['x'])!
    expect(r.separation).toBe(true)
  })

  it('ridge-rescues a separated multi-predictor model instead of returning null', () => {
    // two predictors that jointly separate the outcome → unpenalized Hessian
    // goes singular; the ridge fallback returns a finite (regularized) fit
    const rows = [
      [1, 1], [1, 2], [2, 1], [2, 2], [4, 4], [4, 5], [5, 4], [5, 5], [1, 1], [5, 5],
    ]
    const y = [0, 0, 0, 0, 1, 1, 1, 1, 0, 1]
    const r = logisticRegression(y, rows, ['a', 'b'])
    expect(r).not.toBeNull()
    expect(r!.separation).toBe(true)
    // direction is still recoverable: higher a/b → higher odds
    expect(r!.coefs[1].beta).toBeGreaterThan(0)
  })

  it('finds no effect when the predictor is unrelated (OR ≈ 1, high p)', () => {
    // y is symmetric around the middle of x → mean(x|y=1) == mean(x|y=0) → no trend
    const x = [1, 2, 3, 4, 5, 6, 7, 8]
    const y = [0, 1, 1, 0, 0, 1, 1, 0]
    const r = logisticRegression(y, x.map((v) => [v]), ['x'])!
    expect(r.coefs[1].or).toBeCloseTo(1, 1)
    expect(r.coefs[1].p).toBeGreaterThan(0.3)
  })
})

describe('vif', () => {
  it('matches 1/(1-r²) for two predictors', () => {
    const x1 = [1, 2, 3, 4, 5, 6]
    const x2 = [1, 2, 2, 4, 5, 7]
    const X = x1.map((v, i) => [v, x2[i]])
    const r = pearsonR(x1, x2).r
    const expected = 1 / (1 - r * r)
    const v = vif(X, ['x1', 'x2'])
    expect(v[0].vif).toBeCloseTo(expected, 4)
    expect(v[1].vif).toBeCloseTo(expected, 4)
  })

  it('reports ~1 for independent predictors', () => {
    const X = [[1, 5], [2, 1], [3, 6], [4, 2], [5, 7], [6, 3], [7, 8], [8, 1]]
    const v = vif(X, ['a', 'b'])
    expect(v[0].vif).toBeLessThan(1.5)
    expect(v[1].vif).toBeLessThan(1.5)
  })
})

describe('pruneCollinear', () => {
  it('drops one of two perfectly collinear predictors', () => {
    // c is an exact linear function of a (c = 2a) → infinite VIF
    const X = [[1, 5, 2], [2, 9, 4], [3, 2, 6], [4, 7, 8], [5, 1, 10], [6, 4, 12]]
    const res = pruneCollinear(X, ['a', 'b', 'c'], 10)
    expect(res.dropped.length).toBe(1)
    expect(['a', 'c']).toContain(res.dropped[0].name) // one of the collinear pair
    expect(res.keptNames).toContain('b')
    expect(res.keptNames.length).toBe(2)
  })

  it('keeps everything when no severe collinearity', () => {
    const X = [[1, 5], [2, 1], [3, 6], [4, 2], [5, 7], [6, 3], [7, 8], [8, 1]]
    const res = pruneCollinear(X, ['a', 'b'], 10)
    expect(res.dropped.length).toBe(0)
    expect(res.keptNames).toEqual(['a', 'b'])
  })
})
