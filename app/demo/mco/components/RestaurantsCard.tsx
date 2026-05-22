'use client'

// Restaurants canvas card. Fetches live data from /api/mco/places using the
// hint's place_ids + context. If no Google Places API key is configured,
// the route returns context-scoped mock data — the card still renders
// (and tags itself as not-live so the demo is honest).

import { useEffect, useState } from 'react'
import type { RestaurantsHint } from '@/lib/uiHints'

interface PlaceCard {
  place_id: string
  name: string
  rating: number | null
  user_ratings_total: number | null
  price_level: number | null
  opening_hours_now: 'open' | 'closed' | 'unknown'
  formatted_address: string
  maps_url: string
  primary_type: string | null
  is_mock: boolean
}

interface ApiResponse { places: PlaceCard[]; has_live_data: boolean }

// Pleasant deterministic photo-area gradient per place_id, so the demo
// reads "richer than a list" without us shipping real photos.
function photoGradient(id: string): string {
  const palette = [
    ['#064e3b', '#047857'],
    ['#92400e', '#c2410c'],
    ['#7c2d12', '#ea580c'],
    ['#b91c1c', '#dc2626'],
    ['#1e3a8a', '#2563eb'],
    ['#581c87', '#7e22ce'],
    ['#134e4a', '#0f766e'],
    ['#831843', '#be185d'],
  ]
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  const [a, b] = palette[hash % palette.length]
  return `linear-gradient(135deg, ${a}, ${b})`
}

function stars(rating: number | null) {
  if (rating == null) return '–'
  const full = Math.round(rating)
  return '★'.repeat(full) + '☆'.repeat(5 - full)
}

function priceBand(p: number | null) {
  if (p == null || p <= 0) return ''
  return '$'.repeat(Math.min(p, 4))
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

export default function RestaurantsCard({ hint }: { hint: RestaurantsHint }) {
  const [places, setPlaces] = useState<PlaceCard[]>([])
  const [loading, setLoading] = useState(true)
  const [hasLive, setHasLive] = useState(false)

  useEffect(() => {
    let aborted = false
    setLoading(true)
    fetch('/api/mco/places', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ place_ids: hint.place_ids || [], context: hint.context }),
    })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then((data: ApiResponse) => {
        if (aborted) return
        setPlaces(Array.isArray(data.places) ? data.places : [])
        setHasLive(!!data.has_live_data)
      })
      .catch(() => { if (!aborted) setPlaces([]) })
      .finally(() => { if (!aborted) setLoading(false) })
    return () => { aborted = true }
  }, [hint.place_ids?.join(','), hint.context])

  return (
    <div className="canvas-card-inner">
      <div className="canvas-header">
        <h2>Dining near you</h2>
        <span className="subtitle">{contextLabel(hint.context)}</span>
        <span className="badge">{hasLive ? 'Live' : 'Sample'}</span>
      </div>

      {loading && places.length === 0 ? (
        <div style={{ padding: '24px 4px', color: '#6b7280', fontSize: 14 }}>Loading nearby dining…</div>
      ) : places.length === 0 ? (
        <div style={{ padding: '24px 4px', color: '#6b7280', fontSize: 14 }}>No dining matches available right now.</div>
      ) : (
        <div className="resto-list">
          {places.map((p) => (
            <a
              key={p.place_id}
              href={p.maps_url}
              target="_blank"
              rel="noopener noreferrer"
              className="resto"
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <div className="resto-photo" style={{ backgroundImage: photoGradient(p.place_id) }} />
              <div className="resto-info">
                <div className="resto-name">
                  <span>{p.name}</span>
                  {!p.is_mock && p.opening_hours_now !== 'unknown' && (
                    <span className={'open-pill ' + p.opening_hours_now}>
                      {p.opening_hours_now === 'open' ? 'Open' : 'Closed'}
                    </span>
                  )}
                </div>
                <div className="resto-meta">
                  {p.primary_type ? p.primary_type.replace(/_/g, ' ') + ' · ' : ''}
                  {p.formatted_address || ''}
                </div>
                {/* Suppress rating numbers in mock mode — synthetic values
                    look authoritative next to the stars but won't match
                    the real Google page the user lands on. Only show
                    rating UI when the data is genuinely live. */}
                {!p.is_mock && (
                  <div className="resto-rating">
                    <span className="stars">{stars(p.rating)}</span>
                    {p.rating != null && <strong>{p.rating.toFixed(1)}</strong>}
                    {p.user_ratings_total != null && <span className="reviews">({p.user_ratings_total.toLocaleString()})</span>}
                    {priceBand(p.price_level) && <span className="price">· {priceBand(p.price_level)}</span>}
                  </div>
                )}
                {p.is_mock && (
                  <div className="resto-rating" style={{ color: '#9ca3af', fontStyle: 'italic', fontSize: 12 }}>
                    Tap to open in Google Maps for current rating &amp; hours
                  </div>
                )}
              </div>
            </a>
          ))}
        </div>
      )}

      <div className="resto-footer">
        {hasLive
          ? 'Ratings & hours powered by Google · Live, refreshed on render'
          : 'Sample list — live Google ratings & hours appear once a Google Places API key is connected. Tap any card to open the real listing on Google Maps.'}
      </div>
    </div>
  )
}
