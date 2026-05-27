'use client'

// FlightListCard — right-pane card for plural flight queries
// ("flights to LGA tonight", "Delta departures today"). Renders a clean
// scrollable list — terminal / gate / time / status per row, color-coded
// by status, click a row to deep-dive into the existing IndoorMapCard
// with flight prep for that single flight.
//
// Replaces the markdown-table-in-chat anti-pattern: prose answer should be
// a single line, this card carries the list.

import { useEffect, useState } from 'react'
import type { FlightListHint } from '@/lib/uiHints'

interface FlightRow {
  flight_number: string
  airline: string
  arrival: boolean
  status: string
  is_delayed: boolean
  departure_to: string
  arrived_from: string
  via_airport: string
  terminal: string | null
  gate: string | null
  baggage_belt: string[]
  scheduled_timestamp: number
  best_known_timestamp: number
  actual_timestamp: number | null
  scheduled_date: string
}
interface ApiResponse {
  flights: FlightRow[]
  count: number
  filters: any
  range_unix: { start: number; end: number }
}

const AIRLINE_NAMES: Record<string, string> = {
  DL: 'Delta', AA: 'American', UA: 'United', WN: 'Southwest', B6: 'JetBlue',
  NK: 'Spirit', F9: 'Frontier', G4: 'Allegiant', AS: 'Alaska',
  MX: 'Breeze', AM: 'AeroMéxico', AC: 'Air Canada', WS: 'WestJet',
  BA: 'British Airways', LH: 'Lufthansa', VS: 'Virgin Atlantic',
}

function fmtClock(unix: number): string {
  if (!unix) return ''
  return new Date(unix * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function statusStyle(s: string, delayed: boolean): { bg: string; fg: string } {
  if (delayed || /delay/i.test(s)) return { bg: '#fef3c7', fg: '#92400e' }
  if (/cancel/i.test(s)) return { bg: '#fee2e2', fg: '#991b1b' }
  if (/board/i.test(s)) return { bg: '#dbeafe', fg: '#1e40af' }
  if (/landed|arrived/i.test(s)) return { bg: '#d1fae5', fg: '#065f46' }
  if (/depart/i.test(s)) return { bg: '#d1fae5', fg: '#065f46' }
  return { bg: '#f3f4f6', fg: '#374151' }
}

function dispatchPrompt(prompt: string) {
  window.dispatchEvent(new CustomEvent('mco:prompt', { detail: prompt }))
}

export default function FlightListCard({ hint }: { hint: FlightListHint }) {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let aborted = false
    setLoading(true); setError(null)
    fetch('/api/mco/flights-list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        airline: hint.airline,
        destination: hint.destination,
        origin: hint.origin,
        terminal: hint.terminal,
        arrivals: hint.arrivals,
        time_window: hint.time_window,
      }),
    })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then((d: ApiResponse) => { if (!aborted) setData(d) })
      .catch(e => { if (!aborted) setError(String(e?.message || e)) })
      .finally(() => { if (!aborted) setLoading(false) })
    return () => { aborted = true }
  }, [hint.airline, hint.destination, hint.origin, hint.terminal, hint.arrivals, hint.time_window])

  // Build a header subtitle from the filter set
  const dir = hint.arrivals ? 'Arrivals' : 'Departures'
  const route = hint.arrivals && hint.origin ? `from ${hint.origin}`
              : !hint.arrivals && hint.destination ? `to ${hint.destination}`
              : ''
  const carrier = hint.airline ? (AIRLINE_NAMES[hint.airline] || hint.airline) : ''
  const window = hint.time_window || ''
  const subtitle = [carrier, dir, route, window].filter(Boolean).join(' · ') || 'Live MCO flights'

  return (
    <div className="canvas-card-inner">
      <div className="canvas-header">
        <h2>{carrier ? carrier + ' ' + dir.toLowerCase() : 'Flights'}{route ? ' ' + route : ''}</h2>
        <span className="subtitle">{subtitle}</span>
        <span className="badge">Live</span>
      </div>

      {loading && !data ? (
        <div style={{ padding: '24px 4px', color: '#6b7280', fontSize: 14 }}>Loading flights…</div>
      ) : error ? (
        <div style={{ padding: '24px 4px', color: '#6b7280', fontSize: 14 }}>Live flight feed unavailable right now.</div>
      ) : !data || data.flights.length === 0 ? (
        <div style={{ padding: '24px 4px', color: '#6b7280', fontSize: 14 }}>
          No matching flights in the live feed for that window.
        </div>
      ) : (
        <div className="fl-list">
          {data.flights.map(f => {
            const ss = statusStyle(f.status, f.is_delayed)
            const route = f.arrival ? `from ${f.arrived_from}` : `to ${f.departure_to}`
            const name = AIRLINE_NAMES[f.airline] || f.airline
            return (
              <button
                key={f.flight_number}
                className="fl-row"
                onClick={() => dispatchPrompt('Tell me about flight ' + f.flight_number)}
              >
                <div className="fl-row-l">
                  <div className="fl-flightno">{f.flight_number}</div>
                  <div className="fl-airline">{name}</div>
                </div>
                <div className="fl-row-m">
                  <div className="fl-route">{route}</div>
                  <div className="fl-gate">
                    {f.terminal ? 'T' + f.terminal : '—'}
                    {f.gate ? ' · gate ' + f.gate : ''}
                    {f.arrival && f.baggage_belt && f.baggage_belt.length > 0 ? ' · belt ' + f.baggage_belt[0] : ''}
                  </div>
                </div>
                <div className="fl-row-r">
                  <div className="fl-time">{fmtClock(f.best_known_timestamp)}</div>
                  <div className="fl-status" style={{ background: ss.bg, color: ss.fg }}>
                    {f.is_delayed ? 'Delayed' : f.status}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {data && data.flights.length > 0 && (
        <div className="resto-footer">
          Tap a flight for gate + security + walking-time details · live from MCO
        </div>
      )}
    </div>
  )
}
