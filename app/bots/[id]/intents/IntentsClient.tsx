'use client'

// app/bots/[id]/intents/IntentsClient.tsx
// Intents management panel — shows configured intents with detection stats

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

var HERMES = '#E8632A'

interface IntentStat {
  label: string
  description: string
  keywords: string[]
  url: string
  message: string
  enabled: boolean
  detection_count: number
  last_detected: string | null
  recent_sessions: string[]
}

export default function IntentsClient() {
  var params = useParams()
  var router = useRouter()
  var botId = params.id as string

  var [intents, setIntents] = useState<IntentStat[]>([])
  var [loading, setLoading] = useState(true)
  var [botName, setBotName] = useState('')
  var [toggling, setToggling] = useState<string | null>(null)

  useEffect(function() {
    fetch('/api/bots/' + botId).then(function(r) { return r.json() }).then(function(d) {
      if (d.name) setBotName(d.name)
    }).catch(function() {})

    fetch('/api/bots/' + botId + '/intents-stats')
      .then(function(r) { return r.json() })
      .then(function(d) { setIntents(d.intents || []) })
      .catch(function() {})
      .finally(function() { setLoading(false) })
  }, [botId])

  async function toggleIntent(label: string, enabled: boolean) {
    setToggling(label)
    try {
      // Fetch current intents, toggle the one, save back
      var r = await fetch('/api/bots/' + botId)
      var bot = await r.json()
      var updated = (bot.intents || []).map(function(i: Record<string, unknown>) {
        if (i.label === label) return { ...i, enabled: enabled }
        return i
      })
      await fetch('/api/bots/' + botId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intents: updated }),
      })
      setIntents(function(prev) {
        return prev.map(function(i) {
          if (i.label === label) return { ...i, enabled: enabled }
          return i
        })
      })
    } catch {}
    setToggling(null)
  }

  function timeAgo(dateStr: string): string {
    // eslint-disable-next-line react-hooks/purity -- relative-time display computed during render; if React recomputes, the elapsed value simply refreshes, which is the desired behaviour. Freezing it in state would need a ticking clock for no benefit
    var diff = Date.now() - new Date(dateStr).getTime()
    var mins = Math.floor(diff / 60000)
    if (mins < 60) return mins + 'm ago'
    var hours = Math.floor(mins / 60)
    if (hours < 24) return hours + 'h ago'
    var days = Math.floor(hours / 24)
    return days + 'd ago'
  }

  var totalDetections = intents.reduce(function(sum, i) { return sum + i.detection_count }, 0)
  var activeCount = intents.filter(function(i) { return i.enabled }).length

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={function() { router.push('/bots') }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#6b7280' }}>&larr; Agents</button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>{botName || 'Agent'} — Intents</h1>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
            {intents.length} configured · {activeCount} active · {totalDetections} total detections
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={function() { router.push('/bots/' + botId + '/conversations') }}
            style={{ padding: '8px 16px', borderRadius: 20, border: '1px solid #d1d5db', background: 'white', color: '#374151', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Chats
          </button>
          <button onClick={function() { router.push('/bots/' + botId + '/knowledge') }}
            style={{ padding: '8px 16px', borderRadius: 20, border: '1px solid #d1d5db', background: 'white', color: '#374151', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Knowledge
          </button>
          <button onClick={function() { router.push('/bots/new?edit=' + botId) }}
            style={{ padding: '8px 16px', borderRadius: 20, border: 'none', background: HERMES, color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Edit Agent
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af', fontSize: 14 }}>Loading intents...</div>
      ) : intents.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <p style={{ fontSize: 16, fontWeight: 600, color: '#374151', marginBottom: 8 }}>No intents configured</p>
          <p style={{ fontSize: 13, color: '#9ca3af', marginBottom: 20 }}>Intents detect user interests and direct them to the right place.</p>
          <button onClick={function() { router.push('/bots/new?edit=' + botId) }}
            style={{ padding: '10px 24px', borderRadius: 20, border: 'none', background: HERMES, color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Add Intents
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {intents.map(function(intent) {
            return (
              <div key={intent.label} style={{
                background: 'white', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20,
                opacity: intent.enabled ? 1 : 0.6, transition: 'opacity 0.2s',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={intent.enabled}
                      disabled={toggling === intent.label}
                      onChange={function(e) { void toggleIntent(intent.label, e.target.checked) }}
                      style={{ width: 16, height: 16, accentColor: HERMES }}
                    />
                  </label>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>{intent.label}</span>
                    {intent.description && (
                      <p style={{ fontSize: 12, color: '#6b7280', margin: '2px 0 0' }}>{intent.description}</p>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: intent.detection_count > 0 ? '#1D4ED8' : '#d1d5db' }}>
                      {intent.detection_count}
                    </div>
                    <div style={{ fontSize: 10, color: '#9ca3af', fontWeight: 500 }}>detections</div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {intent.keywords.length > 0 && (
                    <div>
                      <span style={{ fontSize: 10, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Keywords</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {intent.keywords.map(function(kw, i) {
                          return (
                            <span key={i} style={{ padding: '2px 8px', borderRadius: 10, background: '#EEF2FF', color: '#4338CA', fontSize: 11 }}>
                              {kw}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {intent.url && (
                    <div>
                      <span style={{ fontSize: 10, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Action URL</span>
                      <span style={{ fontSize: 11, color: '#2563EB' }}>{intent.url}</span>
                    </div>
                  )}

                  {intent.message && (
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Response</span>
                      <span style={{ fontSize: 11, color: '#6b7280' }}>{intent.message.length > 100 ? intent.message.slice(0, 100) + '...' : intent.message}</span>
                    </div>
                  )}
                </div>

                {intent.last_detected && (
                  <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: '#9ca3af' }}>Last detected:</span>
                    <span style={{ fontSize: 11, color: '#6b7280' }}>{timeAgo(intent.last_detected)}</span>
                    {intent.recent_sessions.length > 1 && (
                      <span style={{ fontSize: 10, color: '#9ca3af' }}>
                        · {intent.recent_sessions.length} recent sessions
                      </span>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
