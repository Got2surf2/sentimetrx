'use client'

import { useState, useEffect } from 'react'

const HERMES = '#E8632A'

export default function SharedDashboard({ params }: { params: { token: string } }) {
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/share?token=' + params.token)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error)
        else setData(d)
      })
      .catch(() => setError('Failed to load'))
      .finally(() => setLoading(false))
  }, [params.token])

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

  if (data.type === 'study') return <SharedStudyDashboard study={data.study} responses={data.responses} expiresAt={data.expires_at} />
  if (data.type === 'campaign') return <SharedCampaignDashboard campaign={data.campaign} stats={data.stats} expiresAt={data.expires_at} />
  return null
}

function SharedStudyDashboard({ study, responses, expiresAt }: { study: any; responses: any[]; expiresAt: string }) {
  const total = responses.length
  const complete = responses.filter((r: any) => r.status !== 'incomplete').length
  const promoters = responses.filter((r: any) => r.sentiment === 'promoter' || r.sentiment === 'positive').length
  const passives = responses.filter((r: any) => r.sentiment === 'passive' || r.sentiment === 'neutral').length
  const detractors = responses.filter((r: any) => r.sentiment === 'detractor' || r.sentiment === 'negative').length
  const scores = responses.map((r: any) => r.experience_score).filter(Boolean)
  const avgScore = scores.length > 0 ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length * 10) / 10 : 0
  const npsScores = responses.map((r: any) => r.nps_score).filter(Boolean)
  const avgNps = npsScores.length > 0 ? Math.round(npsScores.reduce((a: number, b: number) => a + b, 0) / npsScores.length * 10) / 10 : 0

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

        {/* Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold" style={{ color: HERMES }}>{total}</div>
            <div className="text-xs text-gray-500">Responses</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-green-600">{complete > 0 ? Math.round(complete / total * 100) : 0}%</div>
            <div className="text-xs text-gray-500">Complete</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold" style={{ color: HERMES }}>{avgScore}</div>
            <div className="text-xs text-gray-500">Avg Rating</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-blue-600">{avgNps}</div>
            <div className="text-xs text-gray-500">Avg NPS</div>
          </div>
        </div>

        {/* Sentiment breakdown */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <h3 className="font-semibold text-sm text-gray-800 mb-3">Sentiment Breakdown</h3>
          <div className="space-y-2">
            {[
              { label: 'Promoters', value: promoters, color: '#22c55e' },
              { label: 'Passives', value: passives, color: '#f59e0b' },
              { label: 'Detractors', value: detractors, color: '#ef4444' },
            ].map(s => (
              <div key={s.label} className="flex items-center gap-3">
                <span className="text-xs text-gray-500 w-20">{s.label}</span>
                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: (total > 0 ? s.value / total * 100 : 0) + '%', background: s.color }} />
                </div>
                <span className="text-xs font-semibold text-gray-700 w-16 text-right">{s.value} ({total > 0 ? Math.round(s.value / total * 100) : 0}%)</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-xs text-gray-400 mt-6">
          Powered by <span style={{ color: HERMES, fontWeight: 600 }}>sentimetrx.ai</span>
        </div>
      </div>
    </div>
  )
}

function SharedCampaignDashboard({ campaign, stats, expiresAt }: { campaign: any; stats: any; expiresAt: string }) {
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
          Powered by <span style={{ color: HERMES, fontWeight: 600 }}>sentimetrx.ai</span>
        </div>
      </div>
    </div>
  )
}
