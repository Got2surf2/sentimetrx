'use client'

// app/bots/[id]/knowledge/health/KbHealthClient.tsx
// KB Health view — inventory of the agent's knowledge chunks so the team can
// keep the base tight as answered questions feed into it: counts + size, source
// breakdown, age (staleness), and prune actions (per chunk, or clear a whole
// source). Reads GET /api/bots/[id]/knowledge; prunes via the existing DELETE
// endpoints. Retrieval-recency ("last used") is intentionally NOT shown — it
// isn't tracked yet, and we don't invent it.

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import LottieLoader from '@/components/ui/LottieLoader'

interface Chunk {
  id: string
  title: string
  content: string
  metadata: { source?: string; source_type?: string; sentiment?: string; logged_question_id?: string } | null
  created_at: string
}

const SOURCE_LABEL: Record<string, string> = {
  logged_qa: 'Answered question',
}
function sourceOf(c: Chunk): string { return c.metadata?.source_type || 'other' }
function sourceLabel(st: string): string { return SOURCE_LABEL[st] || (st === 'other' ? 'Imported / other' : st) }

function ageDays(iso: string): number { return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) }
function ageLabel(iso: string): string {
  const d = ageDays(iso)
  if (d <= 0) return 'today'
  if (d === 1) return '1 day'
  if (d < 30) return d + ' days'
  if (d < 365) return Math.floor(d / 30) + ' mo'
  return Math.floor(d / 365) + ' yr'
}

export default function KbHealthClient() {
  const params = useParams()
  const router = useRouter()
  const botId = params.id as string
  const [chunks, setChunks] = useState<Chunk[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sourceFilter, setSourceFilter] = useState<string>('all')
  const [sort, setSort] = useState<'oldest' | 'newest' | 'largest'>('oldest')
  const [q, setQ] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  async function load() {
    setError('')
    try {
      const r = await fetch('/api/bots/' + botId + '/knowledge')
      const d = await r.json()
      if (d?.error) setError(d.error)
      else setChunks(Array.isArray(d?.chunks) ? d.chunks : [])
    } catch { setError('Failed to load knowledge base') }
  }
  useEffect(() => { void load() }, [botId]) // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    const list = chunks || []
    const bySource: Record<string, number> = {}
    let chars = 0
    let oldest: string | null = null
    for (const c of list) {
      const st = sourceOf(c)
      bySource[st] = (bySource[st] || 0) + 1
      chars += (c.content || '').length
      if (!oldest || c.created_at < oldest) oldest = c.created_at
    }
    return { total: list.length, chars, bySource, oldest, fromQa: bySource['logged_qa'] || 0 }
  }, [chunks])

  const visible = useMemo(() => {
    let list = (chunks || []).slice()
    if (sourceFilter !== 'all') list = list.filter(c => sourceOf(c) === sourceFilter)
    if (q.trim()) {
      const nq = q.toLowerCase()
      list = list.filter(c => (c.title || '').toLowerCase().includes(nq) || (c.content || '').toLowerCase().includes(nq))
    }
    list.sort((a, b) => {
      if (sort === 'largest') return (b.content || '').length - (a.content || '').length
      if (sort === 'newest') return a.created_at < b.created_at ? 1 : -1
      return a.created_at > b.created_at ? 1 : -1 // oldest first
    })
    return list
  }, [chunks, sourceFilter, q, sort])

  async function deleteChunk(id: string) {
    if (!confirm('Delete this knowledge entry? The agent will no longer use it.')) return
    setBusy(true)
    try {
      const r = await fetch('/api/bots/' + botId + '/knowledge/' + id, { method: 'DELETE' })
      if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Delete failed'); return }
      setChunks(prev => (prev || []).filter(c => c.id !== id))
    } catch { alert('Delete failed') }
    finally { setBusy(false) }
  }

  async function clearSource(st: string) {
    const n = stats.bySource[st] || 0
    if (!confirm('Remove all ' + n + ' "' + sourceLabel(st) + '" entries from the knowledge base? This cannot be undone.')) return
    setBusy(true)
    try {
      const r = await fetch('/api/bots/' + botId + '/knowledge?source_type=' + encodeURIComponent(st), { method: 'DELETE' })
      if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Clear failed'); return }
      setChunks(prev => (prev || []).filter(c => sourceOf(c) !== st))
    } catch { alert('Clear failed') }
    finally { setBusy(false) }
  }

  if (!chunks && !error) {
    return <div style={{ maxWidth: 900, margin: '0 auto', padding: '64px 24px', textAlign: 'center' }}><LottieLoader message="Loading knowledge base…" /></div>
  }

  const sources = Object.keys(stats.bySource).sort((a, b) => stats.bySource[b] - stats.bySource[a])

  return (
    <div className="max-w-4xl mx-auto px-6 py-6">
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div>
          <button onClick={() => router.push('/bots')} className="text-sm text-gray-500 hover:text-gray-800">&larr; Agents</button>
          <h1 className="text-2xl font-semibold text-gray-900 mt-1">Knowledge base health</h1>
          <p className="text-sm text-gray-600 mt-1">What the agent knows, and how to keep it tight as answered questions feed in.</p>
        </div>
        <button onClick={() => router.push('/bots/' + botId + '/knowledge')} className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-white">Manage knowledge</button>
      </div>

      {error && <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm text-red-600">{error}</div>}

      {!error && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            {[
              { label: 'Entries', value: String(stats.total) },
              { label: 'Total size', value: (stats.chars / 1000).toFixed(1) + 'k chars' },
              { label: 'From answered Qs', value: String(stats.fromQa) },
              { label: 'Oldest entry', value: stats.oldest ? ageLabel(stats.oldest) : '—' },
            ].map(s => (
              <div key={s.label} className="bg-white border border-gray-200 rounded-lg p-3">
                <div className="text-xl font-semibold text-gray-900">{s.value}</div>
                <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Source breakdown + clear */}
          <div className="bg-white border border-gray-200 rounded-lg p-4 mb-5">
            <div className="text-sm font-semibold text-gray-900 mb-2">By source</div>
            {sources.length === 0 && <div className="text-sm text-gray-500">No knowledge entries yet.</div>}
            <div className="flex flex-col gap-2">
              {sources.map(st => (
                <div key={st} className="flex items-center justify-between gap-2">
                  <span className="text-sm text-gray-700">{sourceLabel(st)} · <span className="text-gray-500">{stats.bySource[st]}</span></span>
                  <button disabled={busy} onClick={() => { void clearSource(st) }} className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50">Clear all</button>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-3">Note: how often each entry is actually used in answers isn’t tracked yet — prune by age, source, and relevance for now.</p>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search entries…"
              style={{ fontSize: '16px' }}
              className="flex-1 min-w-[160px] border border-gray-200 rounded-md px-3 py-1.5 focus:outline-none focus:border-teal-400"
            />
            <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} className="border border-gray-200 rounded-md px-2 py-1.5 text-sm">
              <option value="all">All sources</option>
              {sources.map(st => <option key={st} value={st}>{sourceLabel(st)}</option>)}
            </select>
            <select value={sort} onChange={e => setSort(e.target.value as 'oldest' | 'newest' | 'largest')} className="border border-gray-200 rounded-md px-2 py-1.5 text-sm">
              <option value="oldest">Oldest first</option>
              <option value="newest">Newest first</option>
              <option value="largest">Largest first</option>
            </select>
          </div>

          {/* List */}
          <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-200">
            {visible.length === 0 && <div className="p-4 text-sm text-gray-500">No entries match.</div>}
            {visible.map(c => {
              const st = sourceOf(c)
              const isOpen = !!expanded[c.id]
              return (
                <div key={c.id} className="p-3">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 break-words">{c.title || '(untitled)'}</div>
                      <div className="text-xs text-gray-500 mt-1 flex items-center gap-2 flex-wrap">
                        <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{sourceLabel(st)}</span>
                        <span>{ageLabel(c.created_at)} old</span>
                        <span>· {(c.content || '').length} chars</span>
                        <button onClick={() => setExpanded(p => ({ ...p, [c.id]: !isOpen }))} className="text-teal-700 hover:underline">{isOpen ? 'Hide' : 'View'}</button>
                      </div>
                      {isOpen && <div className="mt-2 text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-md p-2 whitespace-pre-wrap break-words">{c.content}</div>}
                    </div>
                    <button disabled={busy} onClick={() => { void deleteChunk(c.id) }} className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-50 shrink-0">Delete</button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
