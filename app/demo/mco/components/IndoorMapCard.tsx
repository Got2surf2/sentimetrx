'use client'

// IndoorMapCard — renders a real MCO floor plan (Meridian SVG) with
// overlaid placemark pins. Backed by /api/mco/indoor-map which picks the
// best floor for the hint's { terminal, level, gate, category } combo.
//
// When the hint includes a `gate` or `flight`, ALSO fetches
// /api/mco/flight-prep and renders a flight-prep panel above the map:
// live security wait per lane, walking-time estimates, time-to-departure
// budget, and chips offering shop/dining recommendations during the
// spare window.

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

interface FlightPrep {
  flight: { number: string; airline: string; arrival: boolean; status: string; is_delayed: boolean; departure_to: string; arrived_from: string; scheduled_timestamp: number; best_known_timestamp: number; scheduled_date: string } | null
  gate?: string
  terminal?: string
  concourse?: string
  security?: {
    precheck: { wait_min: number | null; checkpoint_name: string; available: boolean }
    standard: { wait_min: number | null; checkpoint_name: string; available: boolean }
  }
  walk?: { pre_security_min: number; post_security_min: number }
  total?: { precheck_min: number; standard_min: number }
  time_to_departure_min?: number
  time_to_boarding_min?: number
  spare_time_min?: { precheck: number; standard: number }
  security_recommendation?: 'precheck' | 'standard' | 'either'
  summary_line?: string
  error?: string
}

function fmtMin(m: number | null | undefined): string {
  if (m == null) return '—'
  const n = Math.max(0, Math.round(m))
  if (n < 60) return n + ' min'
  return Math.floor(n / 60) + 'h ' + (n % 60) + ' min'
}
function fmtClock(unix: number): string {
  if (!unix) return ''
  const d = new Date(unix * 1000)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

export default function IndoorMapCard({ hint }: { hint: IndoorMapHint }) {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [prep, setPrep] = useState<FlightPrep | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [overrideMapId, setOverrideMapId] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('all')
  const [hovered, setHovered] = useState<ApiPlacemark | null>(null)

  // Reset filter + override when the hint changes (new query).
  useEffect(() => { setFilter('all'); setOverrideMapId(null); setPrep(null) }, [hint.terminal, hint.level, hint.gate, hint.flight, hint.category])

  // Fetch flight-prep when the user supplied a flight or gate. Runs in
  // parallel with the indoor-map fetch; pins drop in as data lands.
  useEffect(() => {
    if (!hint.flight && !hint.gate) { setPrep(null); return }
    let aborted = false
    fetch('/api/mco/flight-prep', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flight: hint.flight, gate: hint.gate }),
    })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then((d: FlightPrep) => { if (!aborted) setPrep(d) })
      .catch(() => { if (!aborted) setPrep(null) })
    return () => { aborted = true }
  }, [hint.flight, hint.gate])

  // When the flight-prep returns a gate we didn't originally have, use it
  // for the floor lookup so the right concourse map loads.
  const effectiveGate = hint.gate || prep?.gate
  const effectiveTerminal = hint.terminal || (prep?.terminal as 'A' | 'B' | 'C' | undefined)

  useEffect(() => {
    let aborted = false
    setLoading(true); setError(null)
    fetch('/api/mco/indoor-map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        terminal: effectiveTerminal,
        level: overrideMapId ? undefined : hint.level,
        gate: overrideMapId ? undefined : effectiveGate,
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
            void fetch('/api/mco/indoor-map', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                terminal: hint.terminal,
                level: sibling.levelLabel,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveTerminal, hint.level, effectiveGate, hint.category, overrideMapId])

  const filtered = useMemo<ApiPlacemark[]>(() => {
    const all = data?.placemarks || []
    // Drop Generic-category meta pins
    const usable = all.filter(p => p.typeCategory !== 'Generic')
    if (filter === 'all') return usable
    return usable.filter(p => p.typeCategory === filter)
  }, [data, filter])

  // Find the gate pin to highlight — uses hint.gate or the gate the
  // flight-prep lookup resolved for us.
  const highlightedId = useMemo(() => {
    const g = (effectiveGate || '').toUpperCase().replace(/^[A-Z]+/, '')
    if (!g || !data) return null
    const match = data.placemarks.find(p => p.type === 'gate' && p.name.toUpperCase().replace(/[^0-9A-Z]/g, '').endsWith(g))
    return match?.id || null
  }, [effectiveGate, data])

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
  const showPrep = prep && (prep.gate || prep.flight)
  return (
    <div className="canvas-card-inner indoor-map-card">
      {showPrep && <FlightPrepPanel prep={prep!} />}
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
        {/* eslint-disable-next-line @next/next/no-img-element -- remote SVG — Next declines to optimize SVG without dangerouslyAllowSVG */}
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

// ── Flight-prep panel ──────────────────────────────────────────────────────
// Renders the gate / departure / security / walking / spare-time summary
// above the floor plan when the user mentioned a flight or gate.

// Pick a playful headline + tagline based on how much spare time the user
// has. The kiosk's killer moment — make it feel like an opportunity, not a
// checklist item.
function spareCopy(min: number): { emoji: string; head: string; tag: string; tone: 'lots' | 'plenty' | 'snug' | 'tight' | 'go' } {
  if (min >= 240) return { emoji: '🌴', head: 'Plenty of time', tag: 'Whole afternoon at the airport. Eat, shop, take it slow.', tone: 'lots' }
  if (min >= 150) return { emoji: '✨', head: 'You\'ve got time', tag: 'Sit-down lunch + a wander before security. Easy.', tone: 'lots' }
  if (min >= 90)  return { emoji: '☕', head: 'Solid window', tag: 'Time for a real meal, or coffee + browsing.', tone: 'plenty' }
  if (min >= 60)  return { emoji: '🍽️', head: 'About an hour', tag: 'A bite to eat works. Want a quick rec?', tone: 'plenty' }
  if (min >= 30)  return { emoji: '⚡', head: 'Snack window', tag: 'Quick coffee, grab-and-go food, light browse.', tone: 'snug' }
  if (min >= 15)  return { emoji: '🏃', head: 'Get moving soon', tag: 'Time for one quick coffee — then head for security.', tone: 'tight' }
  if (min >= 0)   return { emoji: '⏳', head: 'Cutting it close', tag: 'Head straight to security — no detours.', tone: 'tight' }
  return            { emoji: '🚨', head: 'Go now!', tag: 'Boarding\'s coming up — straight to security.', tone: 'go' }
}

function FlightPrepPanel({ prep }: { prep: FlightPrep }) {
  const f = prep.flight
  const sec = prep.security
  const spare = prep.spare_time_min
  const rec = prep.security_recommendation
  const pcAvail = !!sec?.precheck?.available
  const stAvail = !!sec?.standard?.available
  const bestSpare = pcAvail && rec !== 'standard' ? (spare?.precheck ?? 0) : (spare?.standard ?? 0)
  const copy = spareCopy(bestSpare)

  const flightLine = f
    ? `${f.number} ${f.arrival ? 'from' : 'to'} ${f.arrival ? f.arrived_from : f.departure_to}`
    : null

  return (
    <div className={'prep-panel prep-tone-' + copy.tone}>
      {/* Compact flight strip — quick scan: which flight, where, when */}
      <div className="prep-strip">
        {flightLine && <span className="prep-strip-flight">{flightLine}</span>}
        <span className="prep-strip-meta">
          Terminal {prep.terminal} · Gate {prep.gate}
          {f && f.best_known_timestamp ? ` · ${fmtClock(f.best_known_timestamp)}` : ''}
          {f && f.is_delayed ? ' · DELAYED' : ''}
        </span>
      </div>

      {/* HERO — the killer kiosk moment. Big number, playful framing. */}
      <div className="prep-hero">
        <div className="prep-hero-emoji" aria-hidden>{copy.emoji}</div>
        <div className="prep-hero-text">
          <div className="prep-hero-time">{bestSpare > 0 ? fmtMin(bestSpare) : 'Now'}</div>
          <div className="prep-hero-head">{copy.head}</div>
          <div className="prep-hero-tag">{copy.tag}</div>
        </div>
      </div>

      {/* Compact bottom row — security waits + walk, all at a glance */}
      <div className="prep-mini">
        <span className={'prep-mini-item' + (rec === 'precheck' ? ' prep-mini-rec' : '')}>
          <span className="prep-mini-label">PreCheck</span>
          <span className="prep-mini-value">{pcAvail ? fmtMin(sec?.precheck?.wait_min ?? 0) : '—'}</span>
        </span>
        <span className={'prep-mini-item' + (rec === 'standard' ? ' prep-mini-rec' : '')}>
          <span className="prep-mini-label">Standard</span>
          <span className="prep-mini-value">{stAvail ? fmtMin(sec?.standard?.wait_min ?? 0) : '—'}</span>
        </span>
        <span className="prep-mini-item">
          <span className="prep-mini-label">Walk</span>
          <span className="prep-mini-value">{fmtMin(prep.walk ? prep.walk.pre_security_min + prep.walk.post_security_min : 0)}</span>
        </span>
        <span className="prep-mini-item prep-mini-checkpoint">
          <span className="prep-mini-label">via</span>
          <span className="prep-mini-value">{sec?.precheck?.checkpoint_name?.replace(' PreCheck','') || sec?.standard?.checkpoint_name?.replace(' Standard','') || '—'}</span>
        </span>
      </div>

      {/* Rec chips — only when there's real time to spend */}
      {bestSpare > 15 && (
        <div className="prep-recs">
          <button type="button" className="prep-recs-chip" onClick={() => dispatchPrompt('What restaurants are near gate ' + prep.gate + '?')}>🍽️ Eat</button>
          <button type="button" className="prep-recs-chip" onClick={() => dispatchPrompt('What shops are in Terminal ' + prep.terminal + '?')}>🛍️ Shop</button>
          <button type="button" className="prep-recs-chip" onClick={() => dispatchPrompt('Coffee near gate ' + prep.gate + '?')}>☕ Coffee</button>
          <button type="button" className="prep-recs-chip" onClick={() => dispatchPrompt('Where can I find a quiet place to wait in Terminal ' + prep.terminal + '?')}>🧘 Chill</button>
        </div>
      )}
    </div>
  )
}

// Dispatch a prompt up to the canvas — the chat pane listens for this
// custom event and submits it as a user message. Same path the welcome-card
// tiles use, just without prop drilling through HintRenderer.
function dispatchPrompt(prompt: string) {
  window.dispatchEvent(new CustomEvent('mco:prompt', { detail: prompt }))
}
