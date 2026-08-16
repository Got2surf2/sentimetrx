// Breadcrumb + drill-down list for the rolled-up hierarchy view.
//
// The path travels in REPEATED `node` query params (?node=East&node=Downtown)
// rather than one delimited string: a client's own column values are arbitrary
// text, and any separator we picked — "/", ">", "|" — would eventually appear
// inside a real district name and split the path in the wrong place.

import Link from 'next/link'
import type { HierarchyChild } from '@/lib/outletReport'
import { pluralLevel } from '@/lib/hierarchy'

export function nodeHref(datasetId: string, path: string[], outlet?: string): string {
  const q = new URLSearchParams()
  for (const p of path) q.append('node', p)
  if (outlet) q.set('outlet', outlet)
  const s = q.toString()
  return `/analyze/${datasetId}/outlet-report${s ? `?${s}` : ''}`
}

export function HierarchyBreadcrumb({ datasetId, crumbs, current }: {
  datasetId: string
  crumbs: { label: string; levelLabel: string; path: string[] }[]
  // Trailing, non-linked entry — the outlet, when a location is open below the
  // deepest rung.
  current?: { label: string; levelLabel: string }
}) {
  const tail = current ? crumbs : crumbs.slice(0, -1)
  const last = current ?? crumbs[crumbs.length - 1]
  return (
    <nav className="mb-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
      {tail.map((c) => (
        <span key={c.path.join('')} className="flex items-center gap-1.5">
          <Link href={nodeHref(datasetId, c.path)} className="text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline">
            {c.label}
          </Link>
          <span className="text-gray-300">›</span>
        </span>
      ))}
      <span className="font-semibold text-gray-900">{last.label}</span>
      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        {last.levelLabel}
      </span>
    </nav>
  )
}

// One row per node a rung below — the drill-down. Sorted worst-rated first so
// the locations that need attention lead, which is the whole point of rolling
// up: find the weak branch, then open it.
export function HierarchyChildren({ datasetId, childLevelLabel, nodes, networkRating }: {
  datasetId: string
  childLevelLabel: string
  nodes: HierarchyChild[]
  networkRating: number
}) {
  const rows = [...nodes].sort((a, b) => (a.rating ?? 99) - (b.rating ?? 99))
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
          {pluralLevel(childLevelLabel)} in view — weakest first
        </h2>
        <span className="text-[10px] text-gray-400">{nodes.length} {(nodes.length === 1 ? childLevelLabel : pluralLevel(childLevelLabel)).toLowerCase()}</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            <th className="py-1.5 text-left font-semibold">{childLevelLabel}</th>
            <th className="py-1.5 text-right font-semibold">Locations</th>
            <th className="py-1.5 text-right font-semibold">Reviews</th>
            <th className="py-1.5 text-right font-semibold">Avg ★</th>
            <th className="py-1.5 text-right font-semibold">vs network</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            // Colour the SHOWN number, not the raw one: −0.0512 and −0.0489 both
            // print as "−0.05", and coluring them differently reads as a bug.
            const delta = c.rating == null ? null : Number((c.rating - networkRating).toFixed(2))
            return (
              <tr key={c.path.join('')} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                <td className="py-2 pr-2 font-medium">
                  <Link href={nodeHref(datasetId, c.path)} className="text-gray-800 underline-offset-2 hover:text-gray-900 hover:underline">
                    {c.key}
                  </Link>
                </td>
                <td className="py-2 text-right tabular-nums text-gray-500">{c.outlets.toLocaleString()}</td>
                <td className="py-2 text-right tabular-nums text-gray-500">{c.reviews.toLocaleString()}</td>
                <td className={`py-2 text-right font-bold tabular-nums ${c.rating == null ? 'text-gray-300' : c.rating < 4.0 ? 'text-rose-600' : c.rating < 4.35 ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {c.rating == null ? '—' : c.rating.toFixed(2)}
                </td>
                <td className={`py-2 text-right font-semibold tabular-nums ${delta == null ? 'text-gray-300' : delta >= 0.05 ? 'text-emerald-600' : delta <= -0.05 ? 'text-rose-600' : 'text-gray-400'}`}>
                  {delta == null ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// At the deepest rung the drill-down is into individual locations, which keep
// their own (unrolled) deep-dive — the node path rides along so the breadcrumb
// survives the jump.
export function HierarchyOutlets({ datasetId, path, outlets }: {
  datasetId: string
  path: string[]
  outlets: { placeId: string; label: string; sublabel: string; reviews: number }[]
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Locations here</h2>
        <span className="text-[10px] text-gray-400">{outlets.length} location{outlets.length === 1 ? '' : 's'}</span>
      </div>
      <ul className="divide-y divide-gray-100">
        {outlets.map((o) => (
          <li key={o.placeId} className="flex items-center justify-between py-2">
            <Link href={nodeHref(datasetId, path, o.placeId)} className="text-sm font-medium text-gray-800 underline-offset-2 hover:underline">
              {o.label}
            </Link>
            <span className="shrink-0 text-sm tabular-nums text-gray-500">
              <span className="font-semibold text-gray-800">{o.sublabel}</span> · {o.reviews.toLocaleString()} reviews
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
