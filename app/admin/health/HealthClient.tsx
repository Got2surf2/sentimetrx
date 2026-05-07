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

interface SentryHealth {
  dsnSet: boolean
  tokenSet: boolean
  orgSlug: string | null
  projectSlug: string | null
  issueCount24h: number
  events24h: number
  topIssues: { id: string; title: string; lastSeen: string; count: number; permalink: string }[]
  error: string | null
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
  sentry: SentryHealth
}

function StatusDot({ ok }: { ok: boolean }) {
  return <span className={'inline-block w-3 h-3 rounded-full flex-shrink-0 ' + (ok ? 'bg-green-500' : 'bg-red-500')} />
}

export default function HealthClient({
  logoUrl, orgName, fullName, userEmail,
  dbOk, dbLatency, studyHealth, totalResponses24h, totalComplete24h, sentry,
}: Props) {
  const platform24hRate = totalResponses24h > 0
    ? Math.round((totalComplete24h / totalResponses24h) * 100)
    : 0

  // Sentry health classification: green if 0 events, amber if <10, red if 10+.
  const sentryFullyConfigured = sentry.dsnSet && sentry.tokenSet && sentry.orgSlug && sentry.projectSlug
  const sentryStatusOk = sentryFullyConfigured ? sentry.events24h === 0 : sentry.dsnSet
  const sentryBanner: 'green' | 'amber' | 'red' =
    !sentry.dsnSet ? 'red'
    : !sentryFullyConfigured ? 'amber'
    : sentry.events24h >= 10 ? 'red'
    : sentry.events24h > 0 ? 'amber'
    : 'green'
  const sentryProjectUrl = sentry.orgSlug && sentry.projectSlug
    ? `https://sentry.io/organizations/${sentry.orgSlug}/projects/${sentry.projectSlug}/`
    : 'https://sentry.io/'

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

        {/* ── Errors / Sentry ───────────────────────────────────────────── */}
        <div className={'rounded-2xl p-5 border ' +
          (sentryBanner === 'green' ? 'bg-green-50 border-green-200'
           : sentryBanner === 'amber' ? 'bg-amber-50 border-amber-200'
           : 'bg-red-50 border-red-200')}>
          <div className="flex items-start justify-between mb-3 gap-4">
            <div className="flex items-center gap-3">
              <StatusDot ok={sentryStatusOk} />
              <div>
                <p className="text-sm font-bold text-gray-800">Errors (Sentry)</p>
                {!sentry.dsnSet && (
                  <p className="text-xs text-red-600">DSN not configured — set NEXT_PUBLIC_SENTRY_DSN in Vercel</p>
                )}
                {sentry.dsnSet && !sentryFullyConfigured && (
                  <p className="text-xs text-amber-700">DSN connected. Set SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT to see live error data here.</p>
                )}
                {sentryFullyConfigured && sentry.error && (
                  <p className="text-xs text-red-600">Couldn&apos;t reach Sentry API: {sentry.error}</p>
                )}
                {sentryFullyConfigured && !sentry.error && sentry.events24h === 0 && (
                  <p className="text-xs text-green-700">No errors in the last 24 hours</p>
                )}
                {sentryFullyConfigured && !sentry.error && sentry.events24h > 0 && (
                  <p className="text-xs text-gray-700">{sentry.events24h} events across {sentry.issueCount24h} issue{sentry.issueCount24h === 1 ? '' : 's'} in 24h</p>
                )}
              </div>
            </div>
            <a href={sentryProjectUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 whitespace-nowrap">
              Open Sentry →
            </a>
          </div>

          {sentry.topIssues.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="grid gap-3 px-4 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100"
                style={{ gridTemplateColumns: '1fr 80px 120px' }}>
                <span>Top issues (24h)</span>
                <span className="text-right">Events</span>
                <span className="text-right">Last seen</span>
              </div>
              {sentry.topIssues.map(iss => (
                <a key={iss.id} href={iss.permalink} target="_blank" rel="noopener noreferrer"
                  className="grid gap-3 px-4 py-2 text-xs hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                  style={{ gridTemplateColumns: '1fr 80px 120px' }}>
                  <span className="text-gray-700 truncate" title={iss.title}>{iss.title}</span>
                  <span className="text-right font-semibold text-gray-700">{iss.count}</span>
                  <span className="text-right text-gray-400">{new Date(iss.lastSeen).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                </a>
              ))}
            </div>
          )}
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
