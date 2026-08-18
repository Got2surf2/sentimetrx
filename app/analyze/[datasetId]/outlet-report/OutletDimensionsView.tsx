// Peer-relative Dimensions block for the per-outlet report.
//
// The chain-wide Leaderboard has always shown Dimensions next to Themes, but the
// per-outlet report showed themes only — `selected.dimensions` was computed on
// every report and consumed nowhere except the narrative sentence. This renders
// it (owner ask, 2026-08-18).
//
// FORM: the data is a SIGNED distance from the network average per dimension, so
// it is a diverging bar centred on that average — position carries the sign,
// length carries the size, and both arms share one scale so rows are comparable.
// (Two independently-scaled arms would make a +4 look like a −40.)
//
// COLOR: diverging = two poles + a neutral midpoint. teal-600 #0d9488 (ahead) ↔
// rose-600 #e11d48 (behind), validated with the dataviz palette checker against
// this page's white surface: CVD ΔE 10.2 deutan (target ≥ 8), normal-vision 32.4,
// both ≥ 3:1 contrast — all PASS. ⚠️ The obvious emerald-600/rose-600 pair FAILS
// (ΔE 5.8, below the 6 floor) — the classic green/red collapse. Do not "restore"
// it. Teal is also the Datanautix brand colour already on this page.
//
// Identity is never colour-alone: the side of the centre rule, the signed value
// at each bar tip, and the grouped legend all carry it independently.

import type { ComparisonBlock, ThemeDelta } from '@/lib/outletReport'

const AHEAD = '#0d9488'   // teal-600
const BEHIND = '#e11d48'  // rose-600

/** Bars reach at most this share of the track's half-width, leaving room for the
 *  tip label to sit outside the bar end rather than be clipped by it. */
const MAX_ARM = 38

const pts = (d: number) => `${d > 0 ? '+' : '−'}${Math.abs(Math.round(d * 100))}`
/** Net rates are signed — the same minus glyph as the deltas, never "-100% positive". */
const netPct = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(Math.round(n * 100))}%`

function Row({ d, scale, showAxis }: { d: ThemeDelta; scale: number; showAxis: boolean }) {
  const ahead = d.delta > 0
  const arm = scale > 0 ? Math.max(1.5, (Math.abs(d.delta) / scale) * MAX_ARM) : 0
  const color = ahead ? AHEAD : BEHIND
  const title =
    `${d.label}: this location ${netPct(d.outletNet)} net-positive vs ${netPct(d.chainNet)} across the network ` +
    `(${pts(d.delta)} pts) · ${d.n.toLocaleString()} mentions here`

  return (
    <div className="flex items-center gap-3 text-sm" title={title}>
      <div className="w-44 shrink-0 truncate py-1">
        <span className="font-medium text-gray-800">{d.label}</span>
        {showAxis && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-gray-400">{d.axis}</span>}
      </div>

      {/* Diverging track. The centre rule IS the network average — it spans the
          FULL row height (no vertical padding on the row) so consecutive rows'
          rules meet and read as one continuous axis rather than dashes. */}
      <div className="relative h-7 flex-1 print:h-6">
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-gray-300 print:bg-gray-400" />
        <div
          className={`absolute top-1/2 h-2.5 -translate-y-1/2 ${ahead ? 'rounded-r-[4px]' : 'rounded-l-[4px]'}`}
          style={{
            background: color,
            width: `${arm}%`,
            // Square end anchored ON the baseline, rounded end at the data tip.
            ...(ahead ? { left: '50%' } : { right: '50%' }),
          }}
        />
        {/* Value at the tip, outside the bar — never inside, where a short bar
            would clip it. */}
        <span
          className="absolute top-1/2 -translate-y-1/2 text-[11px] font-semibold tabular-nums"
          style={{
            color,
            ...(ahead ? { left: `calc(50% + ${arm}% + 6px)` } : { right: `calc(50% + ${arm}% + 6px)` }),
          }}
        >
          {pts(d.delta)}
        </span>
      </div>

      <div className="w-36 shrink-0 py-1 text-right text-[11px] tabular-nums text-gray-400">
        <span className="font-semibold text-gray-600">{netPct(d.outletNet)}</span> net
        <span className="text-gray-300"> · </span>
        {d.n.toLocaleString()} {d.n === 1 ? 'mention' : 'mentions'}
      </div>
    </div>
  )
}

export default function OutletDimensionsView({
  block, outletCount, unitLabel = 'location',
}: {
  block: ComparisonBlock
  outletCount: number
  unitLabel?: string
}) {
  if (!block.available) return null

  // One list, sorted best → worst, so the reader sees the whole spread at once
  // rather than two disconnected piles.
  const rows: ThemeDelta[] = [...block.strengths, ...block.weaknesses].sort((a, b) => b.delta - a.delta)

  if (rows.length === 0) {
    return (
      <div className="mt-6 print:mt-4 print:break-inside-avoid">
        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
          Dimensions — how this {unitLabel} compares
        </h2>
        <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-4 text-xs text-gray-500">
          No dimension differed from the network by enough to report. That is a
          result, not a gap: on the dimensions guests raise here, this {unitLabel}
          tracks the rest of the network.
        </p>
      </div>
    )
  }

  const scale = Math.max(...rows.map((r) => Math.abs(r.delta)))
  const axes = new Set(rows.map((r) => r.axis))
  const showAxis = axes.size > 1
  const best = rows.find((r) => r.delta > 0 && r.quote)
  const worst = [...rows].reverse().find((r) => r.delta < 0 && r.quote)

  return (
    <div className="mt-6 print:mt-4 print:break-inside-avoid">
      <div className="mb-2.5 flex items-baseline justify-between gap-4">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
          Dimensions — how this {unitLabel} compares
        </h2>
        {/* Legend: always present, two poles. */}
        <span className="flex items-center gap-3 text-[10px] text-gray-400">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2.5 rounded-[2px]" style={{ background: AHEAD }} /> ahead of network
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2.5 rounded-[2px]" style={{ background: BEHIND }} /> behind
          </span>
        </span>
      </div>

      <div className="rounded-lg border border-gray-200 px-4 py-2.5 print:border-gray-300">
        {rows.map((d) => <Row key={`${d.axis}:${d.sub}`} d={d} scale={scale} showAxis={showAxis} />)}
      </div>

      {/* Real guest language for the two biggest gaps.
          ⚠️ Framed as "a review that mentions X", NOT as proof of the sentiment.
          The classifier's `evidence` is a fixed-width window (lib/outletReport
          extractSentence), so the sentence around it does not reliably read as
          the polarity — a ▼ dimension was quoting a cheerful opening line. The
          colour identifies WHICH row the quote belongs to; it makes no claim
          about the quote's own tone. */}
      {(best || worst) && (
        <div className="mt-3">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
            In their words <span className="font-normal normal-case tracking-normal">— a review mentioning each</span>
          </div>
          <div className="mt-1.5 space-y-1.5 text-xs leading-relaxed">
            {best && (
              <div className="flex gap-2">
                <span className="w-24 shrink-0 font-semibold" style={{ color: AHEAD }}>{best.label}</span>
                <span className="italic text-gray-600">“{best.quote}”</span>
              </div>
            )}
            {worst && (
              <div className="flex gap-2">
                <span className="w-24 shrink-0 font-semibold" style={{ color: BEHIND }}>{worst.label}</span>
                <span className="italic text-gray-600">“{worst.quote}”</span>
              </div>
            )}
          </div>
        </div>
      )}

      <p className="mt-2.5 text-[10px] leading-relaxed text-gray-400">
        Each dimension is scored by <span className="font-medium text-gray-500">net-positive rate</span> — the share of
        mentions that are positive minus the share that are negative. The bar is the gap between this {unitLabel} and
        the same figure across all {outletCount.toLocaleString()} {unitLabel}s, in percentage points; the centre line is
        the network. Only dimensions with enough mentions here and network-wide to be reliable are shown, so a short
        list means few differences cleared the bar — not that little was said.
      </p>
    </div>
  )
}
