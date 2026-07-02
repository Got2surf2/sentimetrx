'use client'

// components/admin/SentryDigest.tsx
// Renders the Sentry digest for /admin/sentry. Fetches live on mount;
// shows the most recent unresolved issues sorted by last-seen descending.

import { useEffect, useState } from 'react'
import type { SentryDigest as Digest, SentryIssue } from '@/lib/sentry'

const HERMES = '#E8632A'

const LEVEL_COLOR: Record<string, { bg: string; fg: string; border: string }> = {
  fatal:   { bg: '#fee2e2', fg: '#991b1b', border: '#fca5a5' },
  error:   { bg: '#fee2e2', fg: '#b91c1c', border: '#fecaca' },
  warning: { bg: '#fef3c7', fg: '#92400e', border: '#fde68a' },
  info:    { bg: '#dbeafe', fg: '#1e40af', border: '#bfdbfe' },
  debug:   { bg: '#f3f4f6', fg: '#374151', border: '#e5e7eb' },
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000)    return 'just now'
  if (ms < 3_600_000) return Math.floor(ms / 60_000) + 'm ago'
  if (ms < 86_400_000) return Math.floor(ms / 3_600_000) + 'h ago'
  return Math.floor(ms / 86_400_000) + 'd ago'
}

export default function SentryDigest() {
  const [digest, setDigest] = useState<Digest | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchIssues = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/sentry/issues')
      const data = await res.json()
      setDigest(data)
    } catch (e: any) {
      setDigest({ ok: false, configured: true, reason: e?.message || 'Fetch failed', fetchedAt: new Date().toISOString(), total: 0, issues: [] })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void fetchIssues() }, [])

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Sentry Digest</h1>
          <p className="text-sm text-gray-500 mt-1">Unresolved production issues, freshest first.</p>
        </div>
        <button onClick={() => { void fetchIssues() }} disabled={loading}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white hover:opacity-90 transition-all disabled:opacity-50"
          style={{ background: HERMES }}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* Setup banner — when env vars are missing */}
      {digest && !digest.configured && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <p className="text-sm font-semibold text-amber-900 mb-2">Sentry API access not configured</p>
          <p className="text-xs text-amber-800 mb-3">{digest.reason}</p>
          <p className="text-xs text-amber-800">
            Set <code className="bg-white px-1.5 py-0.5 rounded font-mono">SENTRY_AUTH_TOKEN</code>,
            {' '}<code className="bg-white px-1.5 py-0.5 rounded font-mono">SENTRY_ORG_SLUG</code>, and
            {' '}<code className="bg-white px-1.5 py-0.5 rounded font-mono">SENTRY_PROJECT_SLUG</code> in Vercel env vars.
            Token needs scopes <strong>event:read</strong> + <strong>project:read</strong> (Sentry → Settings → Auth Tokens → Create New Token).
          </p>
        </div>
      )}

      {/* Error banner — when API call failed */}
      {digest && digest.configured && !digest.ok && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
          <p className="text-sm font-semibold text-red-900 mb-1">Couldn't load Sentry issues</p>
          <p className="text-xs text-red-800">{digest.reason}</p>
        </div>
      )}

      {/* Loading */}
      {loading && !digest && (
        <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center text-gray-500">Loading…</div>
      )}

      {/* Empty state — fetched OK but no unresolved issues */}
      {digest && digest.ok && digest.issues.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center">
          <div className="text-4xl mb-3">✅</div>
          <p className="text-sm font-semibold text-gray-800">No unresolved issues.</p>
          <p className="text-xs text-gray-500 mt-1">Fetched {timeAgo(digest.fetchedAt)} from Sentry.</p>
        </div>
      )}

      {/* Issue list */}
      {digest && digest.ok && digest.issues.length > 0 && (
        <>
          <div className="text-xs text-gray-500 mb-3">
            {digest.total} issue{digest.total === 1 ? '' : 's'} · fetched {timeAgo(digest.fetchedAt)}
          </div>
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <div className="divide-y divide-gray-100">
              {digest.issues.map((it: SentryIssue) => {
                const lvl = LEVEL_COLOR[it.level] || LEVEL_COLOR.error
                return (
                  <a
                    key={it.id}
                    href={it.permalink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block px-5 py-4 hover:bg-gray-50 transition-colors"
                    style={{ textDecoration: 'none' }}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: lvl.bg, color: lvl.fg, border: '1px solid ' + lvl.border, textTransform: 'uppercase' }}>
                            {it.level}
                          </span>
                          <span className="text-xs text-gray-400 font-mono">{it.shortId}</span>
                        </div>
                        <div className="text-sm font-semibold text-gray-800 truncate">{it.title}</div>
                        {it.culprit && <div className="text-xs text-gray-500 mt-0.5 truncate">{it.culprit}</div>}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-sm font-bold text-gray-800">{it.count.toLocaleString()}</div>
                        <div className="text-xs text-gray-400">events</div>
                        {it.userCount > 0 && <div className="text-xs text-gray-400 mt-0.5">{it.userCount.toLocaleString()} users</div>}
                        <div className="text-xs text-gray-400 mt-1">{timeAgo(it.lastSeen)}</div>
                      </div>
                    </div>
                  </a>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
