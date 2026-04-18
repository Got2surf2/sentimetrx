'use client'

import TopNav from '@/components/nav/TopNav'
import StudyPageHeader from '@/components/nav/StudyPageHeader'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import LottieLoader from '@/components/ui/LottieLoader'

interface Response {
  id:               string
  study_id:         string
  sentiment:        string | null
  experience_score: number | null
  nps_score:        number | null
  payload:          any
  completed_at:     string | null
  duration_sec:     number | null
  status:           string | null
}

interface Props {
  studyId:    string
  studyName:  string
  botName?:   string
  botEmoji:   string
  studyConfig?: any
  logoUrl?:   string
  orgName?:   string
  isAdmin?:   boolean
  analyzeEnabled?: boolean
  userEmail?: string
  fullName?:  string
}

const HERMES   = '#E8632A'
const SENTIMENTS = ['', 'promoter', 'passive', 'detractor']

export default function ResponsesDashboard({ studyId, studyName, botName='', botEmoji, studyConfig, logoUrl='', orgName='', isAdmin=false, analyzeEnabled=false, userEmail='', fullName='' }: Props) {
  const [responses,   setResponses]   = useState<Response[]>([])
  const [total,       setTotal]       = useState(0)
  const [loading,     setLoading]     = useState(true)
  const [selected,    setSelected]    = useState<Response | null>(null)
  const [checkedIds,  setCheckedIds]  = useState<Set<string>>(new Set())
  const [deleting,    setDeleting]    = useState(false)
  const [deleteToast, setDeleteToast] = useState<string | null>(null)

  // Filters — auto-apply on change, no Apply button
  const [sentiment, setSentiment] = useState('')
  const [minNps,    setMinNps]    = useState('')
  const [maxNps,    setMaxNps]    = useState('')
  const [statusFilter, setStatusFilter] = useState('')  // '' = all, 'complete', 'incomplete'

  const [offset,    setOffset]    = useState(0)
  const defaultFrom = () => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10) }
  const defaultTo   = () => new Date().toISOString().slice(0, 10)
  const [dateFrom,  setDateFrom]  = useState('')
  const [dateTo,    setDateTo]    = useState('')
  const LIMIT = 25

  const allChecked  = responses.length > 0 && responses.every(r => checkedIds.has(r.id))
  const someChecked = responses.some(r => checkedIds.has(r.id))

  const toggleCheck = (id: string) => setCheckedIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const toggleAll = () => setCheckedIds(
    allChecked ? new Set() : new Set(responses.map(r => r.id))
  )

  const deleteSelected = async () => {
    if (!someChecked || deleting) return
    setDeleting(true)
    try {
      const res = await fetch('/api/studies/' + studyId + '/responses', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(checkedIds) }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Delete failed')
      setCheckedIds(new Set())
      setDeleteToast('Deleted ' + (json.deleted ?? checkedIds.size) + ' response' + (json.deleted !== 1 ? 's' : ''))
      setTimeout(() => setDeleteToast(null), 3000)
      fetchResponses()
    } catch (e: any) {
      setDeleteToast('Error: ' + e.message)
      setTimeout(() => setDeleteToast(null), 4000)
    } finally {
      setDeleting(false)
    }
  }

  const fetchResponses = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (sentiment)    params.set('sentiment', sentiment)
    if (minNps)       params.set('min_nps',   minNps)
    if (maxNps)       params.set('max_nps',   maxNps)
    if (statusFilter) params.set('status',    statusFilter)
    if (dateFrom)     params.set('from', dateFrom)
    if (dateTo)       params.set('to',   dateTo)
    params.set('limit',  String(LIMIT))
    params.set('offset', String(offset))
    const res  = await fetch(`/api/studies/${studyId}/responses?${params}`)
    const json = await res.json()
    setResponses(json.data || [])
    setTotal(json.count || 0)
    setLoading(false)
  }, [studyId, sentiment, minNps, maxNps, statusFilter, dateFrom, dateTo, offset])

  useEffect(() => { fetchResponses() }, [fetchResponses])

  // Reset to page 1 when filters change
  const handleFilterChange = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
    setter(e.target.value)
    setOffset(0)
  }

  const clearFilters = () => { setSentiment(''); setMinNps(''); setMaxNps(''); setStatusFilter(''); setDateFrom(defaultFrom()); setDateTo(defaultTo()); setOffset(0) }
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
      {/* Delete toast */}
      {deleteToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl bg-gray-900 text-white text-sm font-medium shadow-xl">
          {deleteToast}
        </div>
      )}
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
        analyzeEnabled={analyzeEnabled}
      />

      <main className="max-w-5xl mx-auto px-6 py-8">

        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-gray-400">{total} total responses</p>
        </div>

        {/* Filters — auto-apply, no button needed */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-6 shadow-sm">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Status</label>
              <select value={statusFilter} onChange={handleFilterChange(setStatusFilter)} className={selCls}>
                <option value="">All</option>
                <option value="complete">Complete</option>
                <option value="incomplete">Incomplete</option>
              </select>
            </div>
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
            <div className="py-16 flex justify-center">
              <LottieLoader size={100} message="Loading responses..." />
            </div>
          ) : responses.length === 0 ? (
            <div className="py-16 text-center">
              <div className="text-3xl mb-3">📭</div>
              <p className="text-gray-400 text-sm">No responses match your filters.</p>
            </div>
          ) : (
            <>
              {someChecked && (
                <div className="flex items-center justify-between px-5 py-3 bg-orange-50 border-b border-orange-200">
                  <span className="text-sm text-orange-700 font-medium">{checkedIds.size} response{checkedIds.size !== 1 ? "s" : ""} selected</span>
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => setCheckedIds(new Set())}
                      className="text-xs text-gray-500 hover:text-gray-700 transition-colors">
                      Clear selection
                    </button>
                    <button type="button" onClick={deleteSelected} disabled={deleting}
                      className="px-4 py-1.5 rounded-xl text-xs font-semibold text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 transition-all">
                      {deleting ? "Deleting..." : "Delete selected"}
                    </button>
                  </div>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="px-4 py-3 w-10">
                        <button type="button" onClick={toggleAll}
                          className={"w-5 h-5 rounded border-2 flex items-center justify-center transition-all " + (allChecked ? "bg-orange-500 border-orange-500" : "bg-white border-gray-300 hover:border-orange-400")}>
                          {allChecked && <span className="text-white text-xs font-bold leading-none">✓</span>}
                          {!allChecked && someChecked && <span className="text-orange-400 text-xs font-bold leading-none">−</span>}
                        </button>
                      </th>
                      <th className="px-2 py-3 w-8" />
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Sentiment</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Exp.</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">NPS</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">First response</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Duration</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {responses.map(r => (
                      <tr key={r.id} className={"hover:bg-orange-50/40 transition-colors " + (r.payload?.conversationLog?.length > 0 ? 'cursor-pointer ' : '') + (checkedIds.has(r.id) ? "bg-orange-50/60" : "")} onClick={() => { if (r.payload?.conversationLog?.length > 0) setSelected(r) }}>
                        <td className="px-4 py-3.5" onClick={e => { e.stopPropagation(); toggleCheck(r.id) }}>
                          <button type="button"
                            className={"w-5 h-5 rounded border-2 flex items-center justify-center transition-all " + (checkedIds.has(r.id) ? "bg-orange-500 border-orange-500" : "bg-white border-gray-300 hover:border-orange-400")}>
                            {checkedIds.has(r.id) && <span className="text-white text-xs font-bold leading-none">✓</span>}
                          </button>
                        </td>
                        <td className="px-2 py-3.5">
                          {r.payload?.conversationLog?.length > 0
                            ? <button onClick={e => { e.stopPropagation(); setSelected(r) }} title="View conversation"
                                className={'w-6 h-6 rounded-full flex items-center justify-center transition-all ' + (r.status === 'incomplete' ? 'hover:bg-orange-100' : 'hover:bg-green-100')}
                                style={{ color: r.status === 'incomplete' ? HERMES : '#16a34a' }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                              </button>
                            : <span className="w-6 h-6 flex items-center justify-center text-gray-200"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            r.status === 'incomplete' ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'
                          }`}>
                            {r.status === 'incomplete' ? 'partial' : 'complete'}
                          </span>
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
                        <td className="px-5 py-3.5 text-sm text-gray-600 whitespace-nowrap">
                          {r.completed_at ? new Date(r.completed_at).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-5 py-3.5 text-sm text-gray-400 whitespace-nowrap">
                          {r.duration_sec ? (r.duration_sec < 60 ? r.duration_sec + 's' : Math.round(r.duration_sec / 60) + 'm') : '—'}
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

      {/* Conversation replay modal */}
      {selected && (
        <ConversationModal
          response={selected}
          studyId={studyId}
          studyConfig={studyConfig}
          botName={botName}
          botEmoji={botEmoji}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

// ── Conversation replay modal ─────────────────────────────────────────────

interface ConvMsg {
  who: 'bot' | 'user'
  text: string
  ai?: boolean  // true if generated by AI or rules
}

function generateConversationHtml(msgs: ConvMsg[], botName: string, botEmoji: string, theme: any, response: any) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${botName} Conversation</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:20px}
.wrap{width:100%;max-width:400px;border-radius:24px;overflow:hidden;box-shadow:0 25px 50px rgba(0,0,0,.15)}
.hdr{padding:16px;display:flex;align-items:center;gap:12px;background:${theme.headerGradient || theme.primaryColor}}
.avatar{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.15);font-size:16px;flex-shrink:0}
.hdr-text{color:#fff;font-weight:600;font-size:14px}
.hdr-sub{color:rgba(255,255,255,.5);font-size:11px}
.chat{padding:16px;display:flex;flex-direction:column;gap:10px;background:#f8fafc}
.row{display:flex;align-items:flex-end;gap:8px;max-width:85%}
.row.user{flex-direction:row-reverse;align-self:flex-end}
.row.bot{align-self:flex-start}
.sm-av{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;background:${theme.botAvatarGradient || theme.primaryColor}}
.bubble{padding:8px 12px;font-size:13px;line-height:1.5;border-radius:16px;white-space:pre-wrap;word-wrap:break-word}
.bot .bubble{background:#fff;color:#1e293b;border:1px solid #e2e8f0;border-bottom-left-radius:4px}
.user .bubble{background:${theme.primaryColor};color:#fff;border-bottom-right-radius:4px;font-weight:500}
.footer{text-align:center;padding:12px;font-size:10px;color:#94a3b8;border-top:1px solid #e2e8f0;background:#fff}
</style></head><body>
<div class="wrap">
<div class="hdr"><div class="avatar">${botEmoji}</div><div><div class="hdr-text">${botName}</div><div class="hdr-sub">${response.completed_at ? new Date(response.completed_at).toLocaleString() : ''}</div></div></div>
<div class="chat">${msgs.map(m => '<div class="row ' + m.who + '">' + (m.who === 'bot' ? '<div class="sm-av">' + botEmoji + '</div>' : '') + '<div class="bubble">' + m.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>') + '</div></div>').join('\n')}</div>
<div class="footer">Datanautix — datanautix.com</div>
</div></body></html>`
}

function ShareConversationButton({ msgs, botName, botEmoji, theme, response, studyConfig, isLight, subtleText }: {
  msgs: ConvMsg[]; botName: string; botEmoji: string; theme: any; response: any; studyConfig: any; isLight: boolean; subtleText: string
}) {
  const [copied, setCopied] = useState(false)

  const download = () => {
    const html = generateConversationHtml(msgs, botName, botEmoji, theme, response)
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = (botName + ' conversation').replace(/[^a-zA-Z0-9 ]/g, '') + '.html'
    a.click()
    URL.revokeObjectURL(url)
  }

  const copyLink = async () => {
    const html = generateConversationHtml(msgs, botName, botEmoji, theme, response)
    const blob = new Blob([html], { type: 'text/html' })
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': blob })])
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback: download instead
      download()
    }
  }

  return (
    <div className="flex gap-1">
      <button onClick={download}
        className="text-xs font-medium px-2.5 py-1 rounded-lg transition-all"
        style={{ background: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.1)', color: subtleText }}
        title="Download as HTML file">
        Download
      </button>
    </div>
  )
}

function buildConversation(response: Response, config: any, botName: string): ConvMsg[] {
  const msgs: ConvMsg[] = []
  const p = response.payload || {}
  const oe = p.openEnded || {}

  // Greeting
  if (config?.greeting) {
    msgs.push({ who: 'bot', text: config.greeting })
  }

  // Ready prompt
  msgs.push({ who: 'bot', text: 'Are you ready to share your feedback?' })
  msgs.push({ who: 'user', text: 'Yes, let\'s go! 👍' })

  // Opening flow: experience rating
  if (p.experienceRating?.score != null) {
    if (config?.ratingPrompt) msgs.push({ who: 'bot', text: config.ratingPrompt })
    msgs.push({ who: 'user', text: `${p.experienceRating.label || ''} (${p.experienceRating.score}/5)` })
  }

  // Opening flow: NPS
  if (p.npsRecommend?.score != null) {
    if (config?.npsPrompt) msgs.push({ who: 'bot', text: config.npsPrompt })
    msgs.push({ who: 'user', text: `${p.npsRecommend.label || ''} (${p.npsRecommend.score}/5)` })
  }

  // Q1 follow-up (after rating)
  if (oe.q1) {
    // The follow-up prompt depends on sentiment
    const sentiment = p.experienceRating?.sentiment || 'neutral'
    const q1Prompt = sentiment === 'positive' ? config?.promoterQ1 : sentiment === 'negative' ? config?.detractorQ1 : config?.passiveQ1
    if (q1Prompt) msgs.push({ who: 'bot', text: q1Prompt, ai: true })
    // q1 may contain [+ clarifier response]
    const parts = oe.q1.split(' [+ ')
    msgs.push({ who: 'user', text: parts[0] })
    if (parts.length > 1) {
      msgs.push({ who: 'bot', text: '(clarifier follow-up)', ai: true })
      msgs.push({ who: 'user', text: parts[1].replace(/\]$/, '') })
    }
  }

  // Q3
  if (oe.q3) {
    if (config?.q3 && config.q3Enabled !== false) msgs.push({ who: 'bot', text: config.q3 })
    const parts = oe.q3.split(' [+ ')
    msgs.push({ who: 'user', text: parts[0] })
    if (parts.length > 1) {
      msgs.push({ who: 'bot', text: '(clarifier follow-up)', ai: true })
      msgs.push({ who: 'user', text: parts[1].replace(/\]$/, '') })
    }
  }

  // Q4
  if (oe.q4) {
    if (config?.q4 && config.q4Enabled !== false) msgs.push({ who: 'bot', text: config.q4 })
    const parts = oe.q4.split(' [+ ')
    msgs.push({ who: 'user', text: parts[0] })
    if (parts.length > 1) {
      msgs.push({ who: 'bot', text: '(clarifier follow-up)', ai: true })
      msgs.push({ who: 'user', text: parts[1].replace(/\]$/, '') })
    }
  }

  // Custom questions
  if (p.customAnswers && config?.questions) {
    const questions = (config.questions as any[]).filter((q: any) => q.type !== 'hidden' && q.enabled !== false)
    for (const q of questions) {
      const answer = p.customAnswers[q.id]
      if (answer != null) {
        msgs.push({ who: 'bot', text: q.prompt })
        const ansText = Array.isArray(answer) ? answer.join(', ') : String(answer)
        if (ansText) {
          const parts = ansText.split(' [+ ')
          msgs.push({ who: 'user', text: parts[0] })
          if (parts.length > 1) {
            msgs.push({ who: 'bot', text: '(clarifier follow-up)', ai: true })
            msgs.push({ who: 'user', text: parts[1].replace(/\]$/, '') })
          }
        }
      }
    }
  }

  // Psychographics
  const psycho = p.psychographics || {}
  const psychoEntries = Object.entries(psycho).filter(([, v]) => v)
  if (psychoEntries.length > 0) {
    const transitionText = config?.sectionTransitions?.psychographics?.text || 'Just a few quick questions to round things out.'
    if (config?.sectionTransitions?.psychographics?.enabled !== false) {
      msgs.push({ who: 'bot', text: transitionText })
    }
    // Match psycho keys to bank questions
    const bank = config?.psychographicBank || []
    for (const [key, val] of psychoEntries) {
      const bankQ = bank.find((b: any) => b.key === key)
      if (bankQ) msgs.push({ who: 'bot', text: bankQ.q })
      msgs.push({ who: 'user', text: val as string })
    }
  }

  // Demographics
  const demo = p.demographics || {}
  const demoEntries = Object.entries(demo).filter(([, v]) => v)
  if (demoEntries.length > 0) {
    const demoTransitionText = config?.sectionTransitions?.demographics?.text || 'Almost done -- a couple of optional questions about you.'
    if (config?.sectionTransitions?.demographics?.enabled !== false) {
      msgs.push({ who: 'bot', text: demoTransitionText })
    }
    const demoFields = config?.demoFields || []
    for (const [key, val] of demoEntries) {
      const field = demoFields.find((f: any) => f.key === key)
      msgs.push({ who: 'bot', text: field?.label || key.replace(/_/g, ' ') })
      msgs.push({ who: 'user', text: val as string })
    }
  }

  // Closing
  const closingMsg = config?.closingMessage || `Thank you so much -- ${botName} really appreciates you taking a moment to share. Your feedback makes a genuine difference. 💛`
  msgs.push({ who: 'bot', text: closingMsg })

  return msgs
}

function ConversationModal({ response, studyId, studyConfig, botName, botEmoji, onClose }: {
  response: Response
  studyId: string
  studyConfig: any
  botName: string
  botEmoji: string
  onClose: () => void
}) {
  const [showJson, setShowJson] = useState(false)
  const [jsonCopied, setJsonCopied] = useState(false)
  const msgs: ConvMsg[] = response.payload?.conversationLog || []
  const theme = studyConfig?.theme || { primaryColor: '#00b4d8', backgroundColor: '#0a1628', headerGradient: 'linear-gradient(135deg, #00b4d8, #0077a8)', botAvatarGradient: 'linear-gradient(135deg, #00b4d8, #0077a8)' }

  // Adapt to viewer's system light/dark preference instead of study background
  const prefersDark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)')?.matches
  const isLight = !prefersDark
  const chatBg = isLight ? '#f8fafc' : '#0f172a'
  const botBubble = isLight
    ? { background: '#ffffff', color: '#1e293b', border: '1px solid #e2e8f0' }
    : { background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.9)', border: '1px solid rgba(255,255,255,0.07)' }
  const mutedText = isLight ? '#94a3b8' : 'rgba(255,255,255,0.3)'
  const subtleText = isLight ? '#64748b' : 'rgba(255,255,255,0.5)'
  const borderColor = isLight ? '#e2e8f0' : 'rgba(255,255,255,0.08)'
  const doneCardText = isLight ? '#1e293b' : '#ffffff'
  const doneCardSub = isLight ? '#64748b' : 'rgba(255,255,255,0.6)'

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="w-full max-w-sm shadow-2xl rounded-3xl overflow-hidden flex flex-col"
        style={{ height: 'min(85vh, 700px)' }}
        onClick={e => e.stopPropagation()}>

        {/* Phone header */}
        <div className="px-4 py-3 flex items-center gap-3 flex-shrink-0" style={{ background: theme.headerGradient }}>
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-base flex-shrink-0" style={{ background: 'rgba(255,255,255,0.15)' }}>
            {botEmoji}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white font-semibold text-sm truncate">{botName}</div>
            <div className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
              {response.completed_at ? new Date(response.completed_at).toLocaleString() : ''}
              {response.duration_sec ? ` · ${Math.floor(response.duration_sec / 60)}m ${response.duration_sec % 60}s` : ''}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {response.sentiment && (
              <span className={'text-xs px-2 py-0.5 rounded-full font-medium capitalize ' + ({
                promoter: 'bg-green-400/20 text-green-200',
                passive: 'bg-amber-400/20 text-amber-200',
                detractor: 'bg-red-400/20 text-red-200',
              }[response.sentiment] || 'bg-white/10 text-white/50')}>{response.sentiment}</span>
            )}
            <button onClick={onClose} className="text-white/60 hover:text-white text-lg transition-colors ml-1">×</button>
          </div>
        </div>

        {/* Chat area */}
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-2.5" style={{ background: chatBg }}>
          {msgs.map((msg, i) => (
            <div key={i} className={'flex items-end gap-2 ' + (msg.who === 'user' ? 'flex-row-reverse self-end max-w-[85%]' : 'self-start max-w-[85%]')}>
              {msg.who === 'bot' && (
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs flex-shrink-0" style={{ background: theme.botAvatarGradient }}>
                  {botEmoji}
                </div>
              )}
              <div className="relative">
                <div
                  className={'px-3 py-2 text-sm leading-relaxed ' + (msg.who === 'user'
                    ? 'rounded-2xl rounded-br-sm font-medium'
                    : 'rounded-2xl rounded-bl-sm')}
                  style={msg.who === 'user'
                    ? { background: theme.primaryColor, color: '#fff' }
                    : botBubble}
                >
                  <span style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</span>
                </div>
                {msg.ai && (
                  <span className="absolute -bottom-3.5 left-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                    style={{ background: theme.primaryColor + '30', color: theme.primaryColor }}>
                    AI
                  </span>
                )}
              </div>
            </div>
          ))}

          {/* All done card */}
          <div className="rounded-2xl p-4 text-center my-1" style={{ background: isLight ? theme.primaryColor + '15' : theme.headerGradient }}>
            <div className="text-3xl mb-1">{botEmoji}</div>
            <div className="font-semibold text-base" style={{ color: doneCardText }}>All done!</div>
            <div className="text-xs mt-0.5" style={{ color: doneCardSub }}>{studyConfig?.closingCard || 'Your responses have been saved. Thank you for your time.'}</div>
          </div>

          {/* Response data summary */}
          {(() => {
            const p = response.payload || {}
            const sections: { title: string; entries: [string, string][] }[] = []

            // Open-ended answers
            const oe = p.openEnded || {}
            const oeEntries: [string, string][] = []
            if (oe.q1) oeEntries.push([studyConfig?.q1ExportLabel || 'Q1', oe.q1])
            if (oe.q2) oeEntries.push([studyConfig?.q2ExportLabel || 'Q2', oe.q2])
            if (oe.q3) oeEntries.push([studyConfig?.q3ExportLabel || 'Q3', oe.q3])
            if (oe.q4) oeEntries.push([studyConfig?.q4ExportLabel || 'Q4', oe.q4])
            if (oeEntries.length) sections.push({ title: 'Open-Ended', entries: oeEntries })

            // Custom answers
            const ca = p.customAnswers || {}
            const caEntries: [string, string][] = []
            const configQs = studyConfig?.questions || []
            Object.entries(ca).forEach(([qId, val]) => {
              const q = configQs.find((cq: any) => cq.id === qId)
              const label = q?.exportLabel || q?.prompt?.slice(0, 40) || qId
              caEntries.push([label, Array.isArray(val) ? (val as string[]).join(', ') : String(val)])
            })
            if (caEntries.length) sections.push({ title: 'Custom Questions', entries: caEntries })

            // Psychographics
            const ps = p.psychographics || {}
            const psEntries: [string, string][] = Object.entries(ps).map(([k, v]) => {
              const pq = (studyConfig?.psychographicBank || []).find((q: any) => q.key === k)
              return [pq?.exportLabel || pq?.q?.slice(0, 40) || k, String(v)]
            })
            if (psEntries.length) sections.push({ title: 'Psychographics', entries: psEntries })

            // Demographics
            const dm = p.demographics || {}
            const dmEntries: [string, string][] = Object.entries(dm)
              .filter(([, v]) => !!v)
              .map(([k, v]) => [k.charAt(0).toUpperCase() + k.slice(1), String(v)])
            if (dmEntries.length) sections.push({ title: 'Demographics', entries: dmEntries })

            // Contact info
            const ci = p.contactInfo || {}
            const ciEntries: [string, string][] = Object.entries(ci)
              .filter(([, v]) => !!v)
              .map(([k, v]) => [k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' '), String(v)])
            if (ciEntries.length) sections.push({ title: 'Contact Info', entries: ciEntries })

            if (sections.length === 0) return null

            return (
              <div className="mt-2 rounded-2xl overflow-hidden" style={{ border: `1px solid ${borderColor}`, background: isLight ? '#ffffff' : 'rgba(255,255,255,0.04)' }}>
                {sections.map((sec, si) => (
                  <div key={si} style={{ borderTop: si > 0 ? `1px solid ${borderColor}` : 'none' }}>
                    <div className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider" style={{ color: mutedText, background: isLight ? '#f8fafc' : 'rgba(255,255,255,0.03)' }}>
                      {sec.title}
                    </div>
                    {sec.entries.map(([label, val], ei) => (
                      <div key={ei} className="px-3 py-1.5 flex gap-2" style={{ borderTop: `1px solid ${borderColor}` }}>
                        <span className="text-xs font-medium flex-shrink-0" style={{ color: subtleText, minWidth: 80 }}>{label}</span>
                        <span className="text-xs" style={{ color: isLight ? '#1e293b' : 'rgba(255,255,255,0.8)' }}>{val}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )
          })()}
        </div>

        {/* Bottom bar */}
        <div className="px-4 py-3 flex-shrink-0 border-t flex items-center justify-between" style={{ background: chatBg, borderColor }}>
          <div className="flex items-center gap-2 text-xs" style={{ color: mutedText }}>
            <span>Exp: {response.experience_score ?? '—'}/5</span>
            <span>·</span>
            <span>NPS: {response.nps_score ?? '—'}/5</span>
            {response.duration_sec && <><span>·</span><span>{response.duration_sec}s</span></>}
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setShowJson(true); setJsonCopied(false) }}
              className="text-xs font-medium px-2.5 py-1 rounded-lg transition-all"
              style={{ background: isLight ? '#f0f9ff' : 'rgba(2,132,199,0.15)', color: '#0284c7', border: '1px solid ' + (isLight ? '#bae6fd' : 'rgba(2,132,199,0.3)') }}>
              View JSON
            </button>
            <button
              onClick={() => {
                const a = document.createElement('a')
                a.href = `/api/studies/${studyId}/responses/${response.id}/conversation-export`
                a.download = 'conversation.pptx'
                a.click()
              }}
              className="text-xs font-medium px-2.5 py-1 rounded-lg transition-all"
              style={{ background: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.1)', color: subtleText }}
              onMouseEnter={e => { e.currentTarget.style.background = isLight ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.2)'; e.currentTarget.style.color = isLight ? '#000' : '#fff' }}
              onMouseLeave={e => { e.currentTarget.style.background = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = subtleText }}
            >
              Export PPTX
            </button>
            <ShareConversationButton msgs={msgs} botName={botName} botEmoji={botEmoji} theme={theme} response={response} studyConfig={studyConfig} isLight={isLight} subtleText={subtleText} />
          </div>
        </div>

        {/* JSON view overlay */}
        {showJson && (
          <div style={{ position: 'absolute', inset: 0, background: isLight ? '#fff' : '#0f172a', borderRadius: 16, display: 'flex', flexDirection: 'column', zIndex: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: '1px solid ' + (isLight ? '#e2e8f0' : 'rgba(255,255,255,0.07)'), flexShrink: 0 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: isLight ? '#1e293b' : '#f8fafc' }}>Conversation JSON</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button onClick={() => {
                  const json = JSON.stringify({ response_id: response.id, study_id: studyId, payload: response.payload, experience_score: response.experience_score, nps_score: response.nps_score, status: response.status, duration_sec: response.duration_sec }, null, 2)
                  navigator.clipboard.writeText(json)
                  setJsonCopied(true); setTimeout(() => setJsonCopied(false), 2000)
                }}
                  style={{ fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 8, background: jsonCopied ? '#dcfce7' : (isLight ? '#f0f9ff' : 'rgba(2,132,199,0.15)'), color: jsonCopied ? '#16a34a' : '#0284c7', border: '1px solid ' + (jsonCopied ? '#bbf7d0' : '#bae6fd') }}>
                  {jsonCopied ? '\u2713 Copied!' : 'Copy'}
                </button>
                <button onClick={() => setShowJson(false)} style={{ color: isLight ? '#94a3b8' : 'rgba(255,255,255,0.4)', fontSize: 18, cursor: 'pointer' }}>&times;</button>
              </div>
            </div>
            <pre style={{ flex: 1, overflow: 'auto', padding: '12px 20px', fontSize: 11, color: isLight ? '#475569' : 'rgba(255,255,255,0.6)', fontFamily: 'monospace', whiteSpace: 'pre-wrap', background: isLight ? '#f8fafc' : '#0a0f1a' }}>
              {JSON.stringify({ response_id: response.id, study_id: studyId, payload: response.payload, experience_score: response.experience_score, nps_score: response.nps_score, status: response.status, duration_sec: response.duration_sec }, null, 2)}
            </pre>
          </div>
        )}
      </div>
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
