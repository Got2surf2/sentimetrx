'use client'

import { useState } from 'react'
import TopNav from '@/components/nav/TopNav'
import SubHeader from '@/components/nav/SubHeader'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Study {
  id: string; guid: string; name: string; bot_name: string; bot_emoji: string
  status: string; visibility: string; created_by: string; created_at: string
  config: any; org_id?: string; orgName?: string; creatorName?: string
}
interface StudyStats { total: number; promoters: number; passives: number; detractors: number; avgNps: number }
interface Props {
  logoUrl?: string; orgId?: string
  user: { email: string; fullName?: string; role?: string; clientName?: string; isAdmin?: boolean; userId: string }
  studies: Study[]; statsMap: Record<string, StudyStats>
}
type Filter = 'all' | 'mine' | 'public'

export default function DashboardClient({ user, studies: initialStudies, logoUrl = '', orgId = '', statsMap }: Props) {
  const [studies,        setStudies]        = useState(initialStudies)
  const [deleting,       setDeleting]       = useState<string | null>(null)
  const [deleteConfirm,  setDeleteConfirm]  = useState<string | null>(null)
  const [duplicating,    setDuplicating]    = useState<string | null>(null)
  const [togglingStatus, setTogglingStatus] = useState<string | null>(null)
  const [togglingVis,    setTogglingVis]    = useState<string | null>(null)
  const [filter,         setFilter]         = useState<Filter>('all')
  const [error,          setError]          = useState<string | null>(null)
  const router = useRouter()

  const statusBadge = (s: string) => {
    if (s === 'active') return 'bg-green-100 text-green-700 border border-green-200'
    if (s === 'draft')  return 'bg-gray-100 text-gray-500 border border-gray-200'
    if (s === 'closed') return 'bg-red-100 text-red-600 border border-red-200'
    return 'bg-gray-100 text-gray-500'
  }
  const visBadge = (v: string) => v === 'public'
    ? 'bg-blue-100 text-blue-600 border border-blue-200'
    : 'bg-gray-100 text-gray-400 border border-gray-200'

  const filtered = studies.filter(s => {
    if (filter === 'mine')   return s.created_by === user.userId
    if (filter === 'public') return s.visibility === 'public'
    return true
  })

  const patch = async (studyId: string, body: object) => {
    const res = await fetch('/api/studies/' + studyId, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error('Failed')
  }

  const handleToggleStatus = async (study: Study) => {
    const next = study.status === 'draft' ? 'active' : study.status === 'active' ? 'draft' : null
    if (!next) return
    setTogglingStatus(study.id)
    try { await patch(study.id, { status: next }); setStudies(p => p.map(s => s.id === study.id ? { ...s, status: next } : s)) }
    catch { setError('Failed to update status.') }
    finally { setTogglingStatus(null) }
  }

  const handleClose = async (study: Study) => {
    setTogglingStatus(study.id)
    try { await patch(study.id, { status: 'closed' }); setStudies(p => p.map(s => s.id === study.id ? { ...s, status: 'closed' } : s)) }
    catch { setError('Failed to close study.') }
    finally { setTogglingStatus(null) }
  }

  const handleToggleVis = async (study: Study) => {
    const newVis = study.visibility === 'public' ? 'private' : 'public'
    setTogglingVis(study.id)
    try { await patch(study.id, { visibility: newVis }); setStudies(p => p.map(s => s.id === study.id ? { ...s, visibility: newVis } : s)) }
    catch { setError('Failed to update visibility.') }
    finally { setTogglingVis(null) }
  }

  const handleDuplicate = async (study: Study) => {
    setDuplicating(study.id)
    try {
      const res = await fetch('/api/studies', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: study.name + ' (copy)', bot_name: study.bot_name, bot_emoji: study.bot_emoji, config: study.config, visibility: 'private' }) })
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      router.push('/studies/' + data.id + '/edit')
    } catch { setError('Failed to duplicate.'); setDuplicating(null) }
  }

  const handleDelete = async (study: Study) => {
    if (deleteConfirm !== study.id) { setDeleteConfirm(study.id); return }
    setDeleting(study.id); setDeleteConfirm(null)
    try { const res = await fetch('/api/studies/' + study.id, { method: 'DELETE' }); if (!res.ok) throw new Error('Failed'); setStudies(p => p.filter(s => s.id !== study.id)) }
    catch { setError('Failed to delete.') }
    finally { setDeleting(null) }
  }

  const isOwner = (s: Study) => s.created_by === user.userId
  const canEdit = (s: Study) => isOwner(s) || !!user.isAdmin

  return (
    <div className="min-h-screen bg-gray-50">
      <TopNav logoUrl={logoUrl} orgName={user.clientName} isAdmin={user.isAdmin} userEmail={user.email} currentPage="dashboard" />
      <SubHeader
        crumbs={[{ label: 'Dashboard' }]}
        isAdmin={user.isAdmin}
        orgId={orgId}
        showFilters
      />

      <main className="max-w-5xl mx-auto px-6 py-8">

        {/* Toolbar */}
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl p-1 shadow-sm">
            {(['all', 'mine', 'public'] as Filter[]).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={'px-4 py-1.5 rounded-lg text-sm font-medium transition-all ' +
                  (filter === f ? 'text-white shadow-sm' : 'text-gray-500 hover:text-gray-700')}
                style={filter === f ? { background: '#E8632A' } : {}}>
                {f === 'all' ? 'All' : f === 'mine' ? 'Mine' : 'Public'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400">{filtered.length} studies</span>
            <Link href="/studies/new"
              className="px-4 py-2 rounded-xl text-white text-sm font-semibold shadow-sm transition-all hover:opacity-90"
              style={{ background: '#E8632A' }}>
              + New Study
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
          <div className="flex flex-col gap-2">
            {filtered.map(study => {
              const st = statsMap[study.id] || { total: 0, promoters: 0, passives: 0, detractors: 0, avgNps: 0 }
              const theme = study.config?.theme || {}
              const headerBg = theme.headerGradient || 'linear-gradient(135deg,#E8632A,#c44d1a)'
              const promoterPct  = st.total > 0 ? Math.round(st.promoters  / st.total * 100) + '%' : '—'
              const detractorPct = st.total > 0 ? Math.round(st.detractors / st.total * 100) + '%' : '—'

              return (
                <div key={study.id}
                  className="group relative bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-orange-300 hover:shadow-md transition-all">
                  <div className="flex items-center gap-3">

                    {/* Emoji */}
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center text-xl flex-shrink-0"
                      style={{ background: headerBg }}>
                      {study.bot_emoji}
                    </div>

                    {/* Main info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-800 text-sm truncate">{study.name}</span>
                        <span className={'text-xs px-1.5 py-0.5 rounded-full font-medium ' + statusBadge(study.status)}>
                          {study.status}
                        </span>
                        <span className={'text-xs px-1.5 py-0.5 rounded-full ' + visBadge(study.visibility)}>
                          {study.visibility}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap mt-0.5 text-xs text-gray-400">
                        <span>{study.bot_name}</span>
                        {user.isAdmin && study.orgName && (
                          <><span>·</span>
                          <button onClick={() => { const p = new URLSearchParams(window.location.search); p.set('org', study.org_id || ''); p.delete('user'); window.location.href = window.location.pathname + '?' + p.toString() }}
                            className="text-orange-500 hover:text-orange-600 hover:underline">{study.orgName}</button></>
                        )}
                        {study.creatorName && (
                          <><span>·</span>
                          <button onClick={() => { const p = new URLSearchParams(window.location.search); p.set('user', study.created_by); window.location.href = window.location.pathname + '?' + p.toString() }}
                            className="hover:text-gray-600 hover:underline">{study.creatorName}</button></>
                        )}
                        <span>· {new Date(study.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>

                    {/* Stats */}
                    <div className="hidden sm:flex items-center gap-5 flex-shrink-0 text-center">
                      <div><div className="text-sm font-bold text-gray-700">{st.total}</div><div className="text-xs text-gray-400">Responses</div></div>
                      <div><div className="text-sm font-bold text-gray-700">{st.total > 0 ? st.avgNps : '—'}</div><div className="text-xs text-gray-400">Avg NPS</div></div>
                      <div><div className="text-sm font-bold text-green-600">{promoterPct}</div><div className="text-xs text-gray-400">Promoters</div></div>
                      <div><div className="text-sm font-bold text-red-500">{detractorPct}</div><div className="text-xs text-gray-400">Detractors</div></div>
                    </div>

                    {/* Hover actions */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <Link href={'/studies/' + study.id + '/analytics'}
                        className="text-xs px-2.5 py-1.5 rounded-lg text-white font-medium transition-all hover:opacity-90"
                        style={{ background: '#E8632A' }}>Analytics</Link>
                      <Link href={'/studies/' + study.id + '/responses'}
                        className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors">Responses</Link>
                      {canEdit(study) && (
                        <Link href={'/studies/' + study.id + '/edit'}
                          className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors">Edit</Link>
                      )}
                      {study.status === 'active' && (
                        <Link href={'/studies/' + study.id + '/deploy'}
                          className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors">Deploy</Link>
                      )}
                      {canEdit(study) && study.status !== 'closed' && (
                        <button onClick={() => handleToggleStatus(study)} disabled={togglingStatus === study.id}
                          className={'text-xs px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-40 ' +
                            (study.status === 'draft' ? 'bg-green-100 hover:bg-green-200 text-green-700' : 'bg-gray-100 hover:bg-gray-200 text-gray-600')}>
                          {study.status === 'draft' ? 'Publish' : 'Unpublish'}
                        </button>
                      )}
                      {canEdit(study) && study.status !== 'closed' && (
                        <button onClick={() => handleClose(study)} disabled={togglingStatus === study.id}
                          className="text-xs px-2.5 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 transition-colors disabled:opacity-40">
                          Close
                        </button>
                      )}
                      {canEdit(study) && (
                        <button onClick={() => handleToggleVis(study)} disabled={togglingVis === study.id}
                          className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500 transition-colors disabled:opacity-40">
                          {study.visibility === 'public' ? 'Make private' : 'Make public'}
                        </button>
                      )}
                      <button onClick={() => handleDuplicate(study)} disabled={duplicating === study.id}
                        className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500 transition-colors disabled:opacity-40">
                        {duplicating === study.id ? '...' : 'Duplicate'}
                      </button>
                      {canEdit(study) && (
                        deleteConfirm === study.id
                          ? <div className="flex gap-1">
                              <button onClick={() => handleDelete(study)} disabled={deleting === study.id}
                                className="text-xs px-2.5 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white transition-colors">
                                {deleting === study.id ? '...' : 'Confirm'}
                              </button>
                              <button onClick={() => setDeleteConfirm(null)}
                                className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500 transition-colors">Cancel</button>
                            </div>
                          : <button onClick={() => handleDelete(study)}
                              className="text-xs px-2.5 py-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">Delete</button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
