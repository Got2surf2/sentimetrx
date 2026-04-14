'use client'

// components/townhall/TownHallAnalyticsPanel.tsx
// Rich analytics panel for the Town Hall facilitator console.
// Modeled after the TextMine theme cards UI (survey standard).

import { useState, useEffect, useCallback } from 'react'

const HERMES = '#E8632A'
const sentColor: Record<string, string> = { positive: '#16a34a', negative: '#dc2626', mixed: '#d97706', neutral: '#6b7280' }
const sentBg: Record<string, string> = { positive: '#f0fdf4', negative: '#fef2f2', mixed: '#fffbeb', neutral: '#f9fafb' }
const THEME_COLORS = ['#0F7173', '#E8B84B', '#7C3AED', '#059669', '#E85A1A', '#1A5070', '#0891B2', '#DB2777', '#65A30D', '#9333EA']

interface ThemeAnalytics {
  id: string; label: string; source: string; state: string
  keywords: string[]; sentiment: string; response_count: number
  match_count: number; percentage: number
  example_quotes: string[]; top_keywords: { word: string; count: number }[]
}

interface Analytics {
  sentiment_breakdown: { positive: number; negative: number; mixed: number; neutral: number }
  responses_over_time: { bucket: string; count: number }[]
  total_responses: number
}

interface Props { sessionId: string }

export default function TownHallAnalyticsPanel({ sessionId }: Props) {
  const [themes, setThemes] = useState<ThemeAnalytics[]>([])
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAnalytics = useCallback(async () => {
    try {
      const res = await fetch('/api/townhall/sessions/' + sessionId + '?analytics=true')
      if (!res.ok) { setError('Failed to load analytics'); return }
      const d = await res.json()
      setThemes(d.themes || [])
      setAnalytics(d.analytics || null)
      setStats(d.stats || null)
    } catch { setError('Network error') }
    setLoading(false)
  }, [sessionId])

  useEffect(() => { fetchAnalytics() }, [fetchAnalytics])

  if (loading) return <div className="py-12 text-center text-gray-400 text-sm">Loading analytics...</div>
  if (error) return <div className="py-8 text-center text-red-500 text-sm">{error}</div>

  const activeThemes = themes.filter(t => t.state !== 'dismissed')
  const sentBreak = analytics?.sentiment_breakdown || { positive: 0, negative: 0, mixed: 0, neutral: 0 }
  const sentTotal = sentBreak.positive + sentBreak.negative + sentBreak.mixed + sentBreak.neutral

  return (
    <div className="space-y-5">
      {/* Refresh bar */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">Last refreshed: {new Date().toLocaleTimeString()}</span>
        <button onClick={() => { setLoading(true); fetchAnalytics() }}
          className="px-3 py-1 rounded-lg text-xs font-semibold border border-gray-200 hover:bg-gray-50 text-gray-600">
          Refresh
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: 'Participants', value: stats?.joined || 0 },
          { label: 'Responses', value: analytics?.total_responses || 0 },
          { label: 'Avg Words', value: stats?.avg_words || 0 },
          { label: 'Themes', value: activeThemes.length },
          { label: 'Surveys', value: stats?.survey_responses || 0 },
        ].map((s, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-3 text-center">
            <div className="text-lg font-bold text-gray-800">{s.value}</div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Sentiment breakdown bar */}
      {sentTotal > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-xs font-bold text-gray-700 mb-3 uppercase">Overall Sentiment</h3>
          <div className="flex rounded-lg overflow-hidden h-6">
            {(['positive', 'negative', 'mixed', 'neutral'] as const).map(s => {
              const pct = Math.round((sentBreak[s] / sentTotal) * 100)
              if (pct === 0) return null
              return <div key={s} style={{ width: pct + '%', background: sentColor[s] }} className="flex items-center justify-center text-[10px] font-bold text-white">{pct}%</div>
            })}
          </div>
          <div className="flex gap-4 mt-2">
            {(['positive', 'negative', 'mixed', 'neutral'] as const).map(s => (
              <div key={s} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: sentColor[s] }} />
                <span className="text-[10px] text-gray-500 capitalize">{s} ({sentBreak[s]})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Theme cards */}
      <div>
        <h3 className="text-xs font-bold text-gray-700 mb-3 uppercase">Themes ({activeThemes.length})</h3>
        <div className="grid grid-cols-2 gap-3">
          {activeThemes.map((t, i) => {
            const color = THEME_COLORS[i % THEME_COLORS.length]
            return (
              <div key={t.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div style={{ background: color, height: 4 }} />
                <div className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-gray-800">{t.label}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold capitalize"
                        style={{ background: sentBg[t.sentiment] || sentBg.neutral, color: sentColor[t.sentiment] || sentColor.neutral }}>
                        {t.sentiment}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium capitalize">{t.source.replace('_', ' ')}</span>
                    </div>
                  </div>

                  {/* Response count + percentage bar */}
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div style={{ width: Math.min(t.percentage, 100) + '%', background: color }} className="h-full rounded-full" />
                    </div>
                    <span className="text-xs font-bold" style={{ color }}>{t.percentage}%</span>
                    <span className="text-[10px] text-gray-400">{t.match_count} mentions</span>
                  </div>

                  {/* Keywords */}
                  {t.top_keywords.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {t.top_keywords.slice(0, 6).map(kw => (
                        <span key={kw.word} className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{kw.word} ({kw.count})</span>
                      ))}
                    </div>
                  )}

                  {/* Top quote */}
                  {t.example_quotes[0] && (
                    <div className="mt-2 pl-2 border-l-2 border-gray-200">
                      <p className="text-xs text-gray-500 italic line-clamp-2">{'\u201C'}{t.example_quotes[0].slice(0, 150)}{t.example_quotes[0].length > 150 ? '...' : ''}{'\u201D'}</p>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Responses over time */}
      {analytics?.responses_over_time && analytics.responses_over_time.length > 1 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-xs font-bold text-gray-700 mb-3 uppercase">Responses Over Time</h3>
          <div className="flex items-end gap-1" style={{ height: 80 }}>
            {(() => {
              const maxCount = Math.max(...analytics.responses_over_time.map(b => b.count), 1)
              return analytics.responses_over_time.map((b, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div style={{ height: Math.max(4, (b.count / maxCount) * 64), background: HERMES, borderRadius: 2 }} className="w-full" />
                  {i % Math.max(1, Math.floor(analytics.responses_over_time.length / 6)) === 0 && (
                    <span className="text-[8px] text-gray-400">{new Date(b.bucket).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  )}
                </div>
              ))
            })()}
          </div>
        </div>
      )}

      {/* Theme distribution */}
      {activeThemes.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-xs font-bold text-gray-700 mb-3 uppercase">Theme Distribution</h3>
          <div className="space-y-2">
            {activeThemes.sort((a, b) => b.percentage - a.percentage).map((t, i) => {
              const color = THEME_COLORS[themes.indexOf(t) % THEME_COLORS.length]
              return (
                <div key={t.id} className="flex items-center gap-3">
                  <span className="text-xs text-gray-700 font-medium w-32 truncate">{t.label}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div style={{ width: Math.min(t.percentage, 100) + '%', background: color }} className="h-full rounded-full" />
                  </div>
                  <span className="text-xs font-bold w-10 text-right" style={{ color }}>{t.percentage}%</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
