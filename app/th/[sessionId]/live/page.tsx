'use client'

// Live presenter screen for Town Hall — full-screen projection view
// No auth required — aggregate data only
// Auto-refreshes every 10s
// Phases: waiting → live → ended

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'

const HERMES = '#E8632A'
const SENT_COLOR: Record<string, string> = { positive: '#16a34a', negative: '#dc2626', mixed: '#d97706', neutral: '#6b7280', insufficient: '#9ca3af' }
const SENT_BG: Record<string, string> = { positive: '#dcfce7', negative: '#fee2e2', mixed: '#fef3c7', neutral: '#f3f4f6', insufficient: '#f9fafb' }

interface ThemeData {
  id: string; label: string; description: string | null; state: string; source: string
  sentiment: string; response_count: number; response_target: number
  mention_count: number; percentage: number
  top_keywords: { word: string; count: number }[]
  example_quote: string | null
}

interface LiveData {
  session: { id: string; name: string; slug: string; status: string; bot_name: string; bot_emoji: string; started_at: string | null; ended_at: string | null }
  stats: { participants: number; responses: number; total_turns: number; skipped: number }
  sentiment: Record<string, number>
  themes: ThemeData[]
  timeline: { time: string; count: number }[]
  trending?: { word: string; recentCount: number; baselineCount: number; ratio: number }[]
}

function Donut({ current, target, size = 56 }: { current: number; target: number; size?: number }) {
  const pct = Math.min(100, Math.round((current / Math.max(target, 1)) * 100))
  const r = (size - 6) / 2
  const circ = 2 * Math.PI * r
  const filled = (pct / 100) * circ
  const color = pct >= 100 ? '#22c55e' : pct >= 70 ? '#65a30d' : pct >= 40 ? '#d97706' : HERMES
  return (
    <div style={{ width: size, height: size, position: 'relative', flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={4} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={4}
          strokeDasharray={`${filled} ${circ - filled}`} strokeLinecap="round" style={{ transition: 'stroke-dasharray 0.6s' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: size < 50 ? 11 : 14, fontWeight: 800, color }}>{pct}%</span>
      </div>
    </div>
  )
}

export default function LivePresenter() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const [data, setData] = useState<LiveData | null>(null)
  const [error, setError] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)

  const fetchData = useCallback(async () => {
    try {
      // cache: 'no-store' + cache-busting timestamp so the polled fetch
      // never gets a stale response from any caching layer.
      const res = await fetch('/api/townhall/live/' + sessionId + '?t=' + Date.now(), { cache: 'no-store' })
      if (!res.ok) { setError(true); return }
      const d = await res.json()
      setData(d)
      setLastUpdate(new Date())
      setError(false)
    } catch { setError(true) }
  }, [sessionId])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 10000)
    return () => clearInterval(interval)
  }, [fetchData])

  if (error) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111827', color: '#9ca3af', fontFamily: 'system-ui' }}>
      <p>Session not found</p>
    </div>
  )

  if (!data) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111827', color: '#9ca3af', fontFamily: 'system-ui' }}>
      <p>Loading...</p>
    </div>
  )

  const { session: s, stats, sentiment, themes } = data
  const participantUrl = typeof window !== 'undefined' ? window.location.origin + '/th/' + (s.slug || s.id) : ''
  const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(participantUrl) + '&margin=12&color=E8632A&bgcolor=ffffff'

  const isWaiting = s.status === 'setup'
  const isEnded = s.status === 'ended'
  const isLive = s.status === 'active' || s.status === 'paused'
  const activeThemes = themes.filter(t => t.state === 'active')
  const completedThemes = themes.filter(t => t.state === 'completed')
  // Detected (organic) themes are only visible after moderator approves them (state → active)
  const totalSent = Object.values(sentiment).reduce((a, b) => a + b, 0) || 1

  // Elapsed time
  const elapsed = s.started_at ? Math.round((Date.now() - new Date(s.started_at).getTime()) / 60000) : 0
  const elapsedStr = elapsed < 60 ? elapsed + ' min' : Math.floor(elapsed / 60) + 'h ' + (elapsed % 60) + 'm'

  return (
    <div style={{ minHeight: '100vh', background: '#111827', color: '#f3f4f6', fontFamily: 'system-ui', padding: 0 }}>

      {/* ── Header bar ──────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 32px', borderBottom: '1px solid #1f2937' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 28 }}>{s.bot_emoji}</span>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: '#f9fafb' }}>{s.name}</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 2 }}>
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 20,
                background: isLive ? '#22c55e' : isEnded ? '#6b7280' : '#d97706',
                color: 'white', textTransform: 'uppercase', letterSpacing: 0.5,
              }}>
                {isLive ? 'Live' : isEnded ? 'Ended' : 'Waiting'}
              </span>
              {s.started_at && <span style={{ fontSize: 12, color: '#6b7280' }}>{elapsedStr}</span>}
            </div>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 32 }}>
          <StatBox label="Participants" value={stats.participants} />
          <StatBox label="Responses" value={stats.responses} />
          <StatBox label="Turns" value={stats.total_turns} />
        </div>

        {/* Controls + update indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ fontSize: 10, color: '#4b5563' }}>
            {lastUpdate && ('Updated ' + lastUpdate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }))}
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'inline-block', marginLeft: 6, animation: 'pulse 2s infinite' }} />
          </div>
        </div>
      </div>


      {/* ── Main content ────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 0, minHeight: 'calc(100vh - 72px)' }}>

        {/* Left: QR + join info */}
        <div style={{
          width: isLive && activeThemes.length > 0 ? 280 : 400,
          flexShrink: 0, padding: '32px 24px',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          borderRight: '1px solid #1f2937',
          transition: 'width 0.5s',
        }}>
          <img src={qrUrl} alt="QR" style={{
            width: isLive && activeThemes.length > 0 ? 180 : 260,
            height: isLive && activeThemes.length > 0 ? 180 : 260,
            borderRadius: 16, transition: 'all 0.5s',
          }} />
          <p style={{ fontSize: 13, color: '#9ca3af', marginTop: 16, textAlign: 'center' }}>Scan to join</p>
          <p style={{ fontSize: 14, fontWeight: 600, color: HERMES, marginTop: 4, wordBreak: 'break-all', textAlign: 'center' }}>
            {participantUrl.replace('https://', '').replace('http://', '')}
          </p>

          {/* Sentiment bar */}
          {stats.responses > 0 && (
            <div style={{ width: '100%', marginTop: 32 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Sentiment</p>
              <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: '#1f2937' }}>
                {(['positive', 'mixed', 'neutral', 'negative'] as const).map(s => {
                  const pct = Math.round((sentiment[s] || 0) / totalSent * 100)
                  return pct > 0 ? <div key={s} style={{ width: pct + '%', background: SENT_COLOR[s] }} /> : null
                })}
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                {(['positive', 'mixed', 'neutral', 'negative'] as const).map(s => (
                  sentiment[s] > 0 && (
                    <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: SENT_COLOR[s] }} />
                      <span style={{ fontSize: 10, color: '#9ca3af', textTransform: 'capitalize' }}>{s} {Math.round((sentiment[s] / totalSent) * 100)}%</span>
                    </div>
                  )
                ))}
              </div>
            </div>
          )}

          {/* Waiting state message */}
          {isWaiting && (
            <div style={{ marginTop: 40, textAlign: 'center' }}>
              <p style={{ fontSize: 16, color: '#6b7280' }}>Waiting for the session to start...</p>
              <p style={{ fontSize: 12, color: '#4b5563', marginTop: 8 }}>Participants can scan the QR code now.</p>
            </div>
          )}
        </div>

        {/* Right: Theme cards grid */}
        <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
          {/* Trending Now strip — surfaces words gaining traction in the last 5 min */}
          {isLive && data.trending && data.trending.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: HERMES, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                Trending Now ↑
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {data.trending.map(t => (
                  <span key={t.word} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '4px 12px', borderRadius: 20,
                    background: 'rgba(232,99,42,0.12)', border: '1px solid rgba(232,99,42,0.3)',
                    fontSize: 13, fontWeight: 600, color: '#fed7aa',
                  }}>
                    <span>{t.word}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: HERMES, opacity: 0.85 }}>↑ {t.recentCount}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {(activeThemes.length > 0 || completedThemes.length > 0) ? (
            <div>
              {/* Active themes */}
              {activeThemes.length > 0 && (
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#22c55e', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
                    Active Topics ({activeThemes.length})
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16, marginBottom: 24 }}>
                    {activeThemes.map(t => <LiveThemeCard key={t.id} theme={t} />)}
                  </div>
                </div>
              )}

              {/* Completed themes */}
              {completedThemes.length > 0 && (
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
                    Closed ({completedThemes.length})
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16, opacity: 0.7 }}>
                    {completedThemes.map(t => <LiveThemeCard key={t.id} theme={t} />)}
                  </div>
                </div>
              )}
            </div>
          ) : isLive ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#4b5563' }}>
              <p style={{ fontSize: 16 }}>Topics will appear here as themes are detected...</p>
            </div>
          ) : isEnded ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#4b5563' }}>
              <p style={{ fontSize: 18 }}>Session ended. Thank you for participating.</p>
            </div>
          ) : null}
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  )
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 28, fontWeight: 800, color: '#f9fafb', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginTop: 2 }}>{label}</div>
    </div>
  )
}

function LiveThemeCard({ theme: t }: { theme: ThemeData }) {
  const sent = t.sentiment || 'neutral'
  const isOrganic = t.source === 'auto_detected'
  // Different shades to distinguish topic origin: seed (planned) vs organic (emerged from conversation)
  const cardBg = isOrganic ? '#1e293b' : '#1f2937'
  const cardBorder = isOrganic ? '#334155' : '#374151'

  return (
    <div style={{ background: cardBg, borderRadius: 16, overflow: 'hidden', border: '1px solid ' + cardBorder }}>
      {sent !== 'insufficient' && <div style={{ height: 3, background: SENT_COLOR[sent] || SENT_COLOR.neutral }} />}
      <div style={{ padding: 16 }}>
        {/* Header: donut + label */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <Donut current={t.response_count} target={t.response_target} size={48} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#f9fafb' }}>{t.label}</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {sent !== 'insufficient' && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: SENT_BG[sent], color: SENT_COLOR[sent], textTransform: 'capitalize' }}>{sent}</span>}
                {isOrganic
                  ? <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: '#064e3b', color: '#6ee7b7' }}>Organic</span>
                  : <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: '#1e3a8a', color: '#93c5fd' }}>Seed</span>}
              </div>
            </div>
            <span style={{ fontSize: 11, color: '#6b7280' }}>
              {t.response_count} / {t.response_target} responses{t.mention_count > 0 ? ' \u00B7 ' + t.mention_count + ' mentions' : ''}
              {t.percentage > 0 ? ' \u00B7 ' + t.percentage + '% of all' : ''}
            </span>
          </div>
        </div>

        {/* Keywords */}
        {t.top_keywords.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 10 }}>
            {t.top_keywords.slice(0, 6).map(kw => (
              <span key={kw.word} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#374151', color: '#9ca3af' }}>
                {kw.word} ({kw.count})
              </span>
            ))}
          </div>
        )}

        {/* Quote */}
        {t.example_quote && (
          <div style={{ marginTop: 10, paddingLeft: 8, borderLeft: '2px solid #374151' }}>
            <p style={{ fontSize: 11, color: '#6b7280', fontStyle: 'italic', lineHeight: 1.5 }}>
              {'\u201C'}{t.example_quote.slice(0, 120)}{t.example_quote.length > 120 ? '...' : ''}{'\u201D'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
