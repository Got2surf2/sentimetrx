'use client'

import { useState, useEffect, useCallback } from 'react'
import TopNav from '@/components/nav/TopNav'
import Link from 'next/link'
import type { TownHallSession, TownHallTheme } from '@/lib/types'

interface Props {
  sessionId: string
  logoUrl?: string
  analyzeEnabled?: boolean
  campaignsEnabled?: boolean
  user: { email: string; fullName?: string; clientName?: string; isAdmin?: boolean }
}

interface Stats {
  joined: number
  total_turns: number
  answered: number
  skipped: number
  skip_rate: number
  avg_words: number
  avg_turns: number
}

const HERMES = '#E8632A'

const STATE_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  active:    { bg: '#dcfce7', text: '#166534', label: 'Active' },
  detected:  { bg: '#fef3c7', text: '#92400e', label: 'Detected' },
  paused:    { bg: '#e5e7eb', text: '#374151', label: 'Paused' },
  completed: { bg: '#dbeafe', text: '#1e40af', label: 'Completed' },
  dismissed: { bg: '#fee2e2', text: '#991b1b', label: 'Dismissed' },
}

function ProgressBar({ current, target }: { current: number; target: number }) {
  const pct = Math.min(100, Math.round((current / Math.max(target, 1)) * 100))
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: '#f3f4f6', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: pct + '%', height: '100%', background: pct >= 100 ? '#22c55e' : HERMES, borderRadius: 3, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 500, minWidth: 50, textAlign: 'right' }}>
        {current} / {target}
      </span>
    </div>
  )
}

export default function SessionDetailClient({ sessionId, logoUrl, analyzeEnabled, campaignsEnabled, user }: Props) {
  const [session, setSession] = useState<TownHallSession | null>(null)
  const [themes, setThemes] = useState<TownHallTheme[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [showCustom, setShowCustom] = useState(false)
  const [customLabel, setCustomLabel] = useState('')
  const [customQuestion, setCustomQuestion] = useState('')
  const [customTarget, setCustomTarget] = useState(30)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/townhall/sessions/' + sessionId)
      if (!res.ok) return
      const data = await res.json()
      setSession(data.session)
      setThemes(data.themes || [])
      setStats(data.stats || null)
    } catch {}
    setLoading(false)
  }, [sessionId])

  // Initial load + polling
  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 4000)
    return () => clearInterval(interval)
  }, [fetchData])

  const handleSessionAction = async (action: 'start' | 'end' | 'restart') => {
    setActionLoading(action)
    setError(null)
    try {
      const body = action === 'restart' ? { restart: true } : { status: action === 'start' ? 'active' : 'ended' }
      const res = await fetch('/api/townhall/sessions/' + sessionId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError('Failed to ' + action + ': ' + (data.error || res.status))
      }
    } catch (err: any) {
      setError('Network error: ' + (err?.message || 'unknown'))
    }
    await fetchData()
    setActionLoading(null)
  }

  const handleThemeAction = async (themeId: string, action: string, extras?: Record<string, unknown>) => {
    setActionLoading(themeId)
    await fetch('/api/townhall/themes/' + themeId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...extras }),
    })
    await fetchData()
    setActionLoading(null)
  }

  const handleCustomPush = async () => {
    if (!customLabel.trim() || !customQuestion.trim()) return
    setActionLoading('custom')
    await fetch('/api/townhall/themes/custom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        label: customLabel.trim(),
        question: customQuestion.trim(),
        response_target: customTarget,
      }),
    })
    setShowCustom(false)
    setCustomLabel('')
    setCustomQuestion('')
    setCustomTarget(30)
    await fetchData()
    setActionLoading(null)
  }

  const participantUrl = typeof window !== 'undefined'
    ? window.location.origin + '/th/' + sessionId
    : ''

  const copyLink = () => {
    navigator.clipboard.writeText(participantUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) {
    return (
      <>
        <TopNav logoUrl={logoUrl} orgName={user.clientName} isAdmin={user.isAdmin} userEmail={user.email} fullName={user.fullName} analyzeEnabled={analyzeEnabled} campaignsEnabled={campaignsEnabled} currentPage="townhall" />
        <main className="pt-14"><div className="text-center py-20 text-gray-400 text-sm">Loading...</div></main>
      </>
    )
  }

  if (!session) {
    return (
      <>
        <TopNav logoUrl={logoUrl} orgName={user.clientName} isAdmin={user.isAdmin} userEmail={user.email} fullName={user.fullName} analyzeEnabled={analyzeEnabled} campaignsEnabled={campaignsEnabled} currentPage="townhall" />
        <main className="pt-14"><div className="text-center py-20 text-gray-400 text-sm">Session not found</div></main>
      </>
    )
  }

  const guideThemes = themes.filter(t => t.source === 'guide')
  const detectedThemes = themes.filter(t => t.source === 'auto_detected' && t.state === 'detected')
  const activeThemes = themes.filter(t => t.state === 'active' || t.state === 'completed')
  const customThemes = themes.filter(t => t.source === 'custom')

  const isSetup = session.status === 'setup'
  const isActive = session.status === 'active'
  const isEnded = session.status === 'ended'

  return (
    <>
      <TopNav logoUrl={logoUrl} orgName={user.clientName} isAdmin={user.isAdmin} userEmail={user.email} fullName={user.fullName} analyzeEnabled={analyzeEnabled} campaignsEnabled={campaignsEnabled} currentPage="townhall" />

      <main className="pt-14">
        <div className="max-w-6xl mx-auto px-5 py-6">
          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <Link href="/townhall" className="text-sm text-gray-400 hover:text-gray-600 mb-1 block">&larr; All sessions</Link>
              <h1 className="text-xl font-bold text-gray-900">{session.name}</h1>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                  style={{ background: isActive ? '#dcfce7' : isEnded ? '#e5e7eb' : '#fef3c7', color: isActive ? '#166534' : isEnded ? '#374151' : '#92400e' }}>
                  {session.status.charAt(0).toUpperCase() + session.status.slice(1)}
                </span>
                {isActive && session.started_at && (
                  <span className="text-xs text-gray-400">
                    Started {new Date(session.started_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {isSetup && (
                <button onClick={() => handleSessionAction('start')} disabled={actionLoading === 'start'}
                  className="px-4 py-2 rounded-xl text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50"
                  style={{ background: '#22c55e' }}>
                  {actionLoading === 'start' ? 'Starting...' : 'Start Session'}
                </button>
              )}
              {isActive && (
                <button onClick={() => handleSessionAction('end')} disabled={actionLoading === 'end'}
                  className="px-4 py-2 rounded-xl text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50"
                  style={{ background: '#ef4444' }}>
                  {actionLoading === 'end' ? 'Ending...' : 'End Session'}
                </button>
              )}
              {isEnded && (
                <button onClick={() => handleSessionAction('restart')} disabled={actionLoading === 'restart'}
                  className="px-4 py-2 rounded-xl text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50"
                  style={{ background: HERMES }}>
                  {actionLoading === 'restart' ? 'Restarting...' : 'Restart Session'}
                </button>
              )}
            </div>
          </div>

          {/* Participant link */}
          {(isSetup || isActive) && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 mb-5 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <span className="text-xs font-semibold text-gray-400 uppercase block mb-1">Participant Link</span>
                <code className="text-sm text-gray-600 break-all">{participantUrl}</code>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={copyLink}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 hover:bg-gray-50 transition-colors">
                  {copied ? 'Copied!' : 'Copy'}
                </button>
                <a href={participantUrl} target="_blank" rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-white hover:opacity-90"
                  style={{ background: HERMES }}>
                  Preview
                </a>
              </div>
            </div>
          )}

          {/* Error display */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-5 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Stats bar */}
          {stats && (
            <div className="grid grid-cols-6 gap-3 mb-6">
              {[
                { label: 'Joined', value: stats.joined },
                { label: 'Total Turns', value: stats.total_turns },
                { label: 'Answered', value: stats.answered },
                { label: 'Skip Rate', value: stats.skip_rate + '%' },
                { label: 'Avg Words', value: stats.avg_words },
                { label: 'Avg Turns', value: stats.avg_turns },
              ].map(s => (
                <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-3 text-center">
                  <div className="text-lg font-bold text-gray-900">{s.value}</div>
                  <div className="text-[10px] text-gray-400 font-medium uppercase">{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Two column layout */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Left: Topic Pool */}
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="text-sm font-bold text-gray-700 mb-3">Discussion Guide</h3>
                {guideThemes.length === 0 && !isSetup ? (
                  <p className="text-xs text-gray-400">Topics will appear here when the session starts.</p>
                ) : (
                  <div className="space-y-3">
                    {(isSetup ? (session.discussion_guide || []) : guideThemes).map((t: any, i: number) => (
                      <div key={t.id} className="border border-gray-100 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-semibold text-gray-700">{t.label}</span>
                          {!isSetup && (
                            <span className="text-xs font-medium px-1.5 py-0.5 rounded-full"
                              style={{ background: STATE_BADGE[t.state]?.bg || '#f3f4f6', color: STATE_BADGE[t.state]?.text || '#6b7280' }}>
                              {STATE_BADGE[t.state]?.label || t.state}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 mb-2">{t.opening_question || t.question}</p>
                        {!isSetup && t.response_target && (
                          <ProgressBar current={t.response_count || 0} target={t.response_target} />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Detected themes */}
              {detectedThemes.length > 0 && (
                <div className="bg-white rounded-xl border border-orange-200 p-5">
                  <h3 className="text-sm font-bold text-orange-600 mb-3">Emerging Themes</h3>
                  <div className="space-y-3">
                    {detectedThemes.map(t => (
                      <div key={t.id} className="border border-orange-100 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-semibold text-gray-700">{t.label}</span>
                          <span className="text-[10px] text-orange-500 font-medium">{t.mention_count} mentions</span>
                        </div>
                        {t.example_quote && <p className="text-xs text-gray-400 italic mb-2">"{t.example_quote}"</p>}
                        <p className="text-xs text-gray-500 mb-2">{t.question}</p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleThemeAction(t.id, 'approve', { response_target: (session.config as any)?.engine?.default_response_target || 30 })}
                            disabled={!!actionLoading}
                            className="px-3 py-1 rounded-lg text-xs font-medium text-white hover:opacity-90"
                            style={{ background: '#22c55e' }}>
                            Approve
                          </button>
                          <button
                            onClick={() => handleThemeAction(t.id, 'dismiss')}
                            disabled={!!actionLoading}
                            className="px-3 py-1 rounded-lg text-xs font-medium text-gray-500 border border-gray-200 hover:bg-gray-50">
                            Dismiss
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Custom question push */}
              {isActive && (
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  {!showCustom ? (
                    <button onClick={() => setShowCustom(true)}
                      className="w-full py-2 rounded-lg border-2 border-dashed border-gray-300 text-sm text-gray-500 hover:border-orange-300 hover:text-orange-600 transition-colors">
                      + Push Custom Question
                    </button>
                  ) : (
                    <div className="space-y-3">
                      <h3 className="text-sm font-bold text-gray-700">Custom Question</h3>
                      <input type="text" value={customLabel} onChange={e => setCustomLabel(e.target.value)}
                        placeholder="Topic label (e.g. School Quality)"
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200" />
                      <textarea value={customQuestion} onChange={e => setCustomQuestion(e.target.value)}
                        placeholder="The question to ask participants..."
                        rows={2}
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 resize-none" />
                      <div className="flex items-center gap-3">
                        <label className="text-xs text-gray-500">Target:</label>
                        <input type="number" min={5} max={200} value={customTarget}
                          onChange={e => setCustomTarget(parseInt(e.target.value) || 30)}
                          className="w-20 px-2 py-1 rounded border border-gray-200 text-sm" />
                      </div>
                      <div className="flex gap-2">
                        <button onClick={handleCustomPush} disabled={actionLoading === 'custom' || !customLabel.trim() || !customQuestion.trim()}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                          style={{ background: HERMES }}>
                          Push
                        </button>
                        <button onClick={() => setShowCustom(false)}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:bg-gray-50">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right: Active themes + responses */}
            <div className="space-y-4">
              {activeThemes.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="text-sm font-bold text-gray-700 mb-3">All Topics</h3>
                  <div className="space-y-3">
                    {activeThemes.map(t => {
                      const badge = STATE_BADGE[t.state] || STATE_BADGE.active
                      return (
                        <div key={t.id} className="border border-gray-100 rounded-lg p-3">
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-gray-700">{t.label}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                                style={{ background: badge.bg, color: badge.text }}>
                                {badge.label}
                              </span>
                              {t.source !== 'guide' && (
                                <span className="text-[10px] text-gray-300">{t.source === 'custom' ? 'Custom' : 'Detected'}</span>
                              )}
                            </div>
                          </div>
                          <ProgressBar current={t.response_count} target={t.response_target} />
                          {t.state === 'active' && isActive && (
                            <div className="flex gap-2 mt-2">
                              <button onClick={() => handleThemeAction(t.id, 'pause')}
                                className="text-[10px] text-gray-400 hover:text-gray-600">Pause</button>
                              <button onClick={() => handleThemeAction(t.id, 'close')}
                                className="text-[10px] text-gray-400 hover:text-red-500">Close</button>
                            </div>
                          )}
                          {t.state === 'paused' && isActive && (
                            <button onClick={() => handleThemeAction(t.id, 'resume')}
                              className="text-[10px] text-orange-500 hover:text-orange-700 mt-2">Resume</button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* QR Code */}
              {(isSetup || isActive) && (
                <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
                  <h3 className="text-sm font-bold text-gray-700 mb-3">QR Code</h3>
                  <img
                    src={'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(participantUrl) + '&margin=8'}
                    alt="QR code"
                    className="mx-auto rounded-lg border border-gray-200"
                    style={{ width: 200, height: 200 }}
                  />
                  <p className="text-xs text-gray-400 mt-2">Scan to join the conversation</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </>
  )
}
