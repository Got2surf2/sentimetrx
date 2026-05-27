'use client'

// ShopsCard — shopping equivalent of RestaurantsCard. Fetches the
// pre-bucketed shop directory from /api/mco/shops (backed by
// data/mco_shops.json from the flymco directory scrape). No ratings —
// flymco doesn't expose them for shops; we just list brand + gate hint.

import { useEffect, useState } from 'react'
import type { ShopsHint } from '@/lib/uiHints'

interface ShopCard {
  id: string
  name: string
  location_label: string
  location_detail: string | null
  bucket: string
  maps_url: string
  cuisine_icon: string
}
interface ApiResponse { shops: ShopCard[] }

function photoGradient(id: string): string {
  const palette = [
    ['#1e3a8a', '#3b82f6'],
    ['#581c87', '#a855f7'],
    ['#831843', '#ec4899'],
    ['#064e3b', '#10b981'],
    ['#7c2d12', '#f97316'],
    ['#0c4a6e', '#0284c7'],
    ['#4c1d95', '#7c3aed'],
    ['#134e4a', '#14b8a6'],
  ]
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  const [a, b] = palette[hash % palette.length]
  return `linear-gradient(135deg, ${a}, ${b})`
}

function contextLabel(c?: string) {
  switch (c) {
    case 'terminal_a_airside': return 'Terminal A, airside'
    case 'terminal_b_airside': return 'Terminal B, airside'
    case 'terminal_c_airside': return 'Terminal C, airside'
    case 'landside_main_terminal': return 'Main terminal, landside'
    default: return 'Near you'
  }
}

export default function ShopsCard({ hint }: { hint: ShopsHint }) {
  const [shops, setShops] = useState<ShopCard[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let aborted = false
    setLoading(true)
    fetch('/api/mco/shops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: hint.context }),
    })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then((data: ApiResponse) => {
        if (aborted) return
        setShops(Array.isArray(data.shops) ? data.shops : [])
      })
      .catch(() => { if (!aborted) setShops([]) })
      .finally(() => { if (!aborted) setLoading(false) })
    return () => { aborted = true }
  }, [hint.context])

  return (
    <div className="canvas-card-inner">
      <div className="canvas-header">
        <h2>Shopping near you</h2>
        <span className="subtitle">{contextLabel(hint.context)}</span>
        <span className="badge">Directory</span>
      </div>

      {loading && shops.length === 0 ? (
        <div style={{ padding: '24px 4px', color: '#6b7280', fontSize: 14 }}>Loading shops…</div>
      ) : shops.length === 0 ? (
        <div style={{ padding: '24px 4px', color: '#6b7280', fontSize: 14 }}>No shop matches available right now.</div>
      ) : (
        <div className="resto-list">
          {shops.map((s) => (
            <a
              key={s.id}
              href={s.maps_url}
              target="_blank"
              rel="noopener noreferrer"
              className="resto"
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <div className="resto-photo" style={{ backgroundImage: photoGradient(s.id) }}>
                <span className="cuisine-icon" aria-hidden="true">{s.cuisine_icon || '🛍️'}</span>
              </div>
              <div className="resto-info">
                <div className="resto-name">
                  <span>{s.name}</span>
                </div>
                <div className="resto-meta">
                  {s.location_label}{s.location_detail ? ' · ' + s.location_detail : ''}
                </div>
                <div className="resto-rating" style={{ color: '#9ca3af', fontStyle: 'italic', fontSize: 12 }}>
                  Tap for location on flymco terminal map
                </div>
              </div>
            </a>
          ))}
        </div>
      )}

      <div className="resto-footer">
        Directory from flymco.com — refresh by re-running the directory scraper for the latest tenants.
      </div>
    </div>
  )
}
