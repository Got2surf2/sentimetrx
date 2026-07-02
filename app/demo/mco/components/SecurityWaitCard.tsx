'use client'

// Security wait times card. Fetches live data from /api/mco/security on
// mount and whenever the hint's terminal/lane filter changes. Renders three
// checkpoint cards (West/East/South → Terminal A/B/C) with per-lane waits.
// Falls back to "Live data unavailable" if the GOAA endpoint is down.

import { useEffect, useMemo, useState } from 'react'
import type { SecurityWaitHint } from '@/lib/uiHints'
import { loadCache, saveCache, maxTimestamp, relativeTime as relTime, isStale } from '../lib/liveDataCache'

const CACHE_KEY = 'mco_security_v1'

interface Checkpoint {
  id: string
  name: string
  lane: 'general' | 'precheck' | string
  isOpen: boolean
  waitSeconds: number | null
  minWaitSeconds: number | null
  maxWaitSeconds: number | null
  lastUpdatedTimestamp: number
  minGate: string | null
  maxGate: string | null
  terminal: 'A' | 'B' | 'C' | null
}
interface ApiResponse { checkpoints: Checkpoint[]; fetched_at: number }

// Color band derived from the current wait. Tuned to MCO's typical ranges:
// <10m green, 10-20m amber, 20m+ red.
function bandFor(seconds: number | null): { label: string; bg: string; fg: string } {
  if (seconds == null) return { label: '–',     bg: '#f3f4f6', fg: '#6b7280' }
  const min = Math.round(seconds / 60)
  if (min < 10) return { label: min + ' min', bg: '#d1fae5', fg: '#065f46' }
  if (min < 20) return { label: min + ' min', bg: '#fef3c7', fg: '#92400e' }
  return         { label: min + ' min', bg: '#fee2e2', fg: '#991b1b' }
}


const CHECKPOINT_DESC: Record<'A' | 'B' | 'C', { label: string; sub: string }> = {
  A: { label: 'West Checkpoint',  sub: 'Terminal A · Gates 1–59' },
  B: { label: 'East Checkpoint',  sub: 'Terminal B · Gates 70–129' },
  C: { label: 'South Checkpoint', sub: 'Terminal C · Gates C230–C249' },
}

export default function SecurityWaitCard({ hint }: { hint: SecurityWaitHint }) {
  // Empty initial state to match SSR markup. Hydrate from localStorage
  // post-mount in a separate useEffect (client only) so we avoid the
  // React hydration mismatch error.
  const [rows, setRows] = useState<Checkpoint[]>([])
  const [loading, setLoading] = useState(true)
  const [usingCache, setUsingCache] = useState(false)

  // Client-only localStorage hydration.
  useEffect(() => {
    const cached = loadCache<Checkpoint[]>(CACHE_KEY)
    if (cached?.payload && cached.payload.length > 0) {
      setRows(cached.payload)
      setUsingCache(true)
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let aborted = false
    fetch('/api/mco/security')
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then((d: ApiResponse) => {
        if (aborted) return
        if (Array.isArray(d.checkpoints) && d.checkpoints.length > 0) {
          setRows(d.checkpoints)
          saveCache(CACHE_KEY, d.checkpoints)
          setUsingCache(false)
        }
      })
      .catch(() => { /* keep whatever's on screen */ })
      .finally(() => { if (!aborted) setLoading(false) })
    return () => { aborted = true }
     
  }, [])

  // Real upstream freshness — max lastUpdatedTimestamp across rows.
  const lastUpdatedTs = useMemo(
    () => maxTimestamp(rows.map(r => r.lastUpdatedTimestamp)),
    [rows],
  )
  const stale = isStale(lastUpdatedTs)

  // Group by terminal, then split lanes within each terminal.
  const grouped = useMemo(() => {
    const out: Record<'A' | 'B' | 'C', { general?: Checkpoint; precheck?: Checkpoint }> = {
      A: {}, B: {}, C: {},
    }
    for (const r of rows) {
      if (!r.terminal) continue
      const key = r.lane === 'precheck' ? 'precheck' : 'general'
      out[r.terminal][key] = r
    }
    return out
  }, [rows])

  // If the hint scopes to a terminal, only show that one. Otherwise show all 3.
  const terminals: Array<'A' | 'B' | 'C'> = hint.terminal ? [hint.terminal] : ['A', 'B', 'C']

  return (
    <div className="canvas-card-inner">
      <div className="canvas-header">
        <h2>Security Wait Times</h2>
        <span className={'subtitle' + (stale ? ' subtitle-stale' : '')}>
          {loading && rows.length === 0 ? 'Loading…' :
            lastUpdatedTs ? (usingCache && stale ? 'Last known wait · ' + relTime(lastUpdatedTs) : 'Updated ' + relTime(lastUpdatedTs)) :
            'Live data unavailable'}
        </span>
        <span className="badge">Live</span>
      </div>

      {loading && rows.length === 0 ? (
        <div style={{ padding: '24px 4px', color: '#6b7280', fontSize: 14 }}>Checking wait times…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '24px 4px', color: '#6b7280', fontSize: 14 }}>Live wait times unavailable right now — usually returns within a minute.</div>
      ) : (
        <div className="sec-list">
          {terminals.map((t) => {
            const desc = CHECKPOINT_DESC[t]
            const g = grouped[t]
            return (
              <div key={t} className="sec-block">
                <div className="sec-head">
                  <div className="sec-name">{desc.label}</div>
                  <div className="sec-sub">{desc.sub}</div>
                </div>
                <div className="sec-lanes">
                  <LaneRow lane="general" label="Standard" cp={g.general} emphasize={hint.lane === 'general'} />
                  <LaneRow lane="precheck" label="PreCheck"  cp={g.precheck} emphasize={hint.lane === 'precheck'} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="resto-footer">
        Live waits powered by Orlando International Airport · refreshes every minute
      </div>
    </div>
  )
}

function LaneRow({ lane, label, cp, emphasize }: { lane: string; label: string; cp: Checkpoint | undefined; emphasize: boolean }) {
  const band = bandFor(cp?.waitSeconds ?? null)
  const closed = cp && !cp.isOpen
  return (
    <div className={'sec-lane' + (emphasize ? ' sec-lane-emp' : '')}>
      <div className="sec-lane-label">{label}</div>
      {closed ? (
        <div className="sec-pill sec-pill-closed">Closed</div>
      ) : (
        <div className="sec-pill" style={{ background: band.bg, color: band.fg }}>{band.label}</div>
      )}
    </div>
  )
}
