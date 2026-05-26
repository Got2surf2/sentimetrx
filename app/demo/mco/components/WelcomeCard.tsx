'use client'

// Default landing card for the right pane of /demo/mco. Shows MCO branding,
// a live parking snapshot pulled from /api/mco/parking, and four quick-
// access tiles representing the most-asked topics. Replaces the previous
// default of showing a C→A/B map before the user has asked anything.

import { useEffect, useMemo, useState } from 'react'
import type { WelcomeHint } from '@/lib/uiHints'
import { loadCache, saveCache, maxTimestamp, relativeTime as relTime, isStale } from '../lib/liveDataCache'

const CACHE_KEY = 'mco_welcome_parking_v1'

interface ApiLot {
  id: string
  name: string
  available: number | null
  total: number | null
  status: 'open' | 'closed' | string
  lastUpdatedTimestamp?: number      // unix sec — GOAA's last refresh of this lot
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
// Each item has a prompt so it's clickable and sends a chat message.
const KIOSK_GLANCE = [
  { icon: '🛜', head: 'Free Wi-Fi', sub: 'Available throughout all terminals', prompt: 'How do I connect to Wi-Fi at MCO?' },
  { icon: '🚆', head: 'Terminal link', sub: 'APM train · Terminals A/B ↔ C', prompt: 'How do I take the train between terminals?' },
  { icon: '⚡', head: 'MCO Reserve', sub: 'Book a security slot · skip the line', prompt: 'What is MCO Reserve?' },
  { icon: '🔌', head: 'Power & charging', sub: 'Outlets & USB ports throughout terminals', prompt: 'Where can I charge my phone at MCO?' },
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

// When GOAA returns status only (no numeric counts) — current production
// state — surface the open/full/closed status as a colored pill instead
// of an empty bar. Garage C being "full" right now is genuinely useful
// info, just not numeric.
function statusBadge(status: string): { label: string; bg: string; fg: string } {
  switch ((status || '').toLowerCase()) {
    case 'full':   return { label: 'Full',   bg: '#fee2e2', fg: '#991b1b' }
    case 'closed': return { label: 'Closed', bg: '#f3f4f6', fg: '#6b7280' }
    case 'open':   return { label: 'Open',   bg: '#d1fae5', fg: '#065f46' }
    default:       return { label: status || '–', bg: '#f3f4f6', fg: '#6b7280' }
  }
}

export default function WelcomeCard({ hint, onTileClick }: { hint: WelcomeHint; onTileClick?: (prompt: string) => void }) {
  // Seed parking strip from localStorage so the kiosk reopen / remount
  // doesn't flash empty before the fetch returns.
  const seed = loadCache<ApiLot[]>(CACHE_KEY)
  const [lots, setLots] = useState<ApiLot[]>(seed?.payload || [])
  const [loading, setLoading] = useState(!seed)
  const [usingCache, setUsingCache] = useState(!!seed)
  const hasLive = useMemo(() => lots.some(g => g.available != null && g.total != null), [lots])

  useEffect(() => {
    let aborted = false
    if (!seed) setLoading(true)
    fetch('/api/mco/parking', { method: 'GET' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then((data: ApiResponse) => {
        if (aborted) return
        const garages = (data.lots || []).filter(l => /Garage [ABC]/i.test(l.name)).sort((a, b) => a.name.localeCompare(b.name))
        if (garages.length > 0) {
          setLots(garages)
          saveCache(CACHE_KEY, garages)
          setUsingCache(false)
        }
        // Empty response → keep cached lots (don't blank)
      })
      .catch(() => { /* keep cached */ })
      .finally(() => { if (!aborted) setLoading(false) })
    return () => { aborted = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // True upstream freshness via per-lot GOAA timestamps.
  const lastUpdatedTs = useMemo(
    () => maxTimestamp(lots.map(l => l.lastUpdatedTimestamp ?? 0)),
    [lots],
  )
  const stale = isStale(lastUpdatedTs)

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
              <button
                key={g.head}
                className="welcome-glance-item"
                title={g.prompt}
                onClick={() => onTileClick?.(g.prompt)}
              >
                <span className="welcome-glance-icon" aria-hidden>{g.icon}</span>
                <div>
                  <div className="welcome-glance-head">{g.head}</div>
                  <div className="welcome-glance-sub">{g.sub}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="welcome-block">
          <div className="welcome-block-head">
            <span>Parking availability right now</span>
            {hasLive && !stale && <span className="welcome-live-pill">Live</span>}
            {lastUpdatedTs > 0 && (
              <span className={'welcome-updated' + (stale && usingCache ? ' welcome-updated-stale' : '')}>
                {stale && usingCache ? 'Last known · ' : 'Updated '}{relTime(lastUpdatedTs)}
              </span>
            )}
          </div>
          {loading && lots.length === 0 ? (
            <div className="welcome-empty">Checking lots…</div>
          ) : lots.length === 0 ? (
            <div className="welcome-empty">Live data unavailable — ask Ana about parking options.</div>
          ) : hasLive ? (
            // Numeric counts available → render fill bars
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
          ) : (
            // Status-only path (current GOAA state): just show open/full/closed pills.
            <div className="welcome-parking-grid">
              {lots.map(l => {
                const s = statusBadge(l.status)
                return (
                  <div key={l.id} className="welcome-parking-row welcome-parking-row-status">
                    <div className="welcome-parking-name">{l.name}</div>
                    <div className="welcome-parking-status-pill" style={{ background: s.bg, color: s.fg }}>{s.label}</div>
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
