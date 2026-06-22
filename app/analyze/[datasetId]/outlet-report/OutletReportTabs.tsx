'use client'

import { useState } from 'react'
import type { OutletReport, ThemeDelta, ComparisonBlock, TrendPoint } from '@/lib/outletReport'
import type { OutletLever, OutletSummary, PredictorModel } from '@/lib/outletPredictor'

type Sel = NonNullable<OutletReport['selected']>

const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`

// Exemplar labels carry the brand prefix ("Rubio's … — Laguna Niguel, CA"); the
// brand is already the page eyebrow, so show just the location half.
function locOnly(label: string): string {
  const i = label.indexOf(' — ')
  return i >= 0 ? label.slice(i + 3) : label
}

// One driver theme this location's unhappy (1–3★) guests cite, the over-
// representation that makes it a real driver, a verbatim quote, and the peer
// that handles it best.
function LeverCard({ l, rank }: { l: OutletLever; rank: number }) {
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-800 text-[11px] font-bold text-white">{rank}</span>
          <span className="text-sm font-semibold text-gray-900">{l.theme}</span>
        </div>
        <span className="shrink-0 text-sm font-bold text-rose-600">cited in {pct1(l.shareInBad)} of 1–3★ reviews here</span>
      </div>
      <div className="mt-1.5 text-xs text-gray-500">
        Brand-wide this theme is <span className="font-medium text-gray-700">{l.brandLift.toFixed(1)}×</span> more common in unhappy reviews than happy ones — a genuine driver of low ratings, not just a loud topic.
      </div>
      {l.quote && (
        <p className="mt-2 border-l-2 border-rose-300 pl-2 text-xs italic text-gray-600">“{l.quote}”</p>
      )}
      {l.exemplar && (
        <div className="mt-2 flex items-start gap-1.5 rounded-md bg-emerald-50/70 px-2.5 py-1.5 text-xs text-emerald-800">
          <span aria-hidden className="mt-px">★</span>
          <span>
            <span className="font-semibold">Learn from {locOnly(l.exemplar.label)}</span> — a {pct1(l.exemplar.lowRate)} 1–3★ rate
            {l.exemplar.rating != null ? ` (${l.exemplar.rating.toFixed(1)}★)` : ''}; this complaint barely shows up there. Worth a call to compare how they run it.
          </span>
        </div>
      )}
    </div>
  )
}

function ActionPlan({ levers, summary, model, s }: { levers: OutletLever[]; summary: OutletSummary | undefined; model: PredictorModel; s: Sel }) {
  if (!summary) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
        Not enough rated reviews at this location to build a plan.
      </div>
    )
  }
  const atPar = summary.gapToTarget <= 0.01
  const showLevers = levers.length > 0 && summary.lowCount >= 5
  return (
    <div className="space-y-4">
      <div className={`rounded-lg p-5 ${atPar ? 'bg-emerald-50/60' : 'bg-gray-50'}`}>
        <h2 className="text-sm font-bold text-gray-700">Recovering this location’s unhappy guests</h2>
        <p className="mt-1 text-sm leading-relaxed text-gray-600">
          <span className="font-semibold text-gray-900">{pct1(summary.lowRate)}</span> of {s.name}’s reviews are 1–3★
          ({summary.lowCount.toLocaleString()} of {s.reviews.toLocaleString()}) — versus about{' '}
          <span className="font-semibold text-gray-900">{pct1(model.targetLowRate)}</span> at the brand’s best-run outlets.{' '}
          {atPar
            ? 'This location already runs among your best — hold the line and share what’s working.'
            : 'Closing that gap to your best operators is the opportunity; the themes below are what its unhappy guests cite most.'}
        </p>
      </div>
      {showLevers ? (
        <>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">What this location’s unhappy guests cite most</h3>
          <div className="space-y-2.5">
            {levers.map((l, i) => <LeverCard key={l.theme} l={l} rank={i + 1} />)}
          </div>
        </>
      ) : !atPar ? (
        <p className="rounded-lg border border-dashed border-gray-200 p-4 text-xs text-gray-500">
          This location’s 1–3★ reviews don’t concentrate on any one brand-wide driver theme — they’re diffuse. Work the operational basics; the brand drivers (order accuracy, brand experience) are where to look first.
        </p>
      ) : null}
      <p className="mt-2 border-t border-gray-100 pt-3 text-[11px] leading-relaxed text-gray-400">
        “Drivers” are themes that show up disproportionately in 1–3★ reviews vs 4–5★ reviews across the brand (an over-representation multiple, not bare frequency — so loud-but-neutral topics don’t mislead). Quotes are from this location’s own 1–3★ reviews. Computed from {model.population.toLocaleString()} rated reviews. Associational — a prioritization signal that benchmarks this outlet against its peers, not a guaranteed star change.
      </p>
    </div>
  )
}

function pts(delta: number) {
  const v = Math.round(delta * 100)
  return `${v >= 0 ? '+' : ''}${v} pts`
}

function ThemeCard({ t, tone }: { t: ThemeDelta; tone: 'good' | 'bad' }) {
  const good = tone === 'good'
  return (
    <div className={`rounded-lg border p-3 ${good ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/60'}`}>
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <span className={`mr-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${good ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
            {t.category}
          </span>
          <span className="text-sm font-semibold text-gray-900">{t.label}</span>
        </div>
        <span className={`text-sm font-bold ${good ? 'text-emerald-600' : 'text-amber-600'}`}>{pts(t.delta)}</span>
      </div>
      <div className="mt-1 text-xs text-gray-500">
        {Math.round(t.outletNet * 100)}% net-positive here · {Math.round(t.chainNet * 100)}% across peers · {t.n} mentions
      </div>
      {t.quote && <p className="mt-2 border-l-2 border-gray-300 pl-2 text-xs italic text-gray-600">“{t.quote}”</p>}
    </div>
  )
}

// Excels / needs-work two-column grid for one comparison axis.
function Block({ block, kind }: { block: ComparisonBlock; kind: 'themes' | 'dimensions' }) {
  const noun = kind === 'themes' ? 'themes' : 'dimensions'
  return (
    <div className="grid grid-cols-2 gap-5">
      <div>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-emerald-700">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> What this location excels at
        </h2>
        <div className="space-y-2">
          {block.strengths.length ? block.strengths.map((t) => <ThemeCard key={t.sub + t.axis} t={t} tone="good" />)
            : <p className="rounded-lg border border-dashed border-gray-200 p-3 text-xs text-gray-400">No {noun} materially ahead of peers.</p>}
        </div>
      </div>
      <div>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-amber-700">
          <span className="inline-block h-2 w-2 rounded-full bg-amber-500" /> What needs work
        </h2>
        <div className="space-y-2">
          {block.weaknesses.length ? block.weaknesses.map((t) => <ThemeCard key={t.sub + t.axis} t={t} tone="bad" />)
            : <p className="rounded-lg border border-dashed border-gray-200 p-3 text-xs text-gray-400">No {noun} materially behind peers.</p>}
        </div>
      </div>
    </div>
  )
}

// Outlet vs network avg-rating over time (inline SVG dual-line; no chart dep).
function monthLabel(m: string): string {
  const [y, mo] = m.split('-')
  const names = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${names[Number(mo)] || mo} '${y.slice(2)}`
}

function TrendChart({ trend }: { trend: TrendPoint[] }) {
  const pts = trend.filter((p) => typeof p.networkAvg === 'number')
  if (pts.length < 3) {
    return <p className="rounded-lg border border-dashed border-gray-200 p-3 text-xs text-gray-400">Not enough dated reviews to chart a trend.</p>
  }
  const W = 660, H = 210, padL = 30, padR = 14, padT = 12, padB = 26
  const x = (i: number) => padL + (W - padL - padR) * (pts.length === 1 ? 0 : i / (pts.length - 1))
  const vals = pts.flatMap((p) => [p.networkAvg, ...(p.outletAvg != null ? [p.outletAvg] : [])])
  const yMin = Math.max(1, Math.floor(Math.min(...vals) * 2) / 2 - 0.25)
  const yMax = 5
  const y = (v: number) => padT + (H - padT - padB) * (1 - (v - yMin) / (yMax - yMin))
  const netLine = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.networkAvg).toFixed(1)}`).join(' ')
  const outLine = pts.map((p, i) => (p.outletAvg != null ? `${x(i).toFixed(1)},${y(p.outletAvg).toFixed(1)}` : '')).filter(Boolean).join(' ')
  const yTicks = [yMin, (yMin + yMax) / 2, yMax]
  const xIdx = [0, Math.floor((pts.length - 1) / 2), pts.length - 1]
  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: '#e8622a' }} /> This location</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-3 rounded-sm bg-gray-400" /> Network avg</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 230 }} role="img" aria-label="Outlet vs network average rating over time">
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#ececed" strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="#9ca3af">{t.toFixed(1)}</text>
          </g>
        ))}
        {xIdx.map((i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={10} fill="#9ca3af">{monthLabel(pts[i].month)}</text>
        ))}
        <polyline points={netLine} fill="none" stroke="#9ca3af" strokeWidth={2} />
        {outLine && <polyline points={outLine} fill="none" stroke="#e8622a" strokeWidth={2.5} />}
      </svg>
    </div>
  )
}

type Tab = 'action' | 'summary' | 'themes' | 'dimensions'

export default function OutletReportTabs({ selected: s, levers, summary, model }: { selected: Sel; levers: OutletLever[]; summary: OutletSummary | undefined; model: PredictorModel }) {
  const [tab, setTab] = useState<Tab>('action')
  const peers = s.outletCount - 1
  const TABS: { id: Tab; label: string }[] = [
    { id: 'action', label: 'Action Plan' },
    { id: 'summary', label: 'Summary' },
    { id: 'themes', label: 'Themes' },
    { id: 'dimensions', label: 'Dimensions' },
  ]

  return (
    <div className="mt-6">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-200 print:hidden">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${tab === t.id ? 'border-gray-800 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {/* ACTION PLAN */}
        {tab === 'action' && <ActionPlan levers={levers} summary={summary} model={model} s={s} />}

        {/* THEMES */}
        {tab === 'themes' && (
          <>
            <Block block={s.themes} kind="themes" />
            <p className="mt-6 border-t border-gray-100 pt-3 text-[11px] leading-relaxed text-gray-400">
              Themes ranked by net-positive sentiment gap vs. the brand’s other {peers} outlets, from {s.themes.analyzedReviews.toLocaleString()} of
              this outlet’s reviews matched to the dataset’s themes (keyword match + lexicon sentiment). “pts” = percentage-point difference in
              net-positive rate between this outlet and the peer-group average for that theme.
            </p>
          </>
        )}

        {/* DIMENSIONS */}
        {tab === 'dimensions' && (
          !s.dimensions.available ? (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
              <p className="text-sm font-semibold text-gray-700">Dimensions comparison requires classification</p>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-gray-500">
                This dataset hasn’t been classified into the 7-axis service Dimensions yet, so there’s nothing to compare against peers here.
                Open <span className="font-medium text-gray-700">TextMine → Dimensions</span> and run classification (a quick keyword pass), then reload this report.
              </p>
            </div>
          ) : (
            <>
              <Block block={s.dimensions} kind="dimensions" />
              <p className="mt-6 border-t border-gray-100 pt-3 text-[11px] leading-relaxed text-gray-400">
                Dimensions ranked by net-positive sentiment gap vs. the brand’s other {peers} outlets, from {s.dimensions.analyzedReviews.toLocaleString()} AI-classified
                reviews tagged across service dimensions (service, food, experience, atmosphere, loyalty). “pts” = percentage-point difference in net-positive
                rate between this outlet and the peer-group average for that dimension.
              </p>
            </>
          )
        )}

        {/* SUMMARY */}
        {tab === 'summary' && (
          <div className="space-y-5">
            <div className="rounded-lg bg-gray-50 p-5">
              <h2 className="mb-3 text-sm font-bold text-gray-700">Review score over time <span className="font-normal text-gray-400">— this location vs. network</span></h2>
              <TrendChart trend={s.trend} />
            </div>
            <div className="rounded-lg bg-gray-50 p-5">
              <h2 className="mb-2 text-sm font-bold text-gray-700">How this location compares to the network</h2>
              <p className="text-sm leading-relaxed text-gray-700">{s.narrative}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
