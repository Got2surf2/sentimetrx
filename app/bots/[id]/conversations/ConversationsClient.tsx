'use client'

// app/bots/[id]/conversations/page.tsx
// Conversation cards with filters, modal viewer, time-range reports, delete

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import DOMPurify from 'isomorphic-dompurify'
import DownloadButton from '@/components/ui/DownloadButton'
import { getFlagStyle, isFixedFlag } from '@/lib/flagStyles'

var HERMES = '#E8632A'
var IMSG_BLUE = '#007AFF'
var IMSG_GRAY = '#E9E9EB'

var TIME_RANGES = [
  { label: 'Yesterday', hours: 24 },
  { label: 'Last 7 days', hours: 168 },
  { label: 'Last 30 days', hours: 720 },
  { label: 'All time', hours: 0 },
]

interface Session {
  session_id: string; first_message: string; turn_count: number
  started_at: string; last_at: string; user_name: string
  flags: string[]; has_deflection: boolean; persona: any | null
  review_status: string; review_reasons: string[]
}

interface Turn {
  id: string; turn_number: number; role: 'user' | 'assistant'
  content: string; content_en: string | null; language: string
  created_at: string; content_flags: string[] | null; source: string | null
  sentiment?: 'positive' | 'neutral' | 'negative' | null
  sentiment_score?: number | null
}

interface BotConfig {
  name?: string; subtitle?: string; avatarLetter?: string
  headerGradient?: string; avatarGradient?: string; avatarTextColor?: string
  userBubbleBg?: string; accentColor?: string
}

export default function ConversationsClient({ isSuperadmin = false }: { isSuperadmin?: boolean }) {
  var params = useParams()
  var router = useRouter()
  var botId = params.id as string
  var chatEndRef = useRef<HTMLDivElement>(null)

  var [sessions, setSessions] = useState<Session[]>([])
  var [loading, setLoading] = useState(true)
  var [selectedSession, setSelectedSession] = useState<string | null>(null)
  var [turns, setTurns] = useState<Turn[]>([])
  var [turnsLoading, setTurnsLoading] = useState(false)
  var [botName, setBotName] = useState('')
  var [botConfig, setBotConfig] = useState<BotConfig>({})
  var [reviews, setReviews] = useState<{ id: string; reviewed_at: string; session_count: number; turn_count: number; report: string; theme_drift: boolean }[]>([])
  var [shareState, setShareState] = useState<'idle' | 'sharing' | 'copied'>('idle')
  var [shareIncludeLabels, setShareIncludeLabels] = useState(false)

  // Filters
  var [filterFlag, setFilterFlag] = useState<string>('all')
  var [filterTime, setFilterTime] = useState<number>(0) // hours, 0 = all
  var [filterSearch, setFilterSearch] = useState('')
  var [showExcluded, setShowExcluded] = useState(false) // collapse the excluded/low-signal group by default

  useEffect(function() {
    fetch('/api/bots/' + botId).then(function(r) { return r.json() }).then(function(d) {
      if (d.name) setBotName(d.name)
      if (d.config) setBotConfig(d.config)
    }).catch(function() {})

    fetch('/api/bots/' + botId + '/conversations')
      .then(function(r) { return r.json() })
      .then(function(d) { setSessions(d.sessions || []) })
      .catch(function() {})
      .finally(function() { setLoading(false) })

    fetch('/api/bots/' + botId + '/conversations/reviews')
      .then(function(r) { return r.json() })
      .then(function(d) { setReviews(d.reviews || []) })
      .catch(function() {})
  }, [botId])

  useEffect(function() {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' })
  }, [turns])

  // Filtered sessions
  var filtered = sessions.filter(function(s) {
    // Time filter
    if (filterTime > 0) {
      var cutoff = Date.now() - filterTime * 3600000
      if (new Date(s.started_at).getTime() < cutoff) return false
    }
    // Review filter — conversations auto-flagged (troll/bot/off-topic) awaiting a human decision
    if (filterFlag === 'needs_review') return s.review_status === 'auto_flagged'
    // Flag filter
    if (filterFlag === 'flagged' && s.flags.length === 0 && !s.has_deflection) return false
    if (filterFlag === 'clean' && (s.flags.length > 0 || s.has_deflection)) return false
    if (filterFlag !== 'all' && filterFlag !== 'flagged' && filterFlag !== 'clean' && !s.flags.includes(filterFlag)) return false
    // Search
    if (filterSearch.trim()) {
      var q = filterSearch.toLowerCase()
      if (!(s.user_name || '').toLowerCase().includes(q) && !(s.first_message || '').toLowerCase().includes(q)) return false
    }
    return true
  })
  // Sink ignored conversations (auto-flagged troll/bot/off-topic + reviewer-
  // excluded) to the bottom — they're kept reachable for the review workflow but
  // shouldn't crowd the real conversations at the top. Stable sort preserves the
  // server's recency order within each group.
  var isIgnored = function(s: Session) { return s.review_status === 'auto_flagged' || s.review_status === 'excluded' }
  // "Set aside" = excluded/flagged conversations PLUS low-signal drive-bys
  // (<=2 turns: a chip tap or one-liner that never became a real exchange).
  // These collapse into a toggleable box so the main grid shows only the
  // conversations worth reading. Only split on the default "All" view — when a
  // specific flag filter is active, show exactly what was asked for.
  var isSetAside = function(s: Session) { return isIgnored(s) || s.turn_count <= 2 }
  var splitView = filterFlag === 'all'
  var includedList = splitView ? filtered.filter(function(s) { return !isSetAside(s) }) : filtered
  var setAsideList = splitView ? filtered.filter(isSetAside) : []

  async function loadSession(sid: string) {
    setSelectedSession(sid)
    setTurnsLoading(true)
    setShareState('idle')
    try {
      var r = await fetch('/api/bots/' + botId + '/conversations/' + encodeURIComponent(sid))
      var d = await r.json()
      setTurns(d.turns || [])
    } catch { setTurns([]) }
    setTurnsLoading(false)
  }

  async function deleteSession(sid: string) {
    if (!confirm('Delete this conversation? This cannot be undone.')) return
    try {
      await fetch('/api/bots/' + botId + '/conversations/' + encodeURIComponent(sid), { method: 'DELETE' })
      setSessions(function(prev) { return prev.filter(function(s) { return s.session_id !== sid }) })
      if (selectedSession === sid) { setSelectedSession(null); setTurns([]) }
    } catch { alert('Failed to delete') }
  }

  // Human review decision — approve (include in reports), exclude (never), or
  // reset (back to clean / live auto-flag). The conversation is never deleted;
  // only its visibility to reports changes.
  async function reviewSession(sid: string, action: 'approve' | 'exclude' | 'reset') {
    var next = action === 'approve' ? 'approved' : action === 'exclude' ? 'excluded' : 'clean'
    try {
      var s = sessions.find(function(x) { return x.session_id === sid })
      await fetch('/api/bots/' + botId + '/conversations/' + encodeURIComponent(sid) + '/review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action, reasons: s ? s.review_reasons : [] }),
      })
      setSessions(function(prev) { return prev.map(function(x) { return x.session_id === sid ? { ...x, review_status: next } : x }) })
    } catch { alert('Failed to update review') }
  }

  async function refreshSession() {
    if (!selectedSession) return
    setTurnsLoading(true)
    try {
      var r = await fetch('/api/bots/' + botId + '/conversations/' + encodeURIComponent(selectedSession))
      var d = await r.json()
      setTurns(d.turns || [])
    } catch {}
    setTurnsLoading(false)
  }

  async function shareConversation() {
    if (shareState === 'sharing' || !selectedSession) return
    setShareState('sharing')
    try {
      // Re-fetch turns before generating the share snapshot so we never
      // share a stale UI cache. The detail panel doesn't auto-refresh
      // when new turns land server-side (the conversation continues in
      // the widget, the admin viewer holds the original snapshot).
      var freshR = await fetch('/api/bots/' + botId + '/conversations/' + encodeURIComponent(selectedSession))
      var freshD = await freshR.json()
      var freshTurns: Turn[] = Array.isArray(freshD?.turns) ? freshD.turns : []
      setTurns(freshTurns)
      if (freshTurns.length === 0) { setShareState('idle'); return }
      // Carry user_name + persona into both share variants so the
      // snapshot shows WHO the participant was, not just the message
      // log. Mirrors what the local conversation modal already shows
      // in its header + persona bar.
      var sessUserName = selectedSessionData?.user_name || ''
      var sessPersona = (selectedSessionData?.persona || null) as any
      var html = buildConversationHtml(botName, botConfig, freshTurns, { userName: sessUserName, persona: sessPersona })
      var html_labeled: string | undefined
      if (isSuperadmin && shareIncludeLabels) {
        html_labeled = buildConversationHtml(botName, botConfig, freshTurns, { labeled: true, userName: sessUserName, persona: sessPersona })
      }
      var r = await fetch('/api/share', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'conversation', target_id: botId, html: html, html_labeled: html_labeled, expires_in: '30d' }) })
      var d = await r.json()
      if (d.url) { await navigator.clipboard.writeText(d.url); setShareState('copied'); setTimeout(function() { setShareState('idle') }, 3000) }
      else setShareState('idle')
    } catch { setShareState('idle') }
  }

  var fmtDate = function(iso: string) {
    var d = new Date(iso)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }

  var avatar = botConfig.avatarLetter || (botName ? botName.charAt(0).toUpperCase() : 'A')
  var headerGrad = botConfig.headerGradient || 'linear-gradient(135deg, #0a1628, #1a2d4a)'
  var avatarGrad = botConfig.avatarGradient || 'linear-gradient(135deg, #00b4d8, #0077a8)'
  var selectedSessionData = sessions.find(function(s) { return s.session_id === selectedSession })

  // Unique flags across all sessions for filter dropdown
  var allFlags: string[] = []
  sessions.forEach(function(s) { s.flags.forEach(function(f) { if (!allFlags.includes(f)) allFlags.push(f) }) })

  var pill = function(active: boolean, color?: string) {
    return {
      padding: '4px 12px', borderRadius: 16, fontSize: 11, fontWeight: 600 as const, cursor: 'pointer' as const, border: 'none',
      background: active ? (color || HERMES) : '#F3F4F6',
      color: active ? 'white' : '#6b7280',
      transition: 'all 0.15s',
    }
  }

  var renderCard = function(s: Session) {
    var persona = s.persona
    var personaLabel = ''
    if (persona) {
      var parts: string[] = []
      if (persona.life_stage?.value) parts.push(persona.life_stage.value)
      if (persona.occupation?.value) parts.push(persona.occupation.value)
      if (persona.location_type?.value) parts.push(persona.location_type.value)
      personaLabel = parts.join(' · ')
    }
    return (
      <div key={s.session_id} style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', transition: 'all 0.15s', opacity: isIgnored(s) ? 0.55 : 1 }}>
        {/* Card header — clickable */}
        <button onClick={function() { loadSession(s.session_id) }}
          style={{ display: 'block', width: '100%', padding: '14px 16px 10px', cursor: 'pointer', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid #f3f4f6' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: s.user_name ? '#E0F2FE' : '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: s.user_name ? '#0369A1' : '#9CA3AF' }}>
                {s.user_name ? s.user_name.charAt(0).toUpperCase() : '?'}
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{s.user_name || 'Anonymous'}</span>
            </div>
            <span style={{ fontSize: 11, color: '#9ca3af' }}>{fmtDate(s.started_at)}</span>
          </div>
          <p style={{ fontSize: 12, color: '#6b7280', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {s.first_message || '(no message)'}
          </p>
        </button>
        {/* Card footer — metadata + delete */}
        <div style={{ padding: '8px 16px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flex: 1 }}>
            <span style={{ fontSize: 11, color: '#9ca3af' }}>{s.turn_count} turns</span>
            {personaLabel && <span style={{ fontSize: 10, color: '#0F7173', background: '#E0F7F7', padding: '1px 6px', borderRadius: 8 }}>{personaLabel}</span>}
            {s.has_deflection && <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 8, background: '#EDE9FE', color: '#7c3aed' }}>Redirected</span>}
            {s.review_status === 'auto_flagged' && <span title={'Auto-flagged: ' + (s.review_reasons || []).join(', ') + ' — excluded from reports until reviewed'} style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 8, background: '#FEF3C7', color: '#B45309' }}>⚑ Review{s.review_reasons && s.review_reasons.length ? ': ' + s.review_reasons.join(', ') : ''}</span>}
            {s.review_status === 'excluded' && <span title="Excluded from reports by a reviewer" style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 8, background: '#F3F4F6', color: '#6b7280' }}>Excluded</span>}
            {s.review_status === 'approved' && <span title="Approved for reports by a reviewer" style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 8, background: '#D1FAE5', color: '#059669' }}>✓ Approved</span>}
            {s.flags.map(function(f) {
              var c = getFlagStyle(f)
              return <span key={f} style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 8, background: c.bg, color: c.color }}>{c.label}</span>
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            {s.review_status === 'auto_flagged' && (
              <>
                <button onClick={function() { reviewSession(s.session_id, 'approve') }} title="Include this conversation in reports"
                  style={{ background: '#D1FAE5', border: 'none', color: '#059669', cursor: 'pointer', fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 10 }}>Approve</button>
                <button onClick={function() { reviewSession(s.session_id, 'exclude') }} title="Confirm junk — keep out of reports"
                  style={{ background: '#FEE2E2', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 10 }}>Exclude</button>
              </>
            )}
            {s.review_status === 'clean' && (
              <button onClick={function() { reviewSession(s.session_id, 'exclude') }} title="Exclude this conversation from reports"
                style={{ background: 'none', border: '1px solid #e5e7eb', color: '#9ca3af', cursor: 'pointer', fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 10 }}>Exclude</button>
            )}
            {(s.review_status === 'excluded' || s.review_status === 'approved') && (
              <button onClick={function() { reviewSession(s.session_id, 'reset') }} title="Undo the review decision"
                style={{ background: 'none', border: '1px solid #e5e7eb', color: '#9ca3af', cursor: 'pointer', fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 10 }}>Reset</button>
            )}
            <button onClick={function() { deleteSession(s.session_id) }}
              style={{ background: 'none', border: 'none', color: '#d1d5db', cursor: 'pointer', fontSize: 14, padding: '2px 4px' }}
              title="Delete conversation">&times;</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={function() { router.push('/bots') }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#6b7280' }}>&larr; Agents</button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>{botName || 'Agent'} — Conversations</h1>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>{sessions.length} total · {filtered.length} shown</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={function() { router.push('/bots/' + botId + '/intents') }}
            style={{ padding: '8px 16px', borderRadius: 20, border: '1px solid #d1d5db', background: 'white', color: '#374151', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Intents
          </button>
          <button onClick={function() { router.push('/bots/' + botId + '/knowledge') }}
            style={{ padding: '8px 16px', borderRadius: 20, border: '1px solid #d1d5db', background: 'white', color: '#374151', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Knowledge
          </button>
          <DownloadButton
            label="Download"
            disabled={sessions.length === 0}
            hrefFor={fmt => '/api/bots/' + botId + '/conversations/export?format=' + fmt}
            className="px-4 py-2 rounded-full border border-gray-300 bg-white text-gray-700 text-xs font-semibold disabled:opacity-50"
          />
          <DownloadButton
            label="Q&A pairs"
            disabled={sessions.length === 0}
            hrefFor={fmt => '/api/bots/' + botId + '/conversations/export?shape=pairs&format=' + fmt}
            className="px-4 py-2 rounded-full border border-gray-300 bg-white text-gray-700 text-xs font-semibold disabled:opacity-50"
          />
          {/* Combined client workbook: Summary + Q&A pairs + Unanswered + Transcript
              in one .xlsx (multi-sheet → no CSV variant). */}
          <button onClick={function() { window.location.href = '/api/bots/' + botId + '/workbook?format=xlsx' }}
            disabled={sessions.length === 0}
            title="One Excel file with four tabs: Summary, Q&A Pairs, Low-Confidence Answers, and the Full Transcript"
            className="px-4 py-2 rounded-full border border-gray-300 bg-white text-gray-700 text-xs font-semibold disabled:opacity-50">
            Excel workbook
          </button>
          <button onClick={function() { router.push('/bots/' + botId + '/report') }}
            style={{ padding: '8px 16px', borderRadius: 20, border: 'none', background: '#0F7173', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Report
          </button>
        </div>
      </div>

      {/* Scheduled reviews */}
      {reviews.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 8 }}>Scheduled Reviews</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {reviews.map(function(r) {
              return (
                <details key={r.id} style={{ background: r.theme_drift ? '#fef2f2' : 'white', border: '1px solid ' + (r.theme_drift ? '#fecaca' : '#e5e7eb'), borderRadius: 10, overflow: 'hidden' }}>
                  <summary style={{ padding: '8px 14px', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 600, color: '#111827' }}>{fmtDate(r.reviewed_at)}</span>
                    <span style={{ color: '#9ca3af' }}>{r.session_count} sessions, {r.turn_count} turns</span>
                    {r.theme_drift && <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 8, background: '#fee2e2', color: '#dc2626' }}>Drift</span>}
                  </summary>
                  <div style={{ padding: '0 14px 10px', fontSize: 11, color: '#374151', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{r.report}</div>
                </details>
              )
            })}
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input type="text" value={filterSearch} onChange={function(e) { setFilterSearch(e.target.value) }}
          placeholder="Search by name or message..."
          style={{ padding: '6px 12px', borderRadius: 20, border: '1px solid #d1d5db', fontSize: 12, width: 200, outline: 'none' }} />
        <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 4 }}>Time:</span>
        {TIME_RANGES.map(function(tr) {
          return <button key={tr.hours} onClick={function() { setFilterTime(tr.hours) }} style={pill(filterTime === tr.hours, '#0F7173')}>{tr.label}</button>
        })}
        <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 4 }}>Flags:</span>
        <button onClick={function() { setFilterFlag('all') }} style={pill(filterFlag === 'all', '#6b7280')}>All</button>
        <button onClick={function() { setFilterFlag('flagged') }} style={pill(filterFlag === 'flagged', '#dc2626')}>Flagged</button>
        <button onClick={function() { setFilterFlag('clean') }} style={pill(filterFlag === 'clean', '#059669')}>Clean</button>
        {(function() {
          var n = sessions.filter(function(s) { return s.review_status === 'auto_flagged' }).length
          if (n === 0) return null
          return <button onClick={function() { setFilterFlag('needs_review') }} style={pill(filterFlag === 'needs_review', '#d97706')}>Needs review ({n})</button>
        })()}
        {allFlags.filter(isFixedFlag).map(function(f) {
          var fc = getFlagStyle(f)
          return <button key={f} onClick={function() { setFilterFlag(f) }} style={pill(filterFlag === f, fc.color)}>{fc.label}</button>
        })}
      </div>

      {/* Conversation cards grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>Loading...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 64, background: 'white', borderRadius: 16, border: '2px dashed #e5e7eb' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>💬</div>
          <p style={{ fontSize: 16, fontWeight: 600, color: '#374151' }}>{sessions.length === 0 ? 'No conversations yet' : 'No conversations match filters'}</p>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 8 }}>{sessions.length === 0 ? 'Conversations will appear here once users start chatting.' : 'Try adjusting your filters.'}</p>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
            {includedList.map(renderCard)}
          </div>
          {includedList.length === 0 && setAsideList.length > 0 && (
            <div style={{ textAlign: 'center', padding: 24, color: '#9ca3af', fontSize: 13 }}>No primary conversations — everything here is excluded or low-signal (toggle below).</div>
          )}
          {setAsideList.length > 0 && (
            <div style={{ marginTop: 28 }}>
              <button onClick={function() { setShowExcluded(!showExcluded) }}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, background: '#F9FAFB', border: '1px dashed #d1d5db', borderRadius: 12, padding: '10px 14px', cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ fontSize: 12, color: '#6b7280', display: 'inline-block', transform: showExcluded ? 'rotate(90deg)' : 'none' }}>&#9654;</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>Excluded &amp; low-signal ({setAsideList.length})</span>
                <span style={{ fontSize: 11, color: '#9ca3af' }}>{setAsideList.filter(function(s) { return !isIgnored(s) }).length} low-signal (&le;2 turns) &middot; {setAsideList.filter(isIgnored).length} flagged/excluded &middot; not counted in reports</span>
              </button>
              {showExcluded && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12, marginTop: 12 }}>
                  {setAsideList.map(renderCard)}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ═══ CONVERSATION MODAL ═══ */}
      {selectedSession && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={function() { setSelectedSession(null); setTurns([]) }}
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }} />
          <div style={{ position: 'relative', width: '100%', maxWidth: 560, maxHeight: '85vh', borderRadius: 20, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 48px rgba(0,0,0,0.2)' }}>
            {/* Header */}
            <div style={{ background: headerGrad, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: avatarGrad, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: botConfig.avatarTextColor || 'white' }}>{avatar}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'white' }}>{botName || 'Agent'}</div>
                {botConfig.subtitle && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>{botConfig.subtitle}</div>}
                {selectedSessionData?.user_name && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>with {selectedSessionData.user_name}</div>}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>{turns.length}</span>
                <button onClick={refreshSession} disabled={turnsLoading || !selectedSession}
                  title="Re-fetch this conversation from the database — new turns added in the live widget won't appear until you refresh"
                  style={{ padding: '5px 10px', borderRadius: 14, border: '1px solid rgba(255,255,255,0.3)', background: 'transparent', color: 'white', fontSize: 11, fontWeight: 600, cursor: turnsLoading ? 'wait' : 'pointer', opacity: turnsLoading ? 0.5 : 1 }}>
                  {turnsLoading ? '…' : '↻'}
                </button>
                {isSuperadmin && (
                  <label title="Bakes a second 'Labeled' variant into the share showing sentiment, intent, and action triggered per turn. Visible to prospects who toggle Labeled on the share page. Datanautix-internal only — leave OFF for shares to voters."
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'rgba(255,255,255,0.85)', fontSize: 10, fontWeight: 500, cursor: 'pointer', userSelect: 'none' }}>
                    <input type="checkbox" checked={shareIncludeLabels}
                      onChange={function(e) { setShareIncludeLabels(e.target.checked) }}
                      style={{ width: 12, height: 12, cursor: 'pointer', accentColor: '#e8622a' }} />
                    AI labels
                  </label>
                )}
                <button onClick={shareConversation} disabled={shareState === 'sharing' || !selectedSession}
                  title="Share — re-fetches the latest turns before generating the snapshot so the share link is always current"
                  style={{ padding: '5px 12px', borderRadius: 14, border: '1px solid rgba(255,255,255,0.3)', background: shareState === 'copied' ? 'rgba(255,255,255,0.2)' : 'transparent', color: 'white', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                  {shareState === 'sharing' ? 'Sharing…' : shareState === 'copied' ? 'Copied!' : 'Share'}
                </button>
                <button onClick={function() { if (selectedSession) deleteSession(selectedSession) }}
                  style={{ padding: '5px 12px', borderRadius: 14, border: '1px solid rgba(255,100,100,0.4)', background: 'transparent', color: '#fca5a5', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                  Delete
                </button>
                <button onClick={function() { setSelectedSession(null); setTurns([]) }}
                  style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white', width: 28, height: 28, borderRadius: '50%', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>&times;</button>
              </div>
            </div>

            {/* Persona bar */}
            {selectedSessionData?.persona && (function() {
              var p = selectedSessionData.persona
              var profileBits: string[] = []
              if (p.life_stage?.value) profileBits.push(p.life_stage.value)
              if (p.occupation?.value) profileBits.push(p.occupation.value)
              if (p.industry?.value) profileBits.push(p.industry.value)
              if (p.location_type?.value) profileBits.push(p.location_type.value)
              if (p.communication_style?.value) profileBits.push(p.communication_style.value + ' tone')
              var concerns = p.concerns?.values?.length ? p.concerns.values.join(', ') : ''
              if (profileBits.length === 0 && !concerns) return null
              return <div style={{ background: '#F0FDFA', borderBottom: '1px solid #CCFBF1', padding: '8px 20px', fontSize: 11, color: '#0F766E', flexShrink: 0 }}>
                {profileBits.length > 0 && <div><span style={{ fontWeight: 600 }}>Profile:</span> {profileBits.join(' · ')}</div>}
                {concerns && <div style={{ marginTop: profileBits.length > 0 ? 2 : 0 }}><span style={{ fontWeight: 600 }}>Concerns:</span> {concerns}</div>}
              </div>
            })()}

            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 8px', display: 'flex', flexDirection: 'column', gap: 8, background: '#FFF' }}>
              {turnsLoading ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>Loading...</div>
              ) : turns.map(function(t) {
                var isUser = t.role === 'user'
                var isDeflect = t.source === 'deflect'
                var isGreeting = t.source === 'greeting'
                var flags = t.content_flags || []
                return (
                  <div key={t.id} style={{ width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, justifyContent: isUser ? 'flex-end' : 'flex-start', width: '100%' }}>
                      {!isUser && <div style={{ width: 28, height: 28, borderRadius: '50%', background: avatarGrad, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: botConfig.avatarTextColor || 'white' }}>{avatar}</div>}
                      <div style={{
                        maxWidth: '75%', padding: '10px 14px',
                        borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                        background: isUser ? (botConfig.userBubbleBg || IMSG_BLUE) : IMSG_GRAY,
                        color: isUser ? 'white' : '#000',
                        fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap',
                        border: isDeflect ? '1.5px solid #c4b5fd' : 'none',
                        opacity: isGreeting ? 0.8 : 1,
                      }}>
                        <span dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(linkify(t.content)) }} />
                        <div style={{ fontSize: 10, marginTop: 4, opacity: 0.5 }}>
                          {new Date(t.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                          {t.language !== 'en' ? ' \u00b7 ' + t.language : ''}
                          {isDeflect ? ' \u00b7 redirected' : ''}
                        </div>
                      </div>
                    </div>
                    {flags.length > 0 && (
                      <div style={{ display: 'flex', gap: 3, marginTop: 3, justifyContent: isUser ? 'flex-end' : 'flex-start', paddingLeft: isUser ? 0 : 36 }}>
                        {flags.map(function(f) {
                          var c = getFlagStyle(f)
                          return <span key={f} style={{ fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 8, background: c.bg, color: c.color }}>{c.label}</span>
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
              <div ref={chatEndRef} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Share HTML builder ────────────────────────────────────────────────
// Builds the conversation snapshot HTML that gets baked into shared_links.metadata.
// When opts.labeled is true, each user-turn shows sentiment + matched intent +
// topic:<slug> pills under the bubble, each assistant-turn shows the action
// triggered + focus:<slug> pills, and timestamps switch to full date + time.
// userName + persona, when provided, render in BOTH plain and labeled —
// those answer "WHO is this participant" not "what AI internals fired,"
// so they're appropriate even for the non-labeled share that goes to
// stakeholders.
function buildConversationHtml(
  name: string,
  config: BotConfig,
  turns: Turn[],
  opts?: { labeled?: boolean; userName?: string; persona?: any },
): string {
  var labeled = !!opts?.labeled
  var userName = (opts?.userName || '').trim()
  var persona = opts?.persona || null
  var av = config.avatarLetter || (name ? name.charAt(0).toUpperCase() : 'A')
  var hG = config.headerGradient || 'linear-gradient(135deg, #0a1628, #1a2d4a)'
  var aG = config.avatarGradient || 'linear-gradient(135deg, #00b4d8, #0077a8)'
  var uB = config.userBubbleBg || '#007AFF'

  function fmtTime(iso: string) {
    var d = new Date(iso)
    if (labeled) {
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    }
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }

  // Pill renderer for focus:<slug> / topic:<slug> / intent:<LABEL> flags.
  // Inlined (not imported from lib/flagStyles) so the HTML string can be
  // built without DOM React. Same color palette.
  function pillsHtml(flags: any[] | null | undefined, kinds: string[]): string {
    if (!Array.isArray(flags)) return ''
    var matched = flags.filter(function(f) { return typeof f === 'string' && kinds.some(function(k) { return f.indexOf(k + ':') === 0 }) }) as string[]
    if (matched.length === 0) return ''
    return matched.map(function(f) {
      var bg = '#F3F4F6', color = '#6b7280', label = f
      if (f.indexOf('focus:') === 0) { bg = '#ECFEFF'; color = '#0E7B7B'; label = f.slice(6).replace(/[-_]/g, ' ') }
      else if (f.indexOf('topic:') === 0) { bg = '#FEF3C7'; color = '#B45309'; label = f.slice(6).replace(/[-_]/g, ' ') }
      else if (f.indexOf('intent:') === 0) { bg = '#DBEAFE'; color = '#1D4ED8'; label = f.slice(7).replace(/_/g, ' ') }
      return '<span style="display:inline-block;font-size:9px;font-weight:600;padding:1px 6px;border-radius:8px;background:' + bg + ';color:' + color + ';margin-right:3px">' + esc(label) + '</span>'
    }).join('')
  }

  function annotation(t: Turn): string {
    if (!labeled) return ''
    var parts: string[] = []
    if (t.role === 'user') {
      if (t.sentiment) {
        var score = typeof t.sentiment_score === 'number' ? ' (' + (t.sentiment_score >= 0 ? '+' : '') + t.sentiment_score.toFixed(2) + ')' : ''
        var color = t.sentiment === 'positive' ? '#059669' : t.sentiment === 'negative' ? '#dc2626' : '#6b7280'
        parts.push('sentiment: <span style="color:' + color + ';font-weight:600">' + t.sentiment + score + '</span>')
      }
      if (Array.isArray(t.content_flags)) {
        var intentFlag = (t.content_flags as string[]).find(function(f) { return typeof f === 'string' && f.startsWith('intent:') })
        if (intentFlag) parts.push('intent: <span style="color:#e8622a;font-weight:600">' + intentFlag.replace('intent:', '') + '</span>')
      }
    } else {
      // Assistant: detect if reply inserts an intent URL.
      var actions: string[] = []
      if (/alexvindman\.com\/florida-first-agenda/i.test(t.content)) actions.push('Florida First Agenda')
      if (/secure\.actblue\.com\/donate/i.test(t.content)) actions.push('Donate')
      if (/act\.alexvindman\.com\/signup\/volunteer/i.test(t.content)) actions.push('Volunteer')
      if (/store\.alexvindman\.com/i.test(t.content)) actions.push('Merch')
      if (/vote\.gov/i.test(t.content)) actions.push('Register to vote')
      if (actions.length) parts.push('action: <span style="color:#e8622a;font-weight:600">' + actions.join(', ') + '</span>')
    }
    // focus:<slug> on assistant turns; topic:<slug> on user turns. Pills
    // render even when sentiment/intent are absent.
    var pillKinds = t.role === 'user' ? ['topic'] : ['focus']
    var pills = pillsHtml(t.content_flags as any, pillKinds)
    var textRow = parts.length > 0 ? '<div>' + parts.join(' · ') + '</div>' : ''
    var pillRow = pills ? '<div style="margin-top:' + (textRow ? '2px' : '0') + '">' + pills + '</div>' : ''
    if (!textRow && !pillRow) return ''
    return '<div style="font-size:10px;font-style:italic;color:#6b7280;margin:2px 0 10px 36px;padding-left:8px;border-left:2px solid #e5e7eb">' + (textRow ? '└ ' + textRow.slice(5, -6) : '') + pillRow + '</div>'
  }

  var rows = turns.map(function(t) {
    var isUser = t.role === 'user'
    var time = fmtTime(t.created_at)
    var bubble: string
    if (isUser) {
      bubble = '<div style="display:flex;justify-content:flex-end;margin-bottom:' + (labeled ? '2px' : '8px') + '"><div style="max-width:75%;padding:10px 14px;border-radius:16px 16px 4px 16px;background:' + uB + ';color:white;font-size:13px;line-height:1.5;white-space:pre-wrap">' + linkify(t.content) + '<div style="font-size:10px;margin-top:4px;opacity:0.5">' + time + '</div></div></div>'
    } else {
      bubble = '<div style="display:flex;align-items:flex-end;gap:8px;margin-bottom:' + (labeled ? '2px' : '8px') + '"><div style="width:28px;height:28px;border-radius:50%;background:' + aG + ';display:flex;align-items:center;justify-content:center;font-size:14px;color:white;flex-shrink:0">' + esc(av) + '</div><div style="max-width:75%;padding:10px 14px;border-radius:16px 16px 16px 4px;background:#E9E9EB;color:#000;font-size:13px;line-height:1.5;white-space:pre-wrap">' + linkify(t.content) + '<div style="font-size:10px;margin-top:4px;opacity:0.5">' + time + '</div></div></div>'
    }
    return bubble + annotation(t)
  }).join('')

  // Persona profile bar — shown in both plain and labeled. Mirrors the
  // local conversation modal at app/bots/[id]/conversations/ConversationsClient
  // lines 577-591. Answers "WHO is this participant" — not AI-internals,
  // so it's appropriate for the plain share too.
  function personaBarHtml(): string {
    if (!persona) return ''
    var bits: string[] = []
    if (persona.life_stage?.value) bits.push(esc(String(persona.life_stage.value)))
    if (persona.occupation?.value) bits.push(esc(String(persona.occupation.value)))
    if (persona.industry?.value) bits.push(esc(String(persona.industry.value)))
    if (persona.location_type?.value) bits.push(esc(String(persona.location_type.value)))
    if (persona.communication_style?.value) bits.push(esc(String(persona.communication_style.value)) + ' tone')
    var concerns = persona.concerns?.values?.length ? persona.concerns.values.map(esc).join(', ') : ''
    if (bits.length === 0 && !concerns) return ''
    var profileRow = bits.length > 0 ? '<div><span style="font-weight:600">Profile:</span> ' + bits.join(' · ') + '</div>' : ''
    var concernsRow = concerns ? '<div style="margin-top:' + (bits.length > 0 ? '2px' : '0') + '"><span style="font-weight:600">Concerns:</span> ' + concerns + '</div>' : ''
    return '<div style="background:#F0FDFA;border-bottom:1px solid #CCFBF1;padding:8px 16px;font-size:11px;color:#0F766E">' + profileRow + concernsRow + '</div>'
  }

  var sub = config.subtitle || ''
  // Header subtitle: bot subtitle + " · with {name}" when name captured.
  var headerSubBits: string[] = []
  if (sub) headerSubBits.push(esc(sub))
  if (userName) headerSubBits.push('with ' + esc(userName))
  var headerSubLine = headerSubBits.length > 0 ? '<div style="font-size:11px;color:rgba(255,255,255,0.65)">' + headerSubBits.join(' · ') + '</div>' : ''
  var footer = labeled ? 'Sentimetrx · AI processing visible' : 'Shared from Sentimetrx'
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(name) + '</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f8fafc;display:flex;justify-content:center;padding:24px}</style></head><body><div style="width:100%;max-width:600px"><div style="background:' + hG + ';padding:16px 20px;border-radius:16px 16px 0 0;display:flex;align-items:center;gap:12px"><div style="width:40px;height:40px;border-radius:50%;background:' + aG + ';display:flex;align-items:center;justify-content:center;font-size:20px;color:white">' + esc(av) + '</div><div><div style="font-size:15px;font-weight:600;color:white">' + esc(name) + '</div>' + headerSubLine + '</div></div>' + personaBarHtml() + '<div style="background:white;padding:16px;' + (persona ? '' : 'border-radius:0 0 16px 16px;') + 'border:1px solid #e5e7eb;border-top:none">' + rows + '</div><div style="text-align:center;padding:12px;font-size:10px;color:#9ca3af">' + esc(footer) + '</div></div></body></html>'
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function linkify(text: string): string {
  // Step -1: normalize raw `<a href="...">text</a>` (some models emit it even
  // when prompted to use markdown) into markdown so the rest of the pipeline
  // handles it cleanly.
  var normalized = text.replace(
    /<a\s+[^>]*href=["']?(https?:\/\/[^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/a>/gi,
    function(_m: string, url: string, t: string) {
      var clean = t.replace(/<[^>]+>/g, '').trim() || url
      return '[' + clean + '](' + url + ')'
    },
  )
  // Step 0: escape HTML so nothing in the source can break out of attrs.
  var s = esc(normalized)
  // Step 1: extract markdown links into placeholders BEFORE bare-URL/domain
  // passes run — otherwise those passes match the URL inside the `href="..."`
  // we just inserted and wrap it again, producing attribute-soup in the bubble.
  var mdLinks: string[] = []
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, function(_m, label, url) {
    mdLinks.push('<a href="' + url + '" target="_blank" rel="noopener noreferrer" style="color:#00b4d8;text-decoration:underline">' + label + '</a>')
    return '\x00ML' + (mdLinks.length - 1) + '\x00'
  })
  // Raw URLs (placeholders don't match)
  s = s.replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:#00b4d8;text-decoration:underline">$1</a>')
  // Bare domains
  s = s.replace(/(?<![/@\w".])((?:[a-zA-Z0-9-]+\.)+(?:com|org|net|ai|io|gov|edu|us|co)(?:\/[^\s<)]*)?)/g, '<a href="https://$1" target="_blank" rel="noopener noreferrer" style="color:#00b4d8;text-decoration:underline">$1</a>')
  // Bold
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  // Step 2: restore markdown-link placeholders.
  s = s.replace(/\x00ML(\d+)\x00/g, function(_m, i) { return mdLinks[parseInt(i, 10)] || '' })
  return s
}
