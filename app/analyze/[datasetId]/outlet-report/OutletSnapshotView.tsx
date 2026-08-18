// Absolute GM-facing "Location Performance Snapshot" — the printable page-1 view
// that matches the Datanautix Bareburger snapshot PDF. Presentational; all
// figures come from lib/outletReport computeSnapshot. Print styles keep it to a
// single clean page (the report's print output IS the export).

import type { OutletSnapshot, ReadVerdict, RatingBucket } from '@/lib/outletReport'
import { verbatimSupports } from '@/lib/verbatimGuard'
import { starBarColor } from '@/lib/ratingGradient'

const TEAL = '#0F7173'
const ORANGE = '#E85A1A'

function Datanautix() {
  return (
    <span className="text-[15px] font-extrabold lowercase tracking-tight">
      <span style={{ color: TEAL }}>data</span>
      <span style={{ color: ORANGE }}>nautix</span>
    </span>
  )
}

const pct0 = (n: number) => `${Math.round(n * 100)}%`

// READ pill colours.
const READ_STYLE: Record<ReadVerdict, string> = {
  FIX: 'bg-rose-100 text-rose-700',
  WATCH: 'bg-amber-100 text-amber-700',
  SOLID: 'bg-slate-100 text-slate-600',
  STRENGTH: 'bg-emerald-100 text-emerald-700',
}
const starColor = (avg: number) => (avg < 4.0 ? 'text-rose-600' : avg < 4.35 ? 'text-amber-600' : 'text-emerald-600')
const negColor = (p: number) => (p >= 0.35 ? 'text-rose-600' : p >= 0.18 ? 'text-amber-600' : 'text-gray-500')

function Kpi({ label, value, unit, sub, subColor }: { label: string; value: string; unit?: string; sub?: React.ReactNode; subColor?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 print:border-gray-300">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">{label}</div>
      <div className="mt-1 flex items-baseline gap-0.5">
        <span className="text-3xl font-bold text-gray-900">{value}</span>
        {unit && <span className="text-lg font-semibold text-gray-400">{unit}</span>}
      </div>
      {sub != null && <div className={`mt-0.5 text-xs ${subColor || 'text-gray-500'}`}>{sub}</div>}
    </div>
  )
}

function DistributionRow({ b }: { b: RatingBucket }) {
  const delta = b.pct - b.net.avg
  const at = (v: number) => `${Math.min(100, Math.max(0, v * 100))}%`
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-8 shrink-0 tabular-nums text-gray-500">{b.star} ★</span>
      <div className="relative h-2 flex-1">
        <div className="h-full overflow-hidden rounded-full bg-gray-100">
          <div className="h-full rounded-full" style={{ width: `${Math.max(1, b.pct * 100)}%`, background: starBarColor(b.star) }} />
        </div>
        {/* Network range for this star bucket: ▶ lowest outlet · ◀ highest outlet · │ average. */}
        <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: at(b.net.min) }} title={`Lowest outlet: ${pct0(b.net.min)}`}>
          {/* White so it stays visible sitting on the coloured bar; drop-shadow
              gives it a faint edge on the light track (and in the legend). */}
          <span className="block h-0 w-0 border-y-[3px] border-l-[5px] border-y-transparent border-l-white" style={{ filter: 'drop-shadow(0 0 0.5px rgba(0,0,0,0.55))' }} />
        </div>
        <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: at(b.net.max) }} title={`Highest outlet: ${pct0(b.net.max)}`}>
          <span className="block h-0 w-0 border-y-[3px] border-r-[5px] border-y-transparent border-r-gray-400" />
        </div>
        <div
          className="absolute top-1/2 h-3.5 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gray-700"
          style={{ left: at(b.net.avg) }}
          title={`Network avg ${b.star}★: ${pct0(b.net.avg)} (this location ${delta >= 0 ? '+' : ''}${Math.round(delta * 100)} pts)`}
        />
      </div>
      <span className="w-24 shrink-0 text-right tabular-nums text-gray-500">
        <span className="font-semibold text-gray-800">{b.count.toLocaleString()}</span> · {pct0(b.pct)}
      </span>
    </div>
  )
}

export default function OutletSnapshotView({
  brand, name, address, reviews, rating, rank, outletCount, networkSize, snapshot: s,
  unitLabel = 'Location', subtitle, rankNoun = '', fleetEmptySub = 'Under 200 reviews',
}: {
  brand: string; name: string; address: string; reviews: number; rating: number
  rank: number; outletCount: number; networkSize: number; snapshot: OutletSnapshot
  // Rolled-up rungs reuse this component verbatim — only the nouns change, so a
  // region's snapshot can never drift from a store's. `rank: 0` hides the pill
  // (the Network root has nothing to be ranked against).
  unitLabel?: string
  subtitle?: React.ReactNode
  rankNoun?: string
  // Shown on the Fleet Position tile when there is no rank to give.
  fleetEmptySub?: string
}) {
  const arrow = s.recent?.direction === 'up' ? '▲' : s.recent?.direction === 'down' ? '▼' : ''
  const arrowColor = s.recent?.direction === 'up' ? 'text-emerald-600' : s.recent?.direction === 'down' ? 'text-rose-600' : 'text-gray-400'

  // "What guests consistently praise" — every verbatim under that heading must
  // read as praise. See lib/verbatimGuard: the rating selects the review, it
  // does not vouch for the sentence lifted out of it.
  const praise = s.praiseVerbatims.filter((v) => verbatimSupports(v.quote, 'positive'))

  return (
    <section className="outlet-print-page">
      {/* Brand bar */}
      <div className="flex items-center justify-between border-b border-gray-200 pb-3">
        <Datanautix />
        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
          {unitLabel} Performance Snapshot{s.asOf ? ` · ${s.asOf}` : ''}
        </div>
      </div>

      {/* Title */}
      <div className="mt-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">
            {brand} <span className="text-gray-400">·</span> {name}
          </h1>
          {rank > 0 && (
            <span className="rounded-full border border-gray-300 px-2.5 py-0.5 text-xs font-semibold text-gray-600">
              Rank #{rank} of {outletCount}{rankNoun ? ` ${rankNoun}` : ''}
            </span>
          )}
        </div>
        <div className="mt-1 text-sm text-gray-500">
          {subtitle != null ? subtitle : <>
            {address ? `${address} · ` : ''}{reviews.toLocaleString()} Google reviews{s.dateRange ? ` (${s.dateRange})` : ''} · full {networkSize}-store network
          </>}
        </div>
      </div>

      {/* KPI tiles */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 print:break-inside-avoid">
        <Kpi
          label="Overall Rating" value={rating.toFixed(2)} unit="★"
          sub={s.recent ? <>Last {s.recent.count.toLocaleString()} reviews: <span className="font-semibold text-gray-700">{s.recent.avg.toFixed(2)}</span> <span className={arrowColor}>{arrow}</span></> : undefined}
        />
        <Kpi
          label="5-Star Share" value={pct0(s.fiveStarShare)} unit=""
          sub={<>Detractors (≤2★): <span className="font-semibold text-gray-700">{pct0(s.detractorShare)}</span></>}
        />
        <Kpi
          label="Owner Responses" value={pct0(s.ownerResponseRate)} unit=""
          sub={s.ownerResponseBand}
        />
        <Kpi
          label="Fleet Position"
          value={s.fleet ? s.fleet.band : '—'}
          sub={s.fleet ? `#${s.fleet.rank} of ${s.fleet.total} ${s.fleet.peerNoun}` : fleetEmptySub}
        />
      </div>

      {/* Rating distribution */}
      <div className="mt-6 print:mt-4 print:break-inside-avoid">
        <div className="mb-2.5 flex items-baseline justify-between">
          <h2 className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Rating Distribution</h2>
          <span className="flex items-center gap-2 text-[10px] text-gray-400">
            <span className="flex items-center gap-1"><span className="inline-block h-0 w-0 border-y-[3px] border-l-[5px] border-y-transparent border-l-gray-400" /> lowest</span>
            <span className="flex items-center gap-1"><span className="inline-block h-3 w-[2px] rounded-full bg-gray-700" /> avg</span>
            <span className="flex items-center gap-1"><span className="inline-block h-0 w-0 border-y-[3px] border-r-[5px] border-y-transparent border-r-gray-400" /> highest</span>
            <span className="text-gray-300">· network</span>
          </span>
        </div>
        <div className="space-y-1.5 print:space-y-1">
          {s.distribution.map((b) => <DistributionRow key={b.star} b={b} />)}
        </div>
      </div>

      {/* Theme table */}
      {s.themeTable.length > 0 && (
        <div className="mt-6 print:mt-4 print:break-inside-avoid">
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400">What guests talk about — and how it scores</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                <th className="py-1.5 text-left font-semibold">Theme</th>
                <th className="py-1.5 text-right font-semibold">Mentions</th>
                <th className="py-1.5 text-right font-semibold">Avg ★</th>
                <th className="py-1.5 text-right font-semibold">% Negative</th>
                <th className="py-1.5 text-right font-semibold">Read</th>
              </tr>
            </thead>
            <tbody>
              {s.themeTable.map((t) => (
                <tr key={t.theme} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 pr-2 font-medium text-gray-800 print:py-1">{t.theme}</td>
                  <td className="py-2 text-right tabular-nums text-gray-500 print:py-1">{t.mentions.toLocaleString()}</td>
                  <td className={`py-2 text-right font-bold tabular-nums print:py-1 ${starColor(t.avgStar)}`}>{t.avgStar.toFixed(2)}</td>
                  <td className={`py-2 text-right font-semibold tabular-nums print:py-1 ${negColor(t.pctNegative)}`}>{pct0(t.pctNegative)}</td>
                  <td className="py-2 text-right print:py-1">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${READ_STYLE[t.read]}`}>{t.read}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Praise */}
      {(s.praiseChips.length > 0 || praise.length > 0) && (
        <div className="mt-6 print:mt-4 print:break-inside-avoid">
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400">What guests consistently praise</h2>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">Keep doing this</div>
            {s.praiseChips.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {s.praiseChips.map((c) => (
                  <span key={c} className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700">{c}</span>
                ))}
              </div>
            )}
            {praise.length > 0 && (
              <div className="mt-3 space-y-1.5 text-xs italic leading-relaxed text-gray-600">
                {praise.map((v, i) => (
                  <span key={i}>
                    <span className="not-italic font-semibold text-emerald-700">{v.rating}★</span> “{v.quote}”{i < praise.length - 1 ? '  ·  ' : ''}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
