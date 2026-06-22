'use client'

import { useState } from 'react'
import type { OutletReport, ThemeDelta, ComparisonBlock } from '@/lib/outletReport'

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

type Tab = 'themes' | 'dimensions' | 'summary'

export default function OutletReportTabs({ selected: s }: { selected: Sel }) {
  const [tab, setTab] = useState<Tab>('themes')
  const peers = s.outletCount - 1
  const TABS: { id: Tab; label: string }[] = [
    { id: 'themes', label: 'Themes' },
    { id: 'dimensions', label: 'Dimensions' },
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
          <div className="rounded-lg bg-gray-50 p-5">
            <h2 className="mb-2 text-sm font-bold text-gray-700">How this location compares to the network</h2>
            <p className="text-sm leading-relaxed text-gray-700">{s.narrative}</p>
          </div>
        )}
      </div>
    </div>
  )
}
