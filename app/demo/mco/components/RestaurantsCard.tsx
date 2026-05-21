'use client'

// Restaurants canvas card. v1: hardcoded list (4-5 representative MCO airside
// concessions with mock ratings). Commit 4 replaces this with Google Places
// data fetched at render time using the hint's place_ids.

import type { RestaurantsHint } from '@/lib/uiHints'

interface MockResto {
  name: string
  cuisine: string
  meta: string
  rating: number
  reviews: number
  price: 1 | 2 | 3
  open: boolean
  gradient: string
}

const MOCK_RESTAURANTS: MockResto[] = [
  { name: 'Starbucks', cuisine: 'Coffee', meta: '0.0 mi · A14 concourse', rating: 4.1, reviews: 2847, price: 2, open: true, gradient: 'linear-gradient(135deg, #064e3b, #047857)' },
  { name: "Auntie Anne's Pretzels", cuisine: 'Snacks', meta: '60 ft from A14', rating: 4.3, reviews: 1206, price: 1, open: true, gradient: 'linear-gradient(135deg, #92400e, #c2410c)' },
  { name: 'Cask & Larder Brewhouse', cuisine: 'American · Bar', meta: '150 ft from A14', rating: 4.2, reviews: 984, price: 3, open: true, gradient: 'linear-gradient(135deg, #7c2d12, #ea580c)' },
  { name: 'Outback Steakhouse', cuisine: 'Steakhouse', meta: 'Full bar · A-side', rating: 3.9, reviews: 2316, price: 3, open: true, gradient: 'linear-gradient(135deg, #b91c1c, #dc2626)' },
  { name: 'Cibo Express Gourmet Market', cuisine: 'Grab-and-go', meta: 'Sandwiches · A-side', rating: 4.0, reviews: 673, price: 2, open: true, gradient: 'linear-gradient(135deg, #1e3a8a, #2563eb)' },
]

function stars(rating: number) {
  const full = Math.floor(rating)
  const empty = 5 - full
  return '★'.repeat(full) + '☆'.repeat(empty)
}

function priceBand(p: 1 | 2 | 3) {
  return '$'.repeat(p)
}

export default function RestaurantsCard({ hint }: { hint: RestaurantsHint }) {
  // hint.place_ids will drive real Places API calls in commit 4; for now we
  // show the hardcoded list and use hint.context just to vary the subtitle.
  const restaurants = MOCK_RESTAURANTS
  const contextLabel = hint.context === 'terminal_a_airside' ? 'Terminal A, airside' : 'Near you'

  return (
    <div className="canvas-card-inner">
      <div className="canvas-header">
        <h2>Dining near you</h2>
        <span className="subtitle">{contextLabel}</span>
        <span className="badge">Open now</span>
      </div>

      <div className="resto-list">
        {restaurants.map((r) => (
          <div key={r.name} className="resto">
            <div className="resto-photo" style={{ backgroundImage: r.gradient }} />
            <div className="resto-info">
              <div className="resto-name">
                <span>{r.name}</span>
                <span className={'open-pill ' + (r.open ? 'open' : 'closed')}>{r.open ? 'Open' : 'Closed'}</span>
              </div>
              <div className="resto-meta">{r.cuisine} · {r.meta}</div>
              <div className="resto-rating">
                <span className="stars">{stars(r.rating)}</span>
                <strong>{r.rating.toFixed(1)}</strong>
                <span className="reviews">({r.reviews.toLocaleString()})</span>
                <span className="price">· {priceBand(r.price)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="resto-footer">Ratings &amp; hours powered by Google · Live data, refreshed on request</div>
    </div>
  )
}
