// lib/simulatorExport.ts
// Builds the Driver Simulator JSON payload (simulator-payload-spec v1.0) from a
// fitted regression on the Statistics page. One self-contained object per model:
// linear OLS emits link:"identity" (with sigma = residual SD), binary logistic
// emits link:"logit" (log-odds coefficients, NO sigma). The consumer needs
// nothing else — no raw data, no callback.
//
// Producer-side assertions mirror the consumer's validation (spec §15) plus the
// silent-failure classes it can't catch: sigma must be the residual SD (not a
// coefficient SE), coefs must be log-odds (never odds ratios), moments must come
// from the ESTIMATION SAMPLE (the listwise-deleted rows that entered the fit),
// and a separated logistic fit (|coef| > 15 or se > 10) must not export at all.

import type { RegressionResult, LogisticResult } from '@/lib/statsUtils'

export interface SimulatorPredictor {
  name: string
  coef: number
  mean: number
  sd: number
  min: number
  max: number
}

export interface SimulatorPayload {
  schema_version: 1
  name?: string
  outcome?: string
  link: 'identity' | 'logit'
  scale?: [number, number]
  n?: number
  df?: number
  r2?: number
  intercept: number
  sigma?: number
  predictors: SimulatorPredictor[]
  se?: number[]
  corr?: number[][]
}

export type SimulatorExportResult =
  | { ok: true; payload: SimulatorPayload }
  | { ok: false; error: string }

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

// Per-predictor moments over the estimation sample. `col` is the design-matrix
// column for that predictor — the exact values that entered the fit, AFTER
// listwise deletion (spec §5: full-dataset moments would desync the sliders
// from the model). A 0/1 dummy column gets sd = sqrt(p(1-p)) per spec §12; a
// continuous column gets the sample (n-1) standard deviation.
export function columnMoments(col: number[]): { mean: number; sd: number; min: number; max: number } | null {
  if (!col.length || col.some(v => !Number.isFinite(v))) return null
  const n = col.length
  const mean = col.reduce((s, v) => s + v, 0) / n
  let min = col[0], max = col[0]
  for (const v of col) { if (v < min) min = v; if (v > max) max = v }
  const isDummy = col.every(v => v === 0 || v === 1)
  let sd: number
  if (isDummy) {
    sd = Math.sqrt(mean * (1 - mean))
  } else {
    const ss = col.reduce((s, v) => s + (v - mean) ** 2, 0)
    sd = n > 1 ? Math.sqrt(ss / (n - 1)) : 0
  }
  return { mean, sd, min, max }
}

// se + corr from the (k+1)×(k+1) covariance matrix, intercept first (spec §10).
// Emitting the pair rather than vcov: easier to eyeball, and the consumer
// rebuilds vcov[i][j] = corr[i][j]·se[i]·se[j] exactly.
function seCorrFromVcov(vcov: number[][]): { se: number[]; corr: number[][] } | null {
  const q = vcov.length
  if (!q || vcov.some(row => row.length !== q)) return null
  const se = vcov.map((row, i) => Math.sqrt(row[i]))
  if (se.some(s => !Number.isFinite(s) || s <= 0)) return null
  const corr = vcov.map((row, i) => row.map((v, j) => {
    if (i === j) return 1
    const c = v / (se[i] * se[j])
    // Numerical fuzz can push |c| a hair past 1; clamp rather than reject.
    return Math.max(-1, Math.min(1, c))
  }))
  // Symmetrize exactly (the inputs are symmetric up to floating-point noise).
  for (let i = 0; i < q; i++) for (let j = i + 1; j < q; j++) {
    const m = (corr[i][j] + corr[j][i]) / 2
    corr[i][j] = m; corr[j][i] = m
  }
  return { se, corr }
}

// Positive-definiteness check via Cholesky on the implied vcov (spec §10: a
// matrix needing the consumer's ridge rescue signals a construction error —
// catch it before it leaves the platform).
export function isPositiveDefinite(se: number[], corr: number[][]): boolean {
  const q = se.length
  const A = corr.map((row, i) => row.map((c, j) => c * se[i] * se[j]))
  const L: number[][] = Array.from({ length: q }, () => new Array(q).fill(0))
  for (let i = 0; i < q; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j]
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k]
      if (i === j) {
        if (s <= 0) return false
        L[i][i] = Math.sqrt(s)
      } else {
        L[i][j] = s / L[j][j]
      }
    }
  }
  return true
}

interface CommonInput {
  /** Model title for the simulator header — include client/dataset and outcome. */
  name?: string
  /** Human-readable outcome label (spec: use the display label, not the key). */
  outcome?: string
  /** Human-readable predictor labels, same order as the fit's non-intercept terms. */
  predictorLabels: string[]
  /** Design-matrix columns of the ESTIMATION sample, one per predictor, same order. */
  sampleColumns: number[][]
}

// Shared assembly + assertions for both links. `betas` are on the
// linear-predictor scale, intercept first.
function assemble(
  link: 'identity' | 'logit',
  betas: number[],
  vcov: number[][] | undefined,
  input: CommonInput,
  extras: Partial<SimulatorPayload>,
): SimulatorExportResult {
  const k = input.predictorLabels.length
  if (!k) return { ok: false, error: 'No predictors in the model.' }
  if (betas.length !== k + 1) return { ok: false, error: 'Coefficient count does not match predictors.' }
  if (input.sampleColumns.length !== k) return { ok: false, error: 'Estimation-sample columns do not match predictors.' }
  if (betas.some(b => !finite(b))) return { ok: false, error: 'Model has a non-finite coefficient — not exportable.' }

  const predictors: SimulatorPredictor[] = []
  for (let i = 0; i < k; i++) {
    const m = columnMoments(input.sampleColumns[i])
    if (!m) return { ok: false, error: 'Predictor "' + input.predictorLabels[i] + '" has non-finite values in the estimation sample.' }
    if (!(m.max > m.min)) return { ok: false, error: 'Predictor "' + input.predictorLabels[i] + '" has no variation (max must exceed min).' }
    predictors.push({ name: input.predictorLabels[i], coef: betas[i + 1], mean: m.mean, sd: m.sd, min: m.min, max: m.max })
  }

  const payload: SimulatorPayload = {
    schema_version: 1,
    ...(input.name ? { name: input.name } : {}),
    ...(input.outcome ? { outcome: input.outcome } : {}),
    link,
    ...extras,
    intercept: betas[0],
    predictors,
  }

  // Coefficient-uncertainty block — optional per spec, but strongly recommended;
  // emit it whenever the covariance matrix is usable, silently omit otherwise.
  if (vcov && vcov.length === k + 1) {
    const sc = seCorrFromVcov(vcov)
    if (sc && isPositiveDefinite(sc.se, sc.corr)) {
      payload.se = sc.se
      payload.corr = sc.corr
    }
  }

  // Final finiteness sweep — NaN/Infinity are not valid JSON (spec §11) and a
  // model producing them should not be exported at all.
  const bad = JSON.stringify(payload, (_key, v) =>
    typeof v === 'number' && !Number.isFinite(v) ? '__NONFINITE__' : v,
  ).includes('__NONFINITE__')
  if (bad) return { ok: false, error: 'Model contains non-finite numbers — not exportable.' }

  return { ok: true, payload }
}

/** Linear OLS → link:"identity". `sigma` = residual SD = sqrt(MSE) = sqrt(SSE/(n−k−1)). */
export function buildLinearSimulatorPayload(
  res: RegressionResult,
  input: CommonInput & { scale?: [number, number] },
): SimulatorExportResult {
  const sigma = Math.sqrt(res.MSE)
  if (!finite(sigma) || sigma < 0) return { ok: false, error: 'Residual SD is not finite — not exportable.' }
  // Sanity (spec §4): sigma must be below the outcome's own SD, and
  // 1 − sigma²/var(y) should land near R². Var(y) = SST/(n−1).
  const varY = res.SST / Math.max(res.n - 1, 1)
  if (varY > 0 && sigma * sigma >= varY * 1.0001 && res.R2 > 0) {
    return { ok: false, error: 'Residual SD exceeds the outcome’s own SD — model not exportable.' }
  }
  return assemble('identity', res.coefs.map(c => c.beta), res.vcov, input, {
    ...(input.scale ? { scale: input.scale } : {}),
    n: res.n,
    df: res.n - res.coefs.length,
    r2: res.R2,
    sigma,
  })
}

/** Binary logistic → link:"logit". Coefs are LOG-ODDS (beta), never odds ratios (§7); no sigma (§4). */
export function buildLogisticSimulatorPayload(
  res: LogisticResult,
  input: CommonInput,
): SimulatorExportResult {
  // Spec §12: separation / non-convergence serializes fine but simulates a
  // distribution pinned at 0%/100% — block it and surface the model warning.
  if (res.separation || !res.converged) {
    return { ok: false, error: 'The model did not estimate reliably (separation / non-convergence) — fix the model before exporting.' }
  }
  if (res.coefs.some((c, i) => i > 0 && Math.abs(c.beta) > 15)) {
    return { ok: false, error: 'A coefficient exceeds ±15 (likely separation) — not exportable.' }
  }
  if (res.coefs.some(c => c.se > 10)) {
    return { ok: false, error: 'A coefficient standard error exceeds 10 (likely separation) — not exportable.' }
  }
  return assemble('logit', res.coefs.map(c => c.beta), res.vcov, input, {
    n: res.n,
    r2: res.pseudoR2,
  })
}

/** Spec §11 suggested filename: `{client}-{model}-simulator.json`. */
export function simulatorFilename(datasetName: string, outcomeLabel: string): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'model'
  return slug(datasetName) + '-' + slug(outcomeLabel) + '-simulator.json'
}
