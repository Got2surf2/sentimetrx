'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import TopNav from '@/components/nav/TopNav'
import Link from 'next/link'
import type { TownHallSession, TownHallTheme, TownHallGuideTopic, TownHallConfig, DemoField, PsychoQuestion } from '@/lib/types'
import { SUPPORTED_LANGUAGES, DEMO_BANK } from '@/lib/types'
import { GENERAL_PSYCHO_BANK } from '@/lib/psychoBank'
import TownHallAnalyticsPanel from '@/components/townhall/TownHallAnalyticsPanel'
import THCreatorNav, { TH_STEP_LABELS } from '@/components/townhall/THCreatorNav'
import { INDUSTRY_LABELS, INDUSTRY_EMOJIS, INDUSTRY_EMOJI_SETS, type Industry } from '@/lib/industryDefaults'
import EmojiPickerPopover from '@/components/creator/EmojiPickerPopover'

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
  survey_responses: number
}

const HERMES = '#E8632A'
const SENT_COLOR: Record<string, string> = { positive: '#16a34a', negative: '#dc2626', mixed: '#d97706', neutral: '#6b7280', insufficient: '#9ca3af' }
const SENT_BG: Record<string, string> = { positive: '#f0fdf4', negative: '#fef2f2', mixed: '#fffbeb', neutral: '#f3f4f6', insufficient: '#f9fafb' }

const STATE_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  active:    { bg: '#dcfce7', text: '#166534', label: 'Active' },
  detected:  { bg: '#fef3c7', text: '#92400e', label: 'Detected' },
  paused:    { bg: '#e5e7eb', text: '#374151', label: 'Paused' },
  completed: { bg: '#dbeafe', text: '#1e40af', label: 'Completed' },
  dismissed: { bg: '#fee2e2', text: '#991b1b', label: 'Dismissed' },
}

function CompletionDonut({ current, target, size = 40 }: { current: number; target: number; size?: number }) {
  const pct = Math.min(100, Math.round((current / Math.max(target, 1)) * 100))
  const r = (size - 6) / 2
  const circ = 2 * Math.PI * r
  const filled = (pct / 100) * circ
  // Orange below target, green at/above
  const color = pct >= 100 ? '#22c55e' : pct >= 70 ? '#65a30d' : pct >= 40 ? '#d97706' : HERMES
  return (
    <div style={{ width: size, height: size, position: 'relative', flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f3f4f6" strokeWidth={3} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={3}
          strokeDasharray={`${filled} ${circ - filled}`} strokeLinecap="round" style={{ transition: 'stroke-dasharray 0.4s' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: size < 36 ? 8 : 10, fontWeight: 700, color }}>{pct}%</span>
      </div>
    </div>
  )
}

function generateId() { return 'topic_' + Math.random().toString(36).slice(2, 8) }

export default function SessionDetailClient({ sessionId, logoUrl, analyzeEnabled, campaignsEnabled, user }: Props) {
  const [session, setSession] = useState<TownHallSession | null>(null)
  const [themes, setThemes] = useState<TownHallTheme[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [activeTab, setActiveTab] = useState<'topics' | 'analytics'>('topics')
  const [gridCols, setGridCols] = useState(2)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Edit mode state — full config editing
  const [editing, setEditing] = useState(false)
  const [autoEditDone, setAutoEditDone] = useState(false)

  // Description grader
  const [descGrade, setDescGrade] = useState<{ score: number; suggestion: string } | null>(null)
  const [grading, setGrading] = useState(false)
  const gradeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gradeDescription = useCallback((desc: string, industry?: string) => {
    if (gradeTimer.current) clearTimeout(gradeTimer.current)
    if (!desc.trim()) { setDescGrade(null); return }
    gradeTimer.current = setTimeout(async () => {
      setGrading(true)
      try {
        const res = await fetch('/api/townhall/grade-description', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: desc, industry }),
        })
        const data = await res.json()
        setDescGrade({ score: data.score || 0, suggestion: data.suggestion || '' })
      } catch {}
      setGrading(false)
    }, 1200)
  }, [])

  // Sensitive topics AI
  const [suggestingTopics, setSuggestingTopics] = useState(false)
  const [suggestedCategories, setSuggestedCategories] = useState<{ name: string; terms: string[] }[] | null>(null)
  const [fanningTerm, setFanningTerm] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editSlug, setEditSlug] = useState('')
  const [editConfig, setEditConfig] = useState<TownHallConfig | null>(null)
  const [editGuide, setEditGuide] = useState<TownHallGuideTopic[]>([])
  const [saving, setSaving] = useState(false)
  const [editStep, setEditStep] = useState(0)

  // Custom question state
  const [showCustom, setShowCustom] = useState(false)
  const [customLabel, setCustomLabel] = useState('')
  const [customQuestion, setCustomQuestion] = useState('')
  const [customTarget, setCustomTarget] = useState(30)
  const updateConfig = (partial: Partial<TownHallConfig>) => setEditConfig(c => c ? { ...c, ...partial } : c)
  const updateContext = (partial: Partial<TownHallConfig['context']>) => setEditConfig(c => c ? { ...c, context: { ...c.context, ...partial } } : c)
  const updateEngine = (partial: Partial<TownHallConfig['engine']>) => setEditConfig(c => c ? { ...c, engine: { ...c.engine, ...partial } } : c)
  const updateSessionEnd = (partial: Partial<TownHallConfig['session_end']>) => setEditConfig(c => c ? { ...c, session_end: { ...c.session_end, ...partial } } : c)
  const updateDisplay = (partial: Partial<TownHallConfig['display']>) => setEditConfig(c => c ? { ...c, display: { ...c.display, ...partial } } : c)

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

  // Auto-enter edit mode on first load — only for setup sessions (not active/paused/ended)
  useEffect(() => {
    if (session && !autoEditDone) {
      setAutoEditDone(true)
      if (session.status === 'setup') startEdit()
    }
  }, [session, autoEditDone])

  // Start editing — deep-copy current config
  const startEdit = () => {
    if (!session) return
    const cfg = JSON.parse(JSON.stringify(session.config)) as TownHallConfig
    // Ensure opening_message is populated from legacy fields if not set
    if (!cfg.opening_message) {
      const welcome = (cfg as any).display?.welcome_message || ''
      const oq = (cfg as any).opening_question || ''
      cfg.opening_message = (welcome && oq) ? welcome + '\n\n' + oq : welcome || oq || ''
    }
    if (!cfg.closing_message) {
      cfg.closing_message = (cfg as any).session_end?.closing_message || (cfg as any).display?.thank_you_message || 'Thank you for participating!'
    }
    setEditName(session.name)
    setEditSlug(session.slug || '')
    setEditConfig(cfg)
    setEditGuide(JSON.parse(JSON.stringify(session.discussion_guide || [])))
    setEditStep(0)
    setEditing(true)
  }

  const cancelEdit = () => { setEditing(false) }

  const saveEdit = async () => {
    if (!session || !editConfig) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/townhall/sessions/' + sessionId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName, slug: editSlug.trim() || null, config: editConfig, discussion_guide: editGuide }),
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
    setEditGuide(g => [...g, { id: generateId(), label: '', description: '', opening_question: '', follow_up_angles: [], keywords: [], response_target: 30 }])
  }
  const removeGuideTopic = (idx: number) => { setEditGuide(g => g.filter((_, i) => i !== idx)) }
  const updateGuideTopic = (idx: number, partial: Partial<TownHallGuideTopic>) => {
    setEditGuide(g => g.map((t, i) => i === idx ? { ...t, ...partial } : t))
  }

  const handleSessionAction = async (action: 'start' | 'end' | 'restart' | 'pause' | 'resume') => {
    setActionLoading(action)
    setError(null)
    try {
      const statusMap: Record<string, string> = { start: 'active', end: 'ended', pause: 'paused', resume: 'active' }
      const body = action === 'restart' ? { restart: true } : { status: statusMap[action] }
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
  const isPaused = session.status === 'paused'
  const isEnded = session.status === 'ended'

  // Separate themes into sections
  const activeTopics = themes.filter(t => t.state === 'active')
  const pendingTopics = themes.filter(t => t.state === 'paused')
  const suggestedTopics = themes.filter(t => t.state === 'detected')
  const parkedTopics = themes.filter(t => t.state === 'parked')
  const completedTopics = themes.filter(t => t.state === 'completed')
  const defaultResponseTarget = cfg?.engine?.default_response_target || 30

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
            {!editing && (
              <button onClick={startEdit}
                className="px-4 py-2 rounded-xl text-sm font-semibold border border-gray-200 hover:bg-gray-50 text-gray-600">
                {'\u270F\uFE0F'} Edit
              </button>
            )}
            {isSetup && (
              <button onClick={() => handleSessionAction('start')} disabled={actionLoading === 'start'}
                className="px-4 py-2 rounded-xl text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50"
                style={{ background: '#22c55e' }}>
                {actionLoading === 'start' ? 'Starting...' : 'Start Session'}
              </button>
            )}
            {(isActive || isPaused) && (
              <button onClick={() => handleSessionAction('end')} disabled={actionLoading === 'end'}
                className="px-4 py-2 rounded-xl text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50"
                style={{ background: '#ef4444' }}>
                {actionLoading === 'end' ? 'Ending...' : 'End Session'}
              </button>
            )}
            {isEnded && (
              <button onClick={async () => {
                setActionLoading('reopen')
                setError(null)
                try {
                  const res = await fetch('/api/townhall/sessions/' + sessionId, {
                    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ reopen: true }),
                  })
                  if (!res.ok) { const d = await res.json().catch(() => ({})); setError('Failed to reopen: ' + (d.error || res.status)) }
                } catch (err: any) { setError('Network error: ' + (err?.message || 'unknown')) }
                await fetchData()
                setActionLoading(null)
              }} disabled={actionLoading === 'reopen'}
                className="px-4 py-2 rounded-xl text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50"
                style={{ background: '#22c55e' }}>
                {actionLoading === 'reopen' ? 'Reopening...' : 'Reopen Session'}
              </button>
            )}
            {isEnded && (
              <button onClick={() => handleSessionAction('restart')} disabled={actionLoading === 'restart'}
                className="px-4 py-2 rounded-xl text-sm font-semibold border border-gray-200 hover:bg-gray-50 text-gray-600 disabled:opacity-50">
                {actionLoading === 'restart' ? 'Restarting...' : 'Restart (clear data)'}
              </button>
            )}
          </div>
        </div>

        {/* Error display */}
        {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-5 text-sm text-red-700">{error}</div>}

        {/* Participant link + QR */}
        {!editing && (
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
        {editing && editConfig && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-5 space-y-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-gray-700">Edit Session</h3>
              <button onClick={cancelEdit} className="px-4 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:bg-gray-50 border border-gray-200">Cancel</button>
            </div>

            {/* Pill navigation */}
            <THCreatorNav
              name={editName}
              config={editConfig}
              guide={editGuide}
              currentStep={editStep}
              highestVisited={TH_STEP_LABELS.length - 1}
              onStepClick={setEditStep}
              onSave={saveEdit}
              saving={saving}
              freeNav
              saveLabel="Save Changes"
              savingLabel="Saving..."
            />

            {/* Scrollable step content */}
            <div className="max-h-[65vh] overflow-y-auto pr-1 space-y-3">

              {/* ── Step 0: Basics ──────────────────────────────────────── */}
              {editStep === 0 && (<div className="space-y-3">
                <ELabel>Session Name</ELabel>
                <EInput value={editName} onChange={setEditName} />
                <ELabel>Participant Link</ELabel>
                <div className="flex items-center">
                  <span className="text-sm text-gray-400 bg-gray-50 border border-r-0 border-gray-200 rounded-l-lg px-3 py-2">/th/</span>
                  <input type="text" value={editSlug} onChange={e => setEditSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                    placeholder="e.g. neighborhood-meeting"
                    className="flex-1 px-3 py-2 rounded-r-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200" />
                </div>
                <ELabel>Industry</ELabel>
                <select
                  value={editConfig.industry || ''}
                  onChange={e => updateConfig({ industry: e.target.value || undefined })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400 bg-white"
                >
                  <option value="">Select industry (optional)</option>
                  {(Object.keys(INDUSTRY_LABELS) as Industry[]).sort((a, b) => INDUSTRY_LABELS[a].localeCompare(INDUSTRY_LABELS[b])).map(k => (
                    <option key={k} value={k}>{INDUSTRY_EMOJIS[k]} {INDUSTRY_LABELS[k]}</option>
                  ))}
                </select>
                <div className="grid grid-cols-2 gap-4">
                  <div><ELabel>Bot Name</ELabel><EInput value={editConfig.bot_name} onChange={v => updateConfig({ bot_name: v })} /></div>
                  <div>
                    <ELabel>Bot Emoji</ELabel>
                    <div className="flex items-center gap-2">
                      <EmojiPickerPopover
                        value={editConfig.bot_emoji || '💬'}
                        onChange={v => updateConfig({ bot_emoji: v })}
                        industryEmojis={editConfig.industry && editConfig.industry !== 'other' ? (INDUSTRY_EMOJI_SETS[editConfig.industry] || undefined) : undefined}
                        industryLabel={editConfig.industry && editConfig.industry !== 'other' ? (INDUSTRY_LABELS[editConfig.industry as Industry] || undefined) : undefined}
                        size="sm"
                      />
                      <span className="text-[11px] text-gray-400">Click to pick</span>
                    </div>
                  </div>
                </div>
                <ELabel>Organization Name</ELabel>
                <EInput value={editConfig.context.org_name} onChange={v => updateContext({ org_name: v })} />
                <div className="flex items-center gap-2">
                  <ELabel>Event Description</ELabel>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-600">Key field</span>
                  {grading && <span className="text-[9px] text-gray-400">Grading...</span>}
                  {!grading && descGrade && descGrade.score > 0 && <DescGradePillSmall score={descGrade.score} />}
                </div>
                <p className="text-[10px] text-gray-400 mb-1">Drives AI moderator context, topic suggestions, and sensitive topic detection.</p>
                <ETextarea value={editConfig.context.event_description} onChange={v => { updateContext({ event_description: v }); gradeDescription(v, editConfig.industry) }} rows={3} />
                {!grading && descGrade?.suggestion && <p className="text-[10px] text-amber-600">{'\u2728'} {descGrade.suggestion}</p>}
                <ELabel>Opening Message</ELabel>
                <ETextarea value={editConfig.opening_message} onChange={v => updateConfig({ opening_message: v })} rows={3} placeholder="Welcome text + opening question shown when a participant joins" />
                <ELabel>Closing Message</ELabel>
                <ETextarea value={editConfig.closing_message} onChange={v => updateConfig({ closing_message: v })} rows={2} placeholder="Thank-you message shown when a participant finishes or the session ends" />
                <ELabel>Tone</ELabel>
                <EInput value={editConfig.context.tone} onChange={v => updateContext({ tone: v })} placeholder="e.g. warm and professional" />
              </div>)}

              {/* ── Step 1: Topics ──────────────────────────────────────── */}
              {editStep === 1 && (<div className="space-y-3">
                <div className="space-y-3">
                  {editGuide.map((t, i) => (
                    <EditTopicCard key={t.id} topic={t} index={i}
                      onChange={partial => updateGuideTopic(i, partial)}
                      onRemove={() => removeGuideTopic(i)}
                      industry={editConfig.industry}
                      orgName={editConfig.context.org_name}
                      eventDesc={editConfig.context.event_description} />
                  ))}
                </div>
                <button onClick={addGuideTopic}
                  className="mt-3 w-full py-2 rounded-lg border-2 border-dashed border-gray-300 text-sm text-gray-500 hover:border-orange-300 hover:text-orange-600">
                  + Add Topic
                </button>
              </div>)}

              {/* ── Step 2: Sensitive Topics ────────────────────────────── */}
              {editStep === 2 && (<div className="space-y-3">
                <div className="flex items-center gap-2">
                  <ELabel>Sensitive Topics</ELabel>
                  <button onClick={async () => {
                    setSuggestingTopics(true); setSuggestedCategories(null)
                    try {
                      const res = await fetch('/api/townhall/suggest-sensitive', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ description: editConfig.context.event_description, industry: editConfig.industry, org_name: editConfig.context.org_name, existing: editConfig.context.sensitive_topics }),
                      })
                      const data = await res.json()
                      if (data.categories) setSuggestedCategories(data.categories)
                    } catch {}
                    setSuggestingTopics(false)
                  }} disabled={suggestingTopics || (!editConfig.context.event_description?.trim() && !editConfig.industry)}
                    className="text-[9px] font-semibold px-2 py-0.5 rounded-lg text-white hover:opacity-90 disabled:opacity-50"
                    style={{ background: '#7c3aed' }}>
                    {suggestingTopics ? '...' : '\u2728 AI Suggest'}
                  </button>
                </div>
                {suggestedCategories && suggestedCategories.length > 0 && (
                  <div className="p-2 rounded-lg border border-purple-200 bg-purple-50/50 space-y-1.5 mb-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-bold text-purple-600 uppercase">AI Suggestions</span>
                      <button onClick={() => setSuggestedCategories(null)} className="text-[9px] text-gray-400">&times;</button>
                    </div>
                    {suggestedCategories.map((cat, ci) => (
                      <div key={ci}>
                        <span className="text-[9px] font-bold text-gray-500">{cat.name}</span>
                        <div className="flex flex-wrap gap-0.5 mt-0.5">
                          {cat.terms.map(term => {
                            const added = (editConfig.context.sensitive_topics || []).includes(term)
                            return (
                              <button key={term} disabled={added}
                                onClick={() => { if (!added) updateContext({ sensitive_topics: [...(editConfig.context.sensitive_topics || []), term] }) }}
                                className="text-[9px] px-1.5 py-0.5 rounded-full border disabled:opacity-40"
                                style={{ background: added ? '#e9d5ff' : 'white', borderColor: added ? '#c084fc' : '#e5e7eb', color: added ? '#7c3aed' : '#6b7280' }}>
                                {added ? '\u2713' : '+'} {term}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-1 mb-1">
                  {(editConfig.context.sensitive_topics || []).map((tag: string, i: number) => (
                    <span key={i} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-red-50 text-[9px] text-red-600 border border-red-200">
                      {tag}
                      <button onClick={async () => {
                        setFanningTerm(tag)
                        try {
                          const res = await fetch('/api/townhall/suggest-sensitive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fan_term: tag }) })
                          const data = await res.json()
                          if (data.terms?.length) {
                            const existing = new Set((editConfig.context.sensitive_topics || []).map((t: string) => t.toLowerCase()))
                            const newTerms = data.terms.filter((t: string) => !existing.has(t.toLowerCase()))
                            if (newTerms.length) updateContext({ sensitive_topics: [...(editConfig.context.sensitive_topics || []), ...newTerms] })
                          }
                        } catch {}
                        setFanningTerm(null)
                      }} disabled={fanningTerm === tag}
                        className="text-red-300 hover:text-purple-500 disabled:animate-pulse" title="Expand">{fanningTerm === tag ? '...' : '\u2728'}</button>
                      <button onClick={() => updateContext({ sensitive_topics: (editConfig.context.sensitive_topics || []).filter((_: string, j: number) => j !== i) })} className="text-red-300 hover:text-red-600">&times;</button>
                    </span>
                  ))}
                </div>
                <EInputCSV value={editConfig.context.sensitive_topics || []} onChange={v => updateContext({ sensitive_topics: v })} />
                <ELabel>Priority Areas <span className="font-normal text-gray-400">(comma-separated)</span></ELabel>
                <EInputCSV value={editConfig.context.priority_areas || []} onChange={v => updateContext({ priority_areas: v })} />
              </div>)}

              {/* ── Step 3: Conversation ────────────────────────────────── */}
              {editStep === 3 && (<div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><ELabel>Max Turns / Participant</ELabel><ENumber value={editConfig.engine.max_turns_per_participant} onChange={v => updateEngine({ max_turns_per_participant: v })} min={3} max={50} /></div>
                  <div><ELabel>Default Response Target</ELabel><ENumber value={editConfig.engine.default_response_target} onChange={v => updateEngine({ default_response_target: v })} min={5} max={500} /></div>
                </div>
                <div><ELabel>AI Timeout (ms)</ELabel><ENumber value={editConfig.engine.ai_timeout_ms} onChange={v => updateEngine({ ai_timeout_ms: v })} min={3000} max={30000} /></div>
                <ELabel>AI Theme Discovery</ELabel>
                <p className="text-[10px] text-gray-400 mb-2">AI scans participant responses to find topics you didn't pre-configure.</p>
                <div className="flex gap-2 mb-2">
                  {([
                    { value: 'off' as const, label: 'Off' },
                    { value: 'manual' as const, label: 'On Demand' },
                    { value: 'auto' as const, label: 'Automatic' },
                  ]).map(m => (
                    <button key={m.value} onClick={() => updateEngine({ theme_detection_mode: m.value })}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all"
                      style={{ background: editConfig.engine.theme_detection_mode === m.value ? '#fff4ef' : '#f9fafb', borderColor: editConfig.engine.theme_detection_mode === m.value ? HERMES : '#e5e7eb', color: editConfig.engine.theme_detection_mode === m.value ? HERMES : '#6b7280' }}>
                      {m.label}
                    </button>
                  ))}
                </div>
                {editConfig.engine.theme_detection_mode === 'auto' && (
                  <div><ELabel>Detect every N responses</ELabel><ENumber value={editConfig.engine.theme_detection_every_n_responses || 20} onChange={v => updateEngine({ theme_detection_every_n_responses: v })} min={5} max={100} /></div>
                )}

                <div className="border-t border-gray-100 pt-3">
                  <ELabel>Session End Mode</ELabel>
                  <div className="flex gap-2 mb-3">
                    {(['manual', 'timed', 'inactivity'] as const).map(m => (
                      <button key={m} onClick={() => updateSessionEnd({ mode: m })}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all"
                        style={{ background: editConfig.session_end.mode === m ? '#fff4ef' : '#f9fafb', borderColor: editConfig.session_end.mode === m ? HERMES : '#e5e7eb', color: editConfig.session_end.mode === m ? HERMES : '#6b7280' }}>
                        {m.charAt(0).toUpperCase() + m.slice(1)}
                      </button>
                    ))}
                  </div>
                  {editConfig.session_end.mode === 'timed' && (
                    <div><ELabel>Duration (minutes)</ELabel><ENumber value={editConfig.session_end.duration_minutes || 60} onChange={v => updateSessionEnd({ duration_minutes: v })} min={5} max={480} /></div>
                  )}
                  {editConfig.session_end.mode === 'inactivity' && (
                    <div><ELabel>Inactivity Timeout (minutes)</ELabel><ENumber value={editConfig.session_end.inactivity_timeout_minutes || 10} onChange={v => updateSessionEnd({ inactivity_timeout_minutes: v })} min={1} max={120} /></div>
                  )}
                </div>

                <div className="border-t border-gray-100 pt-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div><ELabel>Skip Button</ELabel><EInput value={editConfig.display.skip_label} onChange={v => updateDisplay({ skip_label: v })} /></div>
                    <div><ELabel>Done Button</ELabel><EInput value={editConfig.display.done_label} onChange={v => updateDisplay({ done_label: v })} /></div>
                  </div>
                </div>

                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-gray-800">Testing Mode</div>
                      <div className="text-xs text-gray-500 mt-0.5">Show AI thinking process inline</div>
                    </div>
                    <button type="button" onClick={() => updateConfig({ testing: !editConfig.testing })}
                      className={'relative inline-flex w-11 h-6 rounded-full transition-colors flex-shrink-0 ml-4 border-2 border-transparent ' + (editConfig.testing ? 'bg-amber-500' : 'bg-gray-200')}>
                      <span className={'inline-block w-5 h-5 bg-white rounded-full shadow-md transition-transform transform ' + (editConfig.testing ? 'translate-x-5' : 'translate-x-0')} />
                    </button>
                  </div>
                  <p className="text-[10px] text-amber-700 mt-1">Debug: type <code className="bg-white/60 px-1 rounded">#debug SESSION_ID</code> in chat or add <code className="bg-white/60 px-1 rounded">?debug=SESSION_ID</code> to participant URL.</p>
                </div>

                <div className="border-t border-gray-100 pt-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <ELabel>Content Safety</ELabel>
                      <p className="text-[10px] text-gray-400">Filter profanity, slurs, and threats. Warnings + shutdown after repeated violations.</p>
                    </div>
                    <button type="button" onClick={() => updateConfig({
                      content_safety: { enabled: !(editConfig.content_safety?.enabled !== false) },
                    })}
                      className={'relative inline-flex w-11 h-6 rounded-full transition-colors flex-shrink-0 ml-4 border-2 border-transparent ' + (editConfig.content_safety?.enabled !== false ? 'bg-green-500' : 'bg-gray-200')}>
                      <span className={'inline-block w-5 h-5 bg-white rounded-full shadow-md transition-transform transform ' + (editConfig.content_safety?.enabled !== false ? 'translate-x-5' : 'translate-x-0')} />
                    </button>
                  </div>
                  {editConfig.content_safety?.enabled === false && (
                    <p className="text-[10px] text-amber-600 mt-1">Content filtering is OFF — profanity and strong language will not be blocked.</p>
                  )}
                </div>
              </div>)}

              {/* ── Step 4: Post-Session ────────────────────────────────── */}
              {editStep === 4 && (<div className="space-y-4">
                <ELabel>Languages</ELabel>
                <p className="text-[10px] text-gray-400 mb-2">Participants choose their language before joining. Responses are auto-translated to English.</p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {SUPPORTED_LANGUAGES.map(l => {
                    const checked = (editConfig.languages || []).includes(l.code)
                    const isEn = l.code === 'en'
                    return (
                      <button key={l.code} type="button" disabled={isEn} onClick={() => {
                        const prev = editConfig.languages || ['en']
                        updateConfig({ languages: checked ? prev.filter(c => c !== l.code) : [...prev, l.code] })
                      }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all"
                        style={{ background: checked ? '#fff4ef' : '#f9fafb', border: '1.5px solid ' + (checked ? HERMES : '#e5e7eb'), cursor: isEn ? 'default' : 'pointer', opacity: isEn ? 0.7 : 1 }}>
                        <span className="w-4 h-4 rounded border flex items-center justify-center text-[10px] flex-shrink-0"
                          style={{ borderColor: checked ? HERMES : '#d1d5db', background: checked ? HERMES : 'white', color: checked ? 'white' : 'transparent' }}>
                          {checked ? '\u2713' : ''}
                        </span>
                        <span style={{ color: checked ? HERMES : '#6b7280', fontWeight: checked ? 600 : 400 }}>{l.nativeName}</span>
                        {l.name !== l.nativeName && <span className="text-xs" style={{ color: '#9ca3af' }}>{l.name}</span>}
                      </button>
                    )
                  })}
                </div>

                <div className="border-t border-gray-100 pt-3">
                  <p className="text-[10px] font-bold text-gray-400 uppercase mb-2">Bot Messages <span className="font-normal normal-case">(auto-translated for participants)</span></p>
                  <ELabel>Post-Session Intro <span className="font-normal text-gray-400">(before optional questions)</span></ELabel>
                  <EInput value={(editConfig.messages?.post_session_intro) || ''} onChange={v => updateConfig({ messages: { ...editConfig.messages, post_session_intro: v } })} placeholder="Almost done — a few quick optional questions..." />
                  <ELabel>Before Demographics <span className="font-normal text-gray-400">(before demo form)</span></ELabel>
                  <EInput value={(editConfig.messages?.post_session_demo) || ''} onChange={v => updateConfig({ messages: { ...editConfig.messages, post_session_demo: v } })} placeholder="A couple of optional questions about you." />
                </div>

                <div className="border-t border-gray-100 pt-3">
                  <ELabel>Demographics</ELabel>
                  <div className="space-y-1 mb-4">
                    {DEMO_BANK.map(d => {
                      const active = (editConfig.demoFields || []).find(f => f.key === d.key)
                      const enabled = active?.enabled ?? false
                      return (
                        <button key={d.key} onClick={() => {
                          const current = editConfig.demoFields || DEMO_BANK.map(b => ({ ...b, enabled: false }))
                          const next = current.map(f => f.key === d.key ? { ...f, enabled: !enabled } : f)
                          if (!current.find(f => f.key === d.key)) next.push({ ...d, enabled: true })
                          updateConfig({ demoFields: next })
                        }}
                          className="flex items-center gap-2 w-full text-left px-3 py-1.5 rounded-lg text-sm transition-all"
                          style={{ background: enabled ? '#fff4ef' : '#f9fafb', border: '1.5px solid ' + (enabled ? HERMES : '#e5e7eb') }}>
                          <span className="w-4 h-4 rounded border flex items-center justify-center text-[10px] flex-shrink-0"
                            style={{ borderColor: enabled ? HERMES : '#d1d5db', background: enabled ? HERMES : 'white', color: enabled ? 'white' : 'transparent' }}>
                            {enabled ? '\u2713' : ''}
                          </span>
                          <span style={{ color: enabled ? HERMES : '#6b7280', fontWeight: enabled ? 600 : 400 }}>{d.label}</span>
                          <span className="text-[10px] text-gray-400 ml-auto">{d.type}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="border-t border-gray-100 pt-3">
                  <ELabel>Psychographic Questions</ELabel>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] text-gray-400">Show</span>
                    <ENumber value={editConfig.psychoCount || 3} onChange={v => updateConfig({ psychoCount: v })} min={0} max={15} />
                    <span className="text-[10px] text-gray-400">random questions per participant</span>
                  </div>
                  <div className="space-y-1">
                    {GENERAL_PSYCHO_BANK.map(pq => {
                      const inBank = (editConfig.psychographicBank || []).some(b => b.key === pq.key)
                      return (
                        <button key={pq.key} onClick={() => {
                          const current = editConfig.psychographicBank || []
                          const next = inBank ? current.filter(b => b.key !== pq.key) : [...current, { key: pq.key, q: pq.q, opts: pq.opts }]
                          updateConfig({ psychographicBank: next })
                        }}
                          className="flex items-center gap-2 w-full text-left px-3 py-1.5 rounded-lg text-sm transition-all"
                          style={{ background: inBank ? '#fff4ef' : '#f9fafb', border: '1.5px solid ' + (inBank ? HERMES : '#e5e7eb') }}>
                          <span className="w-4 h-4 rounded border flex items-center justify-center text-[10px] flex-shrink-0"
                            style={{ borderColor: inBank ? HERMES : '#d1d5db', background: inBank ? HERMES : 'white', color: inBank ? 'white' : 'transparent' }}>
                            {inBank ? '\u2713' : ''}
                          </span>
                          <span className="flex-1" style={{ color: inBank ? HERMES : '#6b7280', fontWeight: inBank ? 600 : 400 }}>{pq.q}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>)}

              {/* ── Step 5: Review ──────────────────────────────────────── */}
              {editStep === 5 && (<div className="space-y-3">
                <div className="bg-gray-50 rounded-lg p-3">
                  <span className="text-[10px] font-bold text-gray-400 uppercase">Session</span>
                  <p className="text-sm font-medium text-gray-700 mt-1">{editName || '(no name)'}</p>
                  <p className="text-xs text-gray-400">{editConfig.context.org_name} &middot; {editConfig.context.tone}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <span className="text-[10px] font-bold text-gray-400 uppercase">Topics ({editGuide.length})</span>
                  {editGuide.map((t, i) => (
                    <div key={t.id} className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-gray-400">{i + 1}.</span>
                      <span className="text-sm text-gray-700">{t.label}</span>
                    </div>
                  ))}
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <span className="text-[10px] font-bold text-gray-400 uppercase">Settings</span>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mt-1">
                    <span className="text-gray-400">Max turns</span><span className="text-gray-600">{editConfig.engine.max_turns_per_participant}</span>
                    <span className="text-gray-400">End mode</span><span className="text-gray-600">{editConfig.session_end.mode}</span>
                    <span className="text-gray-400">Languages</span><span className="text-gray-600">{(editConfig.languages || ['en']).join(', ')}</span>
                  </div>
                </div>
              </div>)}

            </div>
          </div>
        )}

        {/* Stats bar */}
        {stats && !editing && (
          <div className="grid grid-cols-7 gap-3 mb-6">
            {[
              { label: 'Joined', value: stats.joined },
              { label: 'Total Turns', value: stats.total_turns },
              { label: 'Answered', value: stats.answered },
              { label: 'Skip Rate', value: stats.skip_rate + '%' },
              { label: 'Avg Words', value: stats.avg_words },
              { label: 'Avg Turns', value: stats.avg_turns },
              { label: 'Surveys', value: stats.survey_responses },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-3 text-center">
                <div className="text-lg font-bold text-gray-900">{s.value}</div>
                <div className="text-[10px] text-gray-400 font-medium uppercase">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Tab switcher */}
        {!editing && (
          <div className="flex gap-1 mb-5 bg-gray-100 rounded-xl p-1 w-fit">
            {(['topics', 'analytics'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-all capitalize"
                style={{ background: activeTab === tab ? 'white' : 'transparent', color: activeTab === tab ? HERMES : '#6b7280', boxShadow: activeTab === tab ? '0 1px 3px rgba(0,0,0,0.08)' : 'none' }}>
                {tab}
              </button>
            ))}
          </div>
        )}

        {/* ── ANALYTICS TAB ────────────────────────────────────────── */}
        {!editing && activeTab === 'analytics' && (
          <TownHallAnalyticsPanel sessionId={sessionId} />
        )}

        {/* ── TOPICS TAB (main content) ────────────────────────────── */}
        {!editing && activeTab === 'topics' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Left 2/3: Topics — single unified list */}
            <div className="lg:col-span-2 space-y-4">

              {/* Opening message preview */}
              {(cfg?.opening_message || cfg?.opening_question) && (
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <span className="text-[10px] font-bold text-gray-400 uppercase">Opening Message</span>
                  <p className="text-sm text-gray-600 mt-1 italic whitespace-pre-wrap">"{cfg.opening_message || cfg.opening_question}"</p>
                </div>
              )}

              {/* Grid size toggle */}
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-gray-400 mr-1">Grid:</span>
                {[2, 3, 4].map(n => (
                  <button key={n} onClick={() => setGridCols(n)}
                    className="text-[10px] px-2 py-1 rounded-lg font-semibold transition-all"
                    style={{ background: gridCols === n ? '#fff4ef' : '#f9fafb', border: '1px solid ' + (gridCols === n ? '#E8632A' : '#e5e7eb'), color: gridCols === n ? '#E8632A' : '#6b7280' }}>
                    {n}
                  </button>
                ))}
              </div>

              {/* ── AI SUGGESTED (show above active if any exist) ── */}
              {!isSetup && suggestedTopics.length > 0 && (
                <div className="rounded-xl border-2 border-orange-300 p-5" style={{ background: '#fffaf5' }}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2.5 h-2.5 rounded-full bg-orange-400 animate-pulse" />
                    <h3 className="text-sm font-bold text-orange-600">AI Recommended</h3>
                    <span className="text-[10px] bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full font-bold">{suggestedTopics.length} new</span>
                  </div>
                  <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(' + (gridCols >= 4 ? '220px' : gridCols >= 3 ? '260px' : '300px') + ', 1fr))' }}>
                    {suggestedTopics.map(t => (
                      <ThemeCard key={t.id} theme={t} isActive={isActive} variant="suggested"
                        onAction={(action, extras) => handleThemeAction(t.id, action, extras)} loading={actionLoading === t.id}
                        defaultResponseTarget={defaultResponseTarget} />
                    ))}
                  </div>
                </div>
              )}

              {/* ── ACTIVE ──────────────────────────────────── */}
              <div className="bg-white rounded-xl border border-green-200 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  <h3 className="text-sm font-bold text-green-700">Active</h3>
                  <span className="text-[10px] text-gray-400">{isSetup ? (session.discussion_guide || []).filter((t: any) => t.enabled !== false).length : activeTopics.length}</span>
                </div>

                {isSetup ? (
                  <div className="space-y-2">
                    {(session.discussion_guide || []).filter((t: any) => t.enabled !== false).map((t: any, i: number) => (
                      <div key={t.id || i} className="border border-gray-100 rounded-lg p-3 flex items-start gap-3">
                        <CompletionDonut current={0} target={t.response_target || 30} size={36} />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-semibold text-gray-700">{t.label}</span>
                          <p className="text-xs text-gray-400 mt-0.5">{t.opening_question}</p>
                          <span className="text-[10px] text-gray-300">Target: {t.response_target || 30} responses</span>
                        </div>
                      </div>
                    ))}
                    {(session.discussion_guide || []).filter((t: any) => t.enabled !== false).length === 0 && (
                      <p className="text-xs text-gray-400">No active topics. Enable topics in the discussion guide or click Edit.</p>
                    )}
                  </div>
                ) : activeTopics.length > 0 ? (
                  <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(' + (gridCols >= 4 ? '220px' : gridCols >= 3 ? '260px' : '300px') + ', 1fr))' }}>
                    {activeTopics.map(t => (
                      <ThemeCard key={t.id} theme={t} isActive={isActive} variant="active"
                        onAction={(action) => handleThemeAction(t.id, action)} loading={actionLoading === t.id} />
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">No active topics.</p>
                )}
              </div>

              {/* ── PARKED (saved for later) ──────────────────── */}
              {parkedTopics.length > 0 && (
                <div className="bg-white rounded-xl border border-blue-200 p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full bg-blue-400" />
                    <h3 className="text-sm font-bold text-blue-700">Parked</h3>
                    <span className="text-[10px] text-blue-400">{parkedTopics.length}</span>
                  </div>
                  <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(' + (gridCols >= 4 ? '220px' : gridCols >= 3 ? '260px' : '300px') + ', 1fr))' }}>
                    {parkedTopics.map(t => (
                      <ThemeCard key={t.id} theme={t} isActive={isActive} variant="parked"
                        onAction={(action, extras) => handleThemeAction(t.id, action, extras)} loading={actionLoading === t.id}
                        defaultResponseTarget={defaultResponseTarget} />
                    ))}
                  </div>
                </div>
              )}

              {/* ── PENDING (paused topics) ───────────────────── */}
              {pendingTopics.length > 0 && (
                <div className="bg-white rounded-xl border border-amber-200 p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full bg-amber-400" />
                    <h3 className="text-sm font-bold text-amber-700">Pending</h3>
                    <span className="text-[10px] text-amber-400">{pendingTopics.length}</span>
                  </div>
                  <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(' + (gridCols >= 4 ? '220px' : gridCols >= 3 ? '260px' : '300px') + ', 1fr))' }}>
                    {pendingTopics.map(t => (
                      <ThemeCard key={t.id} theme={t} isActive={isActive} variant="active"
                        onAction={(action) => handleThemeAction(t.id, action)} loading={actionLoading === t.id} />
                    ))}
                  </div>
                </div>
              )}

              {/* ── SETUP: Disabled topics ────────────────────── */}
              {isSetup && (session.discussion_guide || []).some((t: any) => t.enabled === false) && (
                <div className="bg-white rounded-xl border border-gray-100 p-5 opacity-60">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full bg-gray-300" />
                    <h3 className="text-sm font-bold text-gray-400">Disabled</h3>
                    <span className="text-[10px] text-gray-300">{(session.discussion_guide || []).filter((t: any) => t.enabled === false).length}</span>
                  </div>
                  <div className="space-y-2">
                    {(session.discussion_guide || []).filter((t: any) => t.enabled === false).map((t: any, i: number) => (
                      <div key={t.id || i} className="border border-gray-50 rounded-lg p-3">
                        <span className="text-sm font-semibold text-gray-400">{t.label}</span>
                        <p className="text-xs text-gray-300 mt-0.5">Disabled — enable in Edit to include in session</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── CLOSED ───────────────────────────────────── */}
              {completedTopics.length > 0 && (
                <div className="bg-white rounded-xl border border-blue-200 p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full bg-blue-500" />
                    <h3 className="text-sm font-bold text-blue-700">Closed</h3>
                    <span className="text-[10px] text-blue-400">{completedTopics.length}</span>
                  </div>
                  <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(' + (gridCols >= 4 ? '220px' : gridCols >= 3 ? '260px' : '300px') + ', 1fr))' }}>
                    {completedTopics.map(t => (
                      <ThemeCard key={t.id} theme={t} isActive={false} variant="completed"
                        onAction={(action) => handleThemeAction(t.id, action)} loading={actionLoading === t.id} />
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

              {/* Theme detection button */}
              {isActive && (session.config as any)?.engine?.theme_detection_mode !== 'off' && (
                <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between">
                  <div>
                    <span className="text-sm font-semibold text-gray-700">Theme Detection</span>
                    {(session.config as any)?.engine?.theme_detection_mode === 'auto' && (
                      <span className="text-[10px] text-gray-400 ml-2">Auto every {(session.config as any)?.engine?.theme_detection_interval_minutes || 10} min</span>
                    )}
                  </div>
                  <button onClick={async () => {
                    setActionLoading('detect')
                    try {
                      const res = await fetch('/api/townhall/themes/detect', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ session_id: sessionId }),
                      })
                      const d = await res.json()
                      if (d.error) setError(d.error)
                    } catch { setError('Detection failed') }
                    setActionLoading(null)
                    await fetchData()
                  }}
                    disabled={actionLoading === 'detect'}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                    style={{ background: '#7c3aed' }}>
                    {actionLoading === 'detect' ? 'Detecting...' : '\u29E1 Detect Themes'}
                  </button>
                </div>
              )}
            </div>

            {/* Right 1/3: QR Code + Live link */}
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
              <a href={'/th/' + sessionId + '/live'} target="_blank" rel="noopener noreferrer"
                className="block bg-gray-900 text-white rounded-xl p-4 text-center hover:bg-gray-800 transition-colors">
                <span className="text-sm font-bold">Open Live Screen</span>
                <p className="text-[10px] text-gray-400 mt-0.5">Full-screen view for projection</p>
              </a>
            </div>
          </div>
        )}
      </div>
    </Shell>
  )
}

// ── Description Grade Pill (compact for edit form) ─────────────────────────────
const GRADE_COLORS = ['', '#dc2626', '#ea580c', '#d97706', '#65a30d', '#16a34a']
const GRADE_BG = ['', '#fef2f2', '#fff7ed', '#fffbeb', '#f7fee7', '#f0fdf4']
const GRADE_LABELS = ['', 'Needs work', 'Basic', 'Adequate', 'Good', 'Excellent']

function DescGradePillSmall({ score }: { score: number }) {
  const s = Math.max(1, Math.min(5, score))
  return (
    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
      style={{ background: GRADE_BG[s], color: GRADE_COLORS[s] }}>
      {'●'.repeat(s)}{'○'.repeat(5 - s)} {GRADE_LABELS[s]}
    </span>
  )
}

// ── Edit Topic Card with AI Generate ───────────────────────────────────────────
function EditTopicCard({ topic: t, index, onChange, onRemove, industry, orgName, eventDesc }: {
  topic: TownHallGuideTopic; index: number
  onChange: (partial: Partial<TownHallGuideTopic>) => void
  onRemove: () => void
  industry?: string; orgName?: string; eventDesc?: string
}) {
  const [generating, setGenerating] = useState(false)
  const generateWithAI = async () => {
    if (!t.label.trim()) return
    setGenerating(true)
    try {
      const res = await fetch('/api/townhall/suggest-topic', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: t.label, industry, org_name: orgName, event_description: eventDesc }),
      })
      const data = await res.json()
      if (!data.error) onChange({
        description: data.description || t.description,
        opening_question: data.opening_question || t.opening_question,
        follow_up_angles: data.follow_up_angles?.length ? data.follow_up_angles : t.follow_up_angles,
        keywords: data.keywords?.length ? data.keywords : t.keywords,
      })
    } catch {}
    setGenerating(false)
  }
  const enabled = t.enabled !== false
  return (
    <div className={'border rounded-lg p-3 space-y-2 transition-opacity ' + (enabled ? 'border-gray-100' : 'border-gray-50 bg-gray-50/50 opacity-60')}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => onChange({ enabled: !enabled })}
            className="w-7 h-3.5 rounded-full relative transition-colors flex-shrink-0"
            style={{ background: enabled ? '#22c55e' : '#d1d5db' }}>
            <div className="w-2.5 h-2.5 rounded-full bg-white absolute top-0.5 transition-all"
              style={{ left: enabled ? 15 : 2 }} />
          </button>
          <span className="text-[10px] font-bold text-gray-400 uppercase">Topic {index + 1}</span>
          {!enabled && <span className="text-[9px] text-gray-400 italic">Disabled</span>}
        </div>
        <button onClick={onRemove} className="text-[10px] text-red-400 hover:text-red-600">Remove</button>
      </div>
      <div className="flex gap-2">
        <div className="flex-1"><EInput value={t.label} onChange={v => onChange({ label: v })} placeholder="Topic label" /></div>
        <button onClick={generateWithAI} disabled={generating || !t.label.trim()}
          className="px-2.5 py-1.5 rounded-lg text-[10px] font-semibold text-white hover:opacity-90 disabled:opacity-50 flex-shrink-0"
          style={{ background: '#7c3aed' }}>
          {generating ? '...' : '\u2728 Generate'}
        </button>
      </div>
      <EInput value={t.description || ''} onChange={v => onChange({ description: v })} placeholder="Description (context for AI)" />
      <ETextarea value={t.opening_question} onChange={v => onChange({ opening_question: v })} placeholder="Opening question" rows={2} />
      <EInputCSV value={t.follow_up_angles || []} onChange={v => onChange({ follow_up_angles: v })} placeholder="Follow-up angles (comma-separated)" />
      {t.keywords?.length > 0 && (
        <div>
          <label className="text-[10px] font-semibold text-gray-500 block mb-1">Keywords</label>
          <div className="flex flex-wrap gap-1">
            {t.keywords.map(kw => (
              <span key={kw} className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-600 border border-purple-200 flex items-center gap-0.5">
                {kw}
                <button onClick={() => onChange({ keywords: t.keywords.filter(k => k !== kw) })} className="text-purple-300 hover:text-red-400">&times;</button>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-gray-400">Target:</span>
        <input type="number" min={5} max={500} value={t.response_target} onChange={e => onChange({ response_target: parseInt(e.target.value) || 30 })}
          className="w-20 px-2 py-1 rounded border border-gray-200 text-xs" />
      </div>
    </div>
  )
}

// ── Rich Theme Card (matches analytics style) ─────────────────────────────────
function ThemeCard({ theme: t, isActive, variant, onAction, loading, defaultResponseTarget }: {
  theme: TownHallTheme
  isActive: boolean
  variant: 'suggested' | 'active' | 'parked' | 'completed'
  onAction: (action: string, extras?: Record<string, unknown>) => void
  loading: boolean
  defaultResponseTarget?: number
}) {
  const sent = t.sentiment || 'neutral'
  const keywords = t.keywords || []
  const isSuggested = variant === 'suggested'
  const isParked = variant === 'parked'
  const isAI = t.source === 'auto_detected'
  const isCompleted = variant === 'completed'
  const [showApprove, setShowApprove] = useState(false)
  const [approveTarget, setApproveTarget] = useState(defaultResponseTarget || 30)

  return (
    <div className={`rounded-xl border overflow-hidden ${isSuggested ? 'border-orange-200 bg-white' : isParked ? 'border-blue-100 bg-white' : isCompleted ? 'border-gray-100 bg-gray-50/50' : 'border-gray-200 bg-white'}`}>
      {sent !== 'insufficient' && <div style={{ height: 3, background: SENT_COLOR[sent] || SENT_COLOR.neutral }} />}
      <div className="p-4">
        {/* Header row: donut + label + badges */}
        <div className="flex items-start gap-3">
          <CompletionDonut current={t.response_count} target={t.response_target} size={44} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-gray-800">{t.label}</span>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {sent !== 'insufficient' && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold capitalize"
                    style={{ background: SENT_BG[sent] || SENT_BG.neutral, color: SENT_COLOR[sent] || SENT_COLOR.neutral }}>
                    {sent}
                  </span>
                )}
                {isAI && <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-purple-100 text-purple-600">AI</span>}
                {t.source === 'custom' && <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500">Custom</span>}
                {t.state === 'paused' && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-amber-100 text-amber-600">Paused</span>}
              </div>
            </div>
            {t.description && <p className="text-xs text-gray-500 mt-0.5">{t.description}</p>}
            <span className="text-[10px] text-gray-400">{t.response_count} / {t.response_target} responses{t.mention_count > 0 ? ' \u00B7 ' + t.mention_count + ' mentions' : ''}</span>
          </div>
        </div>

        {/* Keywords */}
        {keywords.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {keywords.slice(0, 8).map(kw => (
              <span key={kw} className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{kw}</span>
            ))}
            {keywords.length > 8 && <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-50 text-gray-400">+{keywords.length - 8}</span>}
          </div>
        )}

        {/* Example quote */}
        {t.example_quote && (
          <div className="mt-2 pl-2 border-l-2 border-gray-200">
            <p className="text-xs text-gray-500 italic line-clamp-2">{'\u201C'}{t.example_quote.slice(0, 150)}{t.example_quote.length > 150 ? '...' : ''}{'\u201D'}</p>
          </div>
        )}

        {/* Action buttons */}
        {(isSuggested || isParked) && !showApprove && (
          <div className="flex gap-2 mt-3 pt-2 border-t border-gray-100">
            <button onClick={() => setShowApprove(true)} disabled={loading}
              className="text-[11px] font-semibold px-3 py-1.5 rounded-lg text-white hover:opacity-90 disabled:opacity-50" style={{ background: '#22c55e' }}>Approve</button>
            {isSuggested && (
              <button onClick={() => onAction('park')} disabled={loading}
                className="text-[11px] font-medium px-3 py-1.5 rounded-lg text-blue-600 hover:bg-blue-50 border border-blue-200 disabled:opacity-50">Park</button>
            )}
            <button onClick={() => onAction('dismiss')} disabled={loading}
              className="text-[11px] font-medium px-3 py-1.5 rounded-lg text-gray-500 hover:text-red-500 border border-gray-200 disabled:opacity-50">Dismiss</button>
          </div>
        )}
        {(isSuggested || isParked) && showApprove && (
          <div className="mt-3 pt-2 border-t border-gray-100 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500">Response target:</span>
              <input type="number" min={5} max={500} value={approveTarget}
                onChange={e => setApproveTarget(parseInt(e.target.value) || 30)}
                className="w-16 px-2 py-1 rounded-lg border border-gray-200 text-xs focus:outline-none focus:ring-2 focus:ring-green-200" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => { onAction('approve', { response_target: approveTarget }); setShowApprove(false) }} disabled={loading}
                className="text-[11px] font-semibold px-3 py-1.5 rounded-lg text-white hover:opacity-90 disabled:opacity-50" style={{ background: '#22c55e' }}>Confirm</button>
              <button onClick={() => setShowApprove(false)}
                className="text-[11px] font-medium px-3 py-1.5 rounded-lg text-gray-400 hover:text-gray-600">Cancel</button>
            </div>
          </div>
        )}
        {variant === 'active' && isActive && (
          <div className="flex gap-2 mt-3 pt-2 border-t border-gray-100">
            {t.state === 'active' && <button onClick={() => onAction('pause')} disabled={loading} className="text-[10px] text-gray-400 hover:text-gray-600 disabled:opacity-50">Pause</button>}
            {t.state === 'paused' && <button onClick={() => onAction('resume')} disabled={loading} className="text-[10px] text-orange-500 hover:text-orange-700 disabled:opacity-50">Resume</button>}
            <button onClick={() => onAction('close')} disabled={loading} className="text-[10px] text-gray-400 hover:text-red-500 disabled:opacity-50">Close</button>
          </div>
        )}
      </div>
    </div>
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

// ── Edit form helper components ──────────────────────────────────────────────


function ELabel({ children }: { children: React.ReactNode }) {
  return <label className="text-xs font-semibold text-gray-500 block mb-1">{children}</label>
}

function EInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input type="text" value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder}
    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200" />
}

function ETextarea({ value, onChange, rows, placeholder }: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  return <textarea value={value || ''} onChange={e => onChange(e.target.value)} rows={rows || 2} placeholder={placeholder}
    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 resize-none" />
}

function ENumber({ value, onChange, min, max }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return <input type="number" value={value} onChange={e => onChange(parseInt(e.target.value) || 0)} min={min} max={max}
    className="w-20 px-2 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200" />
}

// Comma-separated value input — only parses to array on blur, not on every keystroke (preserves spaces while typing)
function EInputCSV({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [raw, setRaw] = useState(value.join(', '))
  useEffect(() => { setRaw(value.join(', ')) }, [value.join(',')])
  return <input type="text" value={raw} onChange={e => setRaw(e.target.value)} placeholder={placeholder}
    onBlur={() => onChange(raw.split(',').map(s => s.trim()).filter(Boolean))}
    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200" />
}
