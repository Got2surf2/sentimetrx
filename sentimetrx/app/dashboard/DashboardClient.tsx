'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Study {
  id: string
  guid: string
  name: string
  bot_name: string
  bot_emoji: string
  status: string
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
  user: { email: string; fullName?: string; role?: string; clientName?: string }
  studies: Study[]
  statsMap: Record<string, StudyStats>
}  
export default function DashboardClient({ user, studies: initial, statsMap }: Props) {
  const [studies,       setStudies]       = useState(initial)
  const [deleting,      setDeleting]      = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [duplicating,   setDuplicating]   = useState<string | null>(null)
  const [error,         setError]         = useState<string | null>(null)
  const router = useRouter()

  const statusColor = (s: string) => ({
    active:  'bg-green-500/15 text-green-400 border border-green-500/20',
    draft:   'bg-slate-700/50 text-slate-400 border border-slate-600/20',
    paused:  'bg-yellow-500/15 text-yellow-400 border border-yellow-500/20',
    closed:  'bg-red-500/15 text-red-400 border border-red-500/20',
  }[s] || 'bg-slate-700 text-slate-400')

  const handleDuplicate = async (study: Study) => {
    setDuplicating(study.id)
    setError(null)
    try {
      const res = await fetch('/api/studies', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:      `${study.name} (copy)`,
          bot_name:  study.bot_name,
          bot_emoji: study.bot_emoji,
          config:    study.config,
        }),
      })
      if (!res.ok) throw new Error('Failed to duplicate')
      const { id } = await res.json()
      router.push(`/studies/${id}/edit`)
    } catch {
      setError('Failed to duplicate study. Please try again.')
      setDuplicating(null)
    }
  }

  const handleDelete = async (study: Study) => {
    if (deleteConfirm !== study.id) {
      setDeleteConfirm(study.id)
      return
    }
    setDeleting(study.id)
    setDeleteConfirm(null)
    setError(null)
    try {
      const res = await fetch(`/api/studies/${study.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      setStudies(prev => prev.filter(s => s.id !== study.id))
    } catch {
      setError('Failed to delete study. Please try again.')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">

      {/* Nav */}
      <nav className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">💓</span>
          <div>
            <div className="font-bold text-white leading-none">Sentimetrx</div>
            {user.clientName && (
            <div className="text-xs text-slate-500 mt-0.5">{user.clientName}</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-slate-500 text-sm hidden sm:block">{user.email}</span>
          <form action="/api/auth/signout" method="POST">
            <button className="text-xs text-slate-500 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-slate-800">
              Sign out
            </button>
          </form>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Studies</h1>
            <p className="text-slate-400 text-sm mt-1">
              {studies.length} {studies.length === 1 ? 'study' : 'studies'}
            </p>
          </div>
          <Link
            href="/studies/new"
            className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-semibold text-sm transition-all flex items-center gap-2"
          >
            <span className="text-base leading-none">+</span>
            New Study
          </Link>
        </div>

        {error && (
          <div className="mb-6 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Studies list */}
        {studies.length === 0 ? (
          <div className="text-center py-20 border border-dashed border-slate-700 rounded-2xl">
            <div className="text-4xl mb-4">📋</div>
            <h2 className="text-white font-medium mb-2">No studies yet</h2>
            <p className="text-slate-500 text-sm mb-6">Create your first study to start collecting feedback.</p>
            <Link
              href="/studies/new"
              className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-semibold text-sm transition-all inline-block"
            >
              Create First Study
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {studies.map(study => {
              const st = statsMap[study.id] || { total: 0, promoters: 0, passives: 0, detractors: 0, avgNps: 0 }
              const isDeleting    = deleting    === study.id
              const isDuplicating = duplicating === study.id
              const confirmDelete = deleteConfirm === study.id
              const theme = study.config?.theme || {}

              return (
                <div
                  key={study.id}
                  className="bg-slate-900 border border-slate-800 rounded-2xl p-5 hover:border-slate-700 transition-colors"
                >
                  <div className="flex items-start gap-4">

                    {/* Bot avatar */}
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
                      style={{ background: theme.headerGradient || 'linear-gradient(135deg,#1e3a5f,#0d1f3c)' }}
                    >
                      {study.bot_emoji}
                    </div>

                    {/* Study info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <h2 className="font-semibold text-white text-base truncate">{study.name}</h2>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(study.status)}`}>
                          {study.status}
                        </span>
                      </div>
                      <div className="text-slate-500 text-xs mt-0.5">
                        {study.bot_name} · Created {new Date(study.created_at).toLocaleDateString()}
                      </div>

                      {/* Stats row */}
                      <div className="flex gap-5 mt-3 flex-wrap">
                        <Stat label="Responses" value={st.total} />
                        <Stat label="Avg NPS"   value={st.total > 0 ? st.avgNps : '—'} />
                        <Stat label="Promoters"  value={st.total > 0 ? `${Math.round(st.promoters / st.total * 100)}%` : '—'} color="text-green-400" />
                        <Stat label="Detractors" value={st.total > 0 ? `${Math.round(st.detractors / st.total * 100)}%` : '—'} color="text-red-400" />
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-1.5 flex-shrink-0 items-end">
                      <Link
                        href={`/studies/${study.id}/responses`}
                        className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors whitespace-nowrap"
                      >
                        View responses
                      </Link>
                      <Link
                        href={`/studies/${study.id}/edit`}
                        className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                      >
                        Edit
                      </Link>
                      {study.status === 'active' && (
                        <Link
                          href={`/studies/${study.id}/deploy`}
                          className="text-xs px-3 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-400 transition-colors"
                        >
                          Deploy
                        </Link>
                      )}
                      <button
                        onClick={() => handleDuplicate(study)}
                        disabled={isDuplicating}
                        className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors disabled:opacity-50"
                      >
                        {isDuplicating ? 'Copying...' : 'Duplicate'}
                      </button>
                      {confirmDelete ? (
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => handleDelete(study)}
                            disabled={isDeleting}
                            className="text-xs px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 transition-colors font-medium"
                          >
                            {isDeleting ? 'Deleting...' : 'Confirm delete'}
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleDelete(study)}
                          className="text-xs px-3 py-1.5 rounded-lg hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-colors"
                        >
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

function Stat({ label, value, color = 'text-white' }: { label: string; value: string | number; color?: string }) {
  return (
    <div>
      <div className={`font-semibold text-sm ${color}`}>{value}</div>
      <div className="text-slate-500 text-xs">{label}</div>
    </div>
  )
}
