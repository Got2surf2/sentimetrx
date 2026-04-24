'use client'

// app/bots/[id]/conversations/page.tsx
// Review page: lists all conversation sessions for a bot, view individual turns, generate reports

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

const HERMES = '#E8632A'

interface Session {
  session_id: string
  first_message: string
  turn_count: number
  started_at: string
  last_at: string
}

interface Turn {
  id: string
  turn_number: number
  role: 'user' | 'assistant'
  content: string
  content_en: string | null
  language: string
  created_at: string
}

export default function ConversationsPage() {
  const params = useParams()
  const router = useRouter()
  const botId = params.id as string

  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [turnsLoading, setTurnsLoading] = useState(false)
  const [report, setReport] = useState('')
  const [reportLoading, setReportLoading] = useState(false)
  const [reportStats, setReportStats] = useState<{ session_count: number; total_turns: number; since: string } | null>(null)
  const [botName, setBotName] = useState('')
  const [reviews, setReviews] = useState<{ id: string; reviewed_at: string; session_count: number; turn_count: number; report: string; theme_drift: boolean }[]>([])

  useEffect(() => {
    // Fetch bot name
    fetch('/api/bots/' + botId).then(r => r.json()).then(d => {
      if (d.name) setBotName(d.name)
    }).catch(() => {})

    // Fetch sessions
    fetch('/api/bots/' + botId + '/conversations')
      .then(r => r.json())
      .then(d => setSessions(d.sessions || []))
      .catch(() => {})
      .finally(() => setLoading(false))

    // Fetch scheduled reviews
    fetch('/api/bots/' + botId + '/conversations/reviews')
      .then(r => r.json())
      .then(d => setReviews(d.reviews || []))
      .catch(() => {})
  }, [botId])

  async function loadSession(sid: string) {
    setSelectedSession(sid)
    setTurnsLoading(true)
    try {
      const r = await fetch('/api/bots/' + botId + '/conversations/' + encodeURIComponent(sid))
      const d = await r.json()
      setTurns(d.turns || [])
    } catch { setTurns([]) }
    setTurnsLoading(false)
  }

  async function generateReport() {
    setReportLoading(true)
    setReport('')
    try {
      const r = await fetch('/api/bots/' + botId + '/conversations/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const d = await r.json()
      setReport(d.report || 'No report generated.')
      setReportStats(d.stats || null)
    } catch { setReport('Failed to generate report.') }
    setReportLoading(false)
  }

  const fmtDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button onClick={() => router.push('/bots')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#6b7280' }}>&larr; Back</button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>{botName || 'Agent'} — Conversations</h1>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>{sessions.length} conversation{sessions.length !== 1 ? 's' : ''} recorded</p>
        </div>
        <button
          onClick={generateReport}
          disabled={reportLoading || sessions.length === 0}
          style={{
            padding: '8px 20px', borderRadius: 20, border: 'none',
            background: sessions.length === 0 ? '#e5e7eb' : HERMES, color: 'white', fontSize: 13, fontWeight: 600,
            cursor: sessions.length === 0 ? 'default' : 'pointer', opacity: reportLoading ? 0.6 : 1,
          }}>
          {reportLoading ? 'Analyzing...' : 'Generate Report'}
        </button>
      </div>

      {/* Report panel */}
      {report && (
        <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 12, padding: 20, marginBottom: 24, fontSize: 13, lineHeight: 1.7, color: '#78350f' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Conversation Report</span>
            {reportStats && (
              <span style={{ fontSize: 11, color: '#92400e' }}>
                {reportStats.session_count} sessions, {reportStats.total_turns} turns since {new Date(reportStats.since).toLocaleDateString()}
              </span>
            )}
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{report}</div>
        </div>
      )}

      {/* Scheduled review history */}
      {reviews.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 10 }}>Scheduled Reviews</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {reviews.map(r => (
              <details key={r.id} style={{ background: r.theme_drift ? '#fef2f2' : 'white', border: '1px solid ' + (r.theme_drift ? '#fecaca' : '#e5e7eb'), borderRadius: 12, overflow: 'hidden' }}>
                <summary style={{ padding: '10px 16px', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontWeight: 600, color: '#111827' }}>{fmtDate(r.reviewed_at)}</span>
                  <span style={{ color: '#9ca3af' }}>{r.session_count} sessions, {r.turn_count} turns</span>
                  {r.theme_drift && <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: '#fee2e2', color: '#dc2626', border: '1px solid #fecaca' }}>Drift Detected</span>}
                </summary>
                <div style={{ padding: '0 16px 12px', fontSize: 12, color: '#374151', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{r.report}</div>
              </details>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: selectedSession ? '380px 1fr' : '1fr', gap: 20 }}>
        {/* Session list */}
        <div>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>Loading...</div>
          ) : sessions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 64, background: 'white', borderRadius: 16, border: '2px dashed #e5e7eb' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>💬</div>
              <p style={{ fontSize: 16, fontWeight: 600, color: '#374151' }}>No conversations yet</p>
              <p style={{ fontSize: 13, color: '#6b7280', marginTop: 8 }}>Conversations will appear here once users start chatting with your agent.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sessions.map(s => (
                <button
                  key={s.session_id}
                  onClick={() => loadSession(s.session_id)}
                  style={{
                    background: selectedSession === s.session_id ? '#fff4ef' : 'white',
                    border: '1px solid ' + (selectedSession === s.session_id ? HERMES + '40' : '#e5e7eb'),
                    borderRadius: 12, padding: '12px 16px', cursor: 'pointer', textAlign: 'left',
                    transition: 'all 0.15s',
                  }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.first_message || '(empty)'}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: '#9ca3af' }}>
                    <span>{s.turn_count} turn{s.turn_count !== 1 ? 's' : ''}</span>
                    <span>{fmtDate(s.started_at)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Conversation detail */}
        {selectedSession && (
          <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
            <div style={{ padding: '12px 20px', borderBottom: '1px solid #f3f4f6', fontSize: 12, color: '#6b7280', fontWeight: 600 }}>
              Conversation — {turns.length} turns
            </div>
            <div style={{ padding: 20, maxHeight: 600, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {turnsLoading ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>Loading...</div>
              ) : turns.map(t => (
                <div key={t.id} style={{ display: 'flex', justifyContent: t.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    maxWidth: '75%', padding: '10px 14px',
                    borderRadius: t.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    background: t.role === 'user' ? '#007AFF' : '#f3f4f6',
                    color: t.role === 'user' ? 'white' : '#111827',
                    fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap',
                  }}>
                    {t.content}
                    <div style={{ fontSize: 10, marginTop: 4, opacity: 0.5 }}>
                      {new Date(t.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                      {t.language !== 'en' && ` · ${t.language}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
