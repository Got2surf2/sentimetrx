// lib/statsUtils.ts
// Statistical computation functions for the Statistics module.
// Ported from Ana.html's statistical engine.

export function mean(a: number[]): number { return a.length ? a.reduce(function(s, v) { return s + v }, 0) / a.length : NaN }
export function variance(a: number[], ddof: number = 1): number { if (a.length < 2) return NaN; var m = mean(a); return a.reduce(function(s, v) { return s + (v - m) ** 2 }, 0) / (a.length - ddof) }
export function std(a: number[], ddof: number = 1): number { return Math.sqrt(variance(a, ddof)) }
export function median(a: number[]): number { var s = a.slice().sort(function(x, y) { return x - y }); var m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
export function quantile(a: number[], q: number): number { var s = a.slice().sort(function(x, y) { return x - y }); var p = (s.length - 1) * q; var lo = Math.floor(p); var hi = Math.ceil(p); return s[lo] + (s[hi] - s[lo]) * (p - lo) }
export function skewness(a: number[]): number { var n = a.length, m = mean(a), s = std(a, 1); return s ? a.reduce(function(x, v) { return x + ((v - m) / s) ** 3 }, 0) / n : 0 }
export function kurtosis(a: number[]): number { var n = a.length, m = mean(a), s = std(a, 1); return s ? a.reduce(function(x, v) { return x + ((v - m) / s) ** 4 }, 0) / n - 3 : 0 }

function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x)
  x -= 1
  var c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7]
  var ag = c[0]; for (var i = 1; i < 9; i++) ag += c[i] / (x + i)
  var t = x + 7.5
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(ag)
}

function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0; if (x >= 1) return 1
  if (x > (a + 1) / (a + b + 2)) return 1 - incompleteBeta(1 - x, b, a)
  var lbeta = logGamma(a) + logGamma(b) - logGamma(a + b)
  var front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lbeta) / a
  var f = 1, Cv = 1, D = 1 - ((a + b) * x / (a + 1)); D = 1 / D; f = D
  for (var m = 1; m <= 200; m++) {
    var dm = m, num = dm * (b - dm) * x / ((a + 2 * dm - 1) * (a + 2 * dm))
    D = 1 + num * D; if (Math.abs(D) < 1e-30) D = 1e-30; Cv = 1 + num / Cv; if (Math.abs(Cv) < 1e-30) Cv = 1e-30; D = 1 / D; var delta = Cv * D; f *= delta
    num = -(a + dm) * (a + b + dm) * x / ((a + 2 * dm) * (a + 2 * dm + 1))
    D = 1 + num * D; if (Math.abs(D) < 1e-30) D = 1e-30; Cv = 1 + num / Cv; if (Math.abs(Cv) < 1e-30) Cv = 1e-30; D = 1 / D; delta = Cv * D; f *= delta
    if (Math.abs(delta - 1) < 1e-8) break
  }
  return front * f
}

function incompleteGamma(a: number, x: number): number {
  if (x <= 0) return 0; var sum = 1 / a, term = 1 / a
  for (var n = 1; n < 200; n++) { term *= x / (a + n); sum += term; if (Math.abs(term) < 1e-10) break }
  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a))
}

export function tDist2p(t: number, df: number): number { return incompleteBeta(df / (df + t * t), df / 2, 0.5) }
export function fDistP(F: number, df1: number, df2: number): number { return incompleteBeta(df2 / (df2 + df1 * F), df2 / 2, df1 / 2) }
export function chiSqP(c: number, df: number): number { return c <= 0 ? 1 : 1 - incompleteGamma(df / 2, c / 2) }
export function normCDF(z: number): number {
  var a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911
  var sg = z < 0 ? -1 : 1; z = Math.abs(z); var t = 1 / (1 + p * z)
  return 0.5 * (1 + sg * (1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z)))
}

export function probit(p: number): number {
  if (p <= 0) return -8; if (p >= 1) return 8
  var c = [0.3374754822726147, 0.9761690190917186, 0.1607979714918209, 0.0276438810333863, 0.0038405729373609, 0.0003951896511349, 0.0000321767881768, 0.0000002888167364, 0.0000003960315187]
  var y = p - 0.5
  if (Math.abs(y) < 0.42) {
    var r = y * y
    var aa = [2.50662823884, -18.61500062529, 41.39119773534, -25.44106049637]
    var bb = [-8.47351093090, 23.08336743743, -21.06224101826, 3.13082909833]
    return y * (((aa[3] * r + aa[2]) * r + aa[1]) * r + aa[0]) / ((((bb[3] * r + bb[2]) * r + bb[1]) * r + bb[0]) * r + 1)
  }
  var rr = p < 0.5 ? Math.log(-Math.log(p)) : Math.log(-Math.log(1 - p))
  var x = c[0]; for (var i = 1; i < 9; i++) x += c[i] * rr ** i
  return p < 0.5 ? -x : x
}

export function shapiroWilk(x: number[]): { W: number; p: number } {
  var n = x.length; if (n < 3) return { W: NaN, p: NaN }
  var s = x.slice().sort(function(a, b) { return a - b })
  var m = mean(s), sd_ = std(s, 1); if (!sd_) return { W: 1, p: 1 }
  var ns = s.map(function(_, i) { return probit((i + 1 - 0.375) / (n + 0.25)) }), mns = mean(ns)
  var num = s.reduce(function(a, v, i) { return a + (v - m) * (ns[i] - mns) }, 0)
  var d1 = s.reduce(function(a, v) { return a + (v - m) ** 2 }, 0)
  var d2 = ns.reduce(function(a, v) { return a + (v - mns) ** 2 }, 0)
  var W = Math.min(num ** 2 / (d1 * d2), 1)
  var mu = -1.2725 + 1.0521 * Math.log(Math.log(n))
  var sigma = 1.0308 - 0.26763 * Math.log(n)
  var z = (Math.log(1 - Math.max(W, 0.0001)) - mu) / sigma
  return { W: W, p: Math.max(0, Math.min(1, 1 - normCDF(z))) }
}

function rank(a: number[]): number[] {
  var sorted = a.map(function(v, i) { return { v: v, i: i } }).sort(function(a, b) { return a.v - b.v })
  var ranks = new Array(a.length); var i = 0
  while (i < sorted.length) { var j = i; while (j < sorted.length && sorted[j].v === sorted[i].v) j++; var r = (i + j - 1) / 2 + 1; for (var k = i; k < j; k++) ranks[sorted[k].i] = r; i = j }
  return ranks
}

export function pearsonR(x: number[], y: number[]): { r: number; p: number; n: number } {
  var n = x.length; if (n < 3) return { r: NaN, p: NaN, n: n }
  var mx = mean(x), my = mean(y)
  var num = x.reduce(function(s, v, i) { return s + (v - mx) * (y[i] - my) }, 0)
  var dx = Math.sqrt(x.reduce(function(s, v) { return s + (v - mx) ** 2 }, 0))
  var dy = Math.sqrt(y.reduce(function(s, v) { return s + (v - my) ** 2 }, 0))
  if (!dx || !dy) return { r: NaN, p: NaN, n: n }
  var r = num / (dx * dy), t = r * Math.sqrt((n - 2) / (1 - r * r))
  return { r: r, p: tDist2p(Math.abs(t), n - 2), n: n }
}

export function spearmanR(x: number[], y: number[]): { r: number; p: number; n: number } { return pearsonR(rank(x), rank(y)) }

export function welchTTest(a: number[], b: number[]): { t: number; df: number; p: number; ma: number; mb: number; sa: number; sb: number; na: number; nb: number; d: number; se: number } | null {
  var na = a.length, nb = b.length; if (na < 2 || nb < 2) return null
  var ma = mean(a), mb = mean(b), va = variance(a), vb = variance(b)
  var se = Math.sqrt(va / na + vb / nb); if (!se) return null
  var t = (ma - mb) / se, df = (va / na + vb / nb) ** 2 / ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1))
  var d = (ma - mb) / Math.sqrt((va + vb) / 2)
  return { t: t, df: df, p: tDist2p(Math.abs(t), df), ma: ma, mb: mb, sa: Math.sqrt(va), sb: Math.sqrt(vb), na: na, nb: nb, d: d, se: se }
}

export function mannWhitneyU(a: number[], b: number[]): { U: number; z: number; p: number; na: number; nb: number } | null {
  var na = a.length, nb = b.length; if (!na || !nb) return null
  var comb = a.map(function(v) { return { v: v, g: 0 } }).concat(b.map(function(v) { return { v: v, g: 1 } })).sort(function(x, y) { return x.v - y.v })
  var ranks_ = new Array(comb.length); var i = 0
  while (i < comb.length) { var j = i; while (j < comb.length && comb[j].v === comb[i].v) j++; var r = (i + j + 1) / 2; for (var k = i; k < j; k++) ranks_[k] = r; i = j }
  var U1 = 0; comb.forEach(function(c, idx) { if (c.g === 0) U1 += ranks_[idx] }); U1 -= na * (na + 1) / 2
  var U2 = na * nb - U1, U = Math.min(U1, U2), z = (U - na * nb / 2) / Math.sqrt(na * nb * (na + nb + 1) / 12)
  return { U: U, z: z, p: 2 * (1 - normCDF(Math.abs(z))), na: na, nb: nb }
}

export function oneWayANOVA(groups: Record<string, number[]>): any {
  var keys = Object.keys(groups); if (keys.length < 2) return null
  var allV = keys.reduce(function(a, k) { return a.concat(groups[k]) }, [] as number[])
  var N = allV.length, gm = mean(allV), kk = keys.length
  var SSB = 0, SSW = 0; var gs: Record<string, { n: number; mean: number; sd: number }> = {}
  keys.forEach(function(key) { var g = groups[key]; var gmu = mean(g); SSB += g.length * (gmu - gm) ** 2; SSW += g.reduce(function(s, v) { return s + (v - gmu) ** 2 }, 0); gs[key] = { n: g.length, mean: gmu, sd: std(g) } })
  var dfB = kk - 1, dfW = N - kk; if (dfW <= 0) return null
  var MSB = SSB / dfB, MSW = SSW / dfW; if (!MSW) return null
  var F = MSB / MSW, p = fDistP(F, dfB, dfW), eta2 = SSB / (SSB + SSW)
  var pairwise: any[] = []
  for (var ii = 0; ii < keys.length; ii++) {
    for (var jj = ii + 1; jj < keys.length; jj++) {
      var r = welchTTest(groups[keys[ii]], groups[keys[jj]])
      if (r) pairwise.push({ a: keys[ii], b: keys[jj], t: r.t, df: r.df, p: r.p, ma: r.ma, mb: r.mb, pAdj: Math.min(1, r.p * keys.length * (keys.length - 1) / 2) })
    }
  }
  return { F: F, dfB: dfB, dfW: dfW, p: p, eta2: eta2, SSB: SSB, SSW: SSW, MSB: MSB, MSW: MSW, groupStats: gs, pairwise: pairwise, k: kk, N: N }
}

export function chiSquareStat(rf: string, cf: string, data: Record<string, unknown>[]): any {
  var rows = Array.from(new Set(data.map(function(r) { return String(r[rf] || '') }))).filter(Boolean)
  var cols = Array.from(new Set(data.map(function(r) { return String(r[cf] || '') }))).filter(Boolean)
  if (rows.length < 2 || cols.length < 2) return null
  var tbl: Record<string, Record<string, number>> = {}
  rows.forEach(function(r) { tbl[r] = {}; cols.forEach(function(c) { tbl[r][c] = 0 }) })
  data.forEach(function(r) { var rv = String(r[rf] || ''), cv = String(r[cf] || ''); if (tbl[rv] && cv in tbl[rv]) tbl[rv][cv]++ })
  var rS: Record<string, number> = {}; rows.forEach(function(r) { rS[r] = cols.reduce(function(s, c) { return s + tbl[r][c] }, 0) })
  var cS: Record<string, number> = {}; cols.forEach(function(c) { cS[c] = rows.reduce(function(s, r) { return s + tbl[r][c] }, 0) })
  var N = rows.reduce(function(s, r) { return s + rS[r] }, 0)
  var chi2 = 0; rows.forEach(function(r) { cols.forEach(function(c) { var E = rS[r] * cS[c] / N; if (E > 0) chi2 += (tbl[r][c] - E) ** 2 / E }) })
  var df = (rows.length - 1) * (cols.length - 1), p = chiSqP(chi2, df), V = Math.sqrt(chi2 / (N * Math.min(rows.length - 1, cols.length - 1)))
  return { chi2: chi2, df: df, p: p, V: V, N: N, rows: rows, cols: cols, table: tbl, rowSums: rS, colSums: cS }
}

function invertMatrix(M: number[][]): number[][] | null {
  var n = M.length, A = M.map(function(r) { return r.slice() }), I = M.map(function(_, i) { return M.map(function(_, j) { return i === j ? 1 : 0 }) })
  for (var col = 0; col < n; col++) {
    var mx = Math.abs(A[col][col]), mr = col
    for (var row = col + 1; row < n; row++) if (Math.abs(A[row][col]) > mx) { mx = Math.abs(A[row][col]); mr = row }
    var tmp = A[col]; A[col] = A[mr]; A[mr] = tmp; var tmpI = I[col]; I[col] = I[mr]; I[mr] = tmpI
    if (Math.abs(A[col][col]) < 1e-12) return null
    var piv = A[col][col]; for (var j = 0; j < n; j++) { A[col][j] /= piv; I[col][j] /= piv }
    for (var row2 = 0; row2 < n; row2++) { if (row2 === col) continue; var f = A[row2][col]; for (var j2 = 0; j2 < n; j2++) { A[row2][j2] -= f * A[col][j2]; I[row2][j2] -= f * I[col][j2] } }
  }
  return I
}

export function olsRegression(y: number[], X: number[][], names: string[]): any {
  var n = y.length, Xd = X.map(function(r) { return [1].concat(r) }), q = Xd[0].length
  var XtX = Array.from({ length: q }, function(_, i) { return Array.from({ length: q }, function(_, j) { return Xd.reduce(function(s, r) { return s + r[i] * r[j] }, 0) }) })
  var Xty = Array.from({ length: q }, function(_, i) { return Xd.reduce(function(s, r, ri) { return s + r[i] * y[ri] }, 0) })
  var inv = invertMatrix(XtX); if (!inv) return null
  var beta = inv.map(function(row) { return row.reduce(function(s, v, i) { return s + v * Xty[i] }, 0) })
  var yhat = Xd.map(function(row) { return row.reduce(function(s, v, i) { return s + v * beta[i] }, 0) })
  var resid = y.map(function(v, i) { return v - yhat[i] })
  var ym = mean(y), SSE = resid.reduce(function(s, v) { return s + v ** 2 }, 0), SST = y.reduce(function(s, v) { return s + (v - ym) ** 2 }, 0)
  var R2 = 1 - SSE / SST, R2adj = 1 - (1 - R2) * (n - 1) / (n - q), MSE = SSE / (n - q)
  var FF = ((SST - SSE) / (q - 1)) / MSE, Fp = fDistP(FF, q - 1, n - q)
  var se = inv.map(function(row, i) { return Math.sqrt(Math.abs(row[i] * MSE)) })
  var tStats = beta.map(function(b, i) { return b / se[i] }), pVals = tStats.map(function(t) { return tDist2p(Math.abs(t), n - q) })
  var coefs = ['Intercept'].concat(names).map(function(nm, i) { return { name: nm, beta: beta[i], se: se[i], t: tStats[i], p: pVals[i], ci: [beta[i] - 1.96 * se[i], beta[i] + 1.96 * se[i]] } })
  return { coefs: coefs, R2: R2, R2adj: R2adj, F: FF, Fp: Fp, n: n, p: q - 1, SSE: SSE, SST: SST, MSE: MSE, yhat: yhat, resid: resid, names: names }
}

export function getNum(field: string, data: Record<string, unknown>[]): number[] {
  return data.map(function(r) { return parseFloat(String(r[field] || '').replace(/,/g, '')) }).filter(function(v) { return !isNaN(v) })
}

// Formatting
export function fmt2(v: number): string { return isNaN(v) || v == null ? '\u2014' : Number(v).toFixed(2) }
export function fmt4(v: number): string { return isNaN(v) || v == null ? '\u2014' : Number(v).toFixed(4) }
export function fmtN(v: number): string { if (v == null || isNaN(v)) return '\u2014'; var a = Math.abs(v); return a >= 10000 || a < 0.001 ? v.toExponential(3) : a >= 100 ? v.toFixed(1) : a >= 10 ? v.toFixed(2) : v.toFixed(3) }
export function fmtP(p: number): string { if (p == null || isNaN(p)) return '\u2014'; if (p < 0.001) return 'p < 0.001'; return 'p = ' + p.toFixed(3) }

export function sigLabel(p: number): { stars: string; color: string; bg: string; border: string; label: string } {
  if (p < 0.001) return { stars: '***', color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0', label: 'highly significant' }
  if (p < 0.01) return { stars: '**', color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0', label: 'significant' }
  if (p < 0.05) return { stars: '*', color: '#d97706', bg: '#fffbeb', border: '#fde68a', label: 'marginally significant' }
  return { stars: 'ns', color: '#6b7280', bg: '#f4f5f7', border: '#e5e7eb', label: 'not significant' }
}
