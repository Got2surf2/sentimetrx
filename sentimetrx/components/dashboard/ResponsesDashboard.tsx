'use client'
import TopNav from '@/components/nav/TopNav'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

interface Response {
  id:               string
  study_id:         string
  sentiment:        string | null
  experience_score: number | null
  nps_score:        number | null
  payload:          any
  completed_at:     string
  duration_sec:     number | null
}

interface Props {
  studyId:    string
  studyName:  string
  botEmoji:   string
  logoUrl?:   string
  isAdmin?:   boolean
  userEmail?: string
}

const SENTIMENTS = ['', 'promoter', 'passive', 'detractor']

export default function ResponsesDashboard({ studyId, studyName, botEmoji, logoUrl='', isAdmin=false, userEmail='' }: Props) {
  const [responses,  setResponses]  = useState<Response[]>([])
  const [total,      setTotal]      = useState(0)
  const [loading,    setLoading]    = useState(true)
  const [exporting,  setExporting]  = useState(false)
  const [exportModal, setExportModal] = useState(false)
  const [selected,   setSelected]   = useState<Response | null>(null)

  // Filters
  const [sentiment, setSentiment] = useState('')
  const [minNps,    setMinNps]    = useState('')
  const [maxNps,    setMaxNps]    = useState('')
  const [from,      setFrom]      = useState('')
  const [to,        setTo]        = useState('')
  const [offset,    setOffset]    = useState(0)
  const LIMIT = 25

  const fetchResponses = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (sentiment) params.set('sentiment', sentiment)
    if (minNps)    params.set('min_nps',   minNps)
    if (maxNps)    params.set('max_nps',   maxNps)
    if (from)      params.set('from',      from)
    if (to)        params.set('to',        to)
    params.set('limit',  String(LIMIT))
    params.set('offset', String(offset))

    const res  = await fetch(`/api/studies/${studyId}/responses?${params}`)
    const json = await res.json()
    setResponses(json.data || [])
    setTotal(json.count || 0)
    setLoading(false)
  }, [studyId, sentiment, minNps, maxNps, from, to, offset])

  useEffect(() => { fetchResponses() }, [fetchResponses])

  const applyFilters = () => { setOffset(0); fetchResponses() }

  const handleExport = async () => {
    setExporting(true)
    const params = new URLSearchParams()
    if (sentiment) params.set('sentiment', sentiment)
    if (minNps)    params.set('min_nps',   minNps)
    if (maxNps)    params.set('max_nps',   maxNps)
    if (from)      params.set('from',      from)
    if (to)        params.set('to',        to)
    params.set('export', 'csv')

    const res  = await fetch(`/api/studies/${studyId}/responses?${params}`)
    const blob = await res.blob()
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `responses-${studyId}-${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setExporting(false)
  }

  // Stats from loaded responses
  const promoters  = responses.filter(r => r.sentiment === 'promoter').length
  const passives   = responses.filter(r => r.sentiment === 'passive').length
  const detractors = responses.filter(r => r.sentiment === 'detractor').length
  const avgNps     = responses.length > 0
    ? (responses.reduce((s, r) => s + (r.nps_score || 0), 0) / responses.length).toFixed(1)
    : '—'

  const sentimentColor = (s: string | null) => ({
    promoter:  'bg-green-500/15 text-green-400',
    passive:   'bg-yellow-500/15 text-yellow-400',
    detractor: 'bg-red-500/15 text-red-400',
  }[s || ''] || 'bg-slate-700 text-slate-400')

  return (
    <div className="min-h-screen bg-slate-950 text-white">

      <nav className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">💓</span>
          <span className="font-bold text-white">Sentimetrx</span>
        </div>
        <Link href="/dashboard" className="text-sm text-slate-500 hover:text-white transition-colors">
          Dashboard
        </Link>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <div>
            <h1 className="text-xl font-bold text-white">{botEmoji} {studyName}</h1>
            <p className="text-slate-400 text-sm mt-0.5">Response dashboard — {total} total</p>
          </div>
          <button
            onClick={handleExport}
            disabled={exporting || total === 0}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white text-sm font-medium transition-all"
          >
            {exporting ? 'Exporting...' : 'Export CSV'}
          </button>
        </div>

        {/* Filters */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 mb-6">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-slate-400 font-medium">Sentiment</label>
              <select
                value={sentiment}
                onChange={e => setSentiment(e.target.value)}
                className="px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm outline-none focus:border-cyan-500 transition-colors cursor-pointer"
              >
                <option value="">All</option>
                <option value="promoter">Promoters</option>
                <option value="passive">Passives</option>
                <option value="detractor">Detractors</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-slate-400 font-medium">NPS score</label>
              <div className="flex gap-2 items-center">
                <select
                  value={minNps}
                  onChange={e => setMinNps(e.target.value)}
                  className="px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm outline-none focus:border-cyan-500 transition-colors cursor-pointer"
                >
                  <option value="">Min</option>
                  {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                <span className="text-slate-500 text-sm">to</span>
                <select
                  value={maxNps}
                  onChange={e => setMaxNps(e.target.value)}
                  className="px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm outline-none focus:border-cyan-500 transition-colors cursor-pointer"
                >
                  <option value="">Max</option>
                  {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-slate-400 font-medium">Date range</label>
              <div className="flex gap-2 items-center">
                <input
                  type="date"
                  value={from}
                  onChange={e => setFrom(e.target.value)}
                  className="px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm outline-none focus:border-cyan-500 transition-colors"
                />
                <span className="text-slate-500 text-sm">to</span>
                <input
                  type="date"
                  value={to}
                  onChange={e => setTo(e.target.value)}
                  className="px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm outline-none focus:border-cyan-500 transition-colors"
                />
              </div>
            </div>

            <button
              onClick={applyFilters}
              className="px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-semibold text-sm transition-all"
            >
              Apply filters
            </button>
            {(sentiment || minNps || maxNps || from || to) && (
              <button
                onClick={() => {
                  setSentiment(''); setMinNps(''); setMaxNps(''); setFrom(''); setTo(''); setOffset(0)
                }}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 text-sm transition-all"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Stats row */}
        {responses.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <StatCard label="Showing"    value={responses.length} sub={`of ${total}`} />
            <StatCard label="Avg NPS"    value={avgNps} />
            <StatCard label="Promoters"  value={`${Math.round(promoters / responses.length * 100)}%`} color="text-green-400" />
            <StatCard label="Detractors" value={`${Math.round(detractors / responses.length * 100)}%`} color="text-red-400" />
          </div>
        )}

        {/* Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-slate-500 text-sm">Loading...</div>
          ) : responses.length === 0 ? (
            <div className="py-16 text-center">
              <div className="text-3xl mb-3">📭</div>
              <p className="text-slate-500 text-sm">No responses match your filters.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-800">
                      <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Date</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Sentiment</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Exp.</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">NPS</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">First response</th>
                      <th className="px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {responses.map(r => (
                      <tr
                        key={r.id}
                        className="hover:bg-slate-800/40 transition-colors cursor-pointer"
                        onClick={() => setSelected(r)}
                      >
                        <td className="px-5 py-3.5 text-sm text-slate-300 whitespace-nowrap">
                          {new Date(r.completed_at).toLocaleDateString()}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`text-xs px-2.5 py-1 rounded-full font-medium capitalize ${sentimentColor(r.sentiment)}`}>
                            {r.sentiment || '—'}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-sm text-slate-300">{r.experience_score ?? '—'}</td>
                        <td className="px-5 py-3.5 text-sm text-slate-300">{r.nps_score ?? '—'}</td>
                        <td className="px-5 py-3.5 text-sm text-slate-400 max-w-xs truncate">
                          {r.payload?.openEnded?.q1 || '—'}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <span className="text-xs text-cyan-400">View →</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {total > LIMIT && (
                <div className="px-5 py-4 border-t border-slate-800 flex items-center justify-between">
                  <span className="text-slate-500 text-sm">
                    {offset + 1}–{Math.min(offset + LIMIT, total)} of {total}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                      disabled={offset === 0}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-white text-sm transition-all"
                    >
                      Prev
                    </button>
                    <button
                      onClick={() => setOffset(offset + LIMIT)}
                      disabled={offset + LIMIT >= total}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-white text-sm transition-all"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* Transcript modal */}
      {selected && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <h2 className="font-semibold text-white">Response detail</h2>
              <button onClick={() => setSelected(null)} className="text-slate-500 hover:text-white text-xl transition-colors">x</button>
            </div>
            <div className="px-6 py-5 flex flex-col gap-4">
              <div className="flex gap-4 flex-wrap">
                <Badge label="Sentiment"  value={selected.sentiment || '—'} />
                <Badge label="Experience" value={String(selected.experience_score ?? '—')} />
                <Badge label="NPS"        value={String(selected.nps_score ?? '—')} />
                <Badge label="Duration"   value={selected.duration_sec ? `${selected.duration_sec}s` : '—'} />
              </div>
              <AnswerBlock label="Q1 — Follow-up" value={selected.payload?.openEnded?.q1} />
              <AnswerBlock label="Q3"              value={selected.payload?.openEnded?.q3} />
              <AnswerBlock label="Q4"              value={selected.payload?.openEnded?.q4} />
              {Object.keys(selected.payload?.psychographics || {}).length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Psychographics</div>
                  <div className="flex flex-col gap-1.5">
                    {Object.entries(selected.payload.psychographics).map(([k, v]) => (
                      <div key={k} className="flex gap-3 text-sm">
                        <span className="text-slate-500 capitalize flex-shrink-0">{k.replace(/_/g,' ')}</span>
                        <span className="text-slate-200">{v as string}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {Object.keys(selected.payload?.demographics || {}).filter(k => selected.payload.demographics[k]).length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Demographics</div>
                  <div className="flex gap-5 flex-wrap">
                    {Object.entries(selected.payload.demographics)
                      .filter(([, v]) => v)
                      .map(([k, v]) => (
                        <Badge key={k} label={k} value={v as string} />
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, sub, color = 'text-white' }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-slate-500 text-xs">{sub}</div>}
      <div className="text-slate-400 text-xs mt-0.5">{label}</div>
    </div>
  )
}

function Badge({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-slate-500 text-xs">{label}</span>
      <span className="text-white text-sm font-medium capitalize">{value}</span>
    </div>
  )
}

function AnswerBlock({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div>
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">{label}</div>
      <div className="text-slate-200 text-sm leading-relaxed bg-slate-800/50 rounded-xl px-4 py-3">{value}</div>
    </div>
  )
}
