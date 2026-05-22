'use client'

// Default landing card for the right pane of /demo/mco. Shows MCO branding,
// a live parking snapshot pulled from /api/mco/parking, and four quick-
// access tiles representing the most-asked topics. Replaces the previous
// default of showing a C→A/B map before the user has asked anything.

import { useEffect, useState } from 'react'
import type { WelcomeHint } from '@/lib/uiHints'

interface ApiLot {
  id: string
  name: string
  available: number | null
  total: number | null
  status: 'open' | 'closed' | string
}
interface ApiResponse { lots: ApiLot[] }

const HOME_TILES = [
  { icon: '🅿️', label: 'Parking', prompt: 'Where should I park?' },
  { icon: '🍽️', label: 'Dining', prompt: 'Where can I eat?' },
  { icon: '⚡', label: 'Speed through security', prompt: 'What is MCO Reserve?' },
  { icon: '♿', label: 'Accessibility', prompt: 'What accessibility services does MCO offer?' },
]

const KIOSK_TILES = [
  { icon: '🛍️', label: 'Shopping', prompt: 'What shops are at MCO?' },
  { icon: '🍽️', label: 'Food & Drinks', prompt: 'What restaurants and bars are near me?' },
  { icon: '🔒', label: 'Security', prompt: 'How long are security lines right now?' },
  { icon: '🚗', label: 'Ground Transport', prompt: 'How do I get ground transportation from MCO?' },
]

// Static in-venue facts shown instead of the parking block in kiosk mode.
// These are universally true at MCO and useful to a traveler already inside.
const KIOSK_GLANCE = [
  { icon: '🛜', head: 'Free Wi-Fi', sub: 'Available throughout all terminals' },
  { icon: '🚆', head: 'Terminal link', sub: 'APM train · Terminals A/B ↔ C' },
  { icon: '⚡', head: 'MCO Reserve', sub: 'Book a security slot · skip the line' },
  { icon: '🚗', head: 'Ground transport', sub: 'Rideshare, taxi & shuttles at arrivals level' },
]

function fillBar(available: number | null, total: number | null): { pct: number; color: string; label: string } {
  if (total == null || total <= 0 || available == null) return { pct: 0, color: '#9ca3af', label: '—' }
  const filled = total - available
  const pct = Math.max(0, Math.min(100, Math.round((filled / total) * 100)))
  let color = '#10b981'  // green — plenty open
  if (pct >= 70) color = '#f59e0b'  // amber — filling up
  if (pct >= 90) color = '#ef4444'  // red — nearly full
  return { pct, color, label: pct + '% full' }
}

export default function WelcomeCard({ hint, onTileClick }: { hint: WelcomeHint; onTileClick?: (prompt: string) => void }) {
  const [lots, setLots] = useState<ApiLot[]>([])
  const [loading, setLoading] = useState(true)
  const [hasLive, setHasLive] = useState(false)

  useEffect(() => {
    let aborted = false
    setLoading(true)
    fetch('/api/mco/parking', { method: 'GET' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then((data: ApiResponse) => {
        if (aborted) return
        const garages = (data.lots || []).filter(l => /Garage [ABC]/i.test(l.name)).sort((a, b) => a.name.localeCompare(b.name))
        setLots(garages)
        setHasLive(garages.some(g => g.available != null && g.total != null))
      })
      .catch(() => { if (!aborted) setLots([]) })
      .finally(() => { if (!aborted) setLoading(false) })
    return () => { aborted = true }
  }, [])

  const greeting = hint.mode === 'invenue' ? "You're at MCO"
    : hint.mode === 'kiosk' ? 'Welcome to MCO'
    : 'Orlando International Airport'

  const isKiosk = hint.mode === 'kiosk'
  const tiles = isKiosk ? KIOSK_TILES : HOME_TILES
  const sub = isKiosk
    ? 'Ask about gates, security lines, dining, or anything else at MCO.'
    : 'Ask Ana anything about your trip — parking, terminals, security, dining, accessibility, getting here.'

  return (
    <div className="canvas-card-inner welcome-card">
      <div className="welcome-hero">
        <div className="welcome-airport-code">MCO</div>
        <div className="welcome-airport-name">{greeting}</div>
        <div className="welcome-sub">{sub}</div>
      </div>

      {isKiosk ? (
        <div className="welcome-block">
          <div className="welcome-block-head">At a glance</div>
          <div className="welcome-glance-grid">
            {KIOSK_GLANCE.map(g => (
              <div key={g.head} className="welcome-glance-item">
                <span className="welcome-glance-icon" aria-hidden>{g.icon}</span>
                <div>
                  <div className="welcome-glance-head">{g.head}</div>
                  <div className="welcome-glance-sub">{g.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="welcome-block">
          <div className="welcome-block-head">
            <span>Parking availability right now</span>
            {hasLive && <span className="welcome-live-pill">Live</span>}
          </div>
          {loading && lots.length === 0 ? (
            <div className="welcome-empty">Checking lots…</div>
          ) : !hasLive ? (
            <div className="welcome-empty">Live spot counts unavailable — ask Ana about parking options.</div>
          ) : (
            <div className="welcome-parking-grid">
              {lots.map(l => {
                const bar = fillBar(l.available, l.total)
                return (
                  <div key={l.id} className="welcome-parking-row">
                    <div className="welcome-parking-name">{l.name}</div>
                    <div className="welcome-parking-track" aria-label={l.name + ' ' + bar.label}>
                      <div className="welcome-parking-fill" style={{ width: bar.pct + '%', background: bar.color }} />
                    </div>
                    <div className="welcome-parking-label">{l.available != null ? l.available.toLocaleString() + ' open' : bar.label}</div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      <div className="welcome-block">
        <div className="welcome-block-head">{isKiosk ? 'Quick actions' : 'Common questions'}</div>
        <div className="welcome-tile-grid">
          {tiles.map(t => (
            <button
              key={t.label}
              className="welcome-tile"
              title={t.prompt}
              onClick={() => onTileClick?.(t.prompt)}
            >
              <div className="welcome-tile-icon" aria-hidden>{t.icon}</div>
              <div className="welcome-tile-label">{t.label}</div>
            </button>
          ))}
        </div>
        <div className="welcome-cue">{isKiosk ? 'Tap the keyboard or pick a question on the left.' : 'Tap a question on the left, or type your own.'}</div>
      </div>
    </div>
  )
}
