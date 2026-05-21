'use client'

// Parking canvas card. v1: hardcoded availability. Commit 4 fetches the
// flymco live parking JSON at render time and updates this view.

import type { ParkingHint } from '@/lib/uiHints'

interface MockLot {
  id: string                                  // matches hint.highlight entries
  name: string
  tag: string
  available: number
  total: number
}

const MOCK_LOTS: MockLot[] = [
  { id: 'garage_c', name: 'Parking Garage C', tag: 'Terminal C', available: 1240, total: 4400 },
  { id: 'garage_a', name: 'Parking Garage A', tag: 'Terminal A/B', available: 520, total: 800 },
  { id: 'garage_b', name: 'Parking Garage B', tag: 'Terminal A/B', available: 145, total: 800 },
  { id: 'terminal_top', name: 'Terminal Top', tag: 'Premium', available: 22, total: 280 },
  { id: 'endeavour', name: 'Surface Lot Endeavour', tag: 'Train Station', available: 340, total: 820 },
  { id: 'north_economy', name: 'North Park Economy', tag: 'Economy', available: 1840, total: 3340 },
]

function fillClass(pct: number) {
  if (pct < 20) return 'fill low'
  if (pct < 50) return 'fill med'
  return 'fill'
}

export default function ParkingCard({ hint }: { hint: ParkingHint }) {
  const highlight = new Set(hint.highlight || [])
  const featured = MOCK_LOTS.find((l) => highlight.has(l.id)) || MOCK_LOTS[0]

  return (
    <div className="canvas-card-inner">
      <div className="canvas-header">
        <h2>Live Parking Availability</h2>
        <span className="subtitle">Updated 60 sec ago</span>
        <span className="badge">Live</span>
      </div>

      <div className="parking-summary">
        <div>
          <div className="parking-num">{featured.available.toLocaleString()}</div>
          <div className="parking-label">spots available · {featured.name}</div>
        </div>
        <div className="parking-summary-right">
          <div className="parking-summary-headline">{featured.tag}</div>
          <div className="parking-summary-meta">Recommended for your destination</div>
        </div>
      </div>

      <div className="lot-grid">
        {MOCK_LOTS.map((lot) => {
          const pct = Math.round((lot.available / lot.total) * 100)
          const isHighlight = highlight.has(lot.id) || (highlight.size === 0 && lot.id === 'garage_c')
          return (
            <div key={lot.id} className={'lot' + (isHighlight ? ' highlight' : '')}>
              <div className="lot-name">
                <span>{lot.name}</span>
                <span className="lot-tag">{isHighlight ? 'RECOMMENDED' : lot.tag}</span>
              </div>
              <div className="bar"><div className={fillClass(pct)} style={{ width: pct + '%' }} /></div>
              <div className="avail"><strong>{lot.available.toLocaleString()}</strong> of {lot.total.toLocaleString()} available</div>
            </div>
          )
        })}
      </div>

      <div className="lot-legend">
        <span><span className="dot dot-green" />Plenty</span>
        <span><span className="dot dot-amber" />Filling</span>
        <span><span className="dot dot-red" />Nearly full</span>
      </div>
    </div>
  )
}
