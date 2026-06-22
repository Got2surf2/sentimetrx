'use client'

import { INDUSTRY_LABELS, type Industry } from '@/lib/industryDefaults'

import React, { useState, useEffect } from 'react'
import TopNav from '@/components/nav/TopNav'
import SubHeader from '@/components/nav/SubHeader'
import ShareModal from '@/components/ui/ShareModal'
import { FavoriteStar } from '@/components/ui/FavoriteStar'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Study {
  id: string; guid: string; slug?: string; name: string; bot_name: string; bot_emoji: string
  status: string; visibility: string; created_by: string; created_at: string
  config: any; org_id?: string; orgName?: string; creatorName?: string
}
interface StudyStats {
  total: number; completeCount: number; promoters: number; passives: number; detractors: number
  avgScore: number; ratingLabel: string; lastResponse: string | null
}
interface Props {
  logoUrl?: string; orgId?: string
  analyzeEnabled?: boolean
  campaignsEnabled?: boolean
  features?: import('@/lib/types').ModuleFeatures
  user: { email: string; fullName?: string; role?: string; clientName?: string; isAdmin?: boolean; userId: string }
  studies: Study[]; statsMap: Record<string, StudyStats>
}
type OwnerFilter  = 'all' | 'mine' | 'public'
type StatusFilter = 'all' | 'active' | 'closed' | 'draft'

const HERMES = '#E8632A'

// -- Donut chart ----------------------------------------------------------------
function DonutChart({ promoters, passives, detractors, total, avgScore, ratingLabel }: {
  promoters: number; passives: number; detractors: number; total: number; avgScore: number; ratingLabel?: string
}) {
  const p = total > 0 ? Math.round(promoters / total * 100) : 0
  const a = total > 0 ? Math.round(passives  / total * 100) : 0
  const d = total > 0 ? Math.round(detractors / total * 100) : 0
  const bg = total > 0
    ? 'conic-gradient(#22c55e ' + p + '%, #f59e0b ' + p + '% ' + (p + a) + '%, #ef4444 ' + (p + a) + '% ' + (p + a + d) + '%, #f3f4f6 ' + (p + a + d) + '%)'
    : 'conic-gradient(#f3f4f6 100%)'
  return (
    <div style={{ position: 'relative', width: 96, height: 96, flexShrink: 0 }}>
      <div style={{ width: 96, height: 96, borderRadius: '50%', background: bg }} />
      <div style={{ position: 'absolute', top: 14, left: 14, width: 68, height: 68, borderRadius: '50%', background: 'white' }} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 18, fontWeight: 900, lineHeight: 1, color: HERMES }}>{total > 0 ? avgScore : '--'}</span>
        <span style={{ fontSize: 9, color: '#9ca3af', fontWeight: 500 }}>{ratingLabel || 'Avg Rating'}</span>
      </div>
    </div>
  )
}

function QRCode({ url }: { url: string }) {
  const src = 'https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=' + encodeURIComponent(url) + '&margin=8'
  return <img src={src} alt="QR code" className="w-40 h-40 rounded-lg border border-gray-200" />
}

// -- Confirm modal --------------------------------------------------------------
function ConfirmModal({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
        <p className="text-gray-700 text-sm mb-5">{message}</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-medium">Cancel</button>
          <button onClick={onConfirm} className="px-4 py-2 rounded-lg text-white text-sm font-medium hover:opacity-90" style={{ background: HERMES }}>Confirm</button>
        </div>
      </div>
    </div>
  )
}

// ShareModal now imported from components/ui/ShareModal.tsx
// -- Study card -----------------------------------------------------------------
function StudyCard({ study, stats: initialStats, isAdmin, userId, campaignsEnabled, initialFavorited, onPatch, onDelete, onDuplicate, onRefresh }: {
  study: Study; stats: StudyStats; isAdmin: boolean; userId: string; campaignsEnabled?: boolean
  initialFavorited?: boolean
  onPatch: (id: string, body: object) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onDuplicate: (study: Study) => Promise<void>
  onRefresh?: (id: string) => Promise<void>
}) {
  const [busy,       setBusy]       = useState(false)
  const [confirm,    setConfirm]    = useState<{ msg: string; action: () => void } | null>(null)
  const [vis,        setVis]        = useState(study.visibility)
  const [status,     setStatus]     = useState(study.status)
  const [refreshing, setRefreshing] = useState(false)
  const [stats,      setStats]      = useState(initialStats)
  const [showShare,  setShowShare]  = useState(false)
  const [guidCopied, setGuidCopied] = useState(false)

  const canEdit  = study.created_by === userId || isAdmin
  const theme    = study.config?.theme || {}
  const headerBg = theme.headerGradient || ('linear-gradient(135deg,' + HERMES + ',#c44d1a)')

  const do_patch = async (body: object) => {
    setBusy(true)
    try {
      await onPatch(study.id, body)
      if ('status'     in body) setStatus((body as any).status)
      if ('visibility' in body) setVis((body as any).visibility)
    } finally { setBusy(false) }
  }

  const statusColor = (s: string) => {
    if (s === 'active') return 'bg-green-100 text-green-700 border-green-200'
    if (s === 'closed') return 'bg-red-100 text-red-600 border-red-200'
    return 'bg-gray-100 text-gray-500 border-gray-200'
  }

  const pp = stats.total > 0 ? Math.round(stats.promoters  / stats.total * 100) : 0
  const ap = stats.total > 0 ? Math.round(stats.passives   / stats.total * 100) : 0
  const dp = stats.total > 0 ? Math.round(stats.detractors / stats.total * 100) : 0

  const lastResp = stats.lastResponse
    ? new Date(stats.lastResponse).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null

  const handleExport = () => {
    window.location.href = '/studies/' + study.id + '/responses?export=csv'
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      const res = await fetch('/api/studies/' + study.id + '/responses?limit=50000&offset=0')
      if (res.ok) {
        const data = await res.json()
        const rows = data.responses || data.data || []
        if (Array.isArray(rows)) {
          const total = rows.length
          const completeCount = rows.filter((r: any) => r.status === 'complete' || !r.status).length
          const promoters = rows.filter((r: any) => (r.sentiment === 'positive' || r.sentiment === 'promoter')).length
          const passives = rows.filter((r: any) => (r.sentiment === 'neutral' || r.sentiment === 'passive')).length
          const detractors = rows.filter((r: any) => (r.sentiment === 'negative' || r.sentiment === 'detractor')).length
          const scoreRows = rows.filter((r: any) => r.experience_score != null)
          const avgScore = scoreRows.length > 0
            ? Math.round(scoreRows.reduce((s: number, r: any) => s + (r.experience_score || 0), 0) / scoreRows.length * 10) / 10
            : (total > 0 ? Math.round(rows.reduce((s: number, r: any) => s + (r.nps_score || 0), 0) / total * 10) / 10 : 0)
          const dates = rows.map((r: any) => r.completed_at).filter(Boolean).sort()
          const lastResponse = dates.length > 0 ? dates[dates.length - 1] : stats.lastResponse
          setStats({ total, completeCount, promoters, passives, detractors, avgScore, ratingLabel: stats.ratingLabel, lastResponse })
        }
      }
    } catch { /* fail silently */ }
    setRefreshing(false)
  }

  const industryLabel = study.config?.industry
    ? (INDUSTRY_LABELS as any)[study.config.industry] || study.config.industry
    : null

  return (
    <>
      {confirm    && <ConfirmModal message={confirm.msg} onConfirm={() => { confirm.action(); setConfirm(null) }} onCancel={() => setConfirm(null)} />}
      {showShare  && <ShareModal type="study" targetId={study.id} onClose={() => setShowShare(false)} />}

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md hover:border-orange-200 transition-all flex flex-col overflow-hidden" style={{ position: 'relative' }}>

        {/* Refresh icon — absolute top-right */}
        <button onClick={handleRefresh} disabled={refreshing}
          title="Refresh stats"
          style={{ position: 'absolute', top: 10, right: 10, zIndex: 2, width: 26, height: 26, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: refreshing ? '#fff4ef' : 'transparent', cursor: 'pointer', color: refreshing ? HERMES : '#9ca3af', transition: 'all 0.15s' }}
          onMouseEnter={function(e) { (e.currentTarget as HTMLElement).style.color = HERMES; (e.currentTarget as HTMLElement).style.background = '#fff4ef' }}
          onMouseLeave={function(e) { if (!refreshing) { (e.currentTarget as HTMLElement).style.color = '#9ca3af'; (e.currentTarget as HTMLElement).style.background = 'transparent' } }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            style={refreshing ? { animation: 'spin 0.8s linear infinite' } : {}}>
            <path d="M1 4v6h6" /><path d="M23 20v-6h-6" />
            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 0 1 3.51 15" />
          </svg>
        </button>

        {/* Color strip */}
        <div className="h-1.5 w-full" style={{ background: headerBg }} />

        <div className="p-4 flex flex-col gap-3 flex-1">

          {/* Title row */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-lg leading-none">{study.bot_emoji}</span>
                <h3 className="font-bold text-gray-800 text-sm truncate">{study.name}</h3>
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className={'text-xs px-2 py-0.5 rounded-full border font-medium ' + statusColor(status)}>
                  {status}
                </span>
                {industryLabel && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ background: '#fff4ef', color: HERMES, border: '1px solid #fbd5c2' }}>
                    {industryLabel}
                  </span>
                )}
                <FavoriteStar resourceType="study" resourceId={study.id} initialFavorited={!!initialFavorited} size={14} />
              </div>
            </div>
            <DonutChart
              promoters={stats.promoters}
              passives={stats.passives}
              detractors={stats.detractors}
              total={stats.total}
              avgScore={stats.avgScore}
              ratingLabel={stats.ratingLabel}
            />
          </div>

          {/* Stats row — responses, completion rate, sentiment all on one line */}
          <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
            <span className="font-medium text-gray-700">
              {stats.total} responses{stats.total > 0 ? ' (' + Math.round(stats.completeCount / stats.total * 100) + '%)' : ''}
            </span>
            {stats.total > 0 && (
              <>
                <span style={{ color: '#16a34a', fontWeight: 600 }}>{pp}% +</span>
                <span style={{ color: '#ca8a04', fontWeight: 600 }}>{ap}% ~</span>
                <span style={{ color: '#dc2626', fontWeight: 600 }}>{dp}% −</span>
              </>
            )}
          </div>

          {lastResp && (
            <div className="text-xs text-gray-400">Last response: {lastResp}</div>
          )}

          {/* Creator / org info for admins */}
          {isAdmin && (study.creatorName || study.orgName) && (
            <div className="text-xs text-gray-400 truncate">
              {[study.creatorName, study.orgName].filter(Boolean).join(' · ')}
            </div>
          )}

          {/* GUID — admin only, click to copy (for debug mode) */}
          {isAdmin && (
            <button
              onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(study.guid); setGuidCopied(true); setTimeout(() => setGuidCopied(false), 1500) }}
              className="text-xs text-gray-300 hover:text-gray-500 truncate text-left transition-colors"
              title="Click to copy study GUID (for debug mode)">
              {guidCopied ? '✓ Copied!' : 'GUID: ' + study.guid}
            </button>
          )}

          {/* Copy survey link */}
          {status === 'active' && (
            <button
              onClick={e => {
                e.stopPropagation()
                const url = window.location.origin + '/s/' + (study.slug || study.guid)
                navigator.clipboard.writeText(url)
                const span = e.currentTarget.querySelector('span')
                if (span) { span.textContent = 'Copied!'; setTimeout(() => { span.textContent = '/s/' + (study.slug || study.guid) }, 1500) }
              }}
              className="text-xs text-gray-300 hover:text-green-600 truncate text-left transition-colors flex items-center gap-1.5"
              title="Click to copy survey link">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              <span>/s/{study.slug || study.guid}</span>
            </button>
          )}

          {/* Action pills — 3-column grid */}
          <div className="grid grid-cols-3 gap-1.5 mt-auto pt-2 border-t border-gray-100">
            {/* Row 1: Analytics, Responses, Campaigns */}
            <Link href={'/studies/' + study.id + '/analytics'} target="_blank"
              className="text-xs py-1.5 rounded-lg font-medium transition-all text-center"
              style={{ background: '#fff4ef', color: HERMES, border: '1px solid #fbd5c2' }}>
              Analytics
            </Link>
            <Link href={'/studies/' + study.id + '/responses'} target="_blank"
              className="text-xs py-1.5 rounded-lg font-medium transition-all text-center"
              style={{ background: '#fff4ef', color: HERMES, border: '1px solid #fbd5c2' }}>
              Responses
            </Link>
            {campaignsEnabled ? (
              <Link href={'/studies/' + study.id + '/campaigns'} target="_blank"
                className="text-xs py-1.5 rounded-lg font-medium transition-all text-center"
                style={{ background: '#fff4ef', color: HERMES, border: '1px solid #fbd5c2' }}>
                Campaigns
              </Link>
            ) : (
              <button onClick={handleExport}
                className="text-xs py-1.5 rounded-lg font-medium transition-all text-center"
                style={{ background: '#fff4ef', color: HERMES, border: '1px solid #fbd5c2' }}>
                Export
              </button>
            )}

            {/* Row 2: Export (if campaigns shown above), Close/Reopen, Delete */}
            {canEdit && (<>
              {campaignsEnabled && (
                <button onClick={handleExport}
                  className="text-xs py-1.5 rounded-lg font-medium transition-all text-center"
                  style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
                  Export
                </button>
              )}
              <button
                onClick={() => setConfirm({
                  msg: 'Are you sure you want to ' + (status === 'active' ? 'close' : status === 'closed' ? 'reopen' : 'activate') + ' this study?',
                  action: () => do_patch({ status: status === 'active' ? 'closed' : 'active' })
                })}
                disabled={busy}
                className="text-xs py-1.5 rounded-lg font-medium transition-all disabled:opacity-50 text-center"
                style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
                {status === 'active' ? 'Close' : 'Reopen'}
              </button>
              <button onClick={() => setConfirm({ msg: 'Delete "' + study.name + '"? This cannot be undone.', action: () => onDelete(study.id) })}
                disabled={busy}
                className="text-xs py-1.5 rounded-lg font-medium transition-all disabled:opacity-50 text-center"
                style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
                Delete
              </button>
            </>)}

            {/* Row 3: Edit, Duplicate, Share */}
            {canEdit && (<>
              <Link href={'/studies/' + study.id + '/edit'} target="_blank"
                className="text-xs py-1.5 rounded-lg font-medium transition-all text-center"
                style={{ background: '#f3f4f6', color: '#4b5563', border: '1px solid #e5e7eb' }}>
                Edit
              </Link>
              <button onClick={() => onDuplicate(study)}
                className="text-xs py-1.5 rounded-lg font-medium transition-all text-center"
                style={{ background: '#f3f4f6', color: '#4b5563', border: '1px solid #e5e7eb' }}>
                Duplicate
              </button>
              <button onClick={() => setShowShare(true)}
                className="text-xs py-1.5 rounded-lg font-medium transition-all text-center"
                style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe' }}>
                Share
              </button>
            </>)}

            {/* Row 4: Analyze in Ana (full-width, solid orange) */}
            <AnalyzeInAnaButton studyId={study.id} />
          </div>
        </div>
      </div>
    </>
  )
}

// Inline component: Analyze in Ana button for study cards
function AnalyzeInAnaButton({ studyId }: { studyId: string }) {
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')

  async function handleClick() {
    setLoading(true)
    setStatus('Syncing...')
    try {
      const res = await fetch('/api/studies/' + studyId + '/analyze', { method: 'POST' })
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

// -- Main dashboard -------------------------------------------------------------
export default function DashboardClient({ user, studies: initialStudies, logoUrl = '', orgId = '', statsMap, analyzeEnabled, campaignsEnabled, features }: Props) {
  const [studies,      setStudies]      = useState(initialStudies)
  const [ownerFilter,  setOwnerFilter]  = useState<OwnerFilter>('mine')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [error,        setError]        = useState<string | null>(null)
  const [favoriteIds,  setFavoriteIds]  = useState<Set<string>>(new Set())
  const [sortMode,     setSortMode]     = useState<'updated' | 'created' | 'name'>('updated')
  const [query,        setQuery]        = useState('')

  useEffect(() => {
    fetch('/api/favorites').then(r => r.json()).then(d => {
      const s = new Set<string>()
      for (const f of (d.favorites || [])) {
        if (f.resource_type === 'study') s.add(f.resource_id)
      }
      setFavoriteIds(s)
    }).catch(() => { /* non-fatal */ })
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem('sentimetrx.sort.studies')
      if (saved === 'updated' || saved === 'created' || saved === 'name') setSortMode(saved)
    }
  }, [])

  function changeSort(next: 'updated' | 'created' | 'name') {
    setSortMode(next)
    if (typeof window !== 'undefined') window.localStorage.setItem('sentimetrx.sort.studies', next)
  }
  const defaultFrom = () => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10) }
  const defaultTo   = () => new Date().toISOString().slice(0, 10)
  const [dateFrom,  setDateFrom]  = useState('')
  const [dateTo,    setDateTo]    = useState('')
  const router = useRouter()

  // Sort: favorites first, then by chosen mode. Studies don't have an
  // updated_at column, so "Last updated" uses the most-recent response
  // timestamp from statsMap, falling back to created_at.
  function sortFiltered(list: Study[]): Study[] {
    function sortKey(s: Study): string | number {
      if (sortMode === 'name')    return (s.name || '').toLowerCase()
      if (sortMode === 'created') return -new Date(s.created_at).getTime()
      const lastResp = statsMap[s.id]?.lastResponse
      return -new Date(lastResp || s.created_at).getTime()
    }
    return list.slice().sort((a, b) => {
      const af = favoriteIds.has(a.id) ? 0 : 1
      const bf = favoriteIds.has(b.id) ? 0 : 1
      if (af !== bf) return af - bf
      const ka = sortKey(a); const kb = sortKey(b)
      if (ka < kb) return -1
      if (ka > kb) return 1
      return 0
    })
  }

  const nameQ = query.trim().toLowerCase()
  const filtered = sortFiltered(studies.filter(s => {
    if (nameQ && !(s.name || '').toLowerCase().includes(nameQ)) return false
    if (ownerFilter  === 'mine'   && s.created_by !== user.userId) return false
    if (ownerFilter  === 'public' && s.visibility  !== 'public')   return false
    if (statusFilter !== 'all'   && s.status       !== statusFilter) return false
    if (dateFrom && s.created_at < dateFrom) return false
    if (dateTo   && s.created_at > dateTo + 'T23:59:59') return false
    return true
  }))

  const firstNonFavIndexStudies = (list: Study[]): number => {
    for (let i = 0; i < list.length; i++) { if (!favoriteIds.has(list[i].id)) return i }
    return -1
  }

  const handlePatch = async (studyId: string, body: object) => {
    const res = await fetch('/api/studies/' + studyId, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error('Failed')
    setStudies(prev => prev.map(s => s.id === studyId ? { ...s, ...body } : s))
  }

  const handleDelete = async (studyId: string) => {
    const res = await fetch('/api/studies/' + studyId, { method: 'DELETE' })
    if (!res.ok) { setError('Failed to delete.'); return }
    setStudies(prev => prev.filter(s => s.id !== studyId))
  }

  const handleDuplicate = async (study: Study) => {
    try {
      const res = await fetch('/api/studies', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: study.name + ' (copy)', bot_name: study.bot_name, bot_emoji: study.bot_emoji, config: study.config, visibility: 'private' }) })
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      router.push('/studies/' + data.id + '/edit')
    } catch { setError('Failed to duplicate.') }
  }

  const ownerTabs:  { key: OwnerFilter;  label: string }[] = [{ key: 'all', label: 'All' }, { key: 'mine', label: 'Mine' }, { key: 'public', label: 'Public' }]
  const statusTabs: { key: StatusFilter; label: string }[] = [{ key: 'all', label: 'All' }, { key: 'active', label: 'Active' }, { key: 'draft', label: 'Draft' }, { key: 'closed', label: 'Closed' }]

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="fixed top-0 left-0 right-0 z-50">
        <TopNav
          logoUrl={logoUrl}
          orgName={user.clientName}
          isAdmin={user.isAdmin}
          userEmail={user.email}
          fullName={user.fullName}
          currentPage="dashboard"
          analyzeEnabled={analyzeEnabled}
          campaignsEnabled={campaignsEnabled}
          features={features as any}
        />
      </div>
      <SubHeader crumbs={[{ label: 'Dashboard' }]} isAdmin={user.isAdmin} orgId={orgId} showFilters />

      <main className="max-w-7xl mx-auto px-6 py-8 pt-28">

        {/* Toolbar */}
        <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
          <div className="flex flex-col gap-2">
            {/* Owner filter */}
            <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl p-1 shadow-sm">
              {ownerTabs.map(({ key, label }) => (
                <button key={key} onClick={() => setOwnerFilter(key)}
                  className={'px-4 py-1.5 rounded-lg text-sm font-medium transition-all ' +
                    (ownerFilter === key ? 'text-white shadow-sm' : 'text-gray-500 hover:text-gray-700')}
                  style={ownerFilter === key ? { background: HERMES } : {}}>
                  {label}
                </button>
              ))}
            </div>
            {/* Status filter */}
            <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl p-1 shadow-sm">
              {statusTabs.map(({ key, label }) => (
                <button key={key} onClick={() => setStatusFilter(key)}
                  className={'px-3 py-1 rounded-lg text-xs font-medium transition-all ' +
                    (statusFilter === key ? 'text-white shadow-sm' : 'text-gray-400 hover:text-gray-600')}
                  style={statusFilter === key ? { background: HERMES } : {}}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {/* Date range filter */}
          <div className="flex items-center gap-2">
            <button onClick={() => { setDateFrom(defaultFrom()); setDateTo(defaultTo()) }}
              className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 hover:bg-gray-100 text-gray-600 text-xs transition-colors">Last 30 days</button>
            <button onClick={() => { setDateFrom(''); setDateTo('') }}
              className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 hover:bg-gray-100 text-gray-600 text-xs transition-colors">All time</button>
            <div className="flex items-center gap-1.5">
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-700 text-xs outline-none focus:border-orange-400 transition-colors" />
              <span className="text-gray-400 text-xs">to</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-700 text-xs outline-none focus:border-orange-400 transition-colors" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name…"
              style={{ fontSize: '16px' }}
              className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-700 outline-none w-48 focus:border-orange-400 transition-colors" />
            <label className="flex items-center gap-1.5 text-xs text-gray-400">
              <span>Sort:</span>
              <select value={sortMode} onChange={e => changeSort(e.target.value as 'updated' | 'created' | 'name')}
                className="px-2 py-1 rounded-lg bg-white border border-gray-200 text-gray-700 text-xs outline-none cursor-pointer">
                <option value="updated">Last updated</option>
                <option value="created">Created</option>
                <option value="name">Name</option>
              </select>
            </label>
            <span className="text-sm text-gray-400">{filtered.length} studies</span>
            <Link href="/studies/new"
              className="px-4 py-2 rounded-xl text-white text-sm font-semibold shadow-sm hover:opacity-90 transition-all"
              style={{ background: HERMES }}>
              + New Survey
            </Link>
          </div>
        </div>

        {error && <div className="mb-5 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm">{error}</div>}

        {filtered.length === 0 ? (
          <div className="text-center py-20 border-2 border-dashed border-gray-200 rounded-2xl bg-white">
            <div className="text-4xl mb-3">📋</div>
            <p className="text-gray-500 text-sm">No studies match this filter.</p>
          </div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {(() => {
              const divIdx = firstNonFavIndexStudies(filtered)
              return filtered.map((study, i) => (
                <React.Fragment key={study.id}>
                  {i === divIdx && divIdx > 0 && (
                    <div style={{ gridColumn: '1 / -1', borderTop: '1px solid #fbd5c2', margin: '4px 0 0' }} />
                  )}
                  <StudyCard
                    study={study}
                    stats={statsMap[study.id] || { total: 0, completeCount: 0, promoters: 0, passives: 0, detractors: 0, avgScore: 0, ratingLabel: 'Avg Rating', lastResponse: null }}
                    isAdmin={!!user.isAdmin}
                    userId={user.userId}
                    campaignsEnabled={campaignsEnabled}
                    initialFavorited={favoriteIds.has(study.id)}
                    onPatch={handlePatch}
                    onDelete={handleDelete}
                    onDuplicate={handleDuplicate}
                  />
                </React.Fragment>
              ))
            })()}
          </div>
        )}
      </main>
    </div>
  )
}



