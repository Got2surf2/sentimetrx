'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
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

function buildTHConversationHtml(botName: string, botEmoji: string, gradient: string, pid: string, turns: any[]) {
  const esc = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${botName} Conversation</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px}
.wrap{width:100%;max-width:400px;height:min(90vh,750px);border-radius:24px;overflow:hidden;box-shadow:0 25px 50px rgba(0,0,0,.15);display:flex;flex-direction:column;background:#f8fafc}
.hdr{padding:14px 16px;display:flex;align-items:center;gap:12px;background:${gradient};flex-shrink:0}
.avatar{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.35);font-size:16px;flex-shrink:0}
.hdr-text{color:#fff;font-weight:600;font-size:14px}
.hdr-sub{color:rgba(255,255,255,.5);font-size:11px}
.brand{margin-left:auto;font-size:9px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;text-align:right;line-height:1.4}
.brand-sub{color:rgba(255,255,255,.4);font-size:8px;font-weight:400;text-transform:none;letter-spacing:0}
.footer a{color:#E8632A;text-decoration:none}
.footer a:hover{text-decoration:underline}
.chat{padding:16px;display:flex;flex-direction:column;gap:10px;flex:1;overflow-y:auto}
.row{display:flex;align-items:flex-end;gap:8px;max-width:85%}
.row.user{flex-direction:row-reverse;align-self:flex-end}
.row.bot{align-self:flex-start}
.sm-av{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;background:#00b4d820}
.bubble{padding:8px 12px;font-size:13px;line-height:1.5;border-radius:16px;white-space:pre-wrap;word-wrap:break-word}
.bot .bubble{background:#fff;color:#1e293b;border:1px solid #e2e8f0;border-bottom-left-radius:4px}
.user .bubble{background:#007AFF;color:#fff;border-bottom-right-radius:4px;font-weight:500}
.skip .bubble{background:#f9fafb;color:#9ca3af;font-style:italic;border-bottom-right-radius:4px;font-size:12px}
.footer{text-align:center;padding:10px;font-size:10px;color:#94a3b8;border-top:1px solid #e2e8f0;background:#fff;flex-shrink:0}
</style></head><body>
<div class="wrap">
<div class="hdr"><div class="avatar">${botEmoji}</div><div><div class="hdr-text">${botName}</div><div class="hdr-sub">${pid.slice(0, 12)}...</div></div><div class="brand"><span style="color:#E8632A">DATANAUTIX</span><br><span class="brand-sub">powered by</span></div></div>
<div class="chat">${turns.map((t: any) => { let o = ''; if (t.bot) o += '<div class="row bot"><div class="sm-av">' + botEmoji + '</div><div class="bubble">' + esc(t.bot) + '</div></div>'; if (t.user && !t.skipped) o += '<div class="row user"><div class="bubble">' + esc(t.user) + '</div></div>'; if (t.skipped) o += '<div class="row skip"><div class="bubble">' + esc(t.user || 'skipped') + '</div></div>'; return o }).join('')}</div>
<div class="footer"><a href="https://datanautix.com" target="_blank">datanautix.com</a></div>
</div></body></html>`
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
  const searchParams = useSearchParams()
  const initialTab = (['topics', 'responses', 'analytics'] as const).includes(searchParams.get('tab') as any) ? searchParams.get('tab') as 'topics' | 'responses' | 'analytics' : 'topics'
  const [activeTab, setActiveTab] = useState<'topics' | 'responses' | 'analytics'>(initialTab)
  const [selectedParticipant, setSelectedParticipant] = useState<string | null>(null)
  const [gridCols, setGridCols] = useState(2)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [participantList, setParticipantList] = useState<any[]>([])
  const [convModal, setConvModal] = useState<{ pid: string; turns: any[]; demographics?: any; psychographics?: any } | null>(null)
  const [convShareState, setConvShareState] = useState<'idle' | 'sharing' | 'copied'>('idle')
  const [jsonView, setJsonView] = useState(false)
  const [jsonCopied, setJsonCopied] = useState(false)

  // Participant selection for delete
  const [checkedPids, setCheckedPids] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [deleteToast, setDeleteToast] = useState<string | null>(null)
  const allPidsChecked = participantList.length > 0 && participantList.every(p => checkedPids.has(p.participant_id))
  const somePidsChecked = participantList.some(p => checkedPids.has(p.participant_id))
  const togglePid = (pid: string) => setCheckedPids(prev => { const next = new Set(prev); next.has(pid) ? next.delete(pid) : next.add(pid); return next })
  const toggleAllPids = () => setCheckedPids(allPidsChecked ? new Set() : new Set(participantList.map(p => p.participant_id)))
  const deleteSelectedPids = async () => {
    if (!somePidsChecked || deleting) return
    setDeleting(true)
    try {
      const res = await fetch('/api/townhall/sessions/' + sessionId, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delete_participants: Array.from(checkedPids) }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Delete failed')
      setCheckedPids(new Set())
      setDeleteToast('Deleted ' + (json.deleted ?? checkedPids.size) + ' conversation' + (json.deleted !== 1 ? 's' : ''))
      setTimeout(() => setDeleteToast(null), 3000)
      fetchData()
    } catch (e: any) {
      setDeleteToast('Error: ' + e.message)
      setTimeout(() => setDeleteToast(null), 4000)
    } finally { setDeleting(false) }
  }

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
  const [editName, setEditName] = useState('')
  const [editSlug, setEditSlug] = useState('')
  const [editConfig, setEditConfig] = useState<TownHallConfig | null>(null)
  const [editGuide, setEditGuide] = useState<TownHallGuideTopic[]>([])
  const [saving, setSaving] = useState(false)
  const [editStep, setEditStep] = useState(0)

  // Topic detail popup — store ID, look up from live themes for fresh data
  const [detailTopicId, setDetailTopicId] = useState<string | null>(null)
  const detailTopic = detailTopicId ? themes.find(t => t.id === detailTopicId) || null : null
  const setDetailTopic = (t: TownHallTheme | null) => {
    setDetailTopicId(t?.id || null)
    // Fetch full analytics (quotes, match reasons) on-demand when opening detail popup
    if (t) fetchData(true)
  }

  // Compact vs expanded view for topic sections
  const [compactView, setCompactView] = useState(false)
  // Group by status (Active/Parked/Completed/Dismissed) or by source (Active/Seed/Organic)
  const [viewMode, setViewMode] = useState<'status' | 'source'>('status')

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

  const fetchData = useCallback(async (analytics?: boolean) => {
    try {
      const url = '/api/townhall/sessions/' + sessionId + (analytics ? '?analytics=true' : '')
      const res = await fetch(url)
      if (!res.ok) return
      const data = await res.json()
      setSession(data.session)
      setThemes(data.themes || [])
      setStats(data.stats || null)
      if (data.participants) setParticipantList(data.participants)
    } catch {}
    setLoading(false)
  }, [sessionId])

  const sessionStatusRef = useRef(session?.status)
  sessionStatusRef.current = session?.status
  useEffect(() => {
    fetchData()
    const interval = setInterval(() => {
      if (document.hidden) return // tab not visible — skip polling
      const s = sessionStatusRef.current
      if (s && s !== 'active' && s !== 'paused' && s !== 'setup') return // ended — skip
      fetchData()
    }, 4000)
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

  // Separate themes into sections — by status
  const activeTopics = themes.filter(t => t.state === 'active')
  const pendingTopics = themes.filter(t => t.state === 'paused')
  const suggestedTopics = themes.filter(t => t.state === 'detected')
  const parkedTopics = themes.filter(t => t.state === 'parked')
  const completedTopics = themes.filter(t => t.state === 'completed')
  const dismissedTopics = themes.filter(t => t.state === 'dismissed')
  // By source
  const seedTopics = themes.filter(t => t.source === 'guide')
  const organicTopics = themes.filter(t => t.source === 'auto_detected')
  const customTopics = themes.filter(t => t.source === 'custom')
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
                <ELabel>Session Type</ELabel>
                <select value={editConfig.session_type || 'community'}
                  onChange={e => setEditConfig((c: any) => ({ ...c, session_type: e.target.value }))}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-300 mb-2">
                  <option value="community">Community (residents)</option>
                  <option value="employee">Employee (team members)</option>
                  <option value="customer">Customer (customers)</option>
                  <option value="student">Student (students)</option>
                  <option value="member">Member (members)</option>
                  <option value="other">Other (participants)</option>
                </select>
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

              {/* ── Step 1: Seed Topics ──────────────────────────────────────── */}
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
                <div className="mb-1">
                  <ExpandableTerms
                    terms={editConfig.context.sensitive_topics || []}
                    onChange={terms => updateContext({ sensitive_topics: terms })}
                    color="red"
                    context={editConfig.context.event_description}
                  />
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
                <ELabel>Organic Topic Discovery</ELabel>
                <p className="text-[10px] text-gray-400 mb-2">AI scans participant responses to find organic topics that emerge from the conversation.</p>
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
                  <span className="text-[10px] font-bold text-gray-400 uppercase">Seed Topics ({editGuide.length})</span>
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
            {(['topics', 'responses', 'analytics'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-all capitalize"
                style={{ background: activeTab === tab ? 'white' : 'transparent', color: activeTab === tab ? HERMES : '#6b7280', boxShadow: activeTab === tab ? '0 1px 3px rgba(0,0,0,0.08)' : 'none' }}>
                {tab}
              </button>
            ))}
          </div>
        )}

        {/* ── RESPONSES TAB ─────────────────────────────────────────── */}
        {!editing && activeTab === 'responses' && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* Selection bar */}
            {somePidsChecked && (
              <div className="flex items-center gap-3 px-4 py-2 text-xs font-semibold" style={{ background: '#FFF4EF', borderBottom: '1px solid #FBD5C2', color: HERMES }}>
                <span>{checkedPids.size} conversation{checkedPids.size !== 1 ? 's' : ''} selected</span>
                <button onClick={deleteSelectedPids} disabled={deleting}
                  className="px-3 py-1 rounded-lg text-white text-xs font-semibold transition-all"
                  style={{ background: deleting ? '#ccc' : '#dc2626' }}>
                  {deleting ? 'Deleting...' : 'Delete selected'}
                </button>
                <button onClick={() => setCheckedPids(new Set())} className="text-xs text-gray-500 hover:text-gray-700 ml-auto">Clear selection</button>
              </div>
            )}
            {/* Delete toast */}
            {deleteToast && (
              <div className={'px-4 py-2 text-xs font-semibold text-center ' + (deleteToast.startsWith('Error') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700')}>
                {deleteToast}
              </div>
            )}
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <th className="px-3 py-2.5 w-8">
                    <button type="button" onClick={toggleAllPids}
                      className={"w-4 h-4 rounded border-2 flex items-center justify-center transition-all " + (allPidsChecked ? "bg-orange-500 border-orange-500" : "bg-white border-gray-300 hover:border-orange-400")}>
                      {allPidsChecked && <span className="text-white text-[9px] font-bold leading-none">{'\u2713'}</span>}
                    </button>
                  </th>
                  <th className="px-4 py-2.5 text-left w-8"></th>
                  <th className="px-4 py-2.5 text-left">Date/Time</th>
                  <th className="px-4 py-2.5 text-left">Participant</th>
                  <th className="px-4 py-2.5 text-center">Turns</th>
                  <th className="px-4 py-2.5 text-center">Answered</th>
                  <th className="px-4 py-2.5 text-center">Topics</th>
                  <th className="px-4 py-2.5 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {participantList.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400 text-xs">No participants yet</td></tr>
                )}
                {[...participantList].sort((a, b) => {
                  const ta = a.last_activity || a.started_at || ''
                  const tb = b.last_activity || b.started_at || ''
                  return tb.localeCompare(ta)
                }).map((p, i) => (
                  <tr key={p.participant_id} className={"border-t border-gray-50 hover:bg-gray-50/50 " + (checkedPids.has(p.participant_id) ? "bg-orange-50/60" : "")}>
                    <td className="px-3 py-2.5" onClick={e => { e.stopPropagation(); togglePid(p.participant_id) }}>
                      <button type="button"
                        className={"w-4 h-4 rounded border-2 flex items-center justify-center transition-all " + (checkedPids.has(p.participant_id) ? "bg-orange-500 border-orange-500" : "bg-white border-gray-300 hover:border-orange-400")}>
                        {checkedPids.has(p.participant_id) && <span className="text-white text-[9px] font-bold leading-none">{'\u2713'}</span>}
                      </button>
                    </td>
                    <td className="px-4 py-2.5">
                      <button onClick={async () => {
                        try {
                          const res = await fetch('/api/townhall/sessions/' + sessionId + '/export?format=json')
                          const data = await res.json()
                          const conv = data.conversations?.find((c: any) => c.participant_id === p.participant_id)
                          if (conv) setConvModal({ pid: p.participant_id, turns: conv.turns, demographics: conv.demographics, psychographics: conv.psychographics })
                        } catch {}
                      }} title="View conversation"
                        className={'w-6 h-6 rounded-full flex items-center justify-center transition-all ' + (p.is_complete ? 'hover:bg-green-100' : 'hover:bg-orange-100')}
                        style={{ color: p.is_complete ? '#16a34a' : HERMES }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">{p.started_at ? new Date(p.started_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 font-mono">{p.participant_id.slice(0, 12)}...</td>
                    <td className="px-4 py-2.5 text-center text-xs text-gray-600">{p.turns}</td>
                    <td className="px-4 py-2.5 text-center text-xs text-gray-600">{p.answered}</td>
                    <td className="px-4 py-2.5 text-center text-xs text-gray-600">{p.topics}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={'text-[10px] px-2 py-0.5 rounded-full font-medium ' + (p.is_complete ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700')}>
                        {p.is_complete ? 'complete' : 'in progress'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Conversation modal */}
        {convModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setConvModal(null)}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-shrink-0">
                <div>
                  <span className="text-sm font-bold text-gray-700">Conversation</span>
                  <span className="text-xs text-gray-400 ml-2 font-mono">{convModal.pid.slice(0, 12)}...</span>
                </div>
                <button onClick={() => { setConvModal(null); setConvShareState('idle') }} className="text-gray-400 hover:text-gray-600 text-lg">&times;</button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
                {convModal.turns.map((t: any, i: number) => (
                  <div key={i}>
                    {t.bot && (
                      <div className="flex gap-2 mb-1">
                        <span className="text-lg flex-shrink-0">{cfg?.bot_emoji || '\uD83D\uDCAC'}</span>
                        <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-3 py-2 text-sm text-gray-700 max-w-[85%]" style={{ whiteSpace: 'pre-wrap' }}>{t.bot}</div>
                      </div>
                    )}
                    {t.user && !t.skipped && (
                      <div className="flex justify-end mb-1">
                        <div className="rounded-2xl rounded-tr-sm px-3 py-2 text-sm text-white max-w-[85%]" style={{ background: '#007AFF', whiteSpace: 'pre-wrap' }}>{t.user}</div>
                      </div>
                    )}
                    {t.skipped && (
                      <div className="flex justify-end mb-1">
                        <div className="rounded-2xl rounded-tr-sm px-3 py-2 text-xs text-gray-400 italic bg-gray-50 max-w-[85%]">{t.user || 'skipped'}</div>
                      </div>
                    )}
                  </div>
                ))}
                {/* Participant ended flag */}
                {convModal.turns.some((t: any) => t.user?.includes('[Done') || t.user?.includes('[done]')) && (
                  <div className="flex justify-center mt-2">
                    <span className="text-[10px] px-3 py-1 rounded-full bg-blue-50 text-blue-600 font-medium">Participant chose to end conversation</span>
                  </div>
                )}
              </div>

              {/* Footer: Share + Download + JSON + PPTX */}
              <div className="flex items-center gap-2 px-5 py-3 border-t border-gray-100 flex-shrink-0">
                <button onClick={async () => {
                  setConvShareState('sharing')
                  const botName = cfg?.bot_name || 'Town Hall'
                  const botEmoji = cfg?.bot_emoji || '\uD83D\uDCAC'
                  const gradient = cfg?.theme?.headerGradient || cfg?.theme?.primaryColor || 'linear-gradient(135deg, #00b4d8, #0077a8)'
                  const html = buildTHConversationHtml(botName, botEmoji, gradient, convModal!.pid, convModal!.turns)
                  try {
                    const res = await fetch('/api/share', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'conversation', target_id: sessionId, html, expires_in: '30d' }) })
                    const data = await res.json()
                    if (data.url) { await navigator.clipboard.writeText(data.url); setConvShareState('copied'); setTimeout(() => setConvShareState('idle'), 3000) }
                    else setConvShareState('idle')
                  } catch { setConvShareState('idle') }
                }} disabled={convShareState === 'sharing'}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
                  style={{ background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}>
                  {convShareState === 'sharing' ? 'Creating...' : convShareState === 'copied' ? 'Link copied!' : 'Share'}
                </button>
                <button onClick={() => {
                  const botName = cfg?.bot_name || 'Town Hall'
                  const botEmoji = cfg?.bot_emoji || '\uD83D\uDCAC'
                  const gradient = cfg?.theme?.headerGradient || cfg?.theme?.primaryColor || 'linear-gradient(135deg, #00b4d8, #0077a8)'
                  const html = buildTHConversationHtml(botName, botEmoji, gradient, convModal!.pid, convModal!.turns)
                  const blob = new Blob([html], { type: 'text/html' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a'); a.href = url; a.download = botName.replace(/[^a-zA-Z0-9 ]/g, '') + ' conversation.html'; a.click(); URL.revokeObjectURL(url)
                }}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
                  style={{ background: '#fff4ef', color: HERMES, border: '1px solid #fbd5c2' }}>
                  Download
                </button>
                <button onClick={() => { setJsonView(true); setJsonCopied(false) }}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
                  style={{ background: '#f0f9ff', color: '#0284c7', border: '1px solid #bae6fd' }}>
                  View JSON
                </button>
                <button onClick={() => {
                  const a = document.createElement('a')
                  a.href = '/api/townhall/sessions/' + sessionId + '/export/pptx?participant=' + convModal.pid
                  a.download = 'conversation.pptx'
                  a.click()
                }}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
                  style={{ background: '#fff4ef', color: HERMES, border: '1px solid #fbd5c2' }}>
                  Download PPTX
                </button>
              </div>

              {/* JSON view overlay */}
              {jsonView && (
                <div className="absolute inset-0 bg-white flex flex-col rounded-2xl">
                  <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-shrink-0">
                    <span className="text-sm font-bold text-gray-700">Conversation JSON</span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => {
                        const json = JSON.stringify({ participant_id: convModal.pid, session_id: sessionId, session_name: session?.name, turns: convModal.turns, demographics: convModal.demographics, psychographics: convModal.psychographics }, null, 2)
                        navigator.clipboard.writeText(json)
                        setJsonCopied(true); setTimeout(() => setJsonCopied(false), 2000)
                      }}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg"
                        style={{ background: jsonCopied ? '#dcfce7' : '#f0f9ff', color: jsonCopied ? '#16a34a' : '#0284c7', border: '1px solid ' + (jsonCopied ? '#bbf7d0' : '#bae6fd') }}>
                        {jsonCopied ? '\u2713 Copied!' : 'Copy'}
                      </button>
                      <button onClick={() => setJsonView(false)} className="text-gray-400 hover:text-gray-600 text-lg">&times;</button>
                    </div>
                  </div>
                  <pre className="flex-1 overflow-auto px-5 py-3 text-[11px] text-gray-600 font-mono whitespace-pre-wrap bg-gray-50">
                    {JSON.stringify({ participant_id: convModal.pid, session_id: sessionId, session_name: session?.name, turns: convModal.turns, demographics: convModal.demographics, psychographics: convModal.psychographics }, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── ANALYTICS TAB ────────────────────────────────────────── */}
        {!editing && activeTab === 'analytics' && (
          <TownHallAnalyticsPanel sessionId={sessionId} />
        )}

        {/* ── TOPICS TAB (main content) ────────────────────────────── */}
        {!editing && activeTab === 'topics' && (
          <div className="space-y-4">
            {/* Top bar: Opening message + QR + Live link — full width */}
            <div className="flex gap-4 items-stretch">
              {/* Opening message (stretches to fill) */}
              <div className="flex-1 min-w-0">
                {(cfg?.opening_message || cfg?.opening_question) && (
                  <div className="bg-white rounded-xl border border-gray-200 p-4 h-full">
                    <span className="text-[10px] font-bold text-gray-400 uppercase">Opening Message</span>
                    <p className="text-sm text-gray-600 mt-1 italic whitespace-pre-wrap">"{cfg.opening_message || cfg.opening_question}"</p>
                  </div>
                )}
              </div>
              {/* QR + Live link (compact right side) */}
              <div className="flex items-center gap-4 flex-shrink-0">
                {(isSetup || isActive) && (
                  <div className="text-center">
                    <img
                      src={'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(participantUrl) + '&margin=8'}
                      alt="QR code" className="rounded-lg border border-gray-200" style={{ width: 160, height: 160 }} />
                    <p className="text-[10px] text-gray-400 mt-1">Scan to join</p>
                  </div>
                )}
                <a href={'/th/' + sessionId + '/live'} target="_blank" rel="noopener noreferrer"
                  className="rounded-lg text-center hover:bg-gray-100 transition-colors flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 self-start">
                  <span className="text-[11px] font-semibold text-gray-600">Live Screen</span>
                  <span className="text-[10px] text-gray-400">&rarr;</span>
                </a>
              </div>
            </div>

            {/* Full-width topics area */}
            <div className="space-y-4">

              {/* Controls: Grid size + View mode + Compact toggle */}
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-gray-400 mr-1">Grid:</span>
                  {[1, 2, 3, 4].map(n => (
                    <button key={n} onClick={() => setGridCols(n)}
                      className="text-[10px] px-2 py-1 rounded-lg font-semibold transition-all"
                      style={{ background: gridCols === n ? '#fff4ef' : '#f9fafb', border: '1px solid ' + (gridCols === n ? '#E8632A' : '#e5e7eb'), color: gridCols === n ? '#E8632A' : '#6b7280' }}>
                      {n}
                    </button>
                  ))}
                </div>
                {!isSetup && themes.length > 0 && (
                  <>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-gray-400 mr-1">View:</span>
                      <button onClick={() => setViewMode('status')}
                        className="text-[10px] px-2 py-1 rounded-lg font-semibold transition-all"
                        style={{ background: viewMode === 'status' ? '#fff4ef' : '#f9fafb', border: '1px solid ' + (viewMode === 'status' ? '#E8632A' : '#e5e7eb'), color: viewMode === 'status' ? '#E8632A' : '#6b7280' }}>
                        By Status
                      </button>
                      <button onClick={() => setViewMode('source')}
                        className="text-[10px] px-2 py-1 rounded-lg font-semibold transition-all"
                        style={{ background: viewMode === 'source' ? '#fff4ef' : '#f9fafb', border: '1px solid ' + (viewMode === 'source' ? '#E8632A' : '#e5e7eb'), color: viewMode === 'source' ? '#E8632A' : '#6b7280' }}>
                        By Source
                      </button>
                    </div>
                    <button onClick={() => setCompactView(v => !v)}
                      className="text-[10px] font-medium px-2 py-1 rounded-lg border border-gray-200 text-gray-500 hover:text-gray-700 hover:border-gray-300">
                      {compactView ? 'Expanded' : 'Compact'}
                    </button>
                  </>
                )}
              </div>

              {/* ── TOPIC SECTIONS ── */}
              {viewMode === 'status' && (<>

              {/* ── ORGANIC TOPICS (sorted by mentions, pill nav, scrollable cards) ── */}
              {!isSetup && suggestedTopics.length > 0 && (function() {
                const sorted = [...suggestedTopics].sort((a, b) => (b.mention_count || b.match_count || 0) - (a.mention_count || a.match_count || 0))
                return (
                <div className="rounded-xl border-2 border-orange-300 p-5" style={{ background: '#fffaf5' }}>
                  {/* Header + pill nav */}
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-orange-400 animate-pulse" />
                    <h3 className="text-sm font-bold text-orange-600">Organic Topics</h3>
                    <span className="text-[10px] bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full font-bold">{sorted.length} new</span>
                  </div>
                  {/* Sortable pill nav — click to open detail popup, sentiment-colored dot */}
                  <div className="flex flex-wrap gap-1.5 mb-3 pb-3 border-b border-orange-200">
                    {sorted.map((t, i) => {
                      const pillSent = t.sentiment || 'neutral'
                      const sentDot = SENT_COLOR[pillSent] || SENT_COLOR.neutral
                      return (
                        <button key={t.id} onClick={() => setDetailTopic(t)}
                          className="text-[11px] font-semibold px-3 py-1 rounded-full transition-all hover:shadow-sm cursor-pointer inline-flex items-center gap-1.5"
                          style={{ background: i === 0 ? '#ea580c' : i < 3 ? '#f97316' : '#fb923c', color: 'white', opacity: Math.max(0.6, 1 - i * 0.08) }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: sentDot, border: '1px solid rgba(255,255,255,0.5)', flexShrink: 0 }} />
                          {t.label} <span className="text-[9px] opacity-80">({t.mention_count || t.match_count || 0})</span>
                        </button>
                      )
                    })}
                  </div>
                  {/* Scrollable cards */}
                  <div style={{ maxHeight: 420, overflowY: 'auto', paddingRight: 4 }}>
                    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(' + gridCols + ', 1fr)' }}>
                      {sorted.map(t => (
                        <ThemeCard key={t.id} theme={t} isActive={isActive} variant="suggested"
                          onAction={(action, extras) => handleThemeAction(t.id, action, extras)} loading={actionLoading === t.id}
                          defaultResponseTarget={defaultResponseTarget} expectedAttendees={cfg?.expected_attendees} onDetailClick={() => setDetailTopic(t)} />
                      ))}
                    </div>
                  </div>
                </div>
                )
              })()}

              {/* ── Topic Detail Popup (works for any topic type) ── */}
              {detailTopic && (function() {
                const isOrganic = detailTopic.source === 'auto_detected'
                const isSeed = detailTopic.source === 'guide'
                const isCustom = detailTopic.source === 'custom'
                const topicState = detailTopic.state || 'detected'
                const quotes = detailTopic.example_quotes && detailTopic.example_quotes.length > 0
                  ? detailTopic.example_quotes
                  : detailTopic.example_quote ? [detailTopic.example_quote] : []
                const mentionCount = detailTopic.mention_count || detailTopic.match_count || detailTopic.response_count || 0

                return (
                <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  onClick={() => setDetailTopic(null)}>
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} />
                  <div onClick={e => e.stopPropagation()}
                    style={{ position: 'relative', background: 'white', borderRadius: 16, width: '90%', maxWidth: 640, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px rgba(0,0,0,.25)' }}>
                    {/* Header */}
                    <div className="p-5 border-b border-gray-100 flex-shrink-0">
                      <div className="flex items-center justify-between mb-2">
                        <h2 className="text-lg font-bold text-gray-900">{detailTopic.label}</h2>
                        <button onClick={() => setDetailTopic(null)} className="text-gray-400 hover:text-gray-600 text-lg">&times;</button>
                      </div>
                      {detailTopic.description && (
                        <p className="text-sm text-gray-500 mb-3">{detailTopic.description}</p>
                      )}
                      <div className="flex flex-wrap gap-2 mb-3">
                        {(detailTopic.sentiment && detailTopic.sentiment !== 'insufficient') && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold capitalize"
                            style={{ background: SENT_BG[detailTopic.sentiment] || SENT_BG.neutral, color: SENT_COLOR[detailTopic.sentiment] || SENT_COLOR.neutral }}>
                            {detailTopic.sentiment}
                          </span>
                        )}
                        {isOrganic && <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-600">Organic</span>}
                        {isSeed && <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-blue-100 text-blue-600">Seed</span>}
                        {isCustom && <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-gray-100 text-gray-500">Custom</span>}
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500">
                          {mentionCount} {isSeed ? 'responses' : 'mentions'}{detailTopic.response_target ? ` / ${detailTopic.response_target}` : ''} · {detailTopic.percentage ?? 0}% of responses
                        </span>
                      </div>
                      {/* Keywords with frequency */}
                      {(detailTopic.top_keywords || detailTopic.keywords || []).length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {(detailTopic.top_keywords || []).map((kw: any) => (
                            <span key={kw.word} className="text-[10px] px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 font-medium border border-orange-200">
                              {kw.word} <span className="text-orange-400">({kw.count})</span>
                            </span>
                          ))}
                          {!detailTopic.top_keywords && (detailTopic.keywords || []).slice(0, 10).map(kw => (
                            <span key={kw} className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{kw}</span>
                          ))}
                        </div>
                      )}
                      {/* Context-appropriate action buttons */}
                      <div className="flex gap-2 mt-3">
                        {topicState === 'detected' && <>
                          <button onClick={() => { handleThemeAction(detailTopic.id, 'approve', { response_target: defaultResponseTarget }); setDetailTopic(null) }}
                            className="text-[11px] font-semibold px-4 py-1.5 rounded-lg text-white hover:opacity-90" style={{ background: '#22c55e' }}>Approve</button>
                          <button onClick={() => { handleThemeAction(detailTopic.id, 'park'); setDetailTopic(null) }}
                            className="text-[11px] font-medium px-3 py-1.5 rounded-lg text-blue-600 hover:bg-blue-50 border border-blue-200">Park</button>
                          <button onClick={() => { handleThemeAction(detailTopic.id, 'dismiss'); setDetailTopic(null) }}
                            className="text-[11px] font-medium px-3 py-1.5 rounded-lg text-gray-500 hover:text-red-500 border border-gray-200">Dismiss</button>
                        </>}
                        {topicState === 'active' && <>
                          <button onClick={() => { handleThemeAction(detailTopic.id, 'close'); setDetailTopic(null) }}
                            className="text-[11px] font-medium px-3 py-1.5 rounded-lg text-blue-600 hover:bg-blue-50 border border-blue-200">Close</button>
                          <button onClick={() => { handleThemeAction(detailTopic.id, 'park'); setDetailTopic(null) }}
                            className="text-[11px] font-medium px-3 py-1.5 rounded-lg text-amber-600 hover:bg-amber-50 border border-amber-200">Park</button>
                        </>}
                        {topicState === 'parked' && <>
                          <button onClick={() => { handleThemeAction(detailTopic.id, 'activate'); setDetailTopic(null) }}
                            className="text-[11px] font-semibold px-4 py-1.5 rounded-lg text-white hover:opacity-90" style={{ background: '#22c55e' }}>Activate</button>
                          <button onClick={() => { handleThemeAction(detailTopic.id, 'dismiss'); setDetailTopic(null) }}
                            className="text-[11px] font-medium px-3 py-1.5 rounded-lg text-gray-500 hover:text-red-500 border border-gray-200">Dismiss</button>
                        </>}
                        {topicState === 'completed' && <>
                          <button onClick={() => { handleThemeAction(detailTopic.id, 'reopen'); setDetailTopic(null) }}
                            className="text-[11px] font-semibold px-4 py-1.5 rounded-lg text-white hover:opacity-90" style={{ background: '#22c55e' }}>Reopen</button>
                        </>}
                        {topicState === 'dismissed' && <>
                          <button onClick={() => { handleThemeAction(detailTopic.id, 'undismiss'); setDetailTopic(null) }}
                            className="text-[11px] font-semibold px-4 py-1.5 rounded-lg text-white hover:opacity-90" style={{ background: '#22c55e' }}>Restore</button>
                        </>}
                      </div>
                    </div>
                    {/* Scrollable comments with match reason */}
                    <div className="flex-1 overflow-y-auto p-5">
                      <h3 className="text-xs font-bold text-gray-500 uppercase mb-3">
                        Matching Responses ({mentionCount})
                        {quotes.length > 0 && quotes.length < mentionCount ? <span className="text-gray-400 font-normal ml-1">· showing {quotes.length}</span> : null}
                      </h3>
                      {(() => {
                        // Use quote_matches if available (has match reason), fall back to plain quotes
                        const qm = (detailTopic as any).quote_matches as { text: string; match: string }[] | undefined
                        if (qm && qm.length > 0) {
                          return (
                            <div className="space-y-2">
                              {qm.map((q, i) => (
                                <div key={i} className="border border-gray-100 rounded-lg p-3 bg-gray-50/50">
                                  <div className="text-sm text-gray-700 leading-relaxed">
                                    <span className="text-gray-400 mr-1">{i + 1}.</span> {q.text}
                                  </div>
                                  <div className="mt-1">
                                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${q.match === 'AI-assigned' ? 'bg-purple-100 text-purple-600' : 'bg-amber-100 text-amber-600'}`}>
                                      {q.match}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )
                        }
                        if (quotes.length > 0) {
                          return (
                            <div className="space-y-2">
                              {quotes.map((q: string, i: number) => (
                                <div key={i} className="border border-gray-100 rounded-lg p-3 text-sm text-gray-700 leading-relaxed bg-gray-50/50">
                                  <span className="text-gray-400 mr-1">{i + 1}.</span> {q}
                                </div>
                              ))}
                            </div>
                          )
                        }
                        return <p className="text-sm text-gray-400 italic">No matching responses yet</p>
                      })()}
                    </div>
                  </div>
                </div>
                )
              })()}

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
                      <p className="text-xs text-gray-400">No active topics. Enable seed topics or click Edit.</p>
                    )}
                  </div>
                ) : activeTopics.length > 0 ? (
                  compactView ? (
                    <div className="flex flex-wrap gap-1.5">
                      {activeTopics.map(t => {
                        const s = t.sentiment || 'neutral'
                        return (
                          <button key={t.id} onClick={() => setDetailTopic(t)}
                            className="text-[11px] font-semibold px-3 py-1.5 rounded-full bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 inline-flex items-center gap-1.5 transition-colors">
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: SENT_COLOR[s] || SENT_COLOR.neutral, flexShrink: 0 }} />
                            {t.label}
                            <span className="text-[9px] text-green-400">{t.response_count}/{t.response_target}</span>
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                  <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(' + gridCols + ', 1fr)' }}>
                    {activeTopics.map(t => (
                      <ThemeCard key={t.id} theme={t} isActive={isActive} variant="active"
                        onAction={(action) => handleThemeAction(t.id, action)} loading={actionLoading === t.id} expectedAttendees={cfg?.expected_attendees}
                        onDetailClick={() => setDetailTopic(t)} />
                    ))}
                  </div>
                  )
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
                  {compactView ? (
                    <div className="flex flex-wrap gap-1.5">
                      {parkedTopics.map(t => (
                        <button key={t.id} onClick={() => setDetailTopic(t)}
                          className="text-[11px] font-semibold px-3 py-1.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 inline-flex items-center gap-1.5">
                          {t.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                  <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(' + gridCols + ', 1fr)' }}>
                    {parkedTopics.map(t => (
                      <ThemeCard key={t.id} theme={t} isActive={isActive} variant="parked"
                        onAction={(action, extras) => handleThemeAction(t.id, action, extras)} loading={actionLoading === t.id}
                        defaultResponseTarget={defaultResponseTarget} expectedAttendees={cfg?.expected_attendees}
                        onDetailClick={() => setDetailTopic(t)} />
                    ))}
                  </div>
                  )}
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
                  {compactView ? (
                    <div className="flex flex-wrap gap-1.5">
                      {pendingTopics.map(t => (
                        <button key={t.id} onClick={() => setDetailTopic(t)}
                          className="text-[11px] font-semibold px-3 py-1.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200 hover:bg-amber-100 inline-flex items-center gap-1.5">
                          {t.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                  <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(' + gridCols + ', 1fr)' }}>
                    {pendingTopics.map(t => (
                      <ThemeCard key={t.id} theme={t} isActive={isActive} variant="active"
                        onAction={(action) => handleThemeAction(t.id, action)} loading={actionLoading === t.id} expectedAttendees={cfg?.expected_attendees}
                        onDetailClick={() => setDetailTopic(t)} />
                    ))}
                  </div>
                  )}
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
                  {compactView ? (
                    <div className="flex flex-wrap gap-1.5">
                      {completedTopics.map(t => (
                        <button key={t.id} onClick={() => setDetailTopic(t)}
                          className="text-[11px] font-semibold px-3 py-1.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 inline-flex items-center gap-1.5">
                          {t.label}
                          <span className="text-[9px] text-blue-400">{t.response_count}/{t.response_target}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                  <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(' + gridCols + ', 1fr)' }}>
                    {completedTopics.map(t => (
                      <ThemeCard key={t.id} theme={t} isActive={isActive} variant="completed"
                        onAction={(action, extras) => handleThemeAction(t.id, action, extras)} loading={actionLoading === t.id}
                        defaultResponseTarget={defaultResponseTarget} expectedAttendees={cfg?.expected_attendees}
                        onDetailClick={() => setDetailTopic(t)} />
                    ))}
                  </div>
                  )}
                </div>
              )}

              {/* ── DISMISSED ──────────────────────────────── */}
              {dismissedTopics.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-100 p-5 opacity-60 hover:opacity-100 transition-opacity">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full bg-gray-300" />
                    <h3 className="text-sm font-bold text-gray-400">Dismissed</h3>
                    <span className="text-[10px] text-gray-300">{dismissedTopics.length}</span>
                  </div>
                  {compactView ? (
                    <div className="flex flex-wrap gap-1.5">
                      {dismissedTopics.map(t => (
                        <button key={t.id} onClick={() => setDetailTopic(t)}
                          className="text-[11px] font-medium px-3 py-1.5 rounded-full bg-gray-50 text-gray-400 border border-gray-200 hover:bg-gray-100 inline-flex items-center gap-1.5">
                          {t.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                  <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(' + gridCols + ', 1fr)' }}>
                    {dismissedTopics.map(t => (
                      <ThemeCard key={t.id} theme={t} isActive={isActive} variant="dismissed"
                        onAction={(action, extras) => handleThemeAction(t.id, action, extras)} loading={actionLoading === t.id}
                        defaultResponseTarget={defaultResponseTarget} expectedAttendees={cfg?.expected_attendees}
                        onDetailClick={() => setDetailTopic(t)} />
                    ))}
                  </div>
                  )}
                </div>
              )}

              </>)}

              {/* ── SOURCE VIEW ── */}
              {viewMode === 'source' && !isSetup && (<>
                {/* Active (any source) */}
                <div className="bg-white rounded-xl border border-green-200 p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                    <h3 className="text-sm font-bold text-green-700">Active</h3>
                    <span className="text-[10px] text-gray-400">{activeTopics.length}</span>
                  </div>
                  {activeTopics.length > 0 ? (
                    compactView ? (
                      <div className="flex flex-wrap gap-1.5">
                        {activeTopics.map(t => {
                          const s = t.sentiment || 'neutral'
                          const targetReached = t.response_count >= t.response_target
                          return (
                            <button key={t.id} onClick={() => setDetailTopic(t)}
                              className="text-[11px] font-semibold px-3 py-1.5 rounded-full bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 inline-flex items-center gap-1.5 transition-colors">
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: SENT_COLOR[s] || SENT_COLOR.neutral, flexShrink: 0 }} />
                              {t.label}
                              <span className="text-[9px] text-green-400">{t.response_count}/{t.response_target}</span>
                              {targetReached && <span className="text-[9px]">✓</span>}
                              <span className={`text-[8px] px-1 rounded ${t.source === 'guide' ? 'bg-blue-100 text-blue-500' : t.source === 'auto_detected' ? 'bg-emerald-100 text-emerald-500' : 'bg-gray-100 text-gray-400'}`}>
                                {t.source === 'guide' ? 'S' : t.source === 'auto_detected' ? 'O' : 'C'}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(' + gridCols + ', 1fr)' }}>
                        {activeTopics.map(t => (
                          <ThemeCard key={t.id} theme={t} isActive={isActive} variant="active"
                            onAction={(action) => handleThemeAction(t.id, action)} loading={actionLoading === t.id} expectedAttendees={cfg?.expected_attendees}
                            onDetailClick={() => setDetailTopic(t)} />
                        ))}
                      </div>
                    )
                  ) : (
                    <p className="text-xs text-gray-400">No active topics.</p>
                  )}
                </div>

                {/* Seed Topics (all guide-sourced, grouped by state) */}
                {seedTopics.length > 0 && (
                  <div className="bg-white rounded-xl border border-blue-200 p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-2 h-2 rounded-full bg-blue-500" />
                      <h3 className="text-sm font-bold text-blue-700">Seed Topics</h3>
                      <span className="text-[10px] text-blue-400">{seedTopics.length}</span>
                    </div>
                    {compactView ? (
                      <div className="flex flex-wrap gap-1.5">
                        {seedTopics.map(t => {
                          const targetReached = t.response_count >= t.response_target
                          return (
                            <button key={t.id} onClick={() => setDetailTopic(t)}
                              className="text-[11px] font-semibold px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 inline-flex items-center gap-1.5 transition-colors">
                              {t.label}
                              <span className="text-[9px] text-blue-400">{t.response_count}/{t.response_target}</span>
                              {targetReached && <span className="text-[9px]">✓</span>}
                              <span className={`text-[8px] px-1 rounded ${
                                t.state === 'active' ? 'bg-green-100 text-green-600' :
                                t.state === 'completed' ? 'bg-blue-100 text-blue-600' :
                                t.state === 'parked' ? 'bg-amber-100 text-amber-600' :
                                t.state === 'paused' ? 'bg-amber-100 text-amber-500' :
                                t.state === 'dismissed' ? 'bg-gray-100 text-gray-400' :
                                'bg-gray-100 text-gray-400'
                              }`}>{t.state}</span>
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(' + gridCols + ', 1fr)' }}>
                        {seedTopics.map(t => (
                          <ThemeCard key={t.id} theme={t} isActive={isActive}
                            variant={t.state === 'completed' ? 'completed' : t.state === 'dismissed' ? 'dismissed' : t.state === 'parked' ? 'parked' : 'active'}
                            onAction={(action, extras) => handleThemeAction(t.id, action, extras)} loading={actionLoading === t.id}
                            defaultResponseTarget={defaultResponseTarget} expectedAttendees={cfg?.expected_attendees}
                            onDetailClick={() => setDetailTopic(t)} />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Organic Topics (all auto_detected, grouped by state) */}
                {organicTopics.length > 0 && (
                  <div className="rounded-xl border-2 border-emerald-200 p-5" style={{ background: '#f0fdf4' }}>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                      <h3 className="text-sm font-bold text-emerald-600">Organic Topics</h3>
                      <span className="text-[10px] bg-emerald-100 text-emerald-600 px-2 py-0.5 rounded-full font-bold">{organicTopics.length}</span>
                    </div>
                    {compactView ? (
                      <div className="flex flex-wrap gap-1.5">
                        {organicTopics.sort((a, b) => (b.mention_count || 0) - (a.mention_count || 0)).map(t => {
                          const s = t.sentiment || 'neutral'
                          return (
                            <button key={t.id} onClick={() => setDetailTopic(t)}
                              className="text-[11px] font-semibold px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 inline-flex items-center gap-1.5 transition-colors">
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: SENT_COLOR[s] || SENT_COLOR.neutral, flexShrink: 0 }} />
                              {t.label}
                              <span className="text-[9px] text-emerald-400">{t.mention_count || t.response_count || 0}</span>
                              <span className={`text-[8px] px-1 rounded ${
                                t.state === 'active' ? 'bg-green-100 text-green-600' :
                                t.state === 'detected' ? 'bg-orange-100 text-orange-600' :
                                t.state === 'parked' ? 'bg-amber-100 text-amber-600' :
                                t.state === 'dismissed' ? 'bg-gray-100 text-gray-400' :
                                'bg-gray-100 text-gray-400'
                              }`}>{t.state === 'detected' ? 'new' : t.state}</span>
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(' + gridCols + ', 1fr)' }}>
                        {organicTopics.sort((a, b) => (b.mention_count || 0) - (a.mention_count || 0)).map(t => (
                          <ThemeCard key={t.id} theme={t} isActive={isActive}
                            variant={t.state === 'detected' ? 'suggested' : t.state === 'dismissed' ? 'dismissed' : t.state === 'parked' ? 'parked' : t.state === 'completed' ? 'completed' : 'active'}
                            onAction={(action, extras) => handleThemeAction(t.id, action, extras)} loading={actionLoading === t.id}
                            defaultResponseTarget={defaultResponseTarget} expectedAttendees={cfg?.expected_attendees}
                            onDetailClick={() => setDetailTopic(t)} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>)}

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
// -- Expand toggles for keywords / sensitive terms ----------------------------

type ExpansionMap = Record<string, { similar?: string[]; associated?: string[] }>

function ExpandableTerms({ terms, onChange, color = 'purple', context }: {
  terms: string[]
  onChange: (terms: string[]) => void
  color?: 'purple' | 'red'
  context?: string
}) {
  const [expansions, setExpansions] = useState<ExpansionMap>({})
  const [loading, setLoading] = useState<Record<string, string | null>>({})

  const toggleExpand = async (term: string, mode: 'similar' | 'associated') => {
    const current = expansions[term]?.[mode]
    if (current) {
      const toRemove = new Set(current)
      const updated = terms.filter(t => !toRemove.has(t))
      setExpansions(prev => {
        const next = { ...prev }
        if (next[term]) { const e = { ...next[term] }; delete e[mode]; next[term] = e }
        return next
      })
      onChange(updated)
      return
    }
    setLoading(prev => ({ ...prev, [term]: mode }))
    try {
      const res = await fetch('/api/townhall/expand-terms', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ term, mode, context }),
      })
      const data = await res.json()
      if (data.terms?.length) {
        const existing = new Set(terms.map(t => t.toLowerCase()))
        const newTerms = data.terms.filter((t: string) => !existing.has(t.toLowerCase()) && t.toLowerCase() !== term.toLowerCase())
        if (newTerms.length) {
          setExpansions(prev => ({ ...prev, [term]: { ...prev[term], [mode]: newTerms } }))
          const idx = terms.indexOf(term)
          const updated = [...terms]
          updated.splice(idx + 1, 0, ...newTerms)
          onChange(updated)
        }
      }
    } catch {}
    setLoading(prev => ({ ...prev, [term]: null }))
  }

  const expandedSet = new Set<string>()
  Object.values(expansions).forEach(e => {
    e.similar?.forEach(t => expandedSet.add(t))
    e.associated?.forEach(t => expandedSet.add(t))
  })

  const bg = color === 'red' ? 'bg-red-50' : 'bg-purple-50'
  const text = color === 'red' ? 'text-red-600' : 'text-purple-600'
  const border = color === 'red' ? 'border-red-200' : 'border-purple-200'
  const expandedBg = color === 'red' ? 'bg-red-50/50' : 'bg-purple-50/50'
  const expandedBorder = color === 'red' ? 'border-red-100' : 'border-purple-100'
  const expandedText = color === 'red' ? 'text-red-400' : 'text-purple-400'

  if (terms.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1 items-center">
      {terms.map(kw => {
        const isExpanded = expandedSet.has(kw)
        const hasSimilar = !!expansions[kw]?.similar
        const hasAssociated = !!expansions[kw]?.associated
        const isLoading = loading[kw]

        return (
          <span key={kw} className={`text-[9px] px-1.5 py-0.5 rounded-full border flex items-center gap-0.5 ${isExpanded ? `${expandedBg} ${expandedText} ${expandedBorder}` : `${bg} ${text} ${border}`}`}>
            {kw}
            {!isExpanded && (
              <>
                <button onClick={() => toggleExpand(kw, 'similar')}
                  disabled={!!isLoading}
                  className={`px-0.5 py-0 rounded text-[7px] font-bold leading-none transition-colors ${hasSimilar ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-500 hover:bg-blue-200 hover:text-blue-600'}`}
                  title={hasSimilar ? 'Remove similar terms' : 'Similar word forms'}>
                  {isLoading === 'similar' ? '·' : 'S'}
                </button>
                <button onClick={() => toggleExpand(kw, 'associated')}
                  disabled={!!isLoading}
                  className={`px-0.5 py-0 rounded text-[7px] font-bold leading-none transition-colors ${hasAssociated ? 'bg-emerald-500 text-white' : 'bg-gray-200 text-gray-500 hover:bg-emerald-200 hover:text-emerald-600'}`}
                  title={hasAssociated ? 'Remove associated terms' : 'Associated terms'}>
                  {isLoading === 'associated' ? '·' : 'A'}
                </button>
              </>
            )}
            <button onClick={() => {
              if (expansions[kw]) {
                const toRemove = new Set([...(expansions[kw].similar || []), ...(expansions[kw].associated || [])])
                setExpansions(prev => { const next = { ...prev }; delete next[kw]; return next })
                onChange(terms.filter(t => t !== kw && !toRemove.has(t)))
              } else {
                onChange(terms.filter(t => t !== kw))
              }
            }} className={`${isExpanded ? expandedText : text} opacity-50 hover:opacity-100 hover:text-red-500`}>&times;</button>
          </span>
        )
      })}
    </div>
  )
}

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
          <label className="text-[10px] font-semibold text-gray-500 block mb-1">Keywords <span className="font-normal text-gray-400">— S = similar forms, A = associated terms</span></label>
          <ExpandableTerms
            terms={t.keywords}
            onChange={kws => onChange({ keywords: kws })}
            color="purple"
            context={t.description || t.label}
          />
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
function ThemeCard({ theme: t, isActive, variant, onAction, loading, defaultResponseTarget, onDetailClick, expectedAttendees }: {
  theme: TownHallTheme
  isActive: boolean
  variant: 'suggested' | 'active' | 'parked' | 'completed' | 'dismissed'
  onAction: (action: string, extras?: Record<string, unknown>) => void
  loading: boolean
  defaultResponseTarget?: number
  onDetailClick?: () => void
  expectedAttendees?: number
}) {
  const sent = t.sentiment || 'neutral'
  const keywords = t.keywords || []
  const isSuggested = variant === 'suggested'
  const isParked = variant === 'parked'
  const isDismissed = variant === 'dismissed'
  const isAI = t.source === 'auto_detected'
  const isCompleted = variant === 'completed'
  const [showApprove, setShowApprove] = useState(false)
  const [showReopen, setShowReopen] = useState(false)
  const [approveTarget, setApproveTarget] = useState(defaultResponseTarget || 30)
  const [reopenTarget, setReopenTarget] = useState(defaultResponseTarget || 30)

  return (
    <div className={`rounded-xl border overflow-hidden ${isSuggested ? 'border-orange-200 bg-white' : isDismissed ? 'border-gray-200 bg-gray-50/50' : isParked ? 'border-blue-100 bg-white' : isCompleted ? 'border-gray-100 bg-gray-50/50' : 'border-gray-200 bg-white'}`}>
      {sent !== 'insufficient' && <div style={{ height: 3, background: SENT_COLOR[sent] || SENT_COLOR.neutral }} />}
      <div className="p-4">
        {/* Header row: donut + label + badges */}
        <div className="flex items-start gap-3">
          <CompletionDonut current={t.response_count} target={t.response_target} size={44} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className={`text-sm font-bold text-gray-800${onDetailClick ? ' hover:text-orange-600 cursor-pointer' : ''}`} onClick={onDetailClick ? (e) => { e.stopPropagation(); onDetailClick() } : undefined}>{t.label}</span>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {sent !== 'insufficient' && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold capitalize"
                    style={{ background: SENT_BG[sent] || SENT_BG.neutral, color: SENT_COLOR[sent] || SENT_COLOR.neutral }}>
                    {sent}
                  </span>
                )}
                {isAI && <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-600">Organic</span>}
                {t.source === 'guide' && <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-600">Seed</span>}
                {t.source === 'custom' && <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500">Custom</span>}
                {t.state === 'paused' && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-amber-100 text-amber-600">Paused</span>}
                {t.state === 'active' && t.response_count >= t.response_target && t.response_target > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-green-100 text-green-600">✓ Target</span>}
              </div>
            </div>
            {t.description && <p className="text-xs text-gray-500 mt-0.5">{t.description}</p>}
            <span className="text-[10px] text-gray-400">{t.response_count} / {t.response_target} responses{expectedAttendees ? ' (' + Math.round(t.response_target / expectedAttendees * 100) + '% of ' + expectedAttendees + ')' : ''}{t.mention_count > 0 ? ' \u00B7 ' + t.mention_count + ' mentions' : ''}</span>
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
        {/* Dismissed: Restore button */}
        {isDismissed && (
          <div className="flex gap-2 mt-3 pt-2 border-t border-gray-100">
            <button onClick={() => onAction('undismiss')} disabled={loading}
              className="text-[11px] font-semibold px-3 py-1.5 rounded-lg text-orange-600 hover:bg-orange-50 border border-orange-200 disabled:opacity-50">Restore</button>
          </div>
        )}
        {/* Completed: Reopen button (with target input) */}
        {isCompleted && isActive && !showReopen && (
          <div className="flex gap-2 mt-3 pt-2 border-t border-gray-100">
            <button onClick={() => setShowReopen(true)} disabled={loading}
              className="text-[11px] font-semibold px-3 py-1.5 rounded-lg text-green-600 hover:bg-green-50 border border-green-200 disabled:opacity-50">Reopen</button>
          </div>
        )}
        {isCompleted && showReopen && (
          <div className="mt-3 pt-2 border-t border-gray-100 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500">Additional responses:</span>
              <input type="number" min={5} max={500} value={reopenTarget}
                onChange={e => setReopenTarget(parseInt(e.target.value) || 30)}
                className="w-16 px-2 py-1 rounded-lg border border-gray-200 text-xs focus:outline-none focus:ring-2 focus:ring-green-200" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => { onAction('reopen', { response_target: t.response_count + reopenTarget }); setShowReopen(false) }} disabled={loading}
                className="text-[11px] font-semibold px-3 py-1.5 rounded-lg text-white hover:opacity-90 disabled:opacity-50" style={{ background: '#22c55e' }}>Confirm</button>
              <button onClick={() => setShowReopen(false)}
                className="text-[11px] font-medium px-3 py-1.5 rounded-lg text-gray-400 hover:text-gray-600">Cancel</button>
            </div>
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
