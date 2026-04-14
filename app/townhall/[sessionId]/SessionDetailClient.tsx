'use client'

import { useState, useEffect, useCallback } from 'react'
import TopNav from '@/components/nav/TopNav'
import Link from 'next/link'
import type { TownHallSession, TownHallTheme, TownHallGuideTopic } from '@/lib/types'

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

function generateId() { return 'topic_' + Math.random().toString(36).slice(2, 8) }

export default function SessionDetailClient({ sessionId, logoUrl, analyzeEnabled, campaignsEnabled, user }: Props) {
  const [session, setSession] = useState<TownHallSession | null>(null)
  const [themes, setThemes] = useState<TownHallTheme[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Edit mode state
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editBotName, setEditBotName] = useState('')
  const [editBotEmoji, setEditBotEmoji] = useState('')
  const [editSlug, setEditSlug] = useState('')
  const [editOpening, setEditOpening] = useState('')
  const [editGuide, setEditGuide] = useState<TownHallGuideTopic[]>([])
  const [saving, setSaving] = useState(false)

  // Custom question state
  const [showCustom, setShowCustom] = useState(false)
  const [customLabel, setCustomLabel] = useState('')
  const [customQuestion, setCustomQuestion] = useState('')
  const [customTarget, setCustomTarget] = useState(30)

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

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 4000)
    return () => clearInterval(interval)
  }, [fetchData])

  // Start editing — populate form with current values
  const startEdit = () => {
    if (!session) return
    const cfg = session.config as any
    setEditName(session.name)
    setEditSlug(session.slug || '')
    setEditBotName(cfg?.bot_name || 'Town Hall')
    setEditBotEmoji(cfg?.bot_emoji || '\uD83D\uDCAC')
    setEditOpening(cfg?.opening_question || '')
    setEditGuide(session.discussion_guide || [])
    setEditing(true)
  }

  const cancelEdit = () => { setEditing(false) }

  const saveEdit = async () => {
    if (!session) return
    setSaving(true)
    setError(null)
    const cfg = session.config as any
    const updatedConfig = { ...cfg, bot_name: editBotName, bot_emoji: editBotEmoji, opening_question: editOpening }
    try {
      const res = await fetch('/api/townhall/sessions/' + sessionId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName, slug: editSlug.trim() || null, config: updatedConfig, discussion_guide: editGuide }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError('Save failed: ' + (d.error || res.status))
      } else {
        setEditing(false)
      }
    } catch { setError('Network error') }
    setSaving(false)
    await fetchData()
  }

  const addGuideTopic = () => {
    setEditGuide(g => [...g, { id: generateId(), label: '', description: '', opening_question: '', follow_up_angles: [], response_target: 30 }])
  }
  const removeGuideTopic = (idx: number) => { setEditGuide(g => g.filter((_, i) => i !== idx)) }
  const updateGuideTopic = (idx: number, partial: Partial<TownHallGuideTopic>) => {
    setEditGuide(g => g.map((t, i) => i === idx ? { ...t, ...partial } : t))
  }

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
        const d = await res.json().catch(() => ({}))
        setError('Failed to ' + action + ': ' + (d.error || res.status))
      }
    } catch (err: any) { setError('Network error: ' + (err?.message || 'unknown')) }
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
      body: JSON.stringify({ session_id: sessionId, label: customLabel.trim(), question: customQuestion.trim(), response_target: customTarget }),
    })
    setShowCustom(false); setCustomLabel(''); setCustomQuestion(''); setCustomTarget(30)
    await fetchData()
    setActionLoading(null)
  }

  const participantUrl = typeof window !== 'undefined' ? window.location.origin + '/th/' + (session?.slug || sessionId) : ''
  const copyLink = () => { navigator.clipboard.writeText(participantUrl); setCopied(true); setTimeout(() => setCopied(false), 2000) }

  if (loading) return <Shell {...{ logoUrl, analyzeEnabled, campaignsEnabled, user }}><div className="text-center py-20 text-gray-400 text-sm">Loading...</div></Shell>
  if (!session) return <Shell {...{ logoUrl, analyzeEnabled, campaignsEnabled, user }}><div className="text-center py-20 text-gray-400 text-sm">Session not found</div></Shell>

  const cfg = session.config as any
  const isSetup = session.status === 'setup'
  const isActive = session.status === 'active'
  const isEnded = session.status === 'ended'

  // Separate themes into 3 sections
  const activeTopics = themes.filter(t => t.state === 'active' || t.state === 'paused')
  const suggestedTopics = themes.filter(t => t.state === 'detected')
  const completedTopics = themes.filter(t => t.state === 'completed')

  return (
    <Shell {...{ logoUrl, analyzeEnabled, campaignsEnabled, user }}>
      <div className="max-w-6xl mx-auto px-5 py-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <Link href="/townhall" className="text-sm text-gray-400 hover:text-gray-600 mb-1 block">&larr; All sessions</Link>
            <div className="flex items-center gap-2">
              <span className="text-xl">{cfg?.bot_emoji || '\uD83D\uDCAC'}</span>
              <h1 className="text-xl font-bold text-gray-900">{session.name}</h1>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                style={{ background: isActive ? '#dcfce7' : isEnded ? '#e5e7eb' : '#fef3c7', color: isActive ? '#166534' : isEnded ? '#374151' : '#92400e' }}>
                {session.status.charAt(0).toUpperCase() + session.status.slice(1)}
              </span>
              {cfg?.bot_name && <span className="text-xs text-gray-400">Bot: {cfg.bot_name}</span>}
              {isActive && session.started_at && (
                <span className="text-xs text-gray-400">Started {new Date(session.started_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {(isSetup || isEnded) && !editing && (
              <button onClick={startEdit}
                className="px-4 py-2 rounded-xl text-sm font-semibold border border-gray-200 hover:bg-gray-50 text-gray-600">
                Edit
              </button>
            )}
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

        {/* Error display */}
        {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-5 text-sm text-red-700">{error}</div>}

        {/* Participant link + QR */}
        {(isSetup || isActive) && !editing && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-5 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-xs font-semibold text-gray-400 uppercase block mb-1">Participant Link</span>
              <code className="text-sm text-gray-600 break-all">{participantUrl}</code>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={copyLink} className="px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 hover:bg-gray-50">{copied ? 'Copied!' : 'Copy'}</button>
              <a href={participantUrl} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 rounded-lg text-xs font-medium text-white hover:opacity-90" style={{ background: HERMES }}>Preview</a>
            </div>
          </div>
        )}

        {/* ── EDIT MODE ──────────────────────────────────────────── */}
        {editing && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-5 space-y-5">
            <h3 className="text-sm font-bold text-gray-700">Edit Session</h3>

            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">Session Name</label>
              <input type="text" value={editName} onChange={e => setEditName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200" />
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">Participant Link</label>
              <div className="flex items-center">
                <span className="text-sm text-gray-400 bg-gray-50 border border-r-0 border-gray-200 rounded-l-lg px-3 py-2">/th/</span>
                <input type="text" value={editSlug} onChange={e => setEditSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="e.g. neighborhood-meeting"
                  className="flex-1 px-3 py-2 rounded-r-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-gray-500 block mb-1">Bot Name</label>
                <input type="text" value={editBotName} onChange={e => setEditBotName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 block mb-1">Bot Emoji</label>
                <input type="text" value={editBotEmoji} onChange={e => setEditBotEmoji(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200" />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">Opening Question</label>
              <textarea value={editOpening} onChange={e => setEditOpening(e.target.value)} rows={2}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 resize-none" />
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-3">Discussion Guide</label>
              <div className="space-y-3">
                {editGuide.map((t, i) => (
                  <div key={t.id} className="border border-gray-100 rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-gray-400 uppercase">Topic {i + 1}</span>
                      <button onClick={() => removeGuideTopic(i)} className="text-[10px] text-red-400 hover:text-red-600">Remove</button>
                    </div>
                    <input type="text" value={t.label} onChange={e => updateGuideTopic(i, { label: e.target.value })} placeholder="Topic label"
                      className="w-full px-3 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200" />
                    <textarea value={t.opening_question} onChange={e => updateGuideTopic(i, { opening_question: e.target.value })} placeholder="Opening question" rows={2}
                      className="w-full px-3 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 resize-none" />
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-400">Target:</span>
                      <input type="number" min={5} max={500} value={t.response_target} onChange={e => updateGuideTopic(i, { response_target: parseInt(e.target.value) || 30 })}
                        className="w-20 px-2 py-1 rounded border border-gray-200 text-xs" />
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={addGuideTopic}
                className="mt-3 w-full py-2 rounded-lg border-2 border-dashed border-gray-300 text-sm text-gray-500 hover:border-orange-300 hover:text-orange-600">
                + Add Topic
              </button>
            </div>

            <div className="flex gap-2 pt-2">
              <button onClick={saveEdit} disabled={saving}
                className="px-4 py-2 rounded-xl text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50"
                style={{ background: HERMES }}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button onClick={cancelEdit} className="px-4 py-2 rounded-xl text-sm font-medium text-gray-500 hover:bg-gray-50">Cancel</button>
            </div>
          </div>
        )}

        {/* Stats bar */}
        {stats && !editing && (
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

        {/* ── MAIN CONTENT (not editing) ─────────────────────────── */}
        {!editing && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Left 2/3: Topics — single unified list */}
            <div className="lg:col-span-2 space-y-4">

              {/* Opening question preview */}
              {cfg?.opening_question && (
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <span className="text-[10px] font-bold text-gray-400 uppercase">Opening Question</span>
                  <p className="text-sm text-gray-600 mt-1 italic">"{cfg.opening_question}"</p>
                </div>
              )}

              {/* ── ACTIVE TOPICS ──────────────────────────────── */}
              <div className="bg-white rounded-xl border border-green-200 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  <h3 className="text-sm font-bold text-gray-700">Active Topics</h3>
                  <span className="text-[10px] text-gray-400">{isSetup ? (session.discussion_guide || []).length : activeTopics.length}</span>
                </div>

                {isSetup ? (
                  <div className="space-y-2">
                    {(session.discussion_guide || []).map((t: any, i: number) => (
                      <div key={t.id || i} className="border border-gray-100 rounded-lg p-3">
                        <span className="text-sm font-semibold text-gray-700">{t.label}</span>
                        <p className="text-xs text-gray-400 mt-0.5">{t.opening_question}</p>
                        <span className="text-[10px] text-gray-300">Target: {t.response_target} responses</span>
                      </div>
                    ))}
                    {(!session.discussion_guide || session.discussion_guide.length === 0) && (
                      <p className="text-xs text-gray-400">No topics yet. Click Edit to add discussion topics.</p>
                    )}
                  </div>
                ) : activeTopics.length > 0 ? (
                  <div className="space-y-3">
                    {activeTopics.map(t => (
                      <div key={t.id} className="border border-gray-100 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-gray-700">{t.label}</span>
                            {t.state === 'paused' && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500">Paused</span>}
                            {t.source !== 'guide' && <span className="text-[10px] text-gray-300">{t.source === 'custom' ? 'Custom' : 'Detected'}</span>}
                          </div>
                        </div>
                        <ProgressBar current={t.response_count} target={t.response_target} />
                        {isActive && (
                          <div className="flex gap-2 mt-2">
                            {t.state === 'active' && <button onClick={() => handleThemeAction(t.id, 'pause')} className="text-[10px] text-gray-400 hover:text-gray-600">Pause</button>}
                            {t.state === 'paused' && <button onClick={() => handleThemeAction(t.id, 'resume')} className="text-[10px] text-orange-500 hover:text-orange-700">Resume</button>}
                            <button onClick={() => handleThemeAction(t.id, 'close')} className="text-[10px] text-gray-400 hover:text-red-500">Close</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">No active topics.</p>
                )}
              </div>

              {/* ── AI SUGGESTED ───────────────────────────────── */}
              {suggestedTopics.length > 0 && (
                <div className="bg-white rounded-xl border border-orange-200 p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
                    <h3 className="text-sm font-bold text-orange-600">AI Suggested</h3>
                    <span className="text-[10px] text-orange-400">{suggestedTopics.length} awaiting review</span>
                  </div>
                  <div className="space-y-3">
                    {suggestedTopics.map(t => (
                      <div key={t.id} className="border border-orange-100 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-semibold text-gray-700">{t.label}</span>
                          <span className="text-[10px] text-orange-500 font-medium">{t.mention_count} mentions</span>
                        </div>
                        {t.example_quote && <p className="text-xs text-gray-400 italic mb-1">"{t.example_quote}"</p>}
                        <p className="text-xs text-gray-500 mb-2">{t.question}</p>
                        <div className="flex gap-2">
                          <button onClick={() => handleThemeAction(t.id, 'approve', { response_target: cfg?.engine?.default_response_target || 30 })}
                            disabled={!!actionLoading} className="px-3 py-1 rounded-lg text-xs font-medium text-white hover:opacity-90" style={{ background: '#22c55e' }}>Approve</button>
                          <button onClick={() => handleThemeAction(t.id, 'dismiss')}
                            disabled={!!actionLoading} className="px-3 py-1 rounded-lg text-xs font-medium text-gray-500 border border-gray-200 hover:bg-gray-50">Dismiss</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── COMPLETED ─────────────────────────────────── */}
              {completedTopics.length > 0 && (
                <div className="bg-white rounded-xl border border-blue-200 p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full bg-blue-500" />
                    <h3 className="text-sm font-bold text-blue-700">Completed</h3>
                    <span className="text-[10px] text-blue-400">{completedTopics.length} topics</span>
                  </div>
                  <div className="space-y-2">
                    {completedTopics.map(t => (
                      <div key={t.id} className="border border-blue-50 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-gray-700">{t.label}</span>
                            {t.source !== 'guide' && <span className="text-[10px] text-gray-300">{t.source === 'custom' ? 'Custom' : 'Detected'}</span>}
                          </div>
                          <span className="text-[10px] text-blue-500 font-medium">{t.response_count} responses</span>
                        </div>
                        <ProgressBar current={t.response_count} target={t.response_target} />
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
                      className="w-full py-2 rounded-lg border-2 border-dashed border-gray-300 text-sm text-gray-500 hover:border-orange-300 hover:text-orange-600">
                      + Push Custom Question
                    </button>
                  ) : (
                    <div className="space-y-3">
                      <h3 className="text-sm font-bold text-gray-700">Custom Question</h3>
                      <input type="text" value={customLabel} onChange={e => setCustomLabel(e.target.value)} placeholder="Topic label"
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200" />
                      <textarea value={customQuestion} onChange={e => setCustomQuestion(e.target.value)} placeholder="The question to ask..." rows={2}
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 resize-none" />
                      <div className="flex items-center gap-3">
                        <label className="text-xs text-gray-500">Target:</label>
                        <input type="number" min={5} max={200} value={customTarget} onChange={e => setCustomTarget(parseInt(e.target.value) || 30)}
                          className="w-20 px-2 py-1 rounded border border-gray-200 text-sm" />
                      </div>
                      <div className="flex gap-2">
                        <button onClick={handleCustomPush} disabled={actionLoading === 'custom' || !customLabel.trim() || !customQuestion.trim()}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium text-white hover:opacity-90 disabled:opacity-50" style={{ background: HERMES }}>Push</button>
                        <button onClick={() => setShowCustom(false)} className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:bg-gray-50">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right 1/3: QR Code */}
            <div className="space-y-4">
              {(isSetup || isActive) && (
                <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
                  <h3 className="text-sm font-bold text-gray-700 mb-3">QR Code</h3>
                  <img
                    src={'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(participantUrl) + '&margin=8'}
                    alt="QR code" className="mx-auto rounded-lg border border-gray-200" style={{ width: 200, height: 200 }} />
                  <p className="text-xs text-gray-400 mt-2">Scan to join</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Shell>
  )
}

function Shell({ logoUrl, analyzeEnabled, campaignsEnabled, user, children }: {
  logoUrl?: string; analyzeEnabled?: boolean; campaignsEnabled?: boolean
  user: { email: string; fullName?: string; clientName?: string; isAdmin?: boolean }
  children: React.ReactNode
}) {
  return (
    <>
      <TopNav logoUrl={logoUrl} orgName={user.clientName} isAdmin={user.isAdmin} userEmail={user.email} fullName={user.fullName} analyzeEnabled={analyzeEnabled} campaignsEnabled={campaignsEnabled} currentPage="townhall" />
      <main className="pt-14">{children}</main>
    </>
  )
}
