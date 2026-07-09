import 'server-only'

// lib/sentry.ts
// Thin wrapper around Sentry's REST API for the /admin/sentry digest
// view + daily cron snapshot. Auth: organization-level token with
// event:read + project:read scopes (Sentry → Settings → Auth Tokens).
//
// Env required:
//   SENTRY_AUTH_TOKEN
//   SENTRY_ORG_SLUG       e.g. "datanautix"
//   SENTRY_PROJECT_SLUG   e.g. "javascript-nextjs"
//
// All read-only. If the token is missing we return a marker so the UI
// can show a setup banner instead of crashing.

export interface SentryIssue {
  id:        string
  shortId:   string
  title:     string
  culprit:   string | null
  level:     'error' | 'warning' | 'info' | 'debug' | 'fatal' | string
  status:    'unresolved' | 'resolved' | 'ignored' | string
  count:     number    // total events across history
  userCount: number    // distinct users affected
  firstSeen: string    // ISO
  lastSeen:  string    // ISO
  permalink: string    // sentry.io URL
  metadata?: { type?: string; value?: string }
}

export interface SentryDigest {
  ok:           boolean
  configured:   boolean
  reason?:      string             // when !ok
  fetchedAt:    string             // ISO
  total:        number
  issues:       SentryIssue[]
}

const BASE = 'https://sentry.io/api/0'

function readEnv() {
  return {
    token:   process.env.SENTRY_AUTH_TOKEN,
    org:     process.env.SENTRY_ORG_SLUG,
    project: process.env.SENTRY_PROJECT_SLUG,
  }
}

export function sentryConfigured(): boolean {
  const { token, org, project } = readEnv()
  return !!(token && org && project)
}

/**
 * Fetch unresolved issues for the configured project, most recent first.
 * Returns at most `limit` issues. Sentry's API caps each page at 100; we
 * page until limit is hit or there are no more.
 */
export async function fetchUnresolvedIssues(limit = 50): Promise<SentryDigest> {
  const { token, org, project } = readEnv()
  const now = new Date().toISOString()

  if (!token || !org || !project) {
    return {
      ok:         false,
      configured: false,
      reason:     'SENTRY_AUTH_TOKEN, SENTRY_ORG_SLUG, and SENTRY_PROJECT_SLUG must be set.',
      fetchedAt:  now,
      total:      0,
      issues:     [],
    }
  }

  const issues: SentryIssue[] = []
  let cursor: string | null = null
  let pages = 0
  while (issues.length < limit && pages < 5) {
    const url = new URL(`${BASE}/projects/${org}/${project}/issues/`)
    url.searchParams.set('query', 'is:unresolved')
    url.searchParams.set('limit', String(Math.min(100, limit - issues.length)))
    if (cursor) url.searchParams.set('cursor', cursor)
    let res: Response
    try {
      res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
        // Sentry rate-limits at ~40 req/sec; one page per request is fine.
        // No cache — always fetch live.
        cache: 'no-store',
      })
    } catch (e: unknown) {
      return {
        ok:         false,
        configured: true,
        reason:     `Network error: ${e instanceof Error ? e.message : String(e)}`,
        fetchedAt:  now,
        total:      issues.length,
        issues,
      }
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return {
        ok:         false,
        configured: true,
        reason:     `Sentry API ${res.status}: ${body.slice(0, 200)}`,
        fetchedAt:  now,
        total:      issues.length,
        issues,
      }
    }
    const data = await res.json().catch(() => null)
    if (!Array.isArray(data)) {
      return {
        ok:         false,
        configured: true,
        reason:     'Sentry returned a non-array response.',
        fetchedAt:  now,
        total:      issues.length,
        issues,
      }
    }
    for (const raw of data) {
      issues.push({
        id:        String(raw.id),
        shortId:   String(raw.shortId || raw.id),
        title:     String(raw.title || raw.metadata?.type || 'Untitled'),
        culprit:   raw.culprit ?? null,
        level:     String(raw.level || 'error'),
        status:    String(raw.status || 'unresolved'),
        count:     Number(raw.count || 0),
        userCount: Number(raw.userCount || 0),
        firstSeen: String(raw.firstSeen || now),
        lastSeen:  String(raw.lastSeen || now),
        permalink: String(raw.permalink || ''),
        metadata:  raw.metadata || undefined,
      })
    }
    // Sentry paginates via the Link header. Parse the next cursor.
    const link = res.headers.get('link') || ''
    const m = link.match(/<[^>]+>;\s*rel="next";\s*results="true";\s*cursor="([^"]+)"/)
    if (!m) break
    cursor = m[1]
    pages++
  }

  return {
    ok:         true,
    configured: true,
    fetchedAt:  now,
    total:      issues.length,
    issues,
  }
}

export type SentryIssueStatus = 'resolved' | 'ignored' | 'unresolved'

export interface SentryUpdateResult {
  ok:         boolean
  configured: boolean
  reason?:    string
}

/**
 * Change an issue's status (resolve / archive / reopen). Admin-gated at the
 * route layer; the write scope (event:write / project:write) lives on the
 * same org token as the read path. Uses Sentry's project-scoped bulk-mutate
 * endpoint with a single id, mirroring fetchUnresolvedIssues' project scope.
 * "ignored" is Sentry's API value for what the newer UI labels "archived".
 */
export async function updateIssueStatus(id: string, status: SentryIssueStatus): Promise<SentryUpdateResult> {
  const { token, org, project } = readEnv()

  if (!token || !org || !project) {
    return { ok: false, configured: false, reason: 'SENTRY_AUTH_TOKEN, SENTRY_ORG_SLUG, and SENTRY_PROJECT_SLUG must be set.' }
  }

  const url = new URL(`${BASE}/projects/${org}/${project}/issues/`)
  url.searchParams.set('id', id)

  let res: Response
  try {
    res = await fetch(url.toString(), {
      method:  'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ status }),
      cache:   'no-store',
    })
  } catch (e: unknown) {
    return { ok: false, configured: true, reason: `Network error: ${e instanceof Error ? e.message : String(e)}` }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { ok: false, configured: true, reason: `Sentry API ${res.status}: ${body.slice(0, 200)}` }
  }

  return { ok: true, configured: true }
}
