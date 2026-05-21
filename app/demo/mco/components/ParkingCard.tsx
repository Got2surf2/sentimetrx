'use client'

// Parking canvas card. Fetches live availability from /api/mco/parking on
// mount and any time `hint.highlight` changes (so a new "show garage_b"
// hint refreshes if the cache has expired). Falls back to a small static
// list when the API returns no data — the card still renders.

import { useEffect, useMemo, useState } from 'react'
import type { ParkingHint } from '@/lib/uiHints'

interface ApiLot {
  id: string
  name: string
  category: string
  status: 'open' | 'closed' | string
  available: number | null
  total: number | null
  terminalId: string | null
  rate: { hourly?: string; daily?: string } | null
}
interface ApiResponse { lots: ApiLot[]; fetched_at: number }

// Map ui_hints `highlight` slugs to GOAA's lot ids (mirrors
// lib/parking.ts HIGHLIGHT_TO_GOAA_ID). Inlined here so the card can pick
// the featured lot without importing server-only code.
const HIGHLIGHT_TO_GOAA_ID: Record<string, string> = {
  garage_a: 'parking-garage-a',
  garage_b: 'parking-garage-b',
  garage_c: 'parking-garage-c',
  terminal_top: 'terminal-top',
  atlantis: 'surface-lot-1',
  discovery: 'surface-lot-2',
  endeavour: 'surface-lot-3',
  north_economy: 'north-park-place',
  south_economy: 'south-park-place',
  west_economy: 'west-park-place',
  north_cell: 'north-cell-phone-lot',
  south_cell: 'south-cell-phone-lot',
  valet: 'valet-parking',
}

const STATIC_FALLBACK: ApiLot[] = [
  { id: 'parking-garage-c', name: 'Parking Garage C', category: 'garage', status: 'open', available: null, total: null, terminalId: 'c', rate: { daily: '24' } },
  { id: 'parking-garage-a', name: 'Parking Garage A', category: 'garage', status: 'open', available: null, total: null, terminalId: 'a', rate: { daily: '24' } },
  { id: 'parking-garage-b', name: 'Parking Garage B', category: 'garage', status: 'open', available: null, total: null, terminalId: 'b', rate: { daily: '24' } },
  { id: 'terminal-top', name: 'Terminal Top', category: 'premium', status: 'open', available: null, total: null, terminalId: null, rate: { daily: '32' } },
  { id: 'north-park-place', name: 'North Park Place', category: 'economy', status: 'open', available: null, total: null, terminalId: null, rate: { daily: '14' } },
  { id: 'south-park-place', name: 'South Park Place', category: 'economy', status: 'open', available: null, total: null, terminalId: null, rate: { daily: '14' } },
]

function fillClass(pct: number) {
  if (pct < 20) return 'fill low'
  if (pct < 50) return 'fill med'
  return 'fill'
}

function categoryTag(c: string) {
  switch (c) {
    case 'garage': return 'Garage'
    case 'economy': return 'Economy'
    case 'hotel': return 'Hotel'
    case 'cell_phone': return 'Cell phone'
    case 'surface': return 'Surface lot'
    case 'premium': return 'Premium'
    default: return c.replace(/_/g, ' ')
  }
}

function relativeTime(ts: number) {
  if (!ts) return ''
  const ms = Date.now() - ts * 1000
  if (ms < 60_000) return Math.floor(ms / 1000) + ' sec ago'
  if (ms < 3_600_000) return Math.floor(ms / 60_000) + ' min ago'
  return Math.floor(ms / 3_600_000) + ' h ago'
}

export default function ParkingCard({ hint }: { hint: ParkingHint }) {
  const [lots, setLots] = useState<ApiLot[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchedAt, setFetchedAt] = useState<number>(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let aborted = false
    setLoading(true)
    fetch('/api/mco/parking')
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then((data: ApiResponse) => {
        if (aborted) return
        setLots(Array.isArray(data.lots) && data.lots.length > 0 ? data.lots : STATIC_FALLBACK)
        setFetchedAt(data.fetched_at || Math.floor(Date.now() / 1000))
        setError(null)
      })
      .catch((e) => {
        if (aborted) return
        setLots(STATIC_FALLBACK)
        setError(String(e?.message || e))
      })
      .finally(() => { if (!aborted) setLoading(false) })
    return () => { aborted = true }
  }, [hint.highlight?.join(',')])

  const highlightIds = useMemo(
    () => new Set((hint.highlight || []).map((h) => HIGHLIGHT_TO_GOAA_ID[h] || h)),
    [hint.highlight],
  )

  // Featured = first highlighted lot if any, else garage_c, else first.
  const featured = useMemo(() => {
    if (lots.length === 0) return null
    return (
      lots.find((l) => highlightIds.has(l.id))
      || lots.find((l) => l.id === 'parking-garage-c')
      || lots[0]
    )
  }, [lots, highlightIds])

  // Show only the lots with a known live count when we have any; otherwise
  // show everything (so the card has content even if availability is null).
  const lotsWithCounts = lots.filter((l) => typeof l.available === 'number')
  const display = lotsWithCounts.length > 0 ? lotsWithCounts : lots
  const haveLiveCounts = lotsWithCounts.length > 0
  const liveBadgeLabel = haveLiveCounts ? 'Live' : 'Status'

  return (
    <div className="canvas-card-inner">
      <div className="canvas-header">
        <h2>{haveLiveCounts ? 'Live Parking Availability' : 'MCO Parking Lots'}</h2>
        <span className="subtitle">
          {loading ? 'Loading…' : error ? 'Live data unavailable — refresh to retry' : ('Updated ' + relativeTime(fetchedAt))}
        </span>
        <span className="badge">{liveBadgeLabel}</span>
      </div>

      {featured && (
        <div className="parking-summary">
          <div>
            {typeof featured.available === 'number'
              ? <>
                  <div className="parking-num">{featured.available.toLocaleString()}</div>
                  <div className="parking-label">spots open · {featured.name}</div>
                </>
              : <>
                  <div className="parking-num" style={{ textTransform: 'capitalize' }}>{featured.status}</div>
                  <div className="parking-label">{featured.name}</div>
                </>}
          </div>
          <div className="parking-summary-right">
            <div className="parking-summary-headline">
              {featured.terminalId ? 'Terminal ' + featured.terminalId.toUpperCase() : categoryTag(featured.category)}
            </div>
            {featured.rate?.daily && <div className="parking-summary-meta">${featured.rate.daily}/day</div>}
          </div>
        </div>
      )}

      <div className="lot-grid">
        {display.slice(0, 8).map((lot) => {
          const isHighlight = highlightIds.has(lot.id)
          const hasCount = typeof lot.available === 'number' && typeof lot.total === 'number' && lot.total > 0
          const pct = hasCount ? Math.round((lot.available! / lot.total!) * 100) : 0
          return (
            <div key={lot.id} className={'lot' + (isHighlight ? ' highlight' : '')}>
              <div className="lot-name">
                <span>{lot.name}</span>
                <span className="lot-tag">{isHighlight ? 'RECOMMENDED' : categoryTag(lot.category)}</span>
              </div>
              {hasCount ? (
                <>
                  <div className="bar"><div className={fillClass(pct)} style={{ width: pct + '%' }} /></div>
                  <div className="avail"><strong>{lot.available!.toLocaleString()}</strong> of {lot.total!.toLocaleString()} available</div>
                </>
              ) : (
                <div className="avail">Status: <strong style={{ textTransform: 'capitalize' }}>{lot.status}</strong>{lot.rate?.daily ? ' · $' + lot.rate.daily + '/day' : ''}</div>
              )}
            </div>
          )
        })}
      </div>

      {haveLiveCounts && (
        <div className="lot-legend">
          <span><span className="dot dot-green" />Plenty</span>
          <span><span className="dot dot-amber" />Filling</span>
          <span><span className="dot dot-red" />Nearly full</span>
        </div>
      )}
    </div>
  )
}
