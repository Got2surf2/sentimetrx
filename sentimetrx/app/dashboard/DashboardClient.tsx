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
  const [studies, setStudies] = useState(initial)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [duplicating, setDuplicating] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const statusColor = (s: string) => ({
    active:   'bg-green-500/15 text-green-400 border border-green-500/20',
    draft:    'bg-slate-700/50 text-slate-400 border border-slate-600/20',
    paused:   'bg-yellow-500/15 text-yellow-400 border border-yellow-500/20',
    closed:   'bg-red-500/15 text-red-400 border border-red-500/20',
  }[s] || 'bg-slate-700 text-slate-400')

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
        }),
      })
      if (!res.ok) throw new Error('Failed to duplicate')
      const { id } = await res.json()
      router.push('/studies/' + id + '/edit')
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
      const res = await fetch('/api/studies/' + study.id, { method: 'DELETE' })
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
      <nav className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">💓</span>
          <div>
            <div className="font-bold text-white leading-none">Sentimetrx</div>
            {user.clientName && (
              <div className="text-xs text-slate-500 mt-0.5">{user.clientName}</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-slate-500 text-sm hidden sm:block">{user.email}</span>
          <form action="/api/auth/signout" method="POST
