'use client'

import { useState, useEffect } from 'react'
import TopNav from '@/components/nav/TopNav'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface Session {
  id: string
  name: string
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
  user: { email: string; fullName?: string; role?: string; clientName?: string; isAdmin?: boolean }
}

const HERMES = '#E8632A'

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  setup:  { bg: '#f3f4f6', text: '#6b7280', label: 'Setup' },
  active: { bg: '#dcfce7', text: '#166534', label: 'Active' },
  paused: { bg: '#fef3c7', text: '#92400e', label: 'Paused' },
  ended:  { bg: '#e5e7eb', text: '#374151', label: 'Ended' },
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export default function TownHallListClient({ logoUrl, analyzeEnabled, campaignsEnabled, user }: Props) {
  const router = useRouter()
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/townhall/sessions')
      .then(r => r.json())
      .then(data => { setSessions(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

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
        currentPage="townhall"
      />

      <main className="pt-14">
        <div className="max-w-5xl mx-auto px-5 py-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Town Hall</h1>
              <p className="text-sm text-gray-500 mt-1">AI-moderated focus groups at scale</p>
            </div>
            <Link
              href="/townhall/new"
              className="px-4 py-2.5 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-opacity"
              style={{ background: HERMES }}>
              + New Session
            </Link>
          </div>

          {/* Sessions grid */}
          {loading ? (
            <div className="text-center py-20 text-gray-400 text-sm">Loading sessions...</div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-20">
              <div className="text-4xl mb-3">{'\uD83C\uDFE4'}</div>
              <p className="text-gray-500 text-sm mb-4">No sessions yet. Create your first Town Hall to get started.</p>
              <Link
                href="/townhall/new"
                className="inline-block px-4 py-2 rounded-lg text-white text-sm font-medium hover:opacity-90"
                style={{ background: HERMES }}>
                Create Session
              </Link>
            </div>
          ) : (
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
              {sessions.map(s => {
                const badge = STATUS_BADGE[s.status] || STATUS_BADGE.setup
                const topicCount = s.discussion_guide?.length || 0
                const statusColor = s.status === 'active' ? 'bg-green-100 text-green-700 border-green-200'
                  : s.status === 'ended' ? 'bg-gray-100 text-gray-500 border-gray-200'
                  : 'bg-yellow-50 text-yellow-700 border-yellow-200'
                return (
                  <Link
                    key={s.id}
                    href={'/townhall/' + s.id}
                    className="bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md hover:border-orange-200 transition-all flex flex-col overflow-hidden">

                    {/* Color strip */}
                    <div className="h-1.5 w-full" style={{ background: s.status === 'active' ? 'linear-gradient(135deg, #22c55e, #16a34a)' : s.status === 'ended' ? 'linear-gradient(135deg, #9ca3af, #6b7280)' : 'linear-gradient(135deg,' + HERMES + ',#c44d1a)' }} />

                    <div className="p-4 flex flex-col gap-3 flex-1">
                      {/* Title row */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-lg leading-none">{'\uD83C\uDFE4'}</span>
                          <h3 className="font-bold text-gray-800 text-sm truncate">{s.name}</h3>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={'text-xs px-2 py-0.5 rounded-full border font-medium ' + statusColor}>
                            {badge.label}
                          </span>
                          <span className="text-xs text-gray-400">{formatDate(s.created_at)}</span>
                        </div>
                      </div>

                      {/* Opening question preview */}
                      {s.config?.opening_question && (
                        <p className="text-xs text-gray-400 italic line-clamp-2">"{s.config.opening_question}"</p>
                      )}

                      {/* Stats row */}
                      <div className="grid grid-cols-3 gap-1.5 mt-auto pt-2 border-t border-gray-100">
                        <div className="text-center">
                          <div className="text-base font-black" style={{ color: HERMES }}>{topicCount}</div>
                          <div className="text-[10px] text-gray-400 font-medium">Topics</div>
                        </div>
                        <div className="text-center">
                          <div className="text-base font-black" style={{ color: HERMES }}>{s.participants}</div>
                          <div className="text-[10px] text-gray-400 font-medium">Joined</div>
                        </div>
                        <div className="text-center">
                          <div className="text-base font-black" style={{ color: HERMES }}>{s.turns}</div>
                          <div className="text-[10px] text-gray-400 font-medium">Turns</div>
                        </div>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </main>
    </>
  )
}
