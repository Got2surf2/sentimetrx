'use client'

// components/townhall/TownHallAnalyticsPanel.tsx
// Rich analytics panel for the Town Hall facilitator console.
// Modeled after the TextMine theme cards UI (survey standard).

import { useState, useEffect, useCallback } from 'react'
import { TimeBucket, BUCKET_OPTIONS, formatBucketLabel } from '@/lib/timeBucket'

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

interface TopicSeries {
  theme_id: string; label: string; series: { bucket: string; count: number }[]
}

interface TopicShift {
  theme_id: string; label: string; latest: number; avg: number
}

interface SentimentPoint { turn: number; score: number; cumulative: number }
interface ThemeSentimentTrend { theme_id: string; label: string; trend: SentimentPoint[] }

interface Analytics {
  sentiment_breakdown: { positive: number; negative: number; mixed: number; neutral: number }
  responses_over_time: { bucket: string; count: number }[]
  topic_frequency?: TopicSeries[]
  topic_shifts?: TopicShift[]
  time_bucket: TimeBucket
  total_responses: number
  sentiment_trend?: SentimentPoint[]
  theme_sentiment_trends?: ThemeSentimentTrend[]
}

interface Props { sessionId: string }

export default function TownHallAnalyticsPanel({ sessionId }: Props) {
  const [themes, setThemes] = useState<ThemeAnalytics[]>([])
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [bucketOverride, setBucketOverride] = useState<TimeBucket | 'auto'>('auto')

  const fetchAnalytics = useCallback(async () => {
    try {
      const url = '/api/townhall/sessions/' + sessionId + '?analytics=true' + (bucketOverride !== 'auto' ? '&bucket=' + bucketOverride : '')
      const res = await fetch(url)
      if (!res.ok) { setError('Failed to load analytics'); return }
      const d = await res.json()
      setThemes(d.themes || [])
      setAnalytics(d.analytics || null)
      setStats(d.stats || null)
    } catch { setError('Network error') }
    setLoading(false)
  }, [sessionId, bucketOverride])

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
          { label: 'Topics', value: activeThemes.length },
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

      {/* Sentiment Trend Chart */}
      {analytics?.sentiment_trend && analytics.sentiment_trend.length > 3 && (() => {
        const overall = analytics.sentiment_trend!
        const themesTrends = analytics.theme_sentiment_trends || []
        const W = 500, H = 160, PAD_L = 30, PAD_R = 10, PAD_T = 10, PAD_B = 25
        const chartW = W - PAD_L - PAD_R
        const chartH = H - PAD_T - PAD_B

        // Compute y-axis range from all data
        const allScores = overall.map(p => p.cumulative)
        for (const tt of themesTrends) for (const p of tt.trend) allScores.push(p.cumulative)
        const minY = Math.min(-0.1, ...allScores)
        const maxY = Math.max(0.1, ...allScores)
        const rangeY = maxY - minY || 0.2

        function toX(turn: number, total: number) { return PAD_L + ((turn - 1) / Math.max(1, total - 1)) * chartW }
        function toY(val: number) { return PAD_T + (1 - (val - minY) / rangeY) * chartH }
        function toPoints(trend: SentimentPoint[]) {
          return trend.map(p => toX(p.turn, trend.length) + ',' + toY(p.cumulative)).join(' ')
        }

        const zeroY = toY(0)

        return (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-xs font-bold text-gray-700 mb-3 uppercase">Sentiment Trend (Cumulative)</h3>
            <svg viewBox={'0 0 ' + W + ' ' + H} className="w-full" style={{ height: 180 }}>
              {/* Grid lines */}
              <line x1={PAD_L} y1={zeroY} x2={W - PAD_R} y2={zeroY} stroke="#e5e7eb" strokeWidth={1} strokeDasharray="4,3" />
              <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} stroke="#e5e7eb" strokeWidth={1} />

              {/* Y-axis labels */}
              <text x={PAD_L - 4} y={toY(maxY) + 4} fontSize={9} fill="#9ca3af" textAnchor="end">{maxY > 0 ? '+' : ''}{maxY.toFixed(1)}</text>
              <text x={PAD_L - 4} y={zeroY + 3} fontSize={9} fill="#9ca3af" textAnchor="end">0</text>
              <text x={PAD_L - 4} y={toY(minY) + 4} fontSize={9} fill="#9ca3af" textAnchor="end">{minY.toFixed(1)}</text>

              {/* Positive/negative zones */}
              <rect x={PAD_L} y={PAD_T} width={chartW} height={Math.max(0, zeroY - PAD_T)} fill="#f0fdf4" opacity={0.5} />
              <rect x={PAD_L} y={zeroY} width={chartW} height={Math.max(0, H - PAD_B - zeroY)} fill="#fef2f2" opacity={0.5} />

              {/* Zone labels */}
              <text x={W - PAD_R - 2} y={PAD_T + 12} fontSize={8} fill="#16a34a" textAnchor="end" opacity={0.6}>Positive</text>
              <text x={W - PAD_R - 2} y={H - PAD_B - 4} fontSize={8} fill="#dc2626" textAnchor="end" opacity={0.6}>Negative</text>

              {/* Theme trend lines */}
              {themesTrends.map((tt, i) => (
                <polyline key={tt.theme_id} points={toPoints(tt.trend)} fill="none"
                  stroke={THEME_COLORS[i % THEME_COLORS.length]} strokeWidth={1.5} opacity={0.5} />
              ))}

              {/* Overall trend line (thick, on top) */}
              <polyline points={toPoints(overall)} fill="none" stroke={HERMES} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />

              {/* X-axis labels */}
              {[0, Math.floor(overall.length / 4), Math.floor(overall.length / 2), Math.floor(overall.length * 3 / 4), overall.length - 1].map(idx => {
                if (idx < 0 || idx >= overall.length) return null
                return <text key={idx} x={toX(overall[idx].turn, overall.length)} y={H - 5} fontSize={8} fill="#9ca3af" textAnchor="middle">#{overall[idx].turn}</text>
              })}
            </svg>

            {/* Legend */}
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
              <div className="flex items-center gap-1.5">
                <div className="w-5 h-0.5 rounded" style={{ background: HERMES }} />
                <span className="text-[10px] font-semibold text-gray-600">Overall</span>
              </div>
              {themesTrends.map((tt, i) => (
                <div key={tt.theme_id} className="flex items-center gap-1.5">
                  <div className="w-5 h-0.5 rounded" style={{ background: THEME_COLORS[i % THEME_COLORS.length], opacity: 0.6 }} />
                  <span className="text-[10px] text-gray-500">{tt.label}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* Theme cards */}
      <div>
        <h3 className="text-xs font-bold text-gray-700 mb-3 uppercase">Topics ({activeThemes.length})</h3>
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
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${t.source === 'guide' ? 'bg-blue-100 text-blue-600' : t.source === 'auto_detected' ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-500'}`}>{t.source === 'guide' ? 'Seed' : t.source === 'auto_detected' ? 'Organic' : 'Custom'}</span>
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
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold text-gray-700 uppercase">Responses Over Time</h3>
            <select
              value={bucketOverride}
              onChange={e => { setBucketOverride(e.target.value as TimeBucket | 'auto'); }}
              className="text-[10px] font-semibold text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 cursor-pointer"
            >
              <option value="auto">Auto ({BUCKET_OPTIONS.find(o => o.value === analytics.time_bucket)?.label || 'Auto'})</option>
              {BUCKET_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-1" style={{ height: 80 }}>
            {(() => {
              const tb = analytics.time_bucket
              const maxCount = Math.max(...analytics.responses_over_time.map(b => b.count), 1)
              const labelStep = Math.max(1, Math.floor(analytics.responses_over_time.length / 6))
              return analytics.responses_over_time.map((b, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div style={{ height: Math.max(4, (b.count / maxCount) * 64), background: HERMES, borderRadius: 2 }} className="w-full" />
                  {i % labelStep === 0 && (
                    <span className="text-[8px] text-gray-400">{formatBucketLabel(b.bucket, tb)}</span>
                  )}
                </div>
              ))
            })()}
          </div>
        </div>
      )}

      {/* Topic shift alerts */}
      {analytics?.topic_shifts && analytics.topic_shifts.length > 0 && (
        <div className="space-y-2">
          {analytics.topic_shifts.map(s => (
            <div key={s.theme_id} className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
              <span className="text-lg">{'⚡'}</span>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-bold text-amber-800">{s.label}</span>
                <span className="text-xs text-amber-600 ml-2">surging — {s.latest} mentions in latest period vs {s.avg} avg</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Topic frequency over time */}
      {analytics?.topic_frequency && analytics.topic_frequency.length > 0 && analytics.topic_frequency[0].series.length > 1 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-xs font-bold text-gray-700 mb-3 uppercase">Topic Frequency Over Time</h3>
          {(() => {
            const tf = analytics.topic_frequency!
            const buckets = tf[0].series.map(s => s.bucket)
            const maxVal = Math.max(...tf.flatMap(t => t.series.map(s => s.count)), 1)
            const tb = analytics.time_bucket
            const labelStep = Math.max(1, Math.floor(buckets.length / 6))

            return (
              <div>
                {/* Stacked area chart (CSS-only bars per bucket) */}
                <div className="flex items-end gap-1" style={{ height: 100 }}>
                  {buckets.map((bk, bi) => {
                    const total = tf.reduce((sum, t) => sum + t.series[bi].count, 0)
                    return (
                      <div key={bi} className="flex-1 flex flex-col items-center gap-1">
                        <div className="w-full flex flex-col-reverse" style={{ height: Math.max(4, (total / maxVal) * 80) }}>
                          {tf.map((t, ti) => {
                            const c = t.series[bi].count
                            if (c === 0) return null
                            return <div key={ti} style={{ height: (c / total) * 100 + '%', background: THEME_COLORS[ti % THEME_COLORS.length], minHeight: 2 }} />
                          })}
                        </div>
                        {bi % labelStep === 0 && (
                          <span className="text-[8px] text-gray-400">{formatBucketLabel(bk, tb)}</span>
                        )}
                      </div>
                    )
                  })}
                </div>
                {/* Legend */}
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3">
                  {tf.map((t, i) => (
                    <div key={t.theme_id} className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-sm" style={{ background: THEME_COLORS[i % THEME_COLORS.length] }} />
                      <span className="text-[10px] text-gray-500">{t.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
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
