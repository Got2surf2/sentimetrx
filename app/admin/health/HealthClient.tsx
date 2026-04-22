'use client'

import TopNav from '@/components/nav/TopNav'
import SubHeader from '@/components/nav/SubHeader'

const HERMES = '#E8632A'

interface StudyHealth {
  id: string
  name: string
  orgName: string
  total24h: number
  complete24h: number
  partial24h: number
  total1h: number
  totalAll: number
  completeAll: number
  completionRate: number
}

interface Props {
  logoUrl: string
  orgName: string
  fullName: string
  userEmail: string
  dbOk: boolean
  dbLatency: number
  studyHealth: StudyHealth[]
  totalResponses24h: number
  totalComplete24h: number
}

function StatusDot({ ok }: { ok: boolean }) {
  return <span className={'inline-block w-3 h-3 rounded-full flex-shrink-0 ' + (ok ? 'bg-green-500' : 'bg-red-500')} />
}

export default function HealthClient({
  logoUrl, orgName, fullName, userEmail,
  dbOk, dbLatency, studyHealth, totalResponses24h, totalComplete24h,
}: Props) {
  const platform24hRate = totalResponses24h > 0
    ? Math.round((totalComplete24h / totalResponses24h) * 100)
    : 0

  return (
    <div className="min-h-screen bg-gray-50">
      <TopNav logoUrl={logoUrl} orgName={orgName} isAdmin={true} userEmail={userEmail} fullName={fullName} currentPage="admin" />
      <SubHeader crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Health' }]} />

      <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-6">
        <h1 className="text-2xl font-black text-gray-800">Platform Health</h1>

        {/* Infrastructure status */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white border border-gray-200 rounded-2xl p-5 flex items-center gap-4">
            <StatusDot ok={dbOk} />
            <div>
              <p className="text-sm font-semibold text-gray-800">Supabase</p>
              <p className="text-xs text-gray-400">{dbOk ? dbLatency + 'ms latency' : 'Connection failed'}</p>
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-2xl p-5 flex items-center gap-4">
            <StatusDot ok={true} />
            <div>
              <p className="text-sm font-semibold text-gray-800">Vercel</p>
              <p className="text-xs text-gray-400">Page loaded OK</p>
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-2xl p-5 flex items-center gap-4">
            <StatusDot ok={totalResponses24h > 0 || studyHealth.length === 0} />
            <div>
              <p className="text-sm font-semibold text-gray-800">Response Pipeline</p>
              <p className="text-xs text-gray-400">
                {totalResponses24h > 0
                  ? totalComplete24h + '/' + totalResponses24h + ' complete (24h)'
                  : 'No responses in 24h'}
              </p>
            </div>
          </div>
        </div>

        {/* Platform summary */}
        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          <h2 className="font-bold text-gray-800 mb-3">Last 24 Hours</h2>
          <div className="grid grid-cols-3 gap-6 text-center">
            <div>
              <p className="text-3xl font-bold" style={{ color: HERMES }}>{totalResponses24h}</p>
              <p className="text-xs text-gray-400 mt-1">Total Responses</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-green-600">{totalComplete24h}</p>
              <p className="text-xs text-gray-400 mt-1">Complete</p>
            </div>
            <div>
              <p className={'text-3xl font-bold ' + (platform24hRate < 50 ? 'text-red-500' : platform24hRate < 70 ? 'text-amber-500' : 'text-green-600')}>
                {platform24hRate}%
              </p>
              <p className="text-xs text-gray-400 mt-1">Completion Rate</p>
            </div>
          </div>
        </div>

        {/* Per-study health */}
        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          <h2 className="font-bold text-gray-800 mb-3">Active Studies</h2>
          {studyHealth.length === 0 ? (
            <p className="text-sm text-gray-400">No active studies</p>
          ) : (
            <div className="flex flex-col gap-1">
              {/* Header */}
              <div className="grid gap-3 px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wide"
                style={{ gridTemplateColumns: '2fr 1fr 80px 80px 80px 80px 70px' }}>
                <span>Study</span>
                <span>Org</span>
                <span className="text-right">All Time</span>
                <span className="text-right">24h</span>
                <span className="text-right">1h</span>
                <span className="text-right">Partial 24h</span>
                <span className="text-right">Rate</span>
              </div>
              {studyHealth.map(function(s) {
                const rateColor = s.completionRate < 50 ? 'text-red-500' : s.completionRate < 70 ? 'text-amber-500' : 'text-green-600'
                return (
                  <div key={s.id}
                    className="grid gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 transition-colors items-center text-sm"
                    style={{ gridTemplateColumns: '2fr 1fr 80px 80px 80px 80px 70px' }}>
                    <span className="text-gray-800 font-medium truncate">{s.name}</span>
                    <span className="text-gray-400 text-xs truncate">{s.orgName}</span>
                    <span className="text-right text-gray-600">{s.totalAll}</span>
                    <span className="text-right font-semibold" style={{ color: s.total24h > 0 ? HERMES : '#d1d5db' }}>{s.total24h}</span>
                    <span className="text-right text-gray-500">{s.total1h}</span>
                    <span className={'text-right ' + (s.partial24h > 0 ? 'text-amber-500 font-semibold' : 'text-gray-300')}>{s.partial24h}</span>
                    <span className={'text-right font-bold ' + rateColor}>{s.completionRate}%</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <p className="text-xs text-gray-300 text-center">
          Refreshed on page load. Reload to update.
        </p>
      </div>
    </div>
  )
}
