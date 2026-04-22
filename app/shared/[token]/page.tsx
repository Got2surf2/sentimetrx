'use client'

import { useState, useEffect, useCallback } from 'react'
import { detectScale } from '@/lib/scaleUtils'
import { autoBucket, bucketKey, formatBucketLabel, TimeBucket, BUCKET_OPTIONS } from '@/lib/timeBucket'

const HERMES = '#E8632A'
const SARINA = '#00b4d8'

export default function SharedDashboard({ params }: { params: { token: string } }) {
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    try {
      const r = await fetch('/api/share?token=' + params.token, { cache: 'no-store' })
      const d = await r.json()
      if (d.error) setError(d.error)
      else { setData(d); setLastRefreshed(new Date()) }
    } catch { setError('Failed to load') }
    finally { setLoading(false); setRefreshing(false) }
  }, [params.token])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-gray-400 text-sm">Loading...</div>
    </div>
  )

  if (error) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center max-w-sm">
        <div className="text-3xl mb-3">🔗</div>
        <h1 className="text-lg font-bold text-gray-800 mb-2">{error === 'This share link has expired' ? 'Link Expired' : 'Link Not Found'}</h1>
        <p className="text-sm text-gray-500">{error}</p>
      </div>
    </div>
  )

  if (data.type === 'study') return <SharedStudyDashboard study={data.study} responses={data.responses} expiresAt={data.expires_at}
    ratingScale={data.ratingScale} ratingLabel={data.ratingLabel} npsEnabled={data.npsEnabled} experienceEnabled={data.experienceEnabled}
    ratingPrompt={data.ratingPrompt} npsPrompt={data.npsPrompt} themes={data.themes || []}
    lastRefreshed={lastRefreshed} refreshing={refreshing} onRefresh={() => fetchData(true)} />
  if (data.type === 'campaign') return <SharedCampaignDashboard campaign={data.campaign} stats={data.stats} expiresAt={data.expires_at}
    lastRefreshed={lastRefreshed} refreshing={refreshing} onRefresh={() => fetchData(true)} />
  if (data.type === 'townhall') return <SharedTownHallDashboard session={data.session} themes={data.themes} stats={data.stats} expiresAt={data.expires_at}
    lastRefreshed={lastRefreshed} refreshing={refreshing} onRefresh={() => fetchData(true)} />
  if (data.type === 'analytics') return <SharedAnalyticsDashboard token={params.token} expiresAt={data.expires_at}
    lastRefreshed={lastRefreshed} refreshing={refreshing} onRefresh={() => fetchData(true)} />
  return null
}

// -- Responses over time bar chart (CSS-only, no deps) --
function ResponsesOverTimeChart({ responses }: { responses: any[] }) {
  const [bucketOverride, setBucketOverride] = useState<TimeBucket | 'auto'>('auto')

  // Get all timestamps
  const timestamps = responses
    .map((r: any) => r.completed_at)
    .filter(Boolean)
    .map((t: string) => new Date(t))
    .sort((a, b) => a.getTime() - b.getTime())

  if (timestamps.length < 2) return null

  const smartBucket = autoBucket(timestamps[0], timestamps[timestamps.length - 1])
  const activeBucket: TimeBucket = bucketOverride === 'auto' ? smartBucket : bucketOverride

  // Bucket responses
  const buckets: Record<string, { complete: number; incomplete: number }> = {}

  for (const r of responses) {
    const ts = r.completed_at || r.created_at
    if (!ts) continue
    const key = bucketKey(ts, activeBucket)
    if (!buckets[key]) buckets[key] = { complete: 0, incomplete: 0 }
    if (r.status === 'partial' || r.status === 'incomplete') buckets[key].incomplete++
    else buckets[key].complete++
  }

  const sortedKeys = Object.keys(buckets).sort()
  if (sortedKeys.length === 0) return null

  const maxVal = Math.max(...sortedKeys.map(k => buckets[k].complete + buckets[k].incomplete))

  // Show at most 20 bars, evenly sampled if more
  let displayKeys = sortedKeys
  if (sortedKeys.length > 20) {
    const step = Math.ceil(sortedKeys.length / 20)
    displayKeys = sortedKeys.filter((_, i) => i % step === 0)
  }

  const activeLabel = BUCKET_OPTIONS.find(o => o.value === activeBucket)?.label || 'Daily'

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-semibold text-sm text-gray-800">Responses Over Time</h3>
        <select
          value={bucketOverride}
          onChange={e => setBucketOverride(e.target.value as TimeBucket | 'auto')}
          className="text-[10px] font-semibold text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 cursor-pointer"
        >
          <option value="auto">Auto ({activeLabel})</option>
          {BUCKET_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-4 mb-3">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ background: '#22c55e' }} />
          <span className="text-[10px] text-gray-500">Complete</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ background: '#f59e0b' }} />
          <span className="text-[10px] text-gray-500">Incomplete</span>
        </div>
      </div>
      <div className="flex items-end gap-1" style={{ height: 120 }}>
        {displayKeys.map(key => {
          const b = buckets[key]
          const total = b.complete + b.incomplete
          const h = maxVal > 0 ? (total / maxVal) * 100 : 0
          const completeH = total > 0 ? (b.complete / total) * h : 0
          const incompleteH = h - completeH
          return (
            <div key={key} className="flex-1 flex flex-col items-center justify-end" style={{ height: '100%' }}>
              <div className="text-[8px] text-gray-500 font-semibold mb-0.5">{total}</div>
              <div className="w-full flex flex-col justify-end" style={{ height: h + '%', minHeight: total > 0 ? 4 : 0 }}>
                {incompleteH > 0 && (
                  <div className="w-full rounded-t-sm" style={{ height: (incompleteH / h * 100) + '%', background: '#f59e0b', minHeight: 2 }} />
                )}
                {completeH > 0 && (
                  <div className="w-full" style={{ height: (completeH / h * 100) + '%', background: '#22c55e', minHeight: 2, borderRadius: incompleteH > 0 ? 0 : '2px 2px 0 0' }} />
                )}
              </div>
              <div className="text-[8px] text-gray-400 mt-1 text-center leading-tight" style={{ maxWidth: '100%', wordBreak: 'break-word' }}>
                {formatBucketLabel(key, activeBucket)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RefreshBar({ lastRefreshed, refreshing, onRefresh }: { lastRefreshed: Date | null; refreshing: boolean; onRefresh: () => void }) {
  const timeStr = lastRefreshed
    ? lastRefreshed.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : null
  return (
    <div className="flex items-center justify-end gap-2 mb-2">
      {timeStr && <span className="text-[10px] text-gray-400">Last refreshed {timeStr}</span>}
      <button onClick={onRefresh} disabled={refreshing}
        className="text-[10px] px-2 py-1 rounded-md font-medium transition-all disabled:opacity-50"
        style={{ background: '#fff4ef', color: HERMES }}>
        {refreshing ? 'Refreshing...' : 'Refresh'}
      </button>
    </div>
  )
}

// Detect if a prompt suggests a satisfaction/quality/sentiment measure
function isSatisfactionPrompt(prompt: string): boolean {
  if (!prompt) return false
  const lower = prompt.toLowerCase()
  const keywords = [
    'satisf', 'experience', 'quality', 'recommend', 'likely', 'rate', 'rating',
    'happy', 'pleased', 'how would you', 'how do you feel', 'how was', 'how did',
    'impression', 'opinion', 'agree', 'disagree', 'excellent', 'poor',
    'good', 'bad', 'best', 'worst', 'enjoy', 'disappoint', 'overall',
  ]
  return keywords.some(kw => lower.includes(kw))
}

const STUDY_THEME_COLORS = ['#E8632A', '#2563eb', '#16a34a', '#7c3aed', '#ea580c', '#a21caf', '#0d9488', '#ca8a04', '#db2777', '#0891b2']

function SharedStudyDashboard({ study, responses, expiresAt, ratingScale, ratingLabel, npsEnabled, experienceEnabled, ratingPrompt, npsPrompt, themes, lastRefreshed, refreshing, onRefresh }: {
  study: any; responses: any[]; expiresAt: string
  ratingScale?: any[]; ratingLabel?: string | null; npsEnabled?: boolean; experienceEnabled?: boolean
  ratingPrompt?: string | null; npsPrompt?: string | null; themes?: any[]
  lastRefreshed: Date | null; refreshing: boolean; onRefresh: () => void
}) {
  const total = responses.length
  const complete = responses.filter((r: any) => r.status !== 'incomplete' && r.status !== 'partial').length

  // Determine primary rating from the data
  const expScores = responses.map((r: any) => r.experience_score).filter((v: any) => v != null)
  const npsScores = responses.map((r: any) => r.nps_score).filter((v: any) => v != null)
  const hasExp = expScores.length > 0
  const hasNps = npsScores.length > 0
  const hasSentiment = responses.some((r: any) => r.sentiment)

  // Pick whichever score field has data. If both exist, NPS is the primary
  // rating if npsEnabled and experience is disabled, otherwise experience is primary.
  const npsPrimary = hasNps && (!hasExp || experienceEnabled === false)
  const primaryScores = npsPrimary ? npsScores : (hasExp ? expScores : npsScores)
  const scored = primaryScores.length

  const avgScore = scored > 0
    ? Math.round(primaryScores.reduce((a: number, b: number) => a + b, 0) / scored * 10) / 10
    : 0
  // Always use the alias label if provided
  const scoreLabel = ratingLabel || (npsPrimary ? 'NPS' : 'Avg Rating')
  // Only use Promoter/Passive/Detractor labels when the alias is explicitly "NPS"
  const aliasIsNps = (ratingLabel || '').toLowerCase().includes('nps') || (!ratingLabel && npsPrimary)

  // Build score breakdown bars
  type BreakdownBar = { label: string; value: number; color: string }
  let breakdownBars: BreakdownBar[] = []
  let breakdownTitle = scoreLabel + ' Breakdown'
  const activePrompt = npsPrimary ? (npsPrompt || ratingPrompt) : (ratingPrompt || npsPrompt)
  const promptSuggestsSatisfaction = isSatisfactionPrompt(activePrompt || '')

  // Traffic light gradient (green → yellow → red) for satisfaction-type measures
  const trafficLight = (count: number, idx: number) => {
    const positiveToNegative = ['#22c55e', '#86efac', '#fde68a', '#fca5a5', '#ef4444']
    return positiveToNegative[Math.round(idx / Math.max(count - 1, 1) * (positiveToNegative.length - 1))]
  }
  // Brand gradient (Sarina blue → Hermes orange) for non-satisfaction measures
  const brandGradient = (count: number, idx: number) => {
    const t = count > 1 ? idx / (count - 1) : 0
    return `rgb(${Math.round(t * 232)},${Math.round(180 + t * (99 - 180))},${Math.round(216 + t * (42 - 216))})`
  }

  if (aliasIsNps) {
    // Alias is NPS: use Promoter/Passive/Detractor labels
    if (hasSentiment) {
      const topCount = responses.filter((r: any) => r.sentiment === 'promoter' || r.sentiment === 'positive').length
      const midCount = responses.filter((r: any) => r.sentiment === 'passive' || r.sentiment === 'neutral').length
      const botCount = responses.filter((r: any) => r.sentiment === 'detractor' || r.sentiment === 'negative').length
      breakdownBars = [
        { label: 'Promoters', value: topCount, color: '#22c55e' },
        { label: 'Passives', value: midCount, color: '#f59e0b' },
        { label: 'Detractors', value: botCount, color: '#ef4444' },
      ]
    } else if (hasNps) {
      const topCount = npsScores.filter((s: number) => s >= 9).length
      const midCount = npsScores.filter((s: number) => s >= 7 && s <= 8).length
      const botCount = npsScores.filter((s: number) => s <= 6).length
      breakdownBars = [
        { label: 'Promoters', value: topCount, color: '#22c55e' },
        { label: 'Passives', value: midCount, color: '#f59e0b' },
        { label: 'Detractors', value: botCount, color: '#ef4444' },
      ]
    }
  } else if (hasExp && ratingScale && ratingScale.length > 0) {
    // Non-NPS with ratingScale config — use labels, detect direction for color coding
    const labels = ratingScale.map((r: any) => r.label).filter(Boolean)
    const detected = detectScale(labels)
    const hasDirection = !!detected

    // Order: use detected ordinal scale order (low→high), else sort by score descending
    let ordered: any[]
    if (detected) {
      // detected is in low→high order; reverse for display (best first)
      const labelOrder = [...detected].reverse()
      ordered = labelOrder.map(label => ratingScale.find((r: any) => r.label === label)).filter(Boolean)
      // Add any unmatched items at the end
      const matched = new Set(ordered.map((r: any) => r.score))
      for (const r of ratingScale) { if (!matched.has(r.score)) ordered.push(r) }
    } else {
      ordered = [...ratingScale].sort((a: any, b: any) => b.score - a.score)
    }

    // Colors: traffic light if direction known OR prompt suggests satisfaction; brand colors otherwise
    const useTrafficLight = hasDirection || promptSuggestsSatisfaction

    breakdownBars = ordered.map((opt: any, i: number) => ({
      label: (opt.emoji ? opt.emoji + ' ' : '') + opt.label,
      value: expScores.filter((s: number) => s === opt.score).length,
      color: useTrafficLight ? trafficLight(ordered.length, i) : brandGradient(ordered.length, i),
    }))
  } else if (hasExp) {
    // Non-NPS, no ratingScale config — show numeric values
    const vals: Record<number, number> = {}
    for (const s of expScores) vals[s] = (vals[s] || 0) + 1
    const sortedVals = Object.keys(vals).map(Number).sort((a, b) => b - a)
    breakdownBars = sortedVals.map((v, i) => ({
      label: String(v),
      value: vals[v],
      color: promptSuggestsSatisfaction ? trafficLight(sortedVals.length, i) : brandGradient(sortedVals.length, i),
    }))
  } else if (npsPrimary && hasNps) {
    // NPS data but alias isn't "NPS" — show score distribution
    const vals: Record<number, number> = {}
    for (const s of npsScores) vals[s] = (vals[s] || 0) + 1
    const sortedVals = Object.keys(vals).map(Number).sort((a, b) => b - a)
    breakdownBars = sortedVals.map((v, i) => ({
      label: String(v),
      value: vals[v],
      color: promptSuggestsSatisfaction ? trafficLight(sortedVals.length, i) : brandGradient(sortedVals.length, i),
    }))
  } else if (hasSentiment) {
    // No scores at all but sentiment exists
    breakdownTitle = 'Sentiment Breakdown'
    const topCount = responses.filter((r: any) => r.sentiment === 'promoter' || r.sentiment === 'positive').length
    const midCount = responses.filter((r: any) => r.sentiment === 'passive' || r.sentiment === 'neutral').length
    const botCount = responses.filter((r: any) => r.sentiment === 'detractor' || r.sentiment === 'negative').length
    breakdownBars = [
      { label: 'Positive', value: topCount, color: '#22c55e' },
      { label: 'Neutral', value: midCount, color: '#f59e0b' },
      { label: 'Negative', value: botCount, color: '#ef4444' },
    ]
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-4">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">{study.bot_emoji}</span>
            <h1 className="text-xl font-bold text-gray-800">{study.name}</h1>
          </div>
          <p className="text-xs text-gray-400">Shared dashboard · Expires {new Date(expiresAt).toLocaleDateString()}</p>
        </div>

        <RefreshBar lastRefreshed={lastRefreshed} refreshing={refreshing} onRefresh={onRefresh} />

        {/* Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold" style={{ color: HERMES }}>{total}</div>
            <div className="text-xs text-gray-500">Responses</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-green-600">{total > 0 ? Math.round(complete / total * 100) : 0}%</div>
            <div className="text-xs text-gray-500">Complete</div>
          </div>
          {scored > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
              <div className="text-2xl font-bold" style={{ color: HERMES }}>{avgScore}</div>
              <div className="text-xs text-gray-500">{scoreLabel}</div>
            </div>
          )}
        </div>

        {/* Responses over time chart */}
        <ResponsesOverTimeChart responses={responses} />

        {/* Score breakdown */}
        {breakdownBars.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
            <h3 className="font-semibold text-sm text-gray-800">{breakdownTitle}</h3>
            {activePrompt && <p className="text-[11px] text-gray-400 mb-3">{activePrompt}</p>}
            {!activePrompt && <div className="mb-3" />}
            <div className="space-y-2">
              {breakdownBars.map(s => {
                const denom = breakdownBars.reduce((sum, b) => sum + b.value, 0)
                return (
                  <div key={s.label} className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-36 flex-shrink-0">{s.label}</span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: (denom > 0 ? s.value / denom * 100 : 0) + '%', background: s.color }} />
                    </div>
                    <span className="text-xs font-semibold text-gray-700 w-16 text-right">{s.value} ({denom > 0 ? Math.round(s.value / denom * 100) : 0}%)</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}


        {/* Themes */}
        {themes && themes.length > 0 && (
          <div className="mb-4">
            <h3 className="text-sm font-bold text-gray-700 mb-3 uppercase">Themes ({themes.length})</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {themes.map((t: any, i: number) => {
                const color = STUDY_THEME_COLORS[i % STUDY_THEME_COLORS.length]
                return (
                  <div key={i} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div style={{ background: color, height: 4 }} />
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-bold text-gray-800">{t.name}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold capitalize"
                          style={{ background: sentBgMap[t.sentiment] || sentBgMap.neutral, color: sentColorMap[t.sentiment] || sentColorMap.neutral }}>
                          {t.sentiment}
                        </span>
                      </div>
                      {t.description && (
                        <p className="text-xs text-gray-500 mb-2 line-clamp-2">{t.description}</p>
                      )}
                      <div className="flex items-center gap-2 mb-2">
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div style={{ width: Math.min(t.percentage, 100) + '%', background: color }} className="h-full rounded-full" />
                        </div>
                        <span className="text-xs font-bold" style={{ color }}>{t.percentage}%</span>
                      </div>
                      {t.keywords?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {t.keywords.slice(0, 5).map((kw: string) => (
                            <span key={kw} className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{kw}</span>
                          ))}
                        </div>
                      )}
                      {t.avgRating != null && (
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-gray-500">Avg Rating: <strong style={{ color: t.ratingDelta > 0 ? '#059669' : t.ratingDelta < -0.1 ? '#dc2626' : '#374151' }}>{t.avgRating.toFixed(2)}</strong></span>
                          {t.ratingDelta != null && t.ratingDelta !== 0 && (
                            <span className="text-[10px] font-bold" style={{ color: t.ratingDelta > 0 ? '#059669' : '#dc2626' }}>
                              {t.ratingDelta > 0 ? '\u25B2' : '\u25BC'} {Math.abs(t.ratingDelta).toFixed(2)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Theme Distribution */}
        {themes && themes.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
            <h3 className="text-xs font-bold text-gray-700 mb-3 uppercase">Theme Distribution</h3>
            <div className="space-y-2">
              {[...themes].sort((a: any, b: any) => (b.percentage || 0) - (a.percentage || 0)).map((t: any, i: number) => {
                const color = STUDY_THEME_COLORS[i % STUDY_THEME_COLORS.length]
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs text-gray-700 font-medium w-28 truncate">{t.name}</span>
                    <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div style={{ width: Math.min(t.percentage, 100) + '%', background: color }} className="h-full rounded-full" />
                    </div>
                    <span className="text-xs font-bold w-10 text-right" style={{ color }}>{t.percentage}%</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center text-xs text-gray-400 mt-6">
          Powered by <span style={{ color: HERMES, fontWeight: 600 }}>sentimetrx.ai</span> — to learn more go to{' '}
          <a href="https://www.datanautix.com" target="_blank" rel="noopener noreferrer"
            className="font-semibold underline" style={{ color: HERMES }}>datanautix.com</a>
        </div>
      </div>
    </div>
  )
}

function SharedCampaignDashboard({ campaign, stats, expiresAt, lastRefreshed, refreshing, onRefresh }: {
  campaign: any; stats: any; expiresAt: string
  lastRefreshed: Date | null; refreshing: boolean; onRefresh: () => void
}) {
  const delivered = stats.sent + stats.opened + stats.clicked + stats.completed + stats.unsubscribed
  const deliveryRate = stats.total > 0 ? Math.round(delivered / stats.total * 100) : 0
  const completionRate = stats.total > 0 ? Math.round(stats.completed / stats.total * 100) : 0

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-4">
          <h1 className="text-xl font-bold text-gray-800 mb-1">{campaign.name}</h1>
          <p className="text-xs text-gray-400">Campaign dashboard · Expires {new Date(expiresAt).toLocaleDateString()}</p>
        </div>

        <RefreshBar lastRefreshed={lastRefreshed} refreshing={refreshing} onRefresh={onRefresh} />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold" style={{ color: HERMES }}>{stats.total}</div>
            <div className="text-xs text-gray-500">Recipients</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-blue-600">{deliveryRate}%</div>
            <div className="text-xs text-gray-500">Delivered</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-green-600">{completionRate}%</div>
            <div className="text-xs text-gray-500">Completed</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-gray-600">{stats.pending}</div>
            <div className="text-xs text-gray-500">Pending</div>
          </div>
        </div>

        {/* Funnel */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <h3 className="font-semibold text-sm text-gray-800 mb-3">Delivery Funnel</h3>
          <div className="space-y-2">
            {[
              { label: 'Delivered', value: delivered, color: '#3b82f6' },
              { label: 'Completed', value: stats.completed, color: '#22c55e' },
              { label: 'Pending', value: stats.pending, color: '#f59e0b' },
              ...(stats.bounced > 0 ? [{ label: 'Bounced', value: stats.bounced, color: '#ef4444' }] : []),
              ...(stats.unsubscribed > 0 ? [{ label: 'Unsubscribed', value: stats.unsubscribed, color: '#9ca3af' }] : []),
            ].map(s => (
              <div key={s.label} className="flex items-center gap-3">
                <span className="text-xs text-gray-500 w-20">{s.label}</span>
                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: (stats.total > 0 ? s.value / stats.total * 100 : 0) + '%', background: s.color }} />
                </div>
                <span className="text-xs font-semibold text-gray-700 w-16 text-right">{s.value} ({stats.total > 0 ? Math.round(s.value / stats.total * 100) : 0}%)</span>
              </div>
            ))}
          </div>
        </div>

        {campaign.target_responses && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
            <h3 className="font-semibold text-sm text-gray-800 mb-2">Target Progress</h3>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-500">{stats.completed} of {campaign.target_responses}</span>
              <span className="text-xs font-bold" style={{ color: stats.completed >= campaign.target_responses ? '#16a34a' : HERMES }}>
                {Math.min(Math.round(stats.completed / campaign.target_responses * 100), 100)}%
              </span>
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{
                width: Math.min(Math.round(stats.completed / campaign.target_responses * 100), 100) + '%',
                background: stats.completed >= campaign.target_responses ? '#16a34a' : HERMES,
              }} />
            </div>
          </div>
        )}

        <div className="text-center text-xs text-gray-400 mt-6">
          Powered by <span style={{ color: HERMES, fontWeight: 600 }}>sentimetrx.ai</span> — to learn more go to{' '}
          <a href="https://www.datanautix.com" target="_blank" rel="noopener noreferrer"
            className="font-semibold underline" style={{ color: HERMES }}>datanautix.com</a>
        </div>
      </div>
    </div>
  )
}

// ── Shared Town Hall Dashboard ────────────────────────────────────────────────

const TH_COLORS = ['#0F7173', '#E8B84B', '#7C3AED', '#059669', '#E85A1A', '#1A5070', '#0891B2', '#DB2777']
const sentColorMap: Record<string, string> = { positive: '#16a34a', negative: '#dc2626', mixed: '#d97706', neutral: '#6b7280' }
const sentBgMap: Record<string, string> = { positive: '#f0fdf4', negative: '#fef2f2', mixed: '#fffbeb', neutral: '#f9fafb' }

function SharedTownHallDashboard({ session, themes, stats, expiresAt, lastRefreshed, refreshing, onRefresh }: {
  session: any; themes: any[]; stats: any; expiresAt: string
  lastRefreshed: Date | null; refreshing: boolean; onRefresh: () => void
}) {
  return (
    <div style={{ minHeight: '100dvh', background: '#f9fafb', padding: 20 }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <RefreshBar lastRefreshed={lastRefreshed} refreshing={refreshing} onRefresh={onRefresh} />

        {/* Header */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">{session.bot_emoji || '\uD83D\uDCAC'}</span>
            <div>
              <h1 className="text-lg font-bold text-gray-900">{session.name}</h1>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <span className="capitalize">{session.status}</span>
                {session.started_at && <span>Started {new Date(session.started_at).toLocaleDateString()}</span>}
                {session.ended_at && <span>Ended {new Date(session.ended_at).toLocaleDateString()}</span>}
              </div>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          {[
            { label: 'Participants', value: stats.participants },
            { label: 'Responses', value: stats.responses },
            { label: 'Avg Words', value: stats.avg_words },
          ].map((s: any) => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
              <div className="text-2xl font-bold text-gray-800">{s.value}</div>
              <div className="text-xs text-gray-400 font-semibold uppercase">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Themes */}
        {themes.length > 0 && (
          <div className="mb-4">
            <h2 className="text-sm font-bold text-gray-700 mb-3 uppercase">Topics ({themes.length})</h2>
            <div className="grid grid-cols-2 gap-3">
              {themes.map((t: any, i: number) => {
                const color = TH_COLORS[i % TH_COLORS.length]
                return (
                  <div key={i} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div style={{ background: color, height: 4 }} />
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-bold text-gray-800">{t.label}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold capitalize"
                          style={{ background: sentBgMap[t.sentiment] || sentBgMap.neutral, color: sentColorMap[t.sentiment] || sentColorMap.neutral }}>
                          {t.sentiment}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mb-2">
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div style={{ width: Math.min(t.percentage, 100) + '%', background: color }} className="h-full rounded-full" />
                        </div>
                        <span className="text-xs font-bold" style={{ color }}>{t.percentage}%</span>
                      </div>
                      {t.keywords?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {t.keywords.slice(0, 5).map((kw: string) => (
                            <span key={kw} className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{kw}</span>
                          ))}
                        </div>
                      )}
                      {t.example_quote && (
                        <p className="text-xs text-gray-500 italic border-l-2 border-gray-200 pl-2 line-clamp-2">
                          {'\u201C'}{t.example_quote.slice(0, 120)}{t.example_quote.length > 120 ? '...' : ''}{'\u201D'}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Distribution */}
        {themes.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
            <h3 className="text-xs font-bold text-gray-700 mb-3 uppercase">Distribution</h3>
            <div className="space-y-2">
              {[...themes].sort((a: any, b: any) => b.percentage - a.percentage).map((t: any, i: number) => {
                const color = TH_COLORS[i % TH_COLORS.length]
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs text-gray-700 font-medium w-28 truncate">{t.label}</span>
                    <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div style={{ width: Math.min(t.percentage, 100) + '%', background: color }} className="h-full rounded-full" />
                    </div>
                    <span className="text-xs font-bold w-10 text-right" style={{ color }}>{t.percentage}%</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="text-center text-xs text-gray-400 mt-6">
          Powered by <span style={{ color: HERMES, fontWeight: 600 }}>sentimetrx.ai</span> — <a href="https://www.datanautix.com" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: HERMES }}>datanautix.com</a>
        </div>
      </div>
    </div>
  )
}

// ── Shared Analytics Dashboard (filtered vs benchmark with outlier flags) ───

function OutlierBadge({ outlier, metric }: { outlier: any; metric?: string }) {
  if (!outlier || !outlier.significant) return null
  const isAbove = outlier.direction === 'above' || outlier.direction === 'over'
  const color = isAbove ? '#059669' : '#dc2626'
  const bg = isAbove ? '#f0fdf4' : '#fef2f2'
  const arrow = isAbove ? '\u25B2' : '\u25BC'
  const label = isAbove ? 'Significantly above' : 'Significantly below'
  const pLabel = outlier.p < 0.001 ? 'p<0.001' : outlier.p < 0.01 ? 'p<0.01' : 'p<0.05'
  return (
    <span title={`z=${outlier.z.toFixed(2)}, ${pLabel}`}
      style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: bg, color, display: 'inline-flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }}>
      {arrow} {label} ({pLabel})
    </span>
  )
}

function SharedAnalyticsDashboard({ token, expiresAt, lastRefreshed, refreshing, onRefresh }: {
  token: string; expiresAt: string
  lastRefreshed: Date | null; refreshing: boolean; onRefresh: () => void
}) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const r = await fetch('/api/share/analytics?token=' + token, { cache: 'no-store' })
        const d = await r.json()
        if (d.error) setError(d.error)
        else setData(d)
      } catch { setError('Failed to load analytics') }
      finally { setLoading(false) }
    }
    load()
  }, [token])

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-gray-400 text-sm">Loading analytics...</div>
    </div>
  )

  if (error) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center max-w-sm">
        <div className="text-3xl mb-3">{'\uD83D\uDCCA'}</div>
        <h1 className="text-lg font-bold text-gray-800 mb-2">Analytics Unavailable</h1>
        <p className="text-sm text-gray-500">{error}</p>
      </div>
    </div>
  )

  const numericEntries = Object.entries(data.numeric || {}) as [string, any][]
  const themes = data.themes || []
  const filterSummary = data.filterSummary || {}
  const filterFields = Object.entries(filterSummary)
  const ps = data.primarySummary as { field: string; values: string[]; comparisonValues: string[] } | null
  const inViewN = data.inView?.n || (data.filtered.n + data.benchmark.n)

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-4">
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: (filterFields.length > 0 || data.dateRange) ? 10 : 0 }}>
            <h1 className="text-lg font-bold text-gray-800">{data.label}</h1>
            <div style={{ textAlign: 'right' }}>
              {data.dateRange && (
                <div className="text-xs text-gray-500" style={{ fontWeight: 600, marginBottom: 2 }}>
                  Data: {data.dateRange.min} — {data.dateRange.max}
                </div>
              )}
              <span className="text-xs text-gray-400">Expires {new Date(expiresAt).toLocaleDateString()}</span>
            </div>
          </div>

          {/* Filter pills */}
          {filterFields.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: ps ? 8 : 0 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', flexShrink: 0 }}>Filtered to</span>
              {filterFields.map(([label, value]) => (
                <span key={label} className="text-[11px] px-3 py-1 rounded-full font-medium"
                  style={{ background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb' }}>
                  {label}: {String(value)}
                </span>
              ))}
            </div>
          )}

          {/* Primary vs Comparison */}
          {ps && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: HERMES, textTransform: 'uppercase', flexShrink: 0 }}>{ps.field}</span>
              {ps.values.map(function(v) {
                return <span key={v} style={{ fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 12, background: '#fff4ef', color: HERMES, border: '1px solid #fbd5c2' }}>{v}</span>
              })}
              {ps.comparisonValues.length > 0 && (
                <>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#0284c7', flexShrink: 0 }}>vs</span>
                  {ps.comparisonValues.length <= 5 ? ps.comparisonValues.map(function(v) {
                    return <span key={v} style={{ fontSize: 10, fontWeight: 500, padding: '2px 8px', borderRadius: 12, background: '#e0f2fe', color: '#0369a1' }}>{v}</span>
                  }) : (
                    <span style={{ fontSize: 10, color: '#0284c7', fontWeight: 600 }}>{ps.comparisonValues.length} others</span>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <RefreshBar lastRefreshed={lastRefreshed} refreshing={refreshing} onRefresh={onRefresh} />

        {/* Response counts */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold" style={{ color: HERMES }}>{data.filtered.n.toLocaleString()}</div>
            <div className="text-xs text-gray-500">Primary</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-gray-600">{data.benchmark.n.toLocaleString()}</div>
            <div className="text-xs text-gray-500">Comparison</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-gray-400">{inViewN.toLocaleString()}</div>
            <div className="text-xs text-gray-500">Total in View</div>
          </div>
        </div>

        {/* Numeric metrics comparison */}
        {numericEntries.length > 0 && (
          <div className="mb-4">
            <h3 className="text-sm font-bold text-gray-700 mb-3 uppercase">Metrics Comparison</h3>
            <div className="space-y-3">
              {numericEntries.map(([field, m]) => {
                const fMean = m.filtered.n > 0 ? m.filtered.mean.toFixed(2) : 'N/A'
                const bMean = m.benchmark.n > 0 ? m.benchmark.mean.toFixed(2) : 'N/A'
                const delta = m.filtered.n > 0 && m.benchmark.n > 0 ? (m.filtered.mean - m.benchmark.mean) : null
                const maxVal = Math.max(m.filtered.mean || 0, m.benchmark.mean || 0)

                return (
                  <div key={field} className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-bold text-gray-800">{m.label}</span>
                      <OutlierBadge outlier={m.outlier} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-xs text-gray-400 mb-1">{data.label}</div>
                        <div className="text-xl font-bold" style={{ color: HERMES }}>{fMean}</div>
                        <div className="text-[10px] text-gray-400">n={m.filtered.n}</div>
                        <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: maxVal > 0 ? Math.min((m.filtered.mean / maxVal) * 100, 100) + '%' : '0%', background: HERMES }} />
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-400 mb-1">Benchmark</div>
                        <div className="text-xl font-bold text-gray-600">{bMean}</div>
                        <div className="text-[10px] text-gray-400">n={m.benchmark.n}</div>
                        <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: maxVal > 0 ? Math.min((m.benchmark.mean / maxVal) * 100, 100) + '%' : '0%', background: '#9ca3af' }} />
                        </div>
                      </div>
                    </div>
                    {delta !== null && (
                      <div className="mt-2 text-right">
                        <span className="text-xs font-bold" style={{ color: delta > 0 ? '#059669' : delta < 0 ? '#dc2626' : '#6b7280' }}>
                          {delta > 0 ? '+' : ''}{delta.toFixed(2)} difference
                        </span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Theme comparison */}
        {themes.length > 0 && (
          <div className="mb-4">
            <h3 className="text-sm font-bold text-gray-700 mb-3 uppercase">Theme Analysis</h3>
            <div className="space-y-3">
              {themes.map((t: any, i: number) => {
                const color = STUDY_THEME_COLORS[i % STUDY_THEME_COLORS.length]
                const fPct = Math.round(t.filtered.rate * 100)
                const bPct = Math.round(t.benchmark.rate * 100)
                const maxPct = Math.max(fPct, bPct, 1)

                return (
                  <div key={t.name} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div style={{ background: color, height: 4 }} />
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-gray-800">{t.name}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold capitalize"
                            style={{ background: sentBgMap[t.sentiment] || sentBgMap.neutral, color: sentColorMap[t.sentiment] || sentColorMap.neutral }}>
                            {t.sentiment}
                          </span>
                        </div>
                        <OutlierBadge outlier={t.outlier} />
                      </div>
                      {t.description && <p className="text-xs text-gray-500 mb-3">{t.description}</p>}

                      {/* Side-by-side bars */}
                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <span className="text-[11px] text-gray-500 w-24 flex-shrink-0">{data.label}</span>
                          <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: (fPct / maxPct * 100) + '%', background: color }} />
                          </div>
                          <span className="text-xs font-bold w-16 text-right" style={{ color }}>{fPct}%</span>
                          <span className="text-[10px] text-gray-400 w-12 text-right">({t.filtered.count})</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[11px] text-gray-500 w-24 flex-shrink-0">Benchmark</span>
                          <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: (bPct / maxPct * 100) + '%', background: '#9ca3af' }} />
                          </div>
                          <span className="text-xs font-bold text-gray-500 w-16 text-right">{bPct}%</span>
                          <span className="text-[10px] text-gray-400 w-12 text-right">({t.benchmark.count})</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center text-xs text-gray-400 mt-6">
          Powered by <span style={{ color: HERMES, fontWeight: 600 }}>sentimetrx.ai</span> — to learn more go to{' '}
          <a href="https://www.datanautix.com" target="_blank" rel="noopener noreferrer"
            className="font-semibold underline" style={{ color: HERMES }}>datanautix.com</a>
        </div>
      </div>
    </div>
  )
}
