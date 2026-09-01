'use client'

import { useState } from 'react'
import type { OutletLeaderboard, LeaderItem, LeaderRow } from '@/lib/outletReport'
import type { LeaderboardPdfPayload } from '@/lib/outletPdfPayload'

function netPct(n: number) { const v = Math.round(n * 100); return `${v >= 0 ? '+' : ''}${v}%` }

function LeaderLine({ r, chainNet }: { r: LeaderRow; chainNet: number }) {
  // Bold figure = gap vs the chain average in points (so color and sign agree —
  // red is genuinely below chain). Grey = the outlet's own net-positive rate.
  const v = Math.round((r.net - chainNet) * 100)
  return (
    <div className="flex items-baseline justify-between gap-2 py-1">
      <span className="truncate text-xs text-gray-700">{r.label}</span>
      <span className="flex shrink-0 items-baseline gap-2">
        <span className={`text-xs font-semibold ${v >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{v >= 0 ? '+' : ''}{v} pts</span>
        <span className="text-[10px] text-gray-400">{netPct(r.net)} net · {r.n}{r.rating != null ? ` · ${r.rating.toFixed(1)}★` : ''}</span>
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

export default function LeaderboardClient({ lb, datasetId, brand }: { lb: OutletLeaderboard; datasetId: string; brand: string }) {
  const [k, setK] = useState(lb.defaultK)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfFailed, setPdfFailed] = useState(false)

  // Composed PDF (2026-09-02, replaces "print to PDF"): posts the leaderboard
  // this page already rendered — at the K the slider currently shows — and the
  // route typesets it (POST-the-page's-data, like the Outlet Deep-Dive).
  async function downloadPdf() {
    setPdfBusy(true); setPdfFailed(false)
    try {
      const payload: LeaderboardPdfPayload = {
        brand, outletCount: lb.outletCount, k,
        themes: lb.themes.map((it) => ({ label: it.label, category: it.category, chainNet: it.chainNet, chainN: it.chainN, qualifying: it.qualifying, ranked: it.ranked.map((r) => ({ label: r.label, net: r.net, n: r.n, rating: r.rating })) })),
        dimensions: lb.dimensions.map((it) => ({ label: it.label, category: it.category, chainNet: it.chainNet, chainN: it.chainN, qualifying: it.qualifying, ranked: it.ranked.map((r) => ({ label: r.label, net: r.net, n: r.n, rating: r.rating })) })),
      }
      const res = await fetch(`/api/datasets/${datasetId}/outlet-leaderboard-pdf`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(String(res.status))
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = `${brand.replace(/[^a-z0-9]+/gi, '_')}_Outlet_Leaderboard.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setPdfFailed(true)
    } finally {
      setPdfBusy(false)
    }
  }
  if (lb.themes.length === 0 && lb.dimensions.length === 0) {
    return <p className="rounded-lg border border-dashed border-gray-200 bg-white p-6 text-center text-sm text-gray-400">No themes or dimensions cleared the reliability floor across these outlets yet.</p>
  }
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3 print:hidden">
        <label htmlFor="lb-k" className="text-xs font-semibold text-gray-600">Outlets shown per side</label>
        <div className="flex items-center gap-3">
          <input id="lb-k" type="range" min={1} max={lb.maxK} value={k} onChange={(e) => setK(Number(e.target.value))} className="w-48 accent-gray-700" />
          <span className="w-6 text-center text-sm font-bold text-gray-900">{k}</span>
          <button type="button" onClick={() => { void downloadPdf() }} disabled={pdfBusy} aria-busy={pdfBusy}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold text-white ${pdfBusy ? 'cursor-not-allowed bg-gray-400' : 'bg-gray-800 hover:bg-gray-700'}`}>
            {pdfBusy ? 'Building PDF…' : pdfFailed ? 'Download PDF — retry' : 'Download PDF'}
          </button>
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
        For each theme/dimension, outlets are ranked by net-positive rate (pos − neg)/total among reviews that mention it. The **bold figure is the gap vs the chain average** in points (green = above, red = below); the grey figure is the outlet&apos;s own net-positive rate, mentions, and avg ★. Only outlets with ≥6 such mentions are ranked, and only items carrying real chain-wide opinion appear. Default shows {lb.defaultK} per side; drag the slider to show more or fewer.
      </p>
    </div>
  )
}
