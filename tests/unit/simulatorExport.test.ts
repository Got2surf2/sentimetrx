import { describe, it, expect } from 'vitest'
import { olsRegression, logisticRegression } from '@/lib/statsUtils'
import {
  buildLinearSimulatorPayload, buildLogisticSimulatorPayload,
  columnMoments, isPositiveDefinite, simulatorFilename,
} from '@/lib/simulatorExport'

// Driver Simulator payload export (simulator-payload-spec v1.0). Tests mirror
// the spec's consumer validation (§15) and acceptance tests (§16) on the
// producer side: structure/ordering, sigma = residual SD (identity only),
// log-odds coefficients under logit, estimation-sample moments, and blocked
// export for separated logistic fits.

// Deterministic synthetic sample: y = 1 + 0.5·x1 − 0.3·x2 + noise.
function makeLinearData(n = 200) {
  const rand = (i: number) => {
    // simple deterministic LCG-ish stream so tests never flake
    const v = Math.sin(i * 12.9898 + 78.233) * 43758.5453
    return v - Math.floor(v)
  }
  const X: number[][] = [], y: number[] = []
  for (let i = 0; i < n; i++) {
    const x1 = 1 + 4 * rand(i)
    const x2 = 1 + 4 * rand(i + 1000)
    X.push([x1, x2])
    y.push(1 + 0.5 * x1 - 0.3 * x2 + (rand(i + 2000) - 0.5))
  }
  return { X, y }
}

function fitLinear() {
  const { X, y } = makeLinearData()
  const res = olsRegression(y, X, ['x1', 'x2'])!
  expect(res).toBeTruthy()
  const cols = [X.map(r => r[0]), X.map(r => r[1])]
  return { res, cols, y }
}

describe('buildLinearSimulatorPayload', () => {
  it('emits the spec structure: identity link, sigma, k predictors, se k+1, corr (k+1)²', () => {
    const { res, cols } = fitLinear()
    const out = buildLinearSimulatorPayload(res, {
      name: 'Test model', outcome: 'Satisfaction', predictorLabels: ['Speed', 'Price'],
      sampleColumns: cols, scale: [1, 5],
    })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const p = out.payload
    expect(p.schema_version).toBe(1)
    expect(p.link).toBe('identity')
    expect(p.scale).toEqual([1, 5])
    expect(p.predictors).toHaveLength(2)
    expect(p.predictors.map(x => x.name)).toEqual(['Speed', 'Price'])
    expect(p.se).toHaveLength(3)                 // k+1, intercept first (§6)
    expect(p.corr).toHaveLength(3)
    p.corr!.forEach((row, i) => {
      expect(row).toHaveLength(3)
      expect(row[i]).toBe(1)                     // diagonal exactly 1.0 (§10)
      row.forEach(v => { expect(Math.abs(v)).toBeLessThanOrEqual(1) })
    })
    // symmetric
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(p.corr![i][j]).toBeCloseTo(p.corr![j][i], 12)
    expect(isPositiveDefinite(p.se!, p.corr!)).toBe(true)  // Cholesky without ridge (§16.3)
    expect(p.n).toBe(res.n)
    expect(p.df).toBe(res.n - 3)
  })

  it('sigma is the residual SD sqrt(SSE/(n−k−1)), below the outcome SD, consistent with R²', () => {
    const { res, cols, y } = fitLinear()
    const out = buildLinearSimulatorPayload(res, { predictorLabels: ['Speed', 'Price'], sampleColumns: cols })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const sigma = out.payload.sigma!
    expect(sigma).toBeCloseTo(Math.sqrt(res.SSE / (res.n - 3)), 10)
    const ym = y.reduce((s, v) => s + v, 0) / y.length
    const sdY = Math.sqrt(y.reduce((s, v) => s + (v - ym) ** 2, 0) / (y.length - 1))
    expect(sigma).toBeLessThan(sdY)                              // §4 sanity
    expect(1 - (sigma * sigma) / (sdY * sdY)).toBeCloseTo(out.payload.r2!, 1)
  })

  it('acceptance §16.6: intercept + Σ(coef × mean) equals the outcome mean to 4 decimals', () => {
    const { res, cols, y } = fitLinear()
    const out = buildLinearSimulatorPayload(res, { predictorLabels: ['Speed', 'Price'], sampleColumns: cols })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const p = out.payload
    const pred = p.intercept + p.predictors.reduce((s, x) => s + x.coef * x.mean, 0)
    const ym = y.reduce((s, v) => s + v, 0) / y.length
    expect(pred).toBeCloseTo(ym, 4)
  })

  it('predictor moments come from the estimation columns: mean/min/max/sd', () => {
    const { res, cols } = fitLinear()
    const out = buildLinearSimulatorPayload(res, { predictorLabels: ['Speed', 'Price'], sampleColumns: cols })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const col = cols[0]
    const m = out.payload.predictors[0]
    expect(m.mean).toBeCloseTo(col.reduce((s, v) => s + v, 0) / col.length, 10)
    expect(m.min).toBe(Math.min(...col))
    expect(m.max).toBe(Math.max(...col))
    expect(m.max).toBeGreaterThan(m.min)
  })

  it('rejects a constant predictor (max must exceed min, §15)', () => {
    const { X, y } = makeLinearData(50)
    const Xc = X.map(r => [r[0], 3])                 // second column constant
    const res = olsRegression(y, Xc, ['x1', 'const'])
    // singular design may already fail the fit; if it fits, the export must refuse
    if (res) {
      const out = buildLinearSimulatorPayload(res, {
        predictorLabels: ['x1', 'const'], sampleColumns: [Xc.map(r => r[0]), Xc.map(r => r[1])],
      })
      expect(out.ok).toBe(false)
    }
  })

  it('serialized payload contains no NaN/Infinity and is valid JSON round-trip', () => {
    const { res, cols } = fitLinear()
    const out = buildLinearSimulatorPayload(res, { predictorLabels: ['Speed', 'Price'], sampleColumns: cols })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const s = JSON.stringify(out.payload)
    expect(s).not.toMatch(/NaN|Infinity/)
    expect(JSON.parse(s)).toEqual(out.payload)
  })
})

// Deterministic logistic sample: P(y=1) = sigmoid(-2 + 1.2·x1 − 0.8·x2)
function makeLogisticData(n = 400) {
  const rand = (i: number) => {
    const v = Math.sin(i * 12.9898 + 78.233) * 43758.5453
    return v - Math.floor(v)
  }
  const X: number[][] = [], y: number[] = []
  for (let i = 0; i < n; i++) {
    const x1 = 1 + 4 * rand(i)
    const x2 = rand(i + 5000) > 0.5 ? 1 : 0        // dummy predictor
    const eta = -2 + 1.2 * x1 - 0.8 * x2
    const p = 1 / (1 + Math.exp(-eta))
    X.push([x1, x2])
    y.push(rand(i + 9000) < p ? 1 : 0)
  }
  return { X, y }
}

describe('buildLogisticSimulatorPayload', () => {
  it('emits link:"logit", log-odds coefficients (not odds ratios), pseudo-R², and NO sigma', () => {
    const { X, y } = makeLogisticData()
    const res = logisticRegression(y, X, ['x1', 'weekend'])!
    expect(res).toBeTruthy()
    const out = buildLogisticSimulatorPayload(res, {
      outcome: 'Will return', predictorLabels: ['x1', 'Visited on weekend'],
      sampleColumns: [X.map(r => r[0]), X.map(r => r[1])],
    })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const p = out.payload
    expect(p.link).toBe('logit')
    expect('sigma' in p).toBe(false)                          // §4: absent, not null-ish
    expect(p.r2).toBeCloseTo(res.pseudoR2, 12)
    // §7: coef is beta (log-odds) — must equal the model's beta and differ from exp(beta)
    expect(p.predictors[0].coef).toBeCloseTo(res.coefs[1].beta, 12)
    expect(p.predictors[0].coef).not.toBeCloseTo(res.coefs[1].or, 6)
    expect(p.intercept).toBeCloseTo(res.coefs[0].beta, 12)
    // recovered signs should match the generator (+1.2, −0.8)
    expect(p.predictors[0].coef).toBeGreaterThan(0)
    expect(p.predictors[1].coef).toBeLessThan(0)
    expect(p.se).toHaveLength(3)
    expect(isPositiveDefinite(p.se!, p.corr!)).toBe(true)
  })

  it('dummy predictor gets mean = proportion and sd = sqrt(p(1−p)) (§12)', () => {
    const { X, y } = makeLogisticData()
    const res = logisticRegression(y, X, ['x1', 'weekend'])!
    const dummyCol = X.map(r => r[1])
    const out = buildLogisticSimulatorPayload(res, {
      predictorLabels: ['x1', 'Visited on weekend'],
      sampleColumns: [X.map(r => r[0]), dummyCol],
    })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const d = out.payload.predictors[1]
    const prop = dummyCol.reduce((s, v) => s + v, 0) / dummyCol.length
    expect(d.mean).toBeCloseTo(prop, 12)
    expect(d.sd).toBeCloseTo(Math.sqrt(prop * (1 - prop)), 12)
    expect(d.min).toBe(0)
    expect(d.max).toBe(1)
  })

  it('blocks export on a separated fit (§12)', () => {
    // Perfectly separable: y = 1 exactly when x > 0.
    const X = Array.from({ length: 60 }, (_, i) => [i < 30 ? -1 - (i % 5) : 1 + (i % 5)])
    const y = X.map(r => (r[0] > 0 ? 1 : 0))
    const res = logisticRegression(y, X, ['x'])
    if (res) {
      const out = buildLogisticSimulatorPayload(res, { predictorLabels: ['x'], sampleColumns: [X.map(r => r[0])] })
      expect(out.ok).toBe(false)
      if (!out.ok) expect(out.error).toMatch(/separation|coefficient|not exportable|reliably/i)
    }
  })
})

describe('helpers', () => {
  it('columnMoments: continuous vs dummy sd conventions', () => {
    const cont = columnMoments([1, 2, 3, 4, 5])!
    expect(cont.mean).toBe(3)
    expect(cont.sd).toBeCloseTo(Math.sqrt(10 / 4), 12)        // sample sd
    const dum = columnMoments([0, 0, 1, 1])!
    expect(dum.sd).toBeCloseTo(0.5, 12)                       // sqrt(.5·.5)
    expect(columnMoments([1, NaN])).toBeNull()
  })

  it('simulatorFilename slugs to {client}-{model}-simulator.json', () => {
    expect(simulatorFilename("Ruth's Chris Reviews", 'Overall satisfaction'))
      .toBe('ruth-s-chris-reviews-overall-satisfaction-simulator.json')
    expect(simulatorFilename('', '')).toBe('model-model-simulator.json')
  })
})
