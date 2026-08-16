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

interface ServiceCredit {
  service: string
  display_name: string
  tier: number
  balance_usd: number | null
  status: 'ok' | 'low' | 'critical' | 'error' | 'unknown'
  checked_at: string | null
  last_error_at: string | null
  last_error_code: string | null
  last_error_msg: string | null
}

// Mirrors lib/anthropicCost.ClaudeProbe (that lib is server-only — client
// components re-declare the wire shape, same pattern as AnthropicSpend below).
interface ClaudeProbe {
  status: 'ok' | 'out_of_credits' | 'error' | 'unconfigured'
  message: string | null
}

interface AnthropicSpend {
  configured: boolean
  mtdUsd: number | null
  last7Usd: number | null
  asOf: string | null
  error: string | null
}

interface BackupHealth {
  day: string
  total: number
  gaps: { orgId: string; name: string; status: string; error: string | null }[]
  missing: { orgId: string; name: string }[]
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
  serviceCredits: ServiceCredit[]
  backups: BackupHealth
  anthropicSpend: AnthropicSpend
  claudeProbe: ClaudeProbe
  alertRecipientSet: boolean
}

// Where to re-up each vendor — the "click to fix it" path when a credit
// failure fires (root console URLs only; deep billing paths change).
const VENDOR_CONSOLE: Record<string, string> = {
  anthropic: 'https://console.anthropic.com',
  openai: 'https://platform.openai.com',
  dataforseo: 'https://app.dataforseo.com',
  google_places: 'https://console.cloud.google.com',
}

function relTime(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.round(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

function StatusDot({ ok, neutral }: { ok: boolean; neutral?: boolean }) {
  return <span className={'inline-block w-3 h-3 rounded-full flex-shrink-0 ' + (ok ? 'bg-green-500' : neutral ? 'bg-gray-300' : 'bg-red-500')} />
}

export default function HealthClient({
  logoUrl, orgName, fullName, userEmail,
  dbOk, dbLatency, studyHealth, totalResponses24h, totalComplete24h, sentry, serviceCredits, backups,
  anthropicSpend, claudeProbe, alertRecipientSet,
}: Props) {
  const platform24hRate = totalResponses24h > 0
    ? Math.round((totalComplete24h / totalResponses24h) * 100)
    : 0

  // A tier-2 vendor in 'error' state means a live credit/quota failure — for
  // Anthropic/OpenAI that's "AI calls are failing right now." This is the
  // reactive signal that matters most (Anthropic has no balance API to warn
  // ahead of time): a 402 from lib/ai.ts flips the row to 'error'.
  const creditFailures = serviceCredits.filter(s => s.status === 'error')

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
      <SubHeader crumbs={[{ label: 'Settings & Admin', href: '/admin/hub' }, { label: 'System Health' }]} />

      <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-6">
        <h1 className="text-2xl font-black text-gray-800">Platform Health</h1>

        {/* ── Loud degradation banner — a live vendor credit/quota failure ── */}
        {creditFailures.length > 0 && (
          <div className="rounded-2xl border-2 border-red-500 bg-red-50 p-5">
            <p className="text-sm font-black text-red-700 uppercase tracking-wide">
              ⚠️ Vendor calls may be degraded
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {creditFailures.map(s => (
                <li key={s.service} className="text-sm text-red-800 flex items-center gap-3 flex-wrap">
                  <span>
                    <span className="font-bold">{s.display_name}</span> reported a credit/quota error
                    {s.last_error_at ? ` ${relTime(s.last_error_at)}` : ''}
                    {s.last_error_code ? ` (${s.last_error_code})` : ''}
                    {s.last_error_msg ? ` — ${s.last_error_msg}` : ''}
                  </span>
                  {VENDOR_CONSOLE[s.service] && (
                    <a href={VENDOR_CONSOLE[s.service]} target="_blank" rel="noopener noreferrer"
                      className="inline-block px-3 py-1 rounded-full text-xs font-bold text-white flex-shrink-0"
                      style={{ background: HERMES }}>
                      Add funds ↗
                    </a>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-red-700">
              If this is Anthropic (Claude) or OpenAI, AI features are likely failing now — top up credits in the vendor console.
            </p>
          </div>
        )}

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
          {/* Zero survey submissions = quiet traffic, NOT an outage — a red dot
              here once read as "we ran out of API credits" (owner, 2026-07-12).
              Neutral gray for quiet; red is reserved for real failures. */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5 flex items-center gap-4">
            <StatusDot ok={totalResponses24h > 0 || studyHealth.length === 0} neutral />
            <div>
              <p className="text-sm font-semibold text-gray-800">Survey traffic</p>
              <p className="text-xs text-gray-400">
                {totalResponses24h > 0
                  ? totalComplete24h + '/' + totalResponses24h + ' complete (24h)'
                  : 'No survey responses in 24h — quiet, not an outage'}
              </p>
            </div>
          </div>
        </div>

        {/* ── Claude API spend (Anthropic Cost API — spend, not balance) ──── */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm font-bold text-gray-800 flex items-center gap-2">
                Claude API spend (this month)
                {claudeProbe.status === 'ok' && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700">
                    <span className="inline-block w-2 h-2 rounded-full bg-green-500" /> key live
                  </span>
                )}
                {claudeProbe.status === 'error' && (
                  <span className="text-xs font-semibold text-amber-700" title={claudeProbe.message || ''}>⚠ probe failed</span>
                )}
              </p>
              <p className="text-xs text-gray-500">
                Anthropic has no remaining-balance API — this is month-to-date <span className="font-semibold">spend</span>, not credits left.
                {' '}A live 1-token probe checks the key each load.{' '}
                <a href={VENDOR_CONSOLE.anthropic} target="_blank" rel="noopener noreferrer" className="underline text-gray-600">Console ↗</a>
              </p>
              {claudeProbe.status === 'out_of_credits' && (
                <div className="mt-2 flex items-center gap-3 flex-wrap">
                  <span className="text-sm font-black text-red-700">🔴 Credits exhausted — AI calls are failing now</span>
                  <a href={VENDOR_CONSOLE.anthropic} target="_blank" rel="noopener noreferrer"
                    className="inline-block px-4 py-1.5 rounded-full text-sm font-bold text-white"
                    style={{ background: HERMES }}>
                    Add funds in Console ↗
                  </a>
                </div>
              )}
            </div>
            {anthropicSpend.configured && anthropicSpend.mtdUsd != null ? (
              <div className="text-right">
                <p className="text-3xl font-black" style={{ color: HERMES }}>
                  ${anthropicSpend.mtdUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                {anthropicSpend.last7Usd != null && (
                  <p className="text-xs text-gray-400">
                    ${anthropicSpend.last7Usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} in the last 7 days
                  </p>
                )}
              </div>
            ) : anthropicSpend.error ? (
              <p className="text-xs text-red-600 max-w-xs text-right">{anthropicSpend.error}</p>
            ) : (
              <p className="text-xs text-gray-400 max-w-xs text-right">
                Set <code className="bg-gray-100 px-1 rounded">ANTHROPIC_ADMIN_KEY</code> (an <code className="bg-gray-100 px-1 rounded">sk-ant-admin01-…</code> key) to show spend.
              </p>
            )}
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

        {/* ── Backups: per-tenant snapshot outcomes (sql/192) ─────────────── */}
        {(() => {
          // `missing` is the case that actually bit on 2026-08-08: an org the
          // cron never reached leaves no trace anywhere, so it cannot be an
          // absence of bad news — it has to be counted explicitly.
          const bad = backups.gaps.length + backups.missing.length
          const ok = Math.max(0, backups.total - bad)
          const tone = bad === 0 ? 'green' : backups.gaps.some(g => g.status === 'failed') || backups.missing.length ? 'red' : 'amber'
          const label: Record<string, string> = {
            failed: 'bg-red-100 text-red-700',
            incomplete: 'bg-red-100 text-red-700',
            partial: 'bg-amber-100 text-amber-800',
          }
          return (
            <div className={'rounded-2xl p-5 border ' +
              (tone === 'green' ? 'bg-green-50 border-green-200'
               : tone === 'amber' ? 'bg-amber-50 border-amber-200'
               : 'bg-red-50 border-red-200')}>
              <div className="flex items-center gap-3 mb-3">
                <StatusDot ok={bad === 0} />
                <div>
                  <p className="text-sm font-bold text-gray-800">Per-Tenant Backups</p>
                  <p className="text-xs text-gray-600">
                    Nightly org snapshots for <strong>{backups.day}</strong> — {ok}/{backups.total} orgs backed up cleanly.
                  </p>
                </div>
              </div>
              {bad === 0 ? (
                <p className="text-xs text-gray-600">Every tenant has a complete snapshot for this day.</p>
              ) : (
                <div className="space-y-1.5">
                  {backups.missing.map(m => (
                    <div key={m.orgId} className="flex items-center justify-between gap-3 text-xs">
                      <span className="font-semibold text-gray-800">{m.name}</span>
                      <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">no run recorded</span>
                    </div>
                  ))}
                  {backups.gaps.map(g => (
                    <div key={g.orgId} className="flex items-center justify-between gap-3 text-xs">
                      <span className="font-semibold text-gray-800">{g.name}</span>
                      <span className="flex items-center gap-2 min-w-0">
                        {g.error && <span className="text-gray-500 truncate max-w-[22rem]" title={g.error}>{g.error}</span>}
                        <span className={'px-2 py-0.5 rounded-full font-semibold ' + (label[g.status] || 'bg-gray-100 text-gray-600')}>
                          {g.status}
                        </span>
                      </span>
                    </div>
                  ))}
                  <p className="text-[11px] text-gray-500 pt-1">
                    <strong>incomplete</strong> means a manifest was written but a table failed to read — it is NOT a usable backup.
                  </p>
                </div>
              )}
            </div>
          )
        })()}

        {/* ── Service credits / vendor health ───────────────────────────── */}
        {(() => {
          const worst = serviceCredits.some(s => s.status === 'critical' || s.status === 'error') ? 'red'
            : serviceCredits.some(s => s.status === 'low') ? 'amber' : 'green'
          const badge = (s: ServiceCredit['status']) => {
            const map: Record<string, string> = {
              ok: 'bg-green-100 text-green-700', low: 'bg-amber-100 text-amber-800',
              critical: 'bg-red-100 text-red-700', error: 'bg-red-100 text-red-700',
              unknown: 'bg-gray-100 text-gray-500',
            }
            return map[s] || map.unknown
          }
          return (
            <div className={'rounded-2xl p-5 border ' +
              (worst === 'green' ? 'bg-green-50 border-green-200'
               : worst === 'amber' ? 'bg-amber-50 border-amber-200'
               : 'bg-red-50 border-red-200')}>
              <div className="flex items-center gap-3 mb-3">
                <StatusDot ok={worst === 'green'} />
                <div>
                  <p className="text-sm font-bold text-gray-800">Service Credits &amp; Health</p>
                  <p className="text-xs text-gray-600">
                    Vendor account balances (polled) + last credit/quota error. Alerts via the service-balance cron (every 6h).
                  </p>
                  {!alertRecipientSet && (
                    <p className="text-xs text-red-600 font-semibold mt-0.5">
                      No CREDITS_ALERT_TO set — credit alerts won&apos;t reach anyone. Add it in Vercel env.
                    </p>
                  )}
                </div>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="grid gap-3 px-4 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100"
                  style={{ gridTemplateColumns: '1.4fr 100px 90px 1fr' }}>
                  <span>Service</span>
                  <span className="text-right">Balance</span>
                  <span className="text-center">Status</span>
                  <span>Last credit error</span>
                </div>
                {serviceCredits.map(s => (
                  <div key={s.service}
                    className="grid gap-3 px-4 py-2.5 text-xs items-center border-b border-gray-100 last:border-b-0"
                    style={{ gridTemplateColumns: '1.4fr 100px 90px 1fr' }}>
                    <span className="text-gray-800 font-medium truncate">{s.display_name}</span>
                    <span className="text-right text-gray-700 font-semibold">
                      {s.balance_usd != null ? `$${s.balance_usd.toFixed(2)}`
                        : s.tier === 1 ? <span className="text-gray-300 font-normal">not configured</span>
                        : <span className="text-gray-300 font-normal">no balance API</span>}
                    </span>
                    <span className="text-center">
                      <span className={'inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ' + badge(s.status)}>{s.status}</span>
                    </span>
                    <span className="text-gray-500 truncate" title={s.last_error_msg || ''}>
                      {s.last_error_at
                        ? <>{relTime(s.last_error_at)}{s.last_error_code ? ` · ${s.last_error_code}` : ''}</>
                        : <span className="text-gray-300">none</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )
        })()}

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
