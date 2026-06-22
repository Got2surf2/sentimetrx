'use client'

import { useState } from 'react'
import type { OutletReport, ThemeDelta, ComparisonBlock, TrendPoint, OutletLeaderboard, LeaderItem, LeaderRow } from '@/lib/outletReport'

type Sel = NonNullable<OutletReport['selected']>

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

// ─── Leaderboard: top/bottom outlets per theme & dimension ───────────────────

function netPct(n: number) { const v = Math.round(n * 100); return `${v >= 0 ? '+' : ''}${v}%` }

function LeaderLine({ r, chainNet }: { r: LeaderRow; chainNet: number }) {
  const above = r.net >= chainNet
  return (
    <div className="flex items-baseline justify-between gap-2 py-1">
      <span className="truncate text-xs text-gray-700">{r.label}</span>
      <span className="flex shrink-0 items-baseline gap-2">
        <span className={`text-xs font-semibold ${above ? 'text-emerald-600' : 'text-rose-600'}`}>{netPct(r.net)}</span>
        <span className="text-[10px] text-gray-400">{r.n}{r.rating != null ? ` · ${r.rating.toFixed(1)}★` : ''}</span>
      </span>
    </div>
  )
}

function LeaderItemCard({ item, k }: { item: LeaderItem; k: number }) {
  const eK = Math.min(k, item.qualifying)
  const single = item.qualifying <= 2 * k // top & bottom would overlap → one ranked list
  const leaders = item.ranked.slice(0, eK)
  const laggards = item.ranked.slice(item.ranked.length - eK)
  const middleHidden = item.qualifying - (single ? leaders.length : 2 * eK)
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <span className="mr-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">{item.category}</span>
          <span className="text-sm font-semibold text-gray-900">{item.label}</span>
        </div>
        <span className="shrink-0 text-[11px] text-gray-400">chain {netPct(item.chainNet)} net · {item.chainN.toLocaleString()} mentions · {item.qualifying} outlets</span>
      </div>
      {single ? (
        <div className="mt-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">All {item.qualifying} outlets · best → worst</div>
          <div className="divide-y divide-gray-100">{item.ranked.map((r) => <LeaderLine key={r.placeId} r={r} chainNet={item.chainNet} />)}</div>
        </div>
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-4">
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600"><span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" /> Top {eK}</div>
            <div className="divide-y divide-gray-100">{leaders.map((r) => <LeaderLine key={r.placeId} r={r} chainNet={item.chainNet} />)}</div>
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-rose-600"><span className="inline-block h-1.5 w-1.5 rounded-full bg-rose-500" /> Bottom {eK}</div>
            <div className="divide-y divide-gray-100">{laggards.map((r) => <LeaderLine key={r.placeId} r={r} chainNet={item.chainNet} />)}</div>
          </div>
        </div>
      )}
      {!single && middleHidden > 0 && <div className="mt-1.5 text-center text-[10px] text-gray-400">{middleHidden} more outlet{middleHidden === 1 ? '' : 's'} in between</div>}
    </div>
  )
}

function LeaderboardView({ lb }: { lb: OutletLeaderboard }) {
  const [k, setK] = useState(lb.defaultK)
  if (lb.themes.length === 0 && lb.dimensions.length === 0) {
    return <p className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">No themes or dimensions cleared the reliability floor across these outlets yet.</p>
  }
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3 rounded-lg bg-gray-50 p-3 print:hidden">
        <label htmlFor="lb-k" className="text-xs font-semibold text-gray-600">Outlets shown per side</label>
        <div className="flex items-center gap-3">
          <input id="lb-k" type="range" min={1} max={lb.maxK} value={k} onChange={(e) => setK(Number(e.target.value))} className="w-48 accent-gray-700" />
          <span className="w-6 text-center text-sm font-bold text-gray-900">{k}</span>
        </div>
      </div>
      {lb.themes.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-bold text-gray-700">Themes</h2>
          <div className="space-y-2">{lb.themes.map((it) => <LeaderItemCard key={it.key} item={it} k={k} />)}</div>
        </section>
      )}
      {lb.dimensions.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold text-gray-700">Dimensions</h2>
          <div className="space-y-2">{lb.dimensions.map((it) => <LeaderItemCard key={it.key} item={it} k={k} />)}</div>
        </section>
      )}
      <p className="mt-6 border-t border-gray-100 pt-3 text-[11px] leading-relaxed text-gray-400">
        For each theme/dimension, outlets are ranked by net-positive rate (pos − neg)/total among reviews that mention it. Only outlets with ≥6 such mentions are ranked, and only items carrying real chain-wide opinion appear. Default shows {lb.defaultK} per side; drag the slider to show more or fewer.
      </p>
    </div>
  )
}

type Tab = 'summary' | 'themes' | 'dimensions' | 'leaderboard'

export default function OutletReportTabs({ selected: s, leaderboard }: { selected: Sel; leaderboard: OutletLeaderboard }) {
  const [tab, setTab] = useState<Tab>('summary')
  const peers = s.outletCount - 1
  const TABS: { id: Tab; label: string }[] = [
    { id: 'summary', label: 'Summary' },
    { id: 'themes', label: 'Themes' },
    { id: 'dimensions', label: 'Dimensions' },
    { id: 'leaderboard', label: 'Leaderboard' },
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

        {/* LEADERBOARD — top/bottom outlets per theme & dimension (dataset-wide) */}
        {tab === 'leaderboard' && <LeaderboardView lb={leaderboard} />}

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
