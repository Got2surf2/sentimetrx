'use client'

import { useState, useEffect, useCallback } from 'react'
import { detectScale } from '@/lib/scaleUtils'

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
    ratingPrompt={data.ratingPrompt} npsPrompt={data.npsPrompt}
    lastRefreshed={lastRefreshed} refreshing={refreshing} onRefresh={() => fetchData(true)} />
  if (data.type === 'campaign') return <SharedCampaignDashboard campaign={data.campaign} stats={data.stats} expiresAt={data.expires_at}
    lastRefreshed={lastRefreshed} refreshing={refreshing} onRefresh={() => fetchData(true)} />
  if (data.type === 'townhall') return <SharedTownHallDashboard session={data.session} themes={data.themes} stats={data.stats} expiresAt={data.expires_at}
    lastRefreshed={lastRefreshed} refreshing={refreshing} onRefresh={() => fetchData(true)} />
  return null
}

// -- Responses over time bar chart (CSS-only, no deps) --
function ResponsesOverTimeChart({ responses }: { responses: any[] }) {
  // Get all timestamps
  const timestamps = responses
    .map((r: any) => r.completed_at)
    .filter(Boolean)
    .map((t: string) => new Date(t))
    .sort((a, b) => a.getTime() - b.getTime())

  if (timestamps.length < 2) return null

  // Determine scale: if range < 3 days use hourly, otherwise daily
  const rangeMs = timestamps[timestamps.length - 1].getTime() - timestamps[0].getTime()
  const rangeDays = rangeMs / (1000 * 60 * 60 * 24)
  const useHourly = rangeDays < 3

  // Bucket responses
  const buckets: Record<string, { complete: number; incomplete: number }> = {}

  for (const r of responses) {
    if (!r.completed_at) continue
    const d = new Date(r.completed_at)
    const key = useHourly
      ? d.toISOString().slice(0, 13) // YYYY-MM-DDTHH
      : d.toISOString().slice(0, 10) // YYYY-MM-DD
    if (!buckets[key]) buckets[key] = { complete: 0, incomplete: 0 }
    if (r.status === 'incomplete') buckets[key].incomplete++
    else buckets[key].complete++
  }

  const sortedKeys = Object.keys(buckets).sort()
  if (sortedKeys.length === 0) return null

  const maxVal = Math.max(...sortedKeys.map(k => buckets[k].complete + buckets[k].incomplete))

  // Format labels
  const formatLabel = (key: string) => {
    if (useHourly) {
      const d = new Date(key + ':00:00Z')
      return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' })
    }
    const d = new Date(key + 'T00:00:00Z')
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric' })
  }

  // Show at most 20 bars, evenly sampled if more
  let displayKeys = sortedKeys
  if (sortedKeys.length > 20) {
    const step = Math.ceil(sortedKeys.length / 20)
    displayKeys = sortedKeys.filter((_, i) => i % step === 0)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
      <h3 className="font-semibold text-sm text-gray-800 mb-1">Responses Over Time</h3>
      <div className="flex items-center gap-4 mb-3">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ background: '#22c55e' }} />
          <span className="text-[10px] text-gray-500">Complete</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ background: '#f59e0b' }} />
          <span className="text-[10px] text-gray-500">Incomplete</span>
        </div>
        <span className="text-[10px] text-gray-400 ml-auto">
          {useHourly ? 'Hourly' : 'Daily'}
        </span>
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
                {formatLabel(key)}
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

function SharedStudyDashboard({ study, responses, expiresAt, ratingScale, ratingLabel, npsEnabled, experienceEnabled, ratingPrompt, npsPrompt, lastRefreshed, refreshing, onRefresh }: {
  study: any; responses: any[]; expiresAt: string
  ratingScale?: any[]; ratingLabel?: string | null; npsEnabled?: boolean; experienceEnabled?: boolean
  ratingPrompt?: string | null; npsPrompt?: string | null
  lastRefreshed: Date | null; refreshing: boolean; onRefresh: () => void
}) {
  const total = responses.length
  const complete = responses.filter((r: any) => r.status !== 'incomplete').length

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
            <h2 className="text-sm font-bold text-gray-700 mb-3 uppercase">Themes ({themes.length})</h2>
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
