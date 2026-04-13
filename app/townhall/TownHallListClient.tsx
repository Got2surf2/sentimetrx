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

          {/* Sessions list */}
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
            <div className="space-y-3">
              {sessions.map(s => {
                const badge = STATUS_BADGE[s.status] || STATUS_BADGE.setup
                const topicCount = s.discussion_guide?.length || 0
                return (
                  <Link
                    key={s.id}
                    href={'/townhall/' + s.id}
                    className="block bg-white rounded-xl border border-gray-200 p-5 hover:border-orange-300 hover:shadow-sm transition-all">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2.5 mb-1">
                          <h3 className="font-semibold text-gray-900 truncate">{s.name}</h3>
                          <span
                            className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0"
                            style={{ background: badge.bg, color: badge.text }}>
                            {badge.label}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400">
                          Created {formatDate(s.created_at)}
                          {s.started_at && (' \u00B7 Started ' + formatTime(s.started_at))}
                          {s.ended_at && (' \u00B7 Ended ' + formatTime(s.ended_at))}
                        </p>
                      </div>

                      <div className="flex items-center gap-5 text-center flex-shrink-0">
                        <div>
                          <div className="text-lg font-bold text-gray-900">{topicCount}</div>
                          <div className="text-[10px] text-gray-400 font-medium">Topics</div>
                        </div>
                        <div>
                          <div className="text-lg font-bold text-gray-900">{s.participants}</div>
                          <div className="text-[10px] text-gray-400 font-medium">Participants</div>
                        </div>
                        <div>
                          <div className="text-lg font-bold text-gray-900">{s.turns}</div>
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
