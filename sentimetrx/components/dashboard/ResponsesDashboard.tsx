'use client'

import TopNav from '@/components/nav/TopNav'
import StudyPageHeader from '@/components/nav/StudyPageHeader'
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
  orgName?:   string
  isAdmin?:   boolean
  userEmail?: string
  fullName?:  string
}

const HERMES   = '#E8632A'
const SENTIMENTS = ['', 'promoter', 'passive', 'detractor']

export default function ResponsesDashboard({ studyId, studyName, botEmoji, logoUrl='', orgName='', isAdmin=false, userEmail='', fullName='' }: Props) {
  const [responses,   setResponses]   = useState<Response[]>([])
  const [total,       setTotal]       = useState(0)
  const [loading,     setLoading]     = useState(true)
  const [selected,    setSelected]    = useState<Response | null>(null)

  // Filters — auto-apply on change, no Apply button
  const [sentiment, setSentiment] = useState('')
  const [minNps,    setMinNps]    = useState('')
  const [maxNps,    setMaxNps]    = useState('')

  const [offset,    setOffset]    = useState(0)
  const defaultFrom = () => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10) }
  const defaultTo   = () => new Date().toISOString().slice(0, 10)
  const [dateFrom,  setDateFrom]  = useState(defaultFrom())
  const [dateTo,    setDateTo]    = useState(defaultTo())
  const LIMIT = 25

  const fetchResponses = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (sentiment) params.set('sentiment', sentiment)
    if (minNps)    params.set('min_nps',   minNps)
    if (maxNps)    params.set('max_nps',   maxNps)
    if (dateFrom)  params.set('from', dateFrom)
    if (dateTo)    params.set('to',   dateTo)
    params.set('limit',  String(LIMIT))
    params.set('offset', String(offset))
    const res  = await fetch(`/api/studies/${studyId}/responses?${params}`)
    const json = await res.json()
    setResponses(json.data || [])
    setTotal(json.count || 0)
    setLoading(false)
  }, [studyId, sentiment, minNps, maxNps, dateFrom, dateTo, offset])

  useEffect(() => { fetchResponses() }, [fetchResponses])

  // Reset to page 1 when filters change
  const handleFilterChange = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
    setter(e.target.value)
    setOffset(0)
  }

  const clearFilters = () => { setSentiment(''); setMinNps(''); setMaxNps(''); setDateFrom(defaultFrom()); setDateTo(defaultTo()); setOffset(0) }
  const hasFilter = sentiment || minNps || maxNps



  const promoters  = responses.filter(r => r.sentiment === 'promoter').length
  const passives   = responses.filter(r => r.sentiment === 'passive').length
  const detractors = responses.filter(r => r.sentiment === 'detractor').length
  const avgNps     = responses.length > 0
    ? (responses.reduce((s, r) => s + (r.nps_score || 0), 0) / responses.length).toFixed(1) : '—'

  const sentimentBadge = (s: string | null) => ({
    promoter:  'bg-green-100 text-green-700 border border-green-200',
    passive:   'bg-amber-100 text-amber-700 border border-amber-200',
    detractor: 'bg-red-100 text-red-600 border border-red-200',
  }[s || ''] || 'bg-gray-100 text-gray-500 border border-gray-200')

  const selCls = 'px-3 py-2 rounded-lg bg-white border border-gray-300 text-gray-700 text-sm outline-none focus:border-orange-400 transition-colors cursor-pointer'
  const inputCls = 'px-3 py-2 rounded-lg bg-white border border-gray-300 text-gray-700 text-sm outline-none focus:border-orange-400 transition-colors'

  return (
    <div className="min-h-screen bg-gray-50">
      <TopNav logoUrl={logoUrl} orgName={orgName} isAdmin={isAdmin} userEmail={userEmail} fullName={fullName} />

      <StudyPageHeader
        studyId={studyId} studyName={studyName} botEmoji={botEmoji}
        activePage="responses"
        dateFrom={dateFrom} dateTo={dateTo}
        onDateFrom={v => { setDateFrom(v); setOffset(0) }}
        onDateTo={v => { setDateTo(v); setOffset(0) }}
        onLast30={() => { setDateFrom(defaultFrom()); setDateTo(defaultTo()); setOffset(0) }}
        onAllTime={() => { setDateFrom('2024-01-01'); setDateTo(defaultTo()); setOffset(0) }}
        total={total}
      />

      <main className="max-w-5xl mx-auto px-6 py-8">

        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-gray-400">{total} total responses</p>
        </div>

        {/* Filters — auto-apply, no button needed */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-6 shadow-sm">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Sentiment</label>
              <select value={sentiment} onChange={handleFilterChange(setSentiment)} className={selCls}>
                <option value="">All</option>
                <option value="promoter">Promoters</option>
                <option value="passive">Passives</option>
                <option value="detractor">Detractors</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">NPS min</label>
              <select value={minNps} onChange={handleFilterChange(setMinNps)} className={selCls}>
                <option value="">Any</option>
                {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">NPS max</label>
              <select value={maxNps} onChange={handleFilterChange(setMaxNps)} className={selCls}>
                <option value="">Any</option>
                {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>

            {hasFilter && (
              <button onClick={clearFilters}
                className="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500 text-sm transition-colors self-end">
                Clear ×
              </button>
            )}
          </div>
        </div>

        {/* Stats row */}
        {responses.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <StatCard label="Showing"    value={responses.length} sub={`of ${total}`} />
            <StatCard label="Avg NPS"    value={avgNps} />
            <StatCard label="Promoters"  value={`${Math.round(promoters / responses.length * 100)}%`} color="text-green-600" />
            <StatCard label="Detractors" value={`${Math.round(detractors / responses.length * 100)}%`} color="text-red-500" />
          </div>
        )}

        {/* Table */}
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
          {loading ? (
            <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
          ) : responses.length === 0 ? (
            <div className="py-16 text-center">
              <div className="text-3xl mb-3">📭</div>
              <p className="text-gray-400 text-sm">No responses match your filters.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Sentiment</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Exp.</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">NPS</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">First response</th>
                      <th className="px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {responses.map(r => (
                      <tr key={r.id} className="hover:bg-orange-50/40 transition-colors cursor-pointer" onClick={() => setSelected(r)}>
                        <td className="px-5 py-3.5 text-sm text-gray-600 whitespace-nowrap">
                          {new Date(r.completed_at).toLocaleDateString()}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`text-xs px-2.5 py-1 rounded-full font-medium capitalize ${sentimentBadge(r.sentiment)}`}>
                            {r.sentiment || '—'}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-sm text-gray-600">{r.experience_score ?? '—'}</td>
                        <td className="px-5 py-3.5 text-sm text-gray-600">{r.nps_score ?? '—'}</td>
                        <td className="px-5 py-3.5 text-sm text-gray-500 max-w-xs truncate">
                          {r.payload?.openEnded?.q1 || '—'}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <span className="text-xs font-medium" style={{ color: HERMES }}>View →</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {total > LIMIT && (
                <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between">
                  <span className="text-gray-400 text-sm">{offset + 1}–{Math.min(offset + LIMIT, total)} of {total}</span>
                  <div className="flex gap-2">
                    <button onClick={() => setOffset(Math.max(0, offset - LIMIT))} disabled={offset === 0}
                      className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-30 text-gray-600 text-sm transition-all">Prev</button>
                    <button onClick={() => setOffset(offset + LIMIT)} disabled={offset + LIMIT >= total}
                      className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-30 text-gray-600 text-sm transition-all">Next</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* Response detail modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={() => setSelected(null)}>
          <div className="bg-white border border-gray-200 rounded-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto shadow-xl"
            onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white rounded-t-2xl">
              <h2 className="font-semibold text-gray-800">Response detail</h2>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-xl transition-colors">×</button>
            </div>
            <div className="px-6 py-5 flex flex-col gap-5">
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
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Psychographics</div>
                  <div className="flex flex-col gap-1.5">
                    {Object.entries(selected.payload.psychographics).map(([k, v]) => (
                      <div key={k} className="flex gap-3 text-sm bg-gray-50 rounded-lg px-3 py-2">
                        <span className="text-gray-500 capitalize flex-shrink-0 w-32">{k.replace(/_/g,' ')}</span>
                        <span className="text-gray-800 font-medium">{v as string}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {Object.keys(selected.payload?.demographics || {}).filter(k => selected.payload.demographics[k]).length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Demographics</div>
                  <div className="flex gap-3 flex-wrap">
                    {Object.entries(selected.payload.demographics).filter(([, v]) => v).map(([k, v]) => (
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

function StatCard({ label, value, sub, color = 'text-gray-800' }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-gray-400 text-xs">{sub}</div>}
      <div className="text-gray-500 text-xs mt-0.5">{label}</div>
    </div>
  )
}

function Badge({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-gray-400 text-xs">{label}</span>
      <span className="text-gray-800 text-sm font-medium capitalize">{value}</span>
    </div>
  )
}

function AnswerBlock({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div>
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">{label}</div>
      <div className="text-gray-800 text-sm leading-relaxed bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">{value}</div>
    </div>
  )
}
