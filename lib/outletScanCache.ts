// Persisted form of lib/outletReport's Scan — the fix for the Advanced
// Analytics O(N)-per-click wall (PERFORMANCE_REVIEW.md §8). scanDataset pages
// the ENTIRE dataset's JSONB (~1 KB/row) on every view; everything downstream
// actually needs only per-outlet aggregates plus a ~30 B/row digest, so THAT is
// what we persist in dataset_state.outlet_scan_cache (sql/195) and hydrate on
// later requests. Compute-on-miss: the first view after data changes pays the
// scan and stores the result; every other view is one bounded read.
//
// Pure functions only (no supabase, no server imports) — the orchestrating
// loadScan lives in lib/outletReport.ts. Imports from outletReport are
// TYPE-ONLY, so there is no runtime module cycle.
import type { Scan, ScanRow, Outlet, Acc, Example, ThemeAbs } from '@/lib/outletReport'
import type { PredExample, PredReview } from '@/lib/outletPredictor'

// ── Fingerprint ──────────────────────────────────────────────────────────────
// Mirrors the sql/194 filter_options pattern: the cache is valid only while
// nothing the scan reads has moved. Components:
//   row_count + last_synced_at  — rows added/removed/resynced
//   theme model                 — matchers change every mine/merge
//   hierarchy level designations— digested paths depend on them
//   taxonomy rollup updatedAts  — bump at classify completion, so _tx changes
//                                 (dimensions) invalidate without a row delta
export function scanFingerprint(parts: {
  rowCount: number
  lastSyncedAt: string | null
  themeModel: unknown
  hierLevels: { field: string; level: number }[]
  taxUpdatedAts: string[]
}): string {
  return [
    parts.rowCount,
    parts.lastSyncedAt || '',
    h32(JSON.stringify(parts.themeModel ?? null)),
    h32(JSON.stringify(parts.hierLevels)),
    h32(parts.taxUpdatedAts.join('|')),
  ].join(':')
}

function h32(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

// ── Persisted shape (v1) ─────────────────────────────────────────────────────

type PAcc = { pos: number; neg: number; total: number; xp: [string, string] | null; xn: [string, string] | null }
type PThemeAbs = [number, number, number, number] // mentions, ratingSum, ratingN, low

type POutlet = {
  id: string; nm: string; ct: string; st: string; ad: string
  rv: number; rs: number; rn: number; dc: number; tm: number
  rc: number[]; or: number; d0: string; d1: string
  ds: Record<string, PAcc>; ts: Record<string, PAcc>; ta: Record<string, PThemeAbs>
}

// One digest row: [outletIdx | -1, rating, date10, themeIdxs | -1, hierPathIdx | -1]
type PRow = [number, number, string, number[] | -1, number]

export type PersistedScan = {
  v: 1
  fingerprint: string
  computedAt: string
  brand: string
  themeLabels: string[]
  themeAvailable: boolean
  dimAvailable: boolean
  outlets: POutlet[]
  themeChain: Record<string, PAcc>
  dimChain: Record<string, PAcc>
  lowExamples: PredExample[]
  highExamples: PredExample[]
  hierPaths: string[][]
  rows: PRow[]
}

// ── Serialize ────────────────────────────────────────────────────────────────

const packAcc = (a: Acc): PAcc => ({
  pos: a.pos, neg: a.neg, total: a.total,
  xp: a.exPos ? [a.exPos.full, a.exPos.ev] : null,
  xn: a.exNeg ? [a.exNeg.full, a.exNeg.ev] : null,
})
const packAccMap = (m: Map<string, Acc>): Record<string, PAcc> =>
  Object.fromEntries([...m.entries()].map(([k, a]) => [k, packAcc(a)]))

export function serializeScan(scan: Scan, fingerprint: string): PersistedScan {
  const outletIdx = new Map(scan.outlets.map((o, i) => [o.placeId, i]))
  const hierPaths: string[][] = []
  const hierIdx = new Map<string, number>()
  const rows: PRow[] = scan.rows.map((r) => {
    let hi = -1
    if (r.h) {
      const key = r.h.join('\u001e')
      const existing = hierIdx.get(key)
      if (existing !== undefined) hi = existing
      else { hi = hierPaths.length; hierPaths.push(r.h); hierIdx.set(key, hi) }
    }
    return [r.p !== null ? (outletIdx.get(r.p) ?? -1) : -1, r.r, r.d, r.t ?? -1, hi]
  })
  return {
    v: 1, fingerprint, computedAt: new Date().toISOString(),
    brand: scan.brand,
    themeLabels: scan.themeLabels,
    themeAvailable: scan.themeAvailable,
    dimAvailable: scan.dimAvailable,
    outlets: scan.outlets.map((o) => ({
      id: o.placeId, nm: o.name, ct: o.city, st: o.state, ad: o.address,
      rv: o.reviews, rs: o.ratingSum, rn: o.ratingN, dc: o.dimClassified, tm: o.themeMatched,
      rc: o.ratingCounts, or: o.ownerResponded, d0: o.minDate, d1: o.maxDate,
      ds: packAccMap(o.dimSubs), ts: packAccMap(o.themeSubs),
      ta: Object.fromEntries([...o.themeAbs.entries()].map(([k, t]) => [k, [t.mentions, t.ratingSum, t.ratingN, t.low] as PThemeAbs])),
    })),
    themeChain: packAccMap(scan.themeChain),
    dimChain: packAccMap(scan.dimChain),
    lowExamples: scan.lowExamples,
    highExamples: scan.highExamples,
    hierPaths, rows,
  }
}

// ── Hydrate ──────────────────────────────────────────────────────────────────

const unpackEx = (x: [string, string] | null): Example | null => (x ? { full: x[0], ev: x[1] } : null)
const unpackAcc = (a: PAcc): Acc => ({ pos: a.pos, neg: a.neg, total: a.total, exPos: unpackEx(a.xp), exNeg: unpackEx(a.xn) })
const unpackAccMap = (r: Record<string, PAcc>): Map<string, Acc> =>
  new Map(Object.entries(r).map(([k, a]) => [k, unpackAcc(a)]))

// Everything but labelFor — the caller attaches it (makeLabelFor lives in
// outletReport; importing it here would make the module cycle a runtime one).
export function hydrateScan(p: PersistedScan): Omit<Scan, 'labelFor'> {
  const outlets: Outlet[] = p.outlets.map((o) => ({
    placeId: o.id, name: o.nm, city: o.ct, state: o.st, address: o.ad,
    reviews: o.rv, ratingSum: o.rs, ratingN: o.rn, dimClassified: o.dc, themeMatched: o.tm,
    ratingCounts: o.rc, ownerResponded: o.or, minDate: o.d0, maxDate: o.d1,
    dimSubs: unpackAccMap(o.ds), themeSubs: unpackAccMap(o.ts),
    themeAbs: new Map<string, ThemeAbs>(Object.entries(o.ta).map(([k, t]) => [k, { mentions: t[0], ratingSum: t[1], ratingN: t[2], low: t[3] }])),
  }))
  const rows: ScanRow[] = p.rows.map((r) => ({
    p: r[0] >= 0 ? outlets[r[0]].placeId : null,
    r: r[1], d: r[2],
    t: r[3] === -1 ? null : r[3],
    h: r[4] >= 0 ? p.hierPaths[r[4]] : null,
  }))
  return {
    brand: p.brand,
    brandTokens: new Set<string>(p.brand.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2)),
    outlets,
    outletsById: new Map(outlets.map((o) => [o.placeId, o])),
    themeChain: unpackAccMap(p.themeChain),
    dimChain: unpackAccMap(p.dimChain),
    themeAvailable: p.themeAvailable,
    dimAvailable: p.dimAvailable,
    rows,
    themeLabels: p.themeLabels,
    reviewMatrix: deriveReviewMatrix(rows, p.themeLabels.length),
    lowExamples: p.lowExamples,
    highExamples: p.highExamples,
  }
}

// Rebuild the predictor's review matrix from the digest. Both the fresh-scan
// path (outletReport) and the hydrated path derive it HERE, so they can't drift.
export function deriveReviewMatrix(rows: ScanRow[], themeCount: number): PredReview[] {
  const out: PredReview[] = []
  for (const r of rows) {
    if (r.t === null || !r.r || !r.p) continue
    const themes = new Array(themeCount).fill(false)
    for (const i of r.t) themes[i] = true
    out.push({ placeId: r.p, rating: r.r, themes, month: r.d.slice(0, 7) || undefined })
  }
  return out
}
