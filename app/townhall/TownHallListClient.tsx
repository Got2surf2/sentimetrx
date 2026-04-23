'use client'

import { useState, useEffect, useRef } from 'react'
import TopNav from '@/components/nav/TopNav'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface Session {
  id: string
  name: string
  slug: string | null
  status: string
  config: any
  discussion_guide: any[]
  response_counter: number
  participants: number
  turns: number
  started_at: string | null
  ended_at: string | null
  created_at: string
}

interface Props {
  logoUrl?: string
  analyzeEnabled?: boolean
  campaignsEnabled?: boolean
  features?: Record<string, boolean>
  user: { email: string; fullName?: string; role?: string; clientName?: string; isAdmin?: boolean }
}

const HERMES = '#E8632A'

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  setup:  { bg: '#f3f4f6', text: '#6b7280', label: 'Setup' },
  active: { bg: '#dcfce7', text: '#166534', label: 'Active' },
  paused: { bg: '#fef3c7', text: '#92400e', label: 'Paused' },
  ended:  { bg: '#e5e7eb', text: '#374151', label: 'Ended' },
}

type FilterTab = 'all' | 'active' | 'setup' | 'ended' | 'archived'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export default function TownHallListClient({ logoUrl, analyzeEnabled, campaignsEnabled, features, user }: Props) {
  const router = useRouter()
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterTab>('all')
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [shareLoading, setShareLoading] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/townhall/sessions')
      .then(r => r.json())
      .then(data => { setSessions(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const isArchived = (s: Session) => !!s.config?.archived

  const filtered = sessions.filter(s => {
    if (filter === 'archived') return isArchived(s)
    if (isArchived(s)) return false // hide archived from non-archived tabs
    if (filter === 'all') return true
    return s.status === filter
  })

  const archivedCount = sessions.filter(s => isArchived(s)).length

  const handleArchive = async (sessionId: string, archive: boolean) => {
    setActionLoading(sessionId)
    setMenuOpen(null)
    try {
      const s = sessions.find(s => s.id === sessionId)
      if (!s) return
      const updatedConfig = { ...s.config, archived: archive || undefined }
      if (!archive) delete updatedConfig.archived
      await fetch('/api/townhall/sessions/' + sessionId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: updatedConfig }),
      })
      setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, config: updatedConfig } : s))
    } catch {}
    setActionLoading(null)
  }

  const handleDuplicate = async (sessionId: string) => {
    setActionLoading(sessionId)
    setMenuOpen(null)
    try {
      const res = await fetch('/api/townhall/sessions/' + sessionId + '/duplicate', { method: 'POST' })
      const data = await res.json()
      if (data.id) {
        router.push('/townhall/' + data.id)
      }
    } catch {}
    setActionLoading(null)
  }

  const handleShare = async (sessionId: string) => {
    setShareLoading(sessionId)
    try {
      const res = await fetch('/api/share', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'townhall', target_id: sessionId, expires_in: '7d' }),
      })
      const d = await res.json()
      if (d.url) {
        await navigator.clipboard.writeText(d.url)
        setTimeout(() => setShareLoading(null), 2000)
        return
      }
    } catch {}
    setShareLoading(null)
  }

  const handleAction = async (sessionId: string, action: 'start' | 'end' | 'pause' | 'resume' | 'restart' | 'reopen') => {
    setActionLoading(sessionId)
    try {
      const statusMap: Record<string, string> = { start: 'active', end: 'ended', pause: 'paused', resume: 'active' }
      const body = action === 'restart' ? { restart: true } : action === 'reopen' ? { reopen: true } : { status: statusMap[action] }
      await fetch('/api/townhall/sessions/' + sessionId, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      // Refetch
      const res = await fetch('/api/townhall/sessions')
      const data = await res.json()
      setSessions(Array.isArray(data) ? data : [])
    } catch {}
    setActionLoading(null)
  }

  const handleDelete = async (sessionId: string) => {
    setConfirmDelete(null)
    setActionLoading(sessionId)
    try {
      await fetch('/api/townhall/sessions/' + sessionId, { method: 'DELETE' })
      setSessions(prev => prev.filter(s => s.id !== sessionId))
    } catch {}
    setActionLoading(null)
  }

  const handleExport = async (sessionId: string, name: string, format = 'csv') => {
    try {
      const res = await fetch('/api/townhall/sessions/' + sessionId + '/export?format=' + format)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || (name + '.' + format)
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
    } catch {}
  }

  const tabs: { key: FilterTab; label: string; count?: number }[] = [
    { key: 'all', label: 'All', count: sessions.filter(s => !isArchived(s)).length },
    { key: 'active', label: 'Active', count: sessions.filter(s => s.status === 'active' && !isArchived(s)).length },
    { key: 'setup', label: 'Setup', count: sessions.filter(s => s.status === 'setup' && !isArchived(s)).length },
    { key: 'ended', label: 'Ended', count: sessions.filter(s => s.status === 'ended' && !isArchived(s)).length },
    ...(archivedCount > 0 ? [{ key: 'archived' as FilterTab, label: 'Archived', count: archivedCount }] : []),
  ]

  return (
    <>
      <TopNav
        logoUrl={logoUrl}
        orgName={user.clientName}
        isAdmin={user.isAdmin}
        userEmail={user.email}
        fullName={user.fullName}
        analyzeEnabled={analyzeEnabled}
        campaignsEnabled={campaignsEnabled}
        features={features}
        currentPage="townhall"
      />

      <main className="pt-14">
        <div className="max-w-5xl mx-auto px-5 py-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">SignalIQ</h1>
              <p className="text-sm text-gray-500 mt-1">AI-moderated focus groups at scale</p>
            </div>
            <Link
              href="/townhall/new"
              className="px-4 py-2.5 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-opacity"
              style={{ background: HERMES }}>
              + New Session
            </Link>
          </div>

          {/* Filter tabs */}
          {sessions.length > 0 && (
            <div className="flex gap-1 mb-5">
              {tabs.map(t => (
                <button
                  key={t.key}
                  onClick={() => setFilter(t.key)}
                  className={'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ' + (filter === t.key ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200')}
                >
                  {t.label}{t.count !== undefined ? ` (${t.count})` : ''}
                </button>
              ))}
            </div>
          )}

          {/* Sessions grid */}
          {loading ? (
            <div className="text-center py-20 text-gray-400 text-sm">Loading sessions...</div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-20">
              <div className="text-4xl mb-3">{'\uD83C\uDFE4'}</div>
              <p className="text-gray-500 text-sm mb-4">No sessions yet. Create your first SignalIQ session to get started.</p>
              <Link
                href="/townhall/new"
                className="inline-block px-4 py-2 rounded-lg text-white text-sm font-medium hover:opacity-90"
                style={{ background: HERMES }}>
                Create Session
              </Link>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">No {filter} sessions</div>
          ) : (
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
              {filtered.map(s => {
                const badge = STATUS_BADGE[s.status] || STATUS_BADGE.setup
                const topicCount = s.discussion_guide?.length || 0
                const archived = isArchived(s)
                const statusColor = s.status === 'active' ? 'bg-green-100 text-green-700 border-green-200'
                  : s.status === 'ended' ? 'bg-gray-100 text-gray-500 border-gray-200'
                  : 'bg-yellow-50 text-yellow-700 border-yellow-200'
                return (
                  <div key={s.id} className={'bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md hover:border-orange-200 transition-all flex flex-col overflow-hidden relative' + (archived ? ' opacity-60' : '')}>

                    {/* Color strip */}
                    <div className="h-1.5 w-full" style={{ background: archived ? '#9ca3af' : s.status === 'active' ? 'linear-gradient(135deg, #22c55e, #16a34a)' : s.status === 'ended' ? 'linear-gradient(135deg, #9ca3af, #6b7280)' : 'linear-gradient(135deg,' + HERMES + ',#c44d1a)' }} />

                    <div className="p-4 flex flex-col gap-3 flex-1">
                      {/* Title row — matches survey card */}
                      <div className="flex items-start justify-between gap-2">
                        <Link href={'/townhall/' + s.id} target="_blank" className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-lg leading-none">{s.config?.bot_emoji || '\uD83C\uDFE4'}</span>
                            <h3 className="font-bold text-gray-800 text-sm truncate hover:text-orange-600 transition-colors">{s.name}</h3>
                          </div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className={'text-xs px-2 py-0.5 rounded-full border font-medium ' + statusColor}>
                              {archived ? 'Archived' : badge.label}
                            </span>
                            <span className="text-xs text-gray-400">{formatDate(s.created_at)}</span>
                          </div>
                        </Link>
                        {/* Mini stat circle — matches survey donut position */}
                        <div className="flex flex-col items-center justify-center w-12 h-12 rounded-full flex-shrink-0" style={{ background: '#fff4ef' }}>
                          <div className="text-sm font-black" style={{ color: HERMES }}>{s.participants}</div>
                          <div className="text-[7px] text-gray-400 font-semibold uppercase leading-tight">joined</div>
                        </div>
                      </div>

                      {/* Stats line — matches survey "42 responses (85%)" pattern */}
                      <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                        <span className="font-medium text-gray-700">{s.turns} responses</span>
                        <span className="text-gray-400">{topicCount} topics</span>
                        {s.config?.bot_name && <span className="text-gray-400">Bot: {s.config.bot_name}</span>}
                      </div>

                      {/* Timing info */}
                      {s.started_at && (
                        <div className="text-xs text-gray-400">
                          {s.status === 'ended' && s.ended_at
                            ? 'Ran ' + formatDate(s.started_at) + ' – ' + formatDate(s.ended_at)
                            : 'Started ' + formatDate(s.started_at) + ' ' + formatTime(s.started_at)}
                        </div>
                      )}

                      {/* Session ID — admin only, click to copy (for debug mode) */}
                      {user.isAdmin && (
                        <button
                          onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(s.id); const el = e.currentTarget.querySelector('span')!; el.textContent = '\u2713 Copied!'; setTimeout(() => { el.textContent = 'ID: ' + s.id }, 1500) }}
                          className="text-xs text-gray-300 hover:text-gray-500 truncate text-left transition-colors"
                          title="Click to copy session ID (for debug mode)">
                          <span>ID: {s.id}</span>
                        </button>
                      )}

                      {/* Participant link — always visible */}
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          const url = window.location.origin + '/th/' + (s.slug || s.id)
                          navigator.clipboard.writeText(url)
                          const span = e.currentTarget.querySelector('span')
                          if (span) { span.textContent = 'Copied!'; setTimeout(() => { span.textContent = '/th/' + (s.slug || s.id) }, 1500) }
                        }}
                        className="text-xs text-gray-300 hover:text-green-600 truncate text-left transition-colors flex items-center gap-1.5"
                        title="Click to copy participant link">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                        <span>/th/{s.slug || s.id}</span>
                      </button>

                      {/* Action pills — identical layout to survey cards */}
                      <div className="grid grid-cols-3 gap-1.5 mt-auto pt-2 border-t border-gray-100">
                        {/* Row 1: Analytics, Responses, Export (orange) */}
                        <Link href={'/townhall/' + s.id + '?tab=analytics'} target="_blank"
                          className="text-xs py-1.5 rounded-lg font-medium transition-all text-center"
                          style={{ background: '#fff4ef', color: HERMES, border: '1px solid #fbd5c2' }}>
                          Analytics
                        </Link>
                        <Link href={'/townhall/' + s.id + '?tab=responses'} target="_blank"
                          className="text-xs py-1.5 rounded-lg font-medium transition-all text-center"
                          style={{ background: '#fff4ef', color: HERMES, border: '1px solid #fbd5c2' }}>
                          Responses
                        </Link>
                        <button onClick={() => handleExport(s.id, s.name)}
                          className="text-xs py-1.5 rounded-lg font-medium transition-all text-center"
                          style={{ background: '#fff4ef', color: HERMES, border: '1px solid #fbd5c2' }}>
                          Export
                        </button>

                        {/* Row 2: Close/Reopen, Archive */}
                        <button
                          onClick={() => {
                            const isLive = s.status === 'active' || s.status === 'paused'
                            handleAction(s.id, isLive ? 'end' : s.status === 'ended' ? 'reopen' : 'start')
                          }}
                          disabled={!!actionLoading}
                          className="text-xs py-1.5 rounded-lg font-medium transition-all disabled:opacity-50 text-center"
                          style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
                          {(s.status === 'active' || s.status === 'paused') ? 'Close' : 'Reopen'}
                        </button>
                        <button onClick={() => setConfirmDelete(s.id)}
                          disabled={!!actionLoading}
                          className="text-xs py-1.5 rounded-lg font-medium transition-all disabled:opacity-50 text-center"
                          style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
                          Delete
                        </button>
                        <button onClick={() => handleArchive(s.id, !archived)}
                          className="text-xs py-1.5 rounded-lg font-medium transition-all text-center"
                          style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
                          {archived ? 'Unarchive' : 'Archive'}
                        </button>

                        {/* Row 3: Manage, Duplicate, Share (gray/blue) */}
                        <Link href={'/townhall/' + s.id} target="_blank"
                          className="text-xs py-1.5 rounded-lg font-medium transition-all text-center"
                          style={{ background: '#f3f4f6', color: '#4b5563', border: '1px solid #e5e7eb' }}>
                          Manage
                        </Link>
                        <button onClick={() => handleDuplicate(s.id)}
                          className="text-xs py-1.5 rounded-lg font-medium transition-all text-center"
                          style={{ background: '#f3f4f6', color: '#4b5563', border: '1px solid #e5e7eb' }}>
                          Duplicate
                        </button>
                        <button onClick={() => handleShare(s.id)}
                          className="text-xs py-1.5 rounded-lg font-medium transition-all text-center"
                          style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe' }}>
                          {shareLoading === s.id ? 'Copied!' : 'Share'}
                        </button>

                        {/* Row 4: Analyze in Ana (purple, spans full width) */}
                        <AnalyzeInAnaButton sessionId={s.id} />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </main>

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm mx-4">
            <h3 className="font-bold text-gray-800 text-sm mb-2">Delete this session?</h3>
            <p className="text-xs text-gray-500 mb-4">This will permanently delete the session and all its responses, themes, and participant data. This cannot be undone.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={() => handleDelete(confirmDelete)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-red-500 hover:bg-red-600">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// Inline component: Analyze in Ana button for TH cards
function AnalyzeInAnaButton({ sessionId }: { sessionId: string }) {
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')

  async function handleClick() {
    setLoading(true)
    setStatus('Syncing...')
    try {
      const res = await fetch('/api/townhall/sessions/' + sessionId + '/analyze', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setStatus(data.error || 'Failed'); setLoading(false); return }
      window.location.href = '/analyze/' + data.dataset_id + '/textmine' + (data.created ? '?new=1' : '')
    } catch {
      setStatus('Error')
      setLoading(false)
    }
  }

  return (
    <button onClick={handleClick} disabled={loading}
      className="col-span-3 text-xs py-1.5 rounded-lg font-semibold transition-all text-center"
      style={{ background: '#E8632A', color: 'white', border: 'none', cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1 }}>
      {loading ? status : '\uD83D\uDCCA Analyze in Ana'}
    </button>
  )
}
