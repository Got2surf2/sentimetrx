'use client'

// IndoorMapCard — renders a real MCO floor plan (Meridian SVG) with
// overlaid placemark pins. Backed by /api/mco/indoor-map which picks the
// best floor for the hint's { terminal, level, gate, category } combo.
//
// Layout strategy: fixed-aspect container, SVG fills it via <img>, pins
// absolutely positioned over the SVG using percentages computed from the
// placemark's x/y vs the map's natural width/height. Browser scales the
// SVG and the pins together.

import { useEffect, useMemo, useState } from 'react'
import type { IndoorMapHint } from '@/lib/uiHints'

interface MapMeta {
  id: string
  name: string
  group: string
  groupName: string
  level: number
  levelLabel: string
  width: number | null
  height: number | null
}
interface ApiPlacemark {
  id: string
  name: string
  description: string
  type: string
  typeName: string
  typeCategory: string
  x: number
  y: number
  color: string | null
}
interface SiblingMap {
  id: string; name: string; level: number; levelLabel: string; group: string
}
interface ApiResponse {
  map: MapMeta | null
  placemarks: ApiPlacemark[]
  svg_url: string | null
  other_floors: SiblingMap[]
}

// Emoji per Meridian placemark type. Falls back by typeCategory for slugs
// we haven't enumerated. Keeps the legend self-explanatory without us
// shipping icon SVGs.
function pinIcon(p: ApiPlacemark): string {
  const t = (p.type || '').toLowerCase()
  if (t === 'gate') return '🚪'
  if (t.startsWith('restroom')) return '🚻'
  if (t === 'restaurant' || t === 'cafe') return '🍽️'
  if (t === 'bar' || t === 'club') return '🍷'
  if (t === 'shop') return '🛍️'
  if (t === 'atm') return '💵'
  if (t === 'aed') return '🆘'
  if (t === 'water_fountain') return '💧'
  if (t === 'nursing_station' || t === 'nursing_room') return '🍼'
  if (t === 'pet_relief') return '🐾'
  if (t === 'paging_phone' || t === 'phone') return '📞'
  if (t === 'information' || t === 'customer_service') return 'ℹ️'
  if (t === 'kiosk') return '🟢'
  if (t === 'lounge') return '🛋️'
  if (t === 'shoe_shine') return '👞'
  if (t === 'vending_machines') return '🥤'
  return '📍'
}

// Default category filter chips — which Meridian typeCategory to show
// when no hint.category is set. Generic + meta-pins (paging displays,
// fire extinguishers) hidden by default.
const DEFAULT_CATEGORY_FILTERS = [
  { key: 'all',           label: 'All',         matchAny: true },
  { key: 'Transportation', label: 'Gates' },
  { key: 'Recreational',   label: 'Dining & Shops' },
  { key: 'Restroom/Facilities', label: 'Restrooms' },
  { key: 'Amenities',      label: 'Amenities' },
]

export default function IndoorMapCard({ hint }: { hint: IndoorMapHint }) {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [overrideMapId, setOverrideMapId] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('all')
  const [hovered, setHovered] = useState<ApiPlacemark | null>(null)

  // Reset filter + override when the hint changes (new query).
  useEffect(() => { setFilter('all'); setOverrideMapId(null) }, [hint.terminal, hint.level, hint.gate, hint.category])

  useEffect(() => {
    let aborted = false
    setLoading(true); setError(null)
    fetch('/api/mco/indoor-map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        terminal: hint.terminal,
        level: overrideMapId ? undefined : hint.level,
        gate: overrideMapId ? undefined : hint.gate,
        category: hint.category,
      }),
    })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then((d: ApiResponse) => {
        if (aborted) return
        // If user toggled to a sibling, refetch with that map id baked into a
        // synthetic query (terminal=...&level=...). For now just respect the
        // override by re-using its levelLabel.
        if (overrideMapId) {
          const sibling = d.other_floors.find(f => f.id === overrideMapId) || (d.map?.id === overrideMapId ? d.map : null)
          if (sibling) {
            // refetch with explicit level
            fetch('/api/mco/indoor-map', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                terminal: hint.terminal,
                level: (sibling as any).levelLabel,
                category: hint.category,
              }),
            }).then(r => r.json()).then((d2: ApiResponse) => { if (!aborted) setData(d2) })
            return
          }
        }
        setData(d)
      })
      .catch(e => { if (!aborted) { setError(String(e?.message || e)); setData(null) } })
      .finally(() => { if (!aborted) setLoading(false) })
    return () => { aborted = true }
  }, [hint.terminal, hint.level, hint.gate, hint.category, overrideMapId])

  const filtered = useMemo<ApiPlacemark[]>(() => {
    const all = data?.placemarks || []
    // Drop Generic-category meta pins
    const usable = all.filter(p => p.typeCategory !== 'Generic')
    if (filter === 'all') return usable
    return usable.filter(p => p.typeCategory === filter)
  }, [data, filter])

  // Find the gate pin the hint asked about (for highlight).
  const highlightedId = useMemo(() => {
    if (!hint.gate || !data) return null
    const g = hint.gate.toUpperCase().replace(/^[A-Z]+/, '')
    const match = data.placemarks.find(p => p.type === 'gate' && p.name.toUpperCase().replace(/[^0-9A-Z]/g, '').endsWith(g))
    return match?.id || null
  }, [hint.gate, data])

  if (loading && !data) {
    return (
      <div className="canvas-card-inner indoor-map-card">
        <div className="canvas-header">
          <h2>Indoor Map</h2>
          <span className="subtitle">Loading floor plan…</span>
        </div>
      </div>
    )
  }
  if (error || !data || !data.map || !data.svg_url) {
    return (
      <div className="canvas-card-inner indoor-map-card">
        <div className="canvas-header">
          <h2>Indoor Map</h2>
          <span className="subtitle">{error ? 'Map unavailable right now' : 'No matching floor'}</span>
        </div>
      </div>
    )
  }

  const m = data.map
  const W = m.width || 3000
  const H = m.height || 3000
  return (
    <div className="canvas-card-inner indoor-map-card">
      <div className="canvas-header">
        <h2>{m.name}</h2>
        <span className="subtitle">{m.groupName} · Level {m.levelLabel}</span>
        <span className="badge">{filtered.length} pins</span>
      </div>

      {data.other_floors.length > 0 && (
        <div className="indoor-floors">
          <span className="indoor-floors-label">Other floors:</span>
          {[m, ...data.other_floors]
            .sort((a, b) => a.level - b.level)
            .map(f => (
              <button
                key={f.id}
                className={'indoor-floor-pill' + (f.id === m.id ? ' active' : '')}
                onClick={() => setOverrideMapId(f.id === m.id ? null : f.id)}
                title={f.name}
              >
                {f.levelLabel}
              </button>
            ))}
        </div>
      )}

      <div className="indoor-cat-filters">
        {DEFAULT_CATEGORY_FILTERS.map(f => (
          <button
            key={f.key}
            className={'indoor-cat-pill' + (filter === f.key ? ' active' : '')}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="indoor-map-viewport">
        <img className="indoor-map-svg" src={data.svg_url} alt={m.name} draggable={false} />
        <div className="indoor-pins" aria-hidden={false}>
          {filtered.map(p => {
            const left = (p.x / W) * 100
            const top = (p.y / H) * 100
            const isHighlight = p.id === highlightedId
            return (
              <button
                key={p.id}
                className={'indoor-pin' + (isHighlight ? ' indoor-pin-hl' : '')}
                style={{ left: left + '%', top: top + '%' }}
                onMouseEnter={() => setHovered(p)}
                onMouseLeave={() => setHovered(prev => prev?.id === p.id ? null : prev)}
                onClick={() => setHovered(prev => prev?.id === p.id ? null : p)}
                title={p.name}
              >
                <span className="indoor-pin-icon">{pinIcon(p)}</span>
              </button>
            )
          })}
        </div>
        {hovered && (
          <div className="indoor-pin-tip">
            <div className="indoor-pin-tip-name">{hovered.name}</div>
            <div className="indoor-pin-tip-type">{hovered.typeName || hovered.type}</div>
          </div>
        )}
      </div>

      <div className="resto-footer">Live floor plan via MCO/Meridian · drag the page to scroll, tap pins for details</div>
    </div>
  )
}
