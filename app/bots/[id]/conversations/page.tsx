'use client'

// app/bots/[id]/conversations/page.tsx
// Review page: conversation cards with flags/personas, modal viewer, reports

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'

const HERMES = '#E8632A'
const IMSG_BLUE = '#007AFF'
const IMSG_GRAY = '#E9E9EB'

const FLAG_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  profanity: { bg: '#FEF3C7', color: '#92400E', label: 'Profanity' },
  insult: { bg: '#FEF3C7', color: '#92400E', label: 'Insult' },
  slur: { bg: '#FEE2E2', color: '#dc2626', label: 'Slur' },
  threat: { bg: '#FEE2E2', color: '#dc2626', label: 'Threat' },
  sexual: { bg: '#FEE2E2', color: '#dc2626', label: 'Sexual' },
  spam: { bg: '#F3F4F6', color: '#6b7280', label: 'Spam' },
  outside_scope: { bg: '#EDE9FE', color: '#7c3aed', label: 'Off-topic' },
}

interface Session {
  session_id: string
  first_message: string
  turn_count: number
  started_at: string
  last_at: string
  user_name: string
  flags: string[]
  has_deflection: boolean
  persona: any | null
}

interface Turn {
  id: string
  turn_number: number
  role: 'user' | 'assistant'
  content: string
  content_en: string | null
  language: string
  created_at: string
  content_flags: string[] | null
  source: string | null
}

interface BotConfig {
  name?: string
  subtitle?: string
  avatarLetter?: string
  headerGradient?: string
  avatarGradient?: string
  avatarTextColor?: string
}

export default function ConversationsPage() {
  var params = useParams()
  var router = useRouter()
  var botId = params.id as string
  var chatEndRef = useRef<HTMLDivElement>(null)

  var [sessions, setSessions] = useState<Session[]>([])
  var [loading, setLoading] = useState(true)
  var [selectedSession, setSelectedSession] = useState<string | null>(null)
  var [turns, setTurns] = useState<Turn[]>([])
  var [turnsLoading, setTurnsLoading] = useState(false)
  var [report, setReport] = useState('')
  var [reportLoading, setReportLoading] = useState(false)
  var [reportStats, setReportStats] = useState<{ session_count: number; total_turns: number; since: string } | null>(null)
  var [botName, setBotName] = useState('')
  var [botConfig, setBotConfig] = useState<BotConfig>({})
  var [pptxLoading, setPptxLoading] = useState(false)
  var [reviews, setReviews] = useState<{ id: string; reviewed_at: string; session_count: number; turn_count: number; report: string; theme_drift: boolean }[]>([])
  var [shareState, setShareState] = useState<'idle' | 'sharing' | 'copied'>('idle')

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

  async function generatePptx() {
    setPptxLoading(true)
    try {
      var r = await fetch('/api/bots/' + botId + '/conversations/insights-deck', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      if (!r.ok) { var d = await r.json().catch(function() { return {} }); alert(d.error || 'Failed to generate deck'); return }
      var blob = await r.blob()
      var url = URL.createObjectURL(blob)
      var a = document.createElement('a'); a.href = url; a.download = (botName || 'Agent') + '_Insights.pptx'; a.click(); URL.revokeObjectURL(url)
    } catch { alert('Failed to generate deck') }
    finally { setPptxLoading(false) }
  }

  async function generateReport() {
    setReportLoading(true)
    setReport('')
    try {
      var r = await fetch('/api/bots/' + botId + '/conversations/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      var d = await r.json()
      setReport(d.report || 'No report generated.')
      setReportStats(d.stats || null)
    } catch { setReport('Failed to generate report.') }
    setReportLoading(false)
  }

  async function shareConversation() {
    if (shareState === 'sharing' || turns.length === 0) return
    setShareState('sharing')
    try {
      var html = buildConversationHtml(botName, botConfig, turns)
      var r = await fetch('/api/share', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'conversation', target_id: botId, html: html, expires_in: '30d' }) })
      var d = await r.json()
      if (d.url) { await navigator.clipboard.writeText(window.location.origin + d.url); setShareState('copied'); setTimeout(function() { setShareState('idle') }, 3000) }
      else setShareState('idle')
    } catch { setShareState('idle') }
  }

  var fmtDate = function(iso: string) {
    var d = new Date(iso)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }

  var fmtRelative = function(iso: string) {
    var diff = Date.now() - new Date(iso).getTime()
    var mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return mins + 'm ago'
    var hrs = Math.floor(mins / 60)
    if (hrs < 24) return hrs + 'h ago'
    var days = Math.floor(hrs / 24)
    if (days < 7) return days + 'd ago'
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  var avatar = botConfig.avatarLetter || (botName ? botName.charAt(0).toUpperCase() : 'A')
  var headerGrad = botConfig.headerGradient || 'linear-gradient(135deg, #0a1628, #1a2d4a)'
  var avatarGrad = botConfig.avatarGradient || 'linear-gradient(135deg, #00b4d8, #0077a8)'
  var selectedSessionData = sessions.find(function(s) { return s.session_id === selectedSession })

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button onClick={function() { router.push('/bots') }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#6b7280' }}>&larr; Back</button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>{botName || 'Agent'} — Conversations</h1>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>{sessions.length} conversation{sessions.length !== 1 ? 's' : ''} recorded</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={function() { window.location.href = '/api/bots/' + botId + '/conversations/export' }} disabled={sessions.length === 0}
            style={{ padding: '8px 20px', borderRadius: 20, border: '1px solid #d1d5db', background: sessions.length === 0 ? '#e5e7eb' : 'white', color: '#374151', fontSize: 13, fontWeight: 600, cursor: sessions.length === 0 ? 'default' : 'pointer' }}>
            Export CSV
          </button>
          <button onClick={generatePptx} disabled={pptxLoading || sessions.length === 0}
            style={{ padding: '8px 20px', borderRadius: 20, border: '1px solid #d1d5db', background: sessions.length === 0 ? '#e5e7eb' : 'white', color: '#374151', fontSize: 13, fontWeight: 600, cursor: sessions.length === 0 ? 'default' : 'pointer', opacity: pptxLoading ? 0.6 : 1 }}>
            {pptxLoading ? 'Building...' : 'Insights Deck'}
          </button>
          <button onClick={generateReport} disabled={reportLoading || sessions.length === 0}
            style={{ padding: '8px 20px', borderRadius: 20, border: 'none', background: sessions.length === 0 ? '#e5e7eb' : HERMES, color: 'white', fontSize: 13, fontWeight: 600, cursor: sessions.length === 0 ? 'default' : 'pointer', opacity: reportLoading ? 0.6 : 1 }}>
            {reportLoading ? 'Analyzing...' : 'Generate Report'}
          </button>
        </div>
      </div>

      {/* Report panel */}
      {report && (
        <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 12, padding: 20, marginBottom: 24, fontSize: 13, lineHeight: 1.7, color: '#78350f' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Conversation Report</span>
            {reportStats && <span style={{ fontSize: 11, color: '#92400e' }}>{reportStats.session_count} sessions, {reportStats.total_turns} turns since {new Date(reportStats.since).toLocaleDateString()}</span>}
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{report}</div>
        </div>
      )}

      {/* Scheduled reviews */}
      {reviews.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 10 }}>Scheduled Reviews</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {reviews.map(function(r) {
              return (
                <details key={r.id} style={{ background: r.theme_drift ? '#fef2f2' : 'white', border: '1px solid ' + (r.theme_drift ? '#fecaca' : '#e5e7eb'), borderRadius: 12, overflow: 'hidden' }}>
                  <summary style={{ padding: '10px 16px', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontWeight: 600, color: '#111827' }}>{fmtDate(r.reviewed_at)}</span>
                    <span style={{ color: '#9ca3af' }}>{r.session_count} sessions, {r.turn_count} turns</span>
                    {r.theme_drift && <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: '#fee2e2', color: '#dc2626', border: '1px solid #fecaca' }}>Drift Detected</span>}
                  </summary>
                  <div style={{ padding: '0 16px 12px', fontSize: 12, color: '#374151', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{r.report}</div>
                </details>
              )
            })}
          </div>
        </div>
      )}

      {/* Conversation cards grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>Loading...</div>
      ) : sessions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 64, background: 'white', borderRadius: 16, border: '2px dashed #e5e7eb' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>💬</div>
          <p style={{ fontSize: 16, fontWeight: 600, color: '#374151' }}>No conversations yet</p>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 8 }}>Conversations will appear here once users start chatting with your agent.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
          {sessions.map(function(s) {
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
              <button key={s.session_id} onClick={function() { loadSession(s.session_id) }}
                style={{
                  background: 'white', border: '1px solid #e5e7eb', borderRadius: 14, padding: 0,
                  cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s', overflow: 'hidden',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}>
                {/* Card header */}
                <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #f3f4f6' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: s.user_name ? '#E0F2FE' : '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: s.user_name ? '#0369A1' : '#9CA3AF' }}>
                        {s.user_name ? s.user_name.charAt(0).toUpperCase() : '?'}
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{s.user_name || 'Anonymous'}</span>
                    </div>
                    <span style={{ fontSize: 11, color: '#9ca3af' }}>{fmtRelative(s.started_at)}</span>
                  </div>
                  <p style={{ fontSize: 12, color: '#6b7280', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.4 }}>
                    {s.first_message || '(no message)'}
                  </p>
                </div>
                {/* Card body — metadata */}
                <div style={{ padding: '10px 16px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {/* Persona row */}
                  {personaLabel && (
                    <div style={{ fontSize: 11, color: '#0F7173', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 14, height: 14, borderRadius: '50%', background: '#E0F7F7', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, flexShrink: 0 }}>P</span>
                      {personaLabel}
                    </div>
                  )}
                  {/* Stats + flags row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, color: '#9ca3af' }}>{s.turn_count} turn{s.turn_count !== 1 ? 's' : ''}</span>
                    {s.has_deflection && (
                      <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 10, background: '#EDE9FE', color: '#7c3aed' }}>Redirected</span>
                    )}
                    {s.flags.map(function(f) {
                      var c = FLAG_COLORS[f]
                      if (!c) return null
                      return <span key={f} style={{ fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 10, background: c.bg, color: c.color }}>{c.label}</span>
                    })}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* ═══ CONVERSATION MODAL ═══ */}
      {selectedSession && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {/* Backdrop */}
          <div onClick={function() { setSelectedSession(null); setTurns([]) }}
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }} />
          {/* Modal */}
          <div style={{ position: 'relative', width: '100%', maxWidth: 560, maxHeight: '85vh', borderRadius: 20, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 48px rgba(0,0,0,0.2)' }}>
            {/* Chat header */}
            <div style={{ background: headerGrad, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: avatarGrad, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: botConfig.avatarTextColor || 'white' }}>
                {avatar}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'white' }}>{botName || 'Agent'}</div>
                {selectedSessionData?.user_name && (
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>Conversation with {selectedSessionData.user_name}</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>{turns.length} turns</span>
                <button onClick={shareConversation} disabled={shareState === 'sharing' || turns.length === 0}
                  style={{ padding: '5px 14px', borderRadius: 16, border: '1px solid rgba(255,255,255,0.3)', background: shareState === 'copied' ? 'rgba(255,255,255,0.2)' : 'transparent', color: 'white', fontSize: 11, fontWeight: 600, cursor: 'pointer', opacity: shareState === 'sharing' ? 0.5 : 1 }}>
                  {shareState === 'copied' ? 'Copied!' : shareState === 'sharing' ? '...' : 'Share'}
                </button>
                <button onClick={function() { setSelectedSession(null); setTurns([]) }}
                  style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white', width: 28, height: 28, borderRadius: '50%', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>&times;</button>
              </div>
            </div>

            {/* Persona bar (if exists) */}
            {selectedSessionData?.persona && (function() {
              var p = selectedSessionData.persona
              var bits: string[] = []
              if (p.life_stage?.value) bits.push(p.life_stage.value)
              if (p.occupation?.value) bits.push(p.occupation.value)
              if (p.industry?.value) bits.push(p.industry.value)
              if (p.location_type?.value) bits.push(p.location_type.value)
              if (p.communication_style?.value) bits.push(p.communication_style.value + ' tone')
              if (p.concerns?.values?.length) bits.push('concerns: ' + p.concerns.values.join(', '))
              if (bits.length === 0) return null
              return (
                <div style={{ background: '#F0FDFA', borderBottom: '1px solid #CCFBF1', padding: '8px 20px', fontSize: 11, color: '#0F766E', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <span style={{ fontWeight: 600 }}>Profile:</span>
                  {bits.join(' · ')}
                </div>
              )
            })()}

            {/* Chat messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 8px', display: 'flex', flexDirection: 'column', gap: 8, background: '#FFFFFF' }}>
              {turnsLoading ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>Loading...</div>
              ) : turns.map(function(t) {
                var isUser = t.role === 'user'
                var isDeflect = t.source === 'deflect'
                var isGreeting = t.source === 'greeting'
                var flags = t.content_flags || []

                return (
                  <div key={t.id}>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, justifyContent: isUser ? 'flex-end' : 'flex-start', flexDirection: isUser ? 'row-reverse' : 'row' }}>
                      {!isUser && (
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: avatarGrad, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: botConfig.avatarTextColor || 'white' }}>
                          {avatar}
                        </div>
                      )}
                      <div style={{
                        maxWidth: '75%', padding: '10px 14px',
                        borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                        background: isUser ? IMSG_BLUE : IMSG_GRAY,
                        color: isUser ? 'white' : '#000',
                        fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap',
                        border: isDeflect ? '1.5px solid #c4b5fd' : 'none',
                        opacity: isGreeting ? 0.8 : 1,
                      }}>
                        {t.content}
                        <div style={{ fontSize: 10, marginTop: 4, opacity: 0.5 }}>
                          {new Date(t.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                          {t.language !== 'en' ? ' \u00b7 ' + t.language : ''}
                          {isDeflect ? ' \u00b7 redirected' : ''}
                          {isGreeting ? ' \u00b7 greeting' : ''}
                        </div>
                      </div>
                    </div>
                    {flags.length > 0 && (
                      <div style={{ display: 'flex', gap: 4, marginTop: 4, justifyContent: isUser ? 'flex-end' : 'flex-start', paddingLeft: isUser ? 0 : 36 }}>
                        {flags.map(function(f) {
                          var c = FLAG_COLORS[f] || { bg: '#F3F4F6', color: '#6b7280', label: f }
                          return <span key={f} style={{ fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 10, background: c.bg, color: c.color, textTransform: 'uppercase', letterSpacing: '0.02em' }}>{c.label}</span>
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

// ── Build self-contained HTML for share link ──────────────────────────
function buildConversationHtml(name: string, config: BotConfig, turns: Turn[]): string {
  var avatarChar = config.avatarLetter || (name ? name.charAt(0).toUpperCase() : 'A')
  var hGrad = config.headerGradient || 'linear-gradient(135deg, #0a1628, #1a2d4a)'
  var aGrad = config.avatarGradient || 'linear-gradient(135deg, #00b4d8, #0077a8)'

  var rows = turns.map(function(t) {
    var isUser = t.role === 'user'
    var time = new Date(t.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    var flagHtml = ''
    if (t.content_flags && t.content_flags.length > 0) {
      flagHtml = '<div style="display:flex;gap:3px;margin-top:4px;justify-content:' + (isUser ? 'flex-end' : 'flex-start') + ';padding-left:' + (isUser ? '0' : '36px') + '">' +
        t.content_flags.map(function(f) {
          var fc = FLAG_COLORS[f] || { bg: '#F3F4F6', color: '#6b7280', label: f }
          return '<span style="font-size:9px;font-weight:600;padding:2px 6px;border-radius:10px;background:' + fc.bg + ';color:' + fc.color + ';text-transform:uppercase">' + fc.label + '</span>'
        }).join('') + '</div>'
    }
    if (isUser) {
      return '<div style="display:flex;justify-content:flex-end;margin-bottom:8px"><div style="max-width:75%;padding:10px 14px;border-radius:16px 16px 4px 16px;background:#007AFF;color:white;font-size:13px;line-height:1.5;white-space:pre-wrap">' +
        escHtml(t.content) + '<div style="font-size:10px;margin-top:4px;opacity:0.5">' + time + '</div></div></div>' + flagHtml
    } else {
      var isDeflect = t.source === 'deflect'
      return '<div style="display:flex;align-items:flex-end;gap:8px;margin-bottom:8px">' +
        '<div style="width:28px;height:28px;border-radius:50%;background:' + aGrad + ';display:flex;align-items:center;justify-content:center;font-size:14px;color:white;flex-shrink:0">' + escHtml(avatarChar) + '</div>' +
        '<div style="max-width:75%;padding:10px 14px;border-radius:16px 16px 16px 4px;background:#E9E9EB;color:#000;font-size:13px;line-height:1.5;white-space:pre-wrap' + (isDeflect ? ';border:1.5px solid #c4b5fd' : '') + '">' +
        escHtml(t.content) + '<div style="font-size:10px;margin-top:4px;opacity:0.5">' + time + (isDeflect ? ' \u00b7 redirected' : '') + '</div></div></div>'
    }
  }).join('')

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escHtml(name) + ' — Conversation</title>' +
    '<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f8fafc;display:flex;justify-content:center;padding:24px}</style></head>' +
    '<body><div style="width:100%;max-width:600px">' +
    '<div style="background:' + hGrad + ';padding:16px 20px;border-radius:16px 16px 0 0;display:flex;align-items:center;gap:12px">' +
    '<div style="width:40px;height:40px;border-radius:50%;background:' + aGrad + ';display:flex;align-items:center;justify-content:center;font-size:20px;color:white">' + escHtml(avatarChar) + '</div>' +
    '<div><div style="font-size:15px;font-weight:600;color:white">' + escHtml(name) + '</div>' +
    (config.subtitle ? '<div style="font-size:11px;color:rgba(255,255,255,0.6)">' + escHtml(config.subtitle) + '</div>' : '') +
    '</div></div>' +
    '<div style="background:white;padding:16px;border-radius:0 0 16px 16px;border:1px solid #e5e7eb;border-top:none">' + rows + '</div>' +
    '<div style="text-align:center;padding:12px;font-size:10px;color:#9ca3af">Shared from Sentimetrx</div>' +
    '</div></body></html>'
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
