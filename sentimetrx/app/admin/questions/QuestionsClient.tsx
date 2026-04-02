'use client'

import { useState, useEffect } from 'react'
import TopNav from '@/components/nav/TopNav'
import SubHeader from '@/components/nav/SubHeader'
import { INDUSTRY_LABELS, type Industry } from '@/lib/industryDefaults'

interface Props {
  userEmail: string
  logoUrl?: string
  orgName?: string
  fullName?: string
}

type Tab = 'psychographic' | 'structured' | 'open_ended'

interface PsychographicQ {
  industry: string
  industryLabel: string
  prompt: string
  responses: string[]
}

interface StructuredQ {
  industry: string
  industryLabel: string
  key: string
  prompt: string
  exportLabel: string
  type: string
  options: string[]
}

interface OpenEndedQ {
  industry: string
  industryLabel: string
  prompt: string
  triggerType: string
  keywordTriggers: { priority: number; keywords: string[]; follow_on: string }[]
  defaultFollowOn: string
}

const HERMES = '#E8632A'

const TABS: { id: Tab; label: string; emoji: string }[] = [
  { id: 'psychographic', label: 'Psychographic Library', emoji: '🧠' },
  { id: 'structured',    label: 'Industry Questions',    emoji: '📋' },
  { id: 'open_ended',    label: 'Open-Ended + Clarifiers', emoji: '💬' },
]

const ALL_INDUSTRIES = (Object.entries(INDUSTRY_LABELS) as [Industry, string][])
  .filter(([k]) => k !== 'other')
  .sort(([, a], [, b]) => a.localeCompare(b))

export default function QuestionsClient({ userEmail, logoUrl = '', orgName = '', fullName = '' }: Props) {
  const [tab, setTab] = useState<Tab>('psychographic')
  const [industry, setIndustry] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<{ psychographic: PsychographicQ[]; structured: StructuredQ[]; openEnded: OpenEndedQ[] }>({ psychographic: [], structured: [], openEnded: [] })

  useEffect(function () {
    setLoading(true)
    var params = new URLSearchParams()
    if (industry) params.set('industry', industry)
    fetch('/api/admin/questions?' + params.toString())
      .then(function (r) { return r.json() })
      .then(function (d) { setData(d); setLoading(false) })
      .catch(function () { setLoading(false) })
  }, [industry])

  var inputCls = 'px-4 py-2.5 rounded-xl border border-gray-300 text-sm text-gray-800 outline-none focus:border-orange-400 transition-colors'

  function filterBySearch<T extends { prompt: string }>(items: T[]): T[] {
    if (!search.trim()) return items
    var s = search.toLowerCase()
    return items.filter(function (q) { return q.prompt.toLowerCase().includes(s) })
  }

  var psychoFiltered = filterBySearch(data.psychographic)
  var structuredFiltered = filterBySearch(data.structured)
  var openEndedFiltered = filterBySearch(data.openEnded)

  // Group by industry
  function groupByIndustry<T extends { industryLabel: string }>(items: T[]): Record<string, T[]> {
    var groups: Record<string, T[]> = {}
    for (var item of items) {
      if (!groups[item.industryLabel]) groups[item.industryLabel] = []
      groups[item.industryLabel].push(item)
    }
    return groups
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <TopNav logoUrl={logoUrl} orgName={orgName} isAdmin={true} userEmail={userEmail} fullName={fullName} currentPage="admin" />
      <SubHeader crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Question Library' }]} />

      <main className="max-w-5xl mx-auto px-6 pt-28 pb-10">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800">Question Library</h1>
          <p className="text-gray-500 text-sm mt-1">
            Manage psychographic profiling, industry questions, and open-ended question banks with clarifier rules.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {TABS.map(function (t) {
            return (
              <button
                key={t.id}
                onClick={function () { setTab(t.id) }}
                className={'px-4 py-2 rounded-xl text-sm font-semibold transition-all ' +
                  (tab === t.id ? 'text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300')}
                style={tab === t.id ? { background: HERMES } : undefined}
              >
                {t.emoji} {t.label}
              </button>
            )
          })}
        </div>

        {/* Filters */}
        <div className="flex gap-3 mb-6 flex-wrap">
          <select
            value={industry}
            onChange={function (e) { setIndustry(e.target.value) }}
            className={inputCls + ' min-w-[220px]'}
          >
            <option value="">All industries</option>
            <option value="universal">Universal / Cross-Industry</option>
            {ALL_INDUSTRIES.map(function ([k, v]) {
              return <option key={k} value={k}>{v}</option>
            })}
          </select>
          <input
            value={search}
            onChange={function (e) { setSearch(e.target.value) }}
            placeholder="Search questions..."
            className={inputCls + ' flex-1 min-w-[200px]'}
          />
        </div>

        {loading ? (
          <div className="py-20 text-center text-gray-400 text-sm">Loading library...</div>
        ) : (
          <>
            {/* Psychographic Tab */}
            {tab === 'psychographic' && (
              <div className="flex flex-col gap-4">
                <div className="text-sm text-gray-500">{psychoFiltered.length} questions</div>
                {Object.entries(groupByIndustry(psychoFiltered)).map(function ([indLabel, qs]) {
                  return (
                    <IndustrySection key={indLabel} label={indLabel} count={qs.length}>
                      {qs.map(function (q, i) {
                        return (
                          <div key={i} className="bg-white border border-gray-200 rounded-xl p-4">
                            <div className="text-sm font-medium text-gray-800 mb-2">{q.prompt}</div>
                            <div className="flex flex-wrap gap-1.5">
                              {q.responses.map(function (r) {
                                return <span key={r} className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-lg">{r}</span>
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </IndustrySection>
                  )
                })}
              </div>
            )}

            {/* Structured Tab */}
            {tab === 'structured' && (
              <div className="flex flex-col gap-4">
                <div className="text-sm text-gray-500">{structuredFiltered.length} questions</div>
                {Object.entries(groupByIndustry(structuredFiltered)).map(function ([indLabel, qs]) {
                  return (
                    <IndustrySection key={indLabel} label={indLabel} count={qs.length}>
                      {qs.map(function (q) {
                        return (
                          <div key={q.key} className="bg-white border border-gray-200 rounded-xl p-4">
                            <div className="flex items-center gap-2 mb-2 flex-wrap">
                              <span className="text-sm font-medium text-gray-800">{q.prompt}</span>
                              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium">{q.type}</span>
                            </div>
                            {q.exportLabel && (
                              <div className="text-xs text-gray-400 mb-2">Export: {q.exportLabel}</div>
                            )}
                            <div className="flex flex-wrap gap-1.5">
                              {q.options.map(function (o) {
                                return <span key={o} className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-lg">{o}</span>
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </IndustrySection>
                  )
                })}
              </div>
            )}

            {/* Open-Ended Tab */}
            {tab === 'open_ended' && (
              <div className="flex flex-col gap-4">
                <div className="text-sm text-gray-500">{openEndedFiltered.length} open-ended questions with clarifier rules</div>
                {Object.entries(groupByIndustry(openEndedFiltered)).map(function ([indLabel, qs]) {
                  return (
                    <IndustrySection key={indLabel} label={indLabel} count={qs.length}>
                      {qs.map(function (q, i) {
                        return <OpenEndedCard key={i} q={q} />
                      })}
                    </IndustrySection>
                  )
                })}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

function IndustrySection({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  var [open, setOpen] = useState(true)
  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <button
        onClick={function () { setOpen(function (v) { return !v }) }}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-gray-800">{label}</h3>
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">{count}</span>
        </div>
        <span className="text-gray-400 text-sm">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="px-5 pb-5 flex flex-col gap-3">
          {children}
        </div>
      )}
    </div>
  )
}

function OpenEndedCard({ q }: { q: OpenEndedQ }) {
  var [expanded, setExpanded] = useState(false)
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="text-sm font-medium text-gray-800 mb-1">{q.prompt}</div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs px-2 py-0.5 rounded-full bg-purple-50 text-purple-600 font-medium">{q.triggerType}</span>
            <span className="text-xs text-gray-400">{q.keywordTriggers.length} keyword clusters</span>
          </div>
        </div>
        <button
          onClick={function () { setExpanded(function (v) { return !v }) }}
          className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 flex-shrink-0 transition-colors"
        >
          {expanded ? 'Hide rules' : 'Show rules'}
        </button>
      </div>
      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-100 flex flex-col gap-3">
          {q.keywordTriggers.map(function (kt, i) {
            return (
              <div key={i} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-500 w-5">P{kt.priority}</span>
                  <div className="flex flex-wrap gap-1">
                    {kt.keywords.map(function (kw) {
                      return <span key={kw} className="text-xs bg-orange-50 text-orange-700 px-2 py-0.5 rounded-md font-mono">{kw}</span>
                    })}
                  </div>
                </div>
                <div className="text-xs text-gray-600 ml-7 italic">{kt.follow_on}</div>
              </div>
            )
          })}
          <div className="flex flex-col gap-1 mt-1">
            <div className="text-xs font-semibold text-gray-500">Default follow-on:</div>
            <div className="text-xs text-gray-600 italic">{q.defaultFollowOn}</div>
          </div>
        </div>
      )}
    </div>
  )
}
