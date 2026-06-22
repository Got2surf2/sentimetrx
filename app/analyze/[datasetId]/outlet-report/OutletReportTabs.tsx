'use client'

import { useState } from 'react'
import type { OutletReport, ThemeDelta, ComparisonBlock, TrendPoint } from '@/lib/outletReport'
import type { OutletLever, PredictorModel } from '@/lib/outletPredictor'

type Sel = NonNullable<OutletReport['selected']>

const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`

// Exemplar labels carry the brand prefix ("Rubio's … — Laguna Niguel, CA"); the
// brand is already the page eyebrow, so show just the location half.
function locOnly(label: string): string {
  const i = label.indexOf(' — ')
  return i >= 0 ? label.slice(i + 3) : label
}

// One prioritized lever: theme, projected ★ lift, a guest quote of what to fix,
// and the peer to learn from.
function LeverCard({ l, rank }: { l: OutletLever; rank: number }) {
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-800 text-[11px] font-bold text-white">{rank}</span>
          <span className="text-sm font-semibold text-gray-900">{l.theme}</span>
        </div>
        <span className="shrink-0 text-sm font-bold text-emerald-600">+{l.lift.toFixed(2)}★ potential</span>
      </div>
      <div className="mt-1.5 text-xs text-gray-500">
        <span className="font-medium text-gray-700">{pct1(l.outletNegRate)}</span> of reviews here flag this negatively
        {' · '}peer median <span className="font-medium text-gray-700">{pct1(l.peerMedian)}</span>
        {' · '}each negative ≈ <span className="font-medium text-gray-700">{l.drag.toFixed(1)}★</span> lower
      </div>
      {l.quote && (
        <p className="mt-2 border-l-2 border-amber-300 pl-2 text-xs italic text-gray-600">“{l.quote}”</p>
      )}
      {l.exemplar && (
        <div className="mt-2 flex items-start gap-1.5 rounded-md bg-emerald-50/70 px-2.5 py-1.5 text-xs text-emerald-800">
          <span aria-hidden className="mt-px">★</span>
          <span>
            <span className="font-semibold">Learn from {locOnly(l.exemplar.label)}</span> — {l.exemplar.rating != null ? `${l.exemplar.rating.toFixed(1)}★, ` : ''}
            only {pct1(l.exemplar.negRate)} of its reviews flag this. Worth a call to compare how they run it.
          </span>
        </div>
      )}
    </div>
  )
}

function ActionPlan({ levers, model, s }: { levers: OutletLever[]; model: PredictorModel; s: Sel }) {
  if (!levers.length) {
    return (
      <div className="rounded-lg border border-dashed border-emerald-200 bg-emerald-50/50 p-6 text-center">
        <p className="text-sm font-semibold text-emerald-800">This location is at or above the peer median on every measured theme.</p>
        <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-emerald-700/80">
          There’s no theme where guests complain materially more than at peer outlets. Hold the line and share what’s working —
          this is a location others should learn from.
        </p>
      </div>
    )
  }
  // Upper-bound: summed per-theme lifts overlap (a single bad review hits several
  // themes), so the de-biased drag is per-theme but the total still over-counts.
  const totalLift = levers.reduce((sum, l) => sum + l.lift, 0)
  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-gray-50 p-5">
        <h2 className="text-sm font-bold text-gray-700">Highest-impact things to work on here</h2>
        <p className="mt-1 text-sm leading-relaxed text-gray-600">
          Ranked by modeled effect on {s.name}’s star rating, relative to its {s.outletCount - 1} peer outlets. Closing every gap below
          to the peer median is an upper bound of roughly <span className="font-semibold text-gray-800">+{totalLift.toFixed(2)}★</span> —
          treat it as direction and priority, not a guarantee.
        </p>
      </div>
      <div className="space-y-2.5">
        {levers.map((l, i) => <LeverCard key={l.theme} l={l} rank={i + 1} />)}
      </div>
      <p className="mt-2 border-t border-gray-100 pt-3 text-[11px] leading-relaxed text-gray-400">
        Impact estimated by a de-biased model (ridge regression of star rating on theme-negative mentions, so co-occurring
        complaints don’t double-count; explains {Math.round(model.r2 * 100)}% of rating variance across {model.population.toLocaleString()} reviews).
        Each theme’s “potential” = how far this outlet’s negative-mention rate sits above the peer median × that theme’s modeled ★-drag.
        Associational, not causal — a prioritization signal.
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

export default function OutletReportTabs({ selected: s, levers, model }: { selected: Sel; levers: OutletLever[]; model: PredictorModel }) {
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
        {tab === 'action' && <ActionPlan levers={levers} model={model} s={s} />}

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
