'use client'

import { useState } from 'react'
import TopNav from '@/components/nav/TopNav'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Study {
  id: string
  guid: string
  name: string
  bot_name: string
  bot_emoji: string
  status: string
  visibility: string
  created_by: string
  created_at: string
  config: any
}

interface StudyStats {
  total: number
  promoters: number
  passives: number
  detractors: number
  avgNps: number
}

interface Props {
  logoUrl?: string
  user: { email: string; fullName?: string; role?: string; clientName?: string; isAdmin?: boolean; userId: string }
  studies: Study[]
  statsMap: Record<string, StudyStats>
}

type Filter = 'all' | 'mine' | 'public'

export default function DashboardClient({ user, studies: initialStudies, logoUrl = '', statsMap }: Props) {
  const [studies,       setStudies]       = useState(initialStudies)
  const [deleting,      setDeleting]      = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [duplicating,   setDuplicating]   = useState<string | null>(null)
  const [togglingStatus, setTogglingStatus] = useState<string | null>(null)
  const [togglingVis,   setTogglingVis]   = useState<string | null>(null)
  const [filter,        setFilter]        = useState<Filter>('all')
  const [error,         setError]         = useState<string | null>(null)
  const router = useRouter()

  const getStatusClass = (s: string) => {
    if (s === 'active')  return 'bg-green-500/15 text-green-400 border border-green-500/20'
    if (s === 'draft')   return 'bg-slate-700/50 text-slate-400 border border-slate-600/20'
    if (s === 'paused')  return 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/20'
    if (s === 'closed')  return 'bg-red-500/15 text-red-400 border border-red-500/20'
    return 'bg-slate-700 text-slate-400'
  }

  const visClass = (v: string) =>
    v === 'public'
      ? 'bg-blue-500/15 text-blue-400'
      : 'bg-slate-700/50 text-slate-400'

  const filtered = studies.filter(s => {
    if (filter === 'mine')   return s.created_by === user.userId
    if (filter === 'public') return s.visibility === 'public'
    return true
  })

  const handleToggleVisibility = async (study: Study) => {
    if (study.created_by !== user.userId && !user.isAdmin) return
    const newVis = study.visibility === 'public' ? 'private' : 'public'
    setTogglingVis(study.id)
    setError(null)
    try {
      const res = await fetch('/api/studies/' + study.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: newVis }),
      })
      if (!res.ok) throw new Error('Failed')
      setStudies(prev => prev.map(s => s.id === study.id ? { ...s, visibility: newVis } : s))
    } catch {
      setError('Failed to update visibility.')
    } finally {
      setTogglingVis(null)
    }
  }


  const handleToggleStatus = async (study: Study) => {
    const newStatus = study.status === 'draft' ? 'active' : study.status === 'active' ? 'draft' : null
    if (!newStatus) return
    setTogglingStatus(study.id)
    setError(null)
    try {
      const res = await fetch('/api/studies/' + study.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) throw new Error('Failed')
      setStudies(prev => prev.map(s => s.id === study.id ? { ...s, status: newStatus } : s))
    } catch {
      setError('Failed to update status.')
    } finally {
      setTogglingStatus(null)
    }
  }

  const handleDuplicate = async (study: Study) => {
    setDuplicating(study.id)
    setError(null)
    try {
      const res = await fetch('/api/studies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: study.name + ' (copy)',
          bot_name: study.bot_name,
          bot_emoji: study.bot_emoji,
          config: study.config,
          visibility: 'private',
        }),
      })
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      router.push('/studies/' + data.id + '/edit')
    } catch {
      setError('Failed to duplicate study.')
      setDuplicating(null)
    }
  }

  const handleDelete = async (study: Study) => {
    if (deleteConfirm !== study.id) { setDeleteConfirm(study.id); return }
    setDeleting(study.id)
    setDeleteConfirm(null)
    setError(null)
    try {
      const res = await fetch('/api/studies/' + study.id, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      setStudies(prev => prev.filter(s => s.id !== study.id))
    } catch {
      setError('Failed to delete study.')
    } finally {
      setDeleting(null)
    }
  }

  const isOwner = (study: Study) => study.created_by === user.userId

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <TopNav logoUrl={logoUrl} orgName={user.clientName} isAdmin={user.isAdmin} userEmail={user.email} />

      <main className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Studies</h1>
            <p className="text-slate-400 text-sm mt-1">{filtered.length} of {studies.length} shown</p>
          </div>
          <Link href="/studies/new" className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-semibold text-sm transition-all">
            + New Study
          </Link>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 mb-6 bg-slate-900 border border-slate-800 rounded-xl p-1 w-fit">
          {(['all', 'mine', 'public'] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={'px-4 py-2 rounded-lg text-sm font-medium transition-all capitalize ' + (filter === f ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-white')}
            >
              {f === 'all' ? 'All studies' : f === 'mine' ? 'My studies' : 'Public studies'}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-6 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
        )}

        {filtered.length === 0 && (
          <div className="text-center py-20 border border-dashed border-slate-700 rounded-2xl">
            <div className="text-4xl mb-4">📋</div>
            <h2 className="text-white font-medium mb-2">No studies found</h2>
            <p className="text-slate-500 text-sm mb-6">
              {filter === 'mine' ? 'You have not created any studies yet.' : 'No studies match this filter.'}
            </p>
            {filter === 'mine' && (
              <Link href="/studies/new" className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-semibold text-sm transition-all inline-block">
                Create First Study
              </Link>
            )}
          </div>
        )}

        {filtered.length > 0 && (
          <div className="flex flex-col gap-3">
            {filtered.map(study => {
              const st           = statsMap[study.id] || { total: 0, promoters: 0, passives: 0, detractors: 0, avgNps: 0 }
              const isDeleting   = deleting    === study.id
              const isDuplicating = duplicating === study.id
              const confirmDelete = deleteConfirm === study.id
              const canEdit      = isOwner(study) || !!user.isAdmin
              const theme        = study.config && study.config.theme ? study.config.theme : {}
              const headerBg     = theme.headerGradient || 'linear-gradient(135deg,#1e3a5f,#0d1f3c)'
              const promoterPct  = st.total > 0 ? Math.round(st.promoters  / st.total * 100) + '%' : '---'
              const detractorPct = st.total > 0 ? Math.round(st.detractors / st.total * 100) + '%' : '---'

              return (
                <div key={study.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 hover:border-slate-700 transition-colors">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0" style={{ background: headerBg }}>
                      {study.bot_emoji}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <h2 className="font-semibold text-white text-base truncate">{study.name}</h2>
                        <span className={'text-xs px-2 py-0.5 rounded-full font-medium ' + getStatusClass(study.status)}>
                          {study.status}
                        </span>
                        <span className={'text-xs px-2 py-0.5 rounded-full font-medium ' + visClass(study.visibility)}>
                          {study.visibility}
                        </span>
                        {!isOwner(study) && (
                          <span className="text-xs text-slate-600">shared</span>
                        )}
                      </div>
                      <div className="text-slate-500 text-xs mb-3">
                        {study.bot_name} · Created {new Date(study.created_at).toLocaleDateString()}
                      </div>
                      <div className="flex gap-5 flex-wrap">
                        <div><div className="font-semibold text-sm text-white">{st.total}</div><div className="text-slate-500 text-xs">Responses</div></div>
                        <div><div className="font-semibold text-sm text-white">{st.total > 0 ? st.avgNps : '---'}</div><div className="text-slate-500 text-xs">Avg NPS</div></div>
                        <div><div className="font-semibold text-sm text-green-400">{promoterPct}</div><div className="text-slate-500 text-xs">Promoters</div></div>
                        <div><div className="font-semibold text-sm text-red-400">{detractorPct}</div><div className="text-slate-500 text-xs">Detractors</div></div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5 flex-shrink-0 items-end">
                      <Link href={'/studies/' + study.id + '/analytics'} className="text-xs px-3 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-400 transition-colors whitespace-nowrap">
                        Analytics
                      </Link>
                      <Link href={'/studies/' + study.id + '/responses'} className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors whitespace-nowrap">
                        Responses
                      </Link>
                      {canEdit && (
                        <Link href={'/studies/' + study.id + '/edit'} className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors">
                          Edit
                        </Link>
                      )}
                      {study.status === 'active' && (
                        <Link href={'/studies/' + study.id + '/deploy'} className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors">
                          Deploy
                        </Link>
                      )}
                      {canEdit && study.status !== 'closed' && (
                        <button
                          onClick={() => handleToggleStatus(study)}
                          disabled={togglingStatus === study.id}
                          className={'text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 ' + (study.status === 'draft' ? 'bg-green-500/15 hover:bg-green-500/25 text-green-400' : 'bg-slate-800 hover:bg-slate-700 text-slate-300')}
                        >
                          {togglingStatus === study.id ? '...' : study.status === 'draft' ? 'Publish' : 'Unpublish'}
                        </button>
                      )}
                      {canEdit && (
                        <button
                          onClick={() => handleToggleVisibility(study)}
                          disabled={togglingVis === study.id || study.status === 'closed'}
                          className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors disabled:opacity-40"
                        >
                          {togglingVis === study.id ? '...' : study.visibility === 'public' ? 'Make private' : 'Make public'}
                        </button>
                      )}
                      <button
                        onClick={() => handleDuplicate(study)}
                        disabled={isDuplicating}
                        className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors disabled:opacity-50"
                      >
                        {isDuplicating ? 'Copying...' : 'Duplicate'}
                      </button>
                      {canEdit && confirmDelete && (
                        <div className="flex gap-1.5">
                          <button onClick={() => handleDelete(study)} disabled={isDeleting} className="text-xs px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 transition-colors font-medium">
                            {isDeleting ? 'Deleting...' : 'Confirm'}
                          </button>
                          <button onClick={() => setDeleteConfirm(null)} className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 transition-colors">
                            Cancel
                          </button>
                        </div>
                      )}
                      {canEdit && !confirmDelete && (
                        <button onClick={() => handleDelete(study)} className="text-xs px-3 py-1.5 rounded-lg hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-colors">
                          Delete
                        </button>
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
