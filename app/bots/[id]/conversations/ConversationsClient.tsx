'use client'

// app/bots/[id]/conversations/page.tsx
// Conversation cards with filters, modal viewer, time-range reports, delete

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import DownloadButton from '@/components/ui/DownloadButton'

var HERMES = '#E8632A'
var IMSG_BLUE = '#007AFF'
var IMSG_GRAY = '#E9E9EB'

var FLAG_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  profanity: { bg: '#FEF3C7', color: '#92400E', label: 'Profanity' },
  insult: { bg: '#FEF3C7', color: '#92400E', label: 'Insult' },
  slur: { bg: '#FEE2E2', color: '#dc2626', label: 'Slur' },
  threat: { bg: '#FEE2E2', color: '#dc2626', label: 'Threat' },
  sexual: { bg: '#FEE2E2', color: '#dc2626', label: 'Sexual' },
  spam: { bg: '#F3F4F6', color: '#6b7280', label: 'Spam' },
  outside_scope: { bg: '#EDE9FE', color: '#7c3aed', label: 'Off-topic' },
}

function getFlagStyle(f: string): { bg: string; color: string; label: string } {
  if (FLAG_COLORS[f]) return FLAG_COLORS[f]
  if (f.startsWith('intent:')) {
    return { bg: '#DBEAFE', color: '#1D4ED8', label: f.replace('intent:', '').replace(/_/g, ' ') }
  }
  if (f.startsWith('focus:')) {
    return { bg: '#ECFEFF', color: '#0E7B7B', label: f.replace('focus:', '').replace(/[-_]/g, ' ') }
  }
  return { bg: '#F3F4F6', color: '#6b7280', label: f }
}

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
}

interface Turn {
  id: string; turn_number: number; role: 'user' | 'assistant'
  content: string; content_en: string | null; language: string
  created_at: string; content_flags: string[] | null; source: string | null
}

interface BotConfig {
  name?: string; subtitle?: string; avatarLetter?: string
  headerGradient?: string; avatarGradient?: string; avatarTextColor?: string
  userBubbleBg?: string; accentColor?: string
}

export default function ConversationsClient() {
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

  // Filters
  var [filterFlag, setFilterFlag] = useState<string>('all')
  var [filterTime, setFilterTime] = useState<number>(0) // hours, 0 = all
  var [filterSearch, setFilterSearch] = useState('')
  var [reportRange, setReportRange] = useState<string>('168') // default last 7 days
  var [customFrom, setCustomFrom] = useState('')
  var [customTo, setCustomTo] = useState('')
  var [actions, setActions] = useState<{ type: string; title: string; content: string; applied: boolean }[]>([])
  var [extracting, setExtracting] = useState(false)

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

  async function generatePptx() {
    setPptxLoading(true)
    try {
      var r = await fetch('/api/bots/' + botId + '/conversations/insights-deck', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      if (!r.ok) { var d = await r.json().catch(function() { return {} }); alert(d.error || 'Failed'); return }
      var blob = await r.blob()
      var url = URL.createObjectURL(blob)
      var a = document.createElement('a'); a.href = url; a.download = (botName || 'Agent') + '_Insights.pptx'; a.click(); URL.revokeObjectURL(url)
    } catch { alert('Failed') }
    finally { setPptxLoading(false) }
  }

  async function generateReport() {
    setReportLoading(true)
    setReport('')
    var since: string
    if (reportRange === 'custom' && customFrom) {
      since = new Date(customFrom).toISOString()
    } else {
      var hours = parseInt(reportRange) || 168
      since = hours > 0 ? new Date(Date.now() - hours * 3600000).toISOString() : new Date('2020-01-01').toISOString()
    }
    try {
      var r = await fetch('/api/bots/' + botId + '/conversations/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ since: since }) })
      var d = await r.json()
      setReport(d.report || 'No report generated.')
      setReportStats(d.stats || null)
    } catch { setReport('Failed to generate report.') }
    setReportLoading(false)
  }

  async function extractActions() {
    if (!report || extracting) return
    setExtracting(true)
    try {
      var r = await fetch('/api/bots/' + botId + '/conversations/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          since: new Date('2020-01-01').toISOString(),
          extract_actions: true,
          report_text: report,
        }),
      })
      var d = await r.json()
      if (d.actions && d.actions.length > 0) {
        setActions(d.actions.map(function(a: any) { return { ...a, applied: false } }))
      } else {
        setActions([])
      }
    } catch { setActions([]) }
    setExtracting(false)
  }

  async function applyAction(idx: number) {
    var action = actions[idx]
    if (!action || action.applied) return
    try {
      if (action.type === 'guardrail') {
        // Add as guardrail to bot config
        var botRes = await fetch('/api/bots/' + botId)
        var bot = await botRes.json()
        var existing = Array.isArray(bot.guardrails) ? bot.guardrails : []
        await fetch('/api/bots/' + botId, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guardrails: [...existing, action.content] }),
        })
      } else {
        // Add as knowledge chunk (fact or faq)
        var text = action.type === 'faq'
          ? '### ' + action.title + '\n' + action.content
          : '### ' + action.title + '\n' + action.content
        await fetch('/api/bots/' + botId + '/knowledge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text }),
        })
      }
      setActions(function(prev) {
        var next = [...prev]
        next[idx] = { ...next[idx], applied: true }
        return next
      })
    } catch { alert('Failed to apply') }
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
      var html = buildConversationHtml(botName, botConfig, freshTurns)
      var r = await fetch('/api/share', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'conversation', target_id: botId, html: html, expires_in: '30d' }) })
      var d = await r.json()
      if (d.url) { await navigator.clipboard.writeText(d.url); setShareState('copied'); setTimeout(function() { setShareState('idle') }, 3000) }
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
          <button onClick={generatePptx} disabled={pptxLoading || sessions.length === 0}
            style={{ padding: '8px 16px', borderRadius: 20, border: '1px solid #d1d5db', background: 'white', color: '#374151', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: pptxLoading ? 0.6 : 1 }}>
            {pptxLoading ? '...' : 'Deck'}
          </button>
        </div>
      </div>

      {/* Report generator */}
      <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 12, padding: '14px 18px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Report:</span>
        {[{ label: 'Yesterday', val: '24' }, { label: 'Last 7 days', val: '168' }, { label: 'Last 30 days', val: '720' }, { label: 'All time', val: '0' }, { label: 'Custom', val: 'custom' }].map(function(opt) {
          return <button key={opt.val} onClick={function() { setReportRange(opt.val) }} style={pill(reportRange === opt.val)}>{opt.label}</button>
        })}
        {reportRange === 'custom' && (
          <>
            <input type="date" value={customFrom} onChange={function(e) { setCustomFrom(e.target.value) }}
              style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 11 }} />
            <span style={{ fontSize: 11, color: '#9ca3af' }}>to</span>
            <input type="date" value={customTo} onChange={function(e) { setCustomTo(e.target.value) }}
              style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 11 }} />
          </>
        )}
        <button onClick={generateReport} disabled={reportLoading}
          style={{ padding: '6px 18px', borderRadius: 16, border: 'none', background: reportLoading ? '#9ca3af' : HERMES, color: 'white', fontSize: 12, fontWeight: 600, cursor: reportLoading ? 'not-allowed' : 'pointer', marginLeft: 'auto' }}>
          {reportLoading ? 'Analyzing...' : 'Mine Conversations'}
        </button>
      </div>

      {/* Report panel */}
      {report && (
        <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 12, padding: 20, marginBottom: 16, fontSize: 13, lineHeight: 1.7, color: '#78350f', position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Conversation Report</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {reportStats && <span style={{ fontSize: 11, color: '#92400e' }}>{reportStats.session_count} sessions, {reportStats.total_turns} turns</span>}
              <button onClick={function() { setReport('') }} style={{ background: 'none', border: 'none', color: '#92400e', cursor: 'pointer', fontSize: 16 }}>&times;</button>
            </div>
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{report}</div>
          {/* Extract actions button */}
          <div style={{ borderTop: '1px solid #fcd34d', marginTop: 16, paddingTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={extractActions} disabled={extracting}
              style={{ padding: '6px 16px', borderRadius: 14, border: 'none', background: extracting ? '#9ca3af' : '#0F7173', color: 'white', fontSize: 11, fontWeight: 600, cursor: extracting ? 'not-allowed' : 'pointer' }}>
              {extracting ? 'Extracting...' : 'Extract Actions'}
            </button>
            <span style={{ fontSize: 11, color: '#92400e' }}>Parse recommendations into quick-add items for your knowledge base</span>
          </div>
          {/* Action items */}
          {actions.length > 0 && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {actions.some(function(a) { return !a.applied }) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <button onClick={async function() {
                    var pending = actions.filter(function(a) { return !a.applied })
                    if (!confirm('Apply all ' + pending.length + ' recommendations to your agent? This will add them to your knowledge base and guardrails.')) return
                    for (var i = 0; i < actions.length; i++) { if (!actions[i].applied) await applyAction(i) }
                  }}
                    style={{ padding: '6px 16px', borderRadius: 14, border: 'none', background: '#0F7173', color: 'white', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                    Apply All ({actions.filter(function(a) { return !a.applied }).length})
                  </button>
                  <span style={{ fontSize: 11, color: '#6b7280' }}>Add all recommendations to your agent at once</span>
                </div>
              )}
              {actions.map(function(a, i) {
                var typeLabel = a.type === 'guardrail' ? 'Rule' : a.type === 'faq' ? 'FAQ' : 'Fact'
                var typeBg = a.type === 'guardrail' ? '#EDE9FE' : a.type === 'faq' ? '#DBEAFE' : '#D1FAE5'
                var typeColor = a.type === 'guardrail' ? '#7c3aed' : a.type === 'faq' ? '#1D4ED8' : '#059669'
                return (
                  <div key={i} style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, opacity: a.applied ? 0.5 : 1 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: typeBg, color: typeColor, textTransform: 'uppercase', flexShrink: 0 }}>{typeLabel}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>{a.title}</div>
                      <div style={{ fontSize: 11, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.content}</div>
                    </div>
                    <button onClick={function() { applyAction(i) }} disabled={a.applied}
                      style={{ padding: '4px 12px', borderRadius: 12, border: 'none', background: a.applied ? '#D1FAE5' : HERMES, color: a.applied ? '#059669' : 'white', fontSize: 10, fontWeight: 600, cursor: a.applied ? 'default' : 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}>
                      {a.applied ? 'Added' : 'Apply'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

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
        {allFlags.map(function(f) {
          var fc = FLAG_COLORS[f]
          if (!fc) return null
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
          {filtered.map(function(s) {
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
              <div key={s.session_id} style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', transition: 'all 0.15s' }}>
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
                    <span style={{ fontSize: 11, color: '#9ca3af' }}>{fmtRelative(s.started_at)}</span>
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
                    {s.flags.map(function(f) {
                      var c = getFlagStyle(f)
                      return <span key={f} style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 8, background: c.bg, color: c.color }}>{c.label}</span>
                    })}
                  </div>
                  <button onClick={function() { deleteSession(s.session_id) }}
                    style={{ background: 'none', border: 'none', color: '#d1d5db', cursor: 'pointer', fontSize: 14, padding: '2px 4px', flexShrink: 0 }}
                    title="Delete conversation">&times;</button>
                </div>
              </div>
            )
          })}
        </div>
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
                        <span dangerouslySetInnerHTML={{ __html: linkify(t.content) }} />
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
function buildConversationHtml(name: string, config: BotConfig, turns: Turn[]): string {
  var av = config.avatarLetter || (name ? name.charAt(0).toUpperCase() : 'A')
  var hG = config.headerGradient || 'linear-gradient(135deg, #0a1628, #1a2d4a)'
  var aG = config.avatarGradient || 'linear-gradient(135deg, #00b4d8, #0077a8)'
  var uB = config.userBubbleBg || '#007AFF'
  var rows = turns.map(function(t) {
    var isUser = t.role === 'user'
    var time = new Date(t.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    if (isUser) {
      return '<div style="display:flex;justify-content:flex-end;margin-bottom:8px"><div style="max-width:75%;padding:10px 14px;border-radius:16px 16px 4px 16px;background:' + uB + ';color:white;font-size:13px;line-height:1.5;white-space:pre-wrap">' + linkify(t.content) + '<div style="font-size:10px;margin-top:4px;opacity:0.5">' + time + '</div></div></div>'
    }
    return '<div style="display:flex;align-items:flex-end;gap:8px;margin-bottom:8px"><div style="width:28px;height:28px;border-radius:50%;background:' + aG + ';display:flex;align-items:center;justify-content:center;font-size:14px;color:white;flex-shrink:0">' + esc(av) + '</div><div style="max-width:75%;padding:10px 14px;border-radius:16px 16px 16px 4px;background:#E9E9EB;color:#000;font-size:13px;line-height:1.5;white-space:pre-wrap">' + linkify(t.content) + '<div style="font-size:10px;margin-top:4px;opacity:0.5">' + time + '</div></div></div>'
  }).join('')
  var sub = config.subtitle || ''
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(name) + '</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f8fafc;display:flex;justify-content:center;padding:24px}</style></head><body><div style="width:100%;max-width:600px"><div style="background:' + hG + ';padding:16px 20px;border-radius:16px 16px 0 0;display:flex;align-items:center;gap:12px"><div style="width:40px;height:40px;border-radius:50%;background:' + aG + ';display:flex;align-items:center;justify-content:center;font-size:20px;color:white">' + esc(av) + '</div><div><div style="font-size:15px;font-weight:600;color:white">' + esc(name) + '</div>' + (sub ? '<div style="font-size:11px;color:rgba(255,255,255,0.6)">' + esc(sub) + '</div>' : '') + '</div></div><div style="background:white;padding:16px;border-radius:0 0 16px 16px;border:1px solid #e5e7eb;border-top:none">' + rows + '</div><div style="text-align:center;padding:12px;font-size:10px;color:#9ca3af">Shared from Sentimetrx</div></div></body></html>'
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
