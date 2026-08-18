'use client'

import { useState } from 'react'
import { verbatimSupports } from '@/lib/verbatimGuard'
import { pct1, locOnly, rankWord, topWord, monthLabel, listWords } from '@/lib/outletPeerWords'
import type { OutletSelected, TrendPoint } from '@/lib/outletReport'
import type { OutletLever, OutletSummary, PredictorModel } from '@/lib/outletPredictor'
import WhatIfPanel, { type WhatIfData } from './WhatIfPanel'

type Sel = OutletSelected

// Levers are ordered by what fixing each ALONE wins back, so every card states
// its own number. Sub-1 is spelled out rather than rounded to "~0 guests", which
// would read as "this is pointless" when it is really "this rarely arrives on
// its own" — the combined what-if below is where those themes pay off.
function recoveryWords(n: number): string {
  if (n < 0.5) return 'under 1 unhappy guest — it almost always arrives alongside another complaint'
  const r = Math.round(n)
  return `about ${r} unhappy guest${r === 1 ? '' : 's'}`
}

// One theme where this location is a BOTTOM-quartile performer vs all outlets —
// a real, peer-relative weakness — with a verbatim quote and the best peer.
function LeverCard({ l, rank }: { l: OutletLever; rank: number }) {
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-800 text-[11px] font-bold text-white">{rank}</span>
          <span className="text-sm font-semibold text-gray-900">{l.theme}</span>
        </div>
        <span className="shrink-0 rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-rose-700">{rankWord(l.peerPercentile)} of locations</span>
      </div>
      <div className="mt-1.5 text-xs text-gray-500">
        <span className="font-medium text-gray-700">{pct1(l.problemRate)}</span> of all reviews here are 1–3★ and cite this ({pct1(l.shareInBad)} of its 1–3★ reviews).
        {l.cohortSize > 1 && <> You’re one of <span className="font-medium text-gray-700">{l.cohortSize}</span> outlets in the bottom quartile here.</>}
      </div>
      <div className="mt-1.5 text-xs text-gray-500">
        Fixing <span className="font-medium text-gray-700">only this</span> — to the peer median — wins back{' '}
        <span className="font-semibold text-gray-800">{recoveryWords(l.soloRecovery)}</span>.
      </div>
      {verbatimSupports(l.quote, 'negative') && (
        <p className="mt-2 border-l-2 border-rose-300 pl-2 text-xs italic text-gray-600">“{l.quote}”</p>
      )}
      {l.exemplars.length > 0 && (
        <div className="mt-2 flex items-start gap-1.5 rounded-md bg-emerald-50/70 px-2.5 py-1.5 text-xs text-emerald-800">
          <span aria-hidden className="mt-px">★</span>
          <span>
            <span className="font-semibold">Learn from</span>{' '}
            {l.exemplars.slice(0, 5).map((e, i) => (
              <span key={e.placeId}>{i > 0 ? ', ' : ''}{locOnly(e.label)}{e.rating != null ? ` (${e.rating.toFixed(1)}★)` : ''}</span>
            ))}
            {' '}— the top performers on this theme. Worth a call on how they run it.
          </span>
        </div>
      )}
    </div>
  )
}

// One theme where this location is a TOP-quartile performer vs all outlets — a
// peer-relative strength, with a praise quote from a 4–5★ review.
function StrengthCard({ t }: { t: OutletLever }) {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-gray-900">{t.theme}</span>
        <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-emerald-700">{topWord(t.peerPercentile)} of locations</span>
      </div>
      <div className="mt-1.5 text-xs text-gray-500">
        Only <span className="font-medium text-gray-700">{pct1(t.problemRate)}</span> of reviews here are 1–3★ and cite this — among the best in the brand. Protect it.
      </div>
      {verbatimSupports(t.quote, 'positive') && (
        <p className="mt-2 border-l-2 border-emerald-300 pl-2 text-xs italic text-gray-600">“{t.quote}”</p>
      )}
    </div>
  )
}

function ActionPlan({ levers, strengths, summary, model, brandDrivers, outletCount, whatIf, s }: { levers: OutletLever[]; strengths: OutletLever[]; summary: OutletSummary | undefined; model: PredictorModel; brandDrivers: string[]; outletCount: number; whatIf: WhatIfData | null; s: Sel }) {
  if (!summary) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">
        Not enough rated reviews at this location to build a plan.
      </div>
    )
  }
  const atPar = summary.gapToTarget <= 0.01
  // Item 2 — connect this outlet to the chain's systemic drivers. There is
  // usually MORE THAN ONE: brandLevers is every actionable theme over-represented
  // among 1–3★ reviews brand-wide, and this used to render only [0] under the
  // words "the chain's one systemic issue" (wrong whenever the list was longer,
  // which is the normal case). It also called that theme the outlet's
  // "highest-leverage fix" — conflating brand-level over-representation (a
  // discriminator: does this theme separate happy from unhappy?) with local
  // impact (how many of MY guests does it touch?). Those routinely disagree.
  // The leverage claim now lives on the lever list, where it is computed.
  const mine = new Set(levers.map((l) => l.theme))
  const strong = new Set(strengths.map((l) => l.theme))
  const weakDrivers = brandDrivers.filter((d) => mine.has(d))
  const strongDrivers = brandDrivers.filter((d) => strong.has(d))
  const driverTone = weakDrivers.length ? 'weak' : strongDrivers.length === brandDrivers.length ? 'strong' : 'mid'
  return (
    <div className="space-y-4">
      <div className={`rounded-lg p-5 ${atPar ? 'bg-emerald-50/60' : 'bg-gray-50'}`}>
        <h2 className="text-sm font-bold text-gray-700">Recovering this location’s unhappy guests</h2>
        <p className="mt-1 text-sm leading-relaxed text-gray-600">
          <span className="font-semibold text-gray-900">{pct1(summary.lowRate)}</span> of {s.name}’s reviews are 1–3★
          ({summary.lowCount.toLocaleString()} of {s.reviews.toLocaleString()}) — the{' '}
          <span className="font-semibold text-gray-900">#{summary.lowRateRank}</span> highest 1–3★ rate of {outletCount} outlets (1 = worst),
          versus <span className="font-semibold text-gray-900">{pct1(model.lowRate)}</span> brand average and{' '}
          <span className="font-semibold text-gray-900">{pct1(model.bestLowRate)}</span> at your best location.{' '}
          {levers.length
            ? `Below are the themes where this location ranks among the worst in the brand — its real, fixable weaknesses.`
            : atPar
              ? 'This location already runs among your best — hold the line and share what’s working.'
              : 'It isn’t a bottom-quartile performer on any single operational theme; its 1–3★ reviews are spread across topics. Work the operational basics.'}
        </p>
      </div>
      {brandDrivers.length > 0 && (
        <div className={`rounded-lg border p-3 text-xs leading-relaxed ${driverTone === 'weak' ? 'border-rose-200 bg-rose-50/60 text-rose-800' : driverTone === 'strong' ? 'border-emerald-200 bg-emerald-50/60 text-emerald-800' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
          {brandDrivers.length === 1
            ? <>The chain’s one <span className="font-semibold">systemic</span> issue is <span className="font-semibold">{brandDrivers[0]}</span> — a theme that shows up far more in 1–3★ reviews than in 4–5★ ones brand-wide.</>
            : <>The chain’s <span className="font-semibold">systemic</span> issues are <span className="font-semibold">{listWords(brandDrivers)}</span> — themes that show up far more in 1–3★ reviews than in 4–5★ ones brand-wide.</>}
          {' '}
          {weakDrivers.length
            ? <>You’re <span className="font-semibold">bottom-quartile</span> on {weakDrivers.length === brandDrivers.length && brandDrivers.length > 1 ? <>all {brandDrivers.length}</> : <span className="font-semibold">{listWords(weakDrivers)}</span>}.</>
            : strongDrivers.length === brandDrivers.length
              ? <>You’re <span className="font-semibold">top-quartile</span> on {brandDrivers.length > 1 ? <>every one of them</> : <>it</>} — protect that.</>
              : <>None of them is a bottom-quartile weakness here.</>}
        </div>
      )}
      {levers.length > 0 && (
        <>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Work these — biggest win first</h3>
          <p className="-mt-1.5 text-xs text-gray-500">
            Themes where this location is bottom-quartile vs all outlets, ordered by how many unhappy guests
            bringing each one to the peer median would win back — not by how unusual it is.
          </p>
          <div className="space-y-2.5">
            {levers.map((l, i) => <LeverCard key={l.theme} l={l} rank={i + 1} />)}
          </div>
        </>
      )}
      {whatIf && whatIf.reviews13.length > 0 && whatIf.themes.length > 0 && <WhatIfPanel {...whatIf} />}
      {strengths.length > 0 && (
        <>
          <h3 className="mt-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">What this location does best — top quartile vs all outlets</h3>
          <div className="space-y-2.5">
            {strengths.map((t) => <StrengthCard key={t.theme} t={t} />)}
          </div>
        </>
      )}
      <p className="mt-2 border-t border-gray-100 pt-3 text-[11px] leading-relaxed text-gray-400">
        Each operational theme is peer-ranked across all outlets by its <span className="font-medium text-gray-500">problem rate</span> — the share of a location’s reviews that are 1–3★ and cite that theme. Weaknesses = bottom quartile (among the worst); strengths = top quartile. Lagging outcomes like brand loyalty are excluded — they’re symptoms of these operational issues, not levers. Quotes are this location’s own 1–3★ reviews. Associational — a prioritization signal, not a guaranteed star change.
      </p>
    </div>
  )
}

// Outlet vs network avg-rating over time (inline SVG dual-line; no chart dep).
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

type Tab = 'action' | 'summary'

export default function OutletReportTabs({ selected: s, levers, strengths, summary, model, brandDrivers, outletCount, whatIf }: { selected: Sel; levers: OutletLever[]; strengths: OutletLever[]; summary: OutletSummary | undefined; model: PredictorModel; brandDrivers: string[]; outletCount: number; whatIf: WhatIfData | null }) {
  const [tab, setTab] = useState<Tab>('action')
  const TABS: { id: Tab; label: string }[] = [
    { id: 'action', label: 'Action Plan' },
    { id: 'summary', label: 'Summary' },
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
        {tab === 'action' && <ActionPlan levers={levers} strengths={strengths} summary={summary} model={model} brandDrivers={brandDrivers} outletCount={outletCount} whatIf={whatIf} s={s} />}

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
