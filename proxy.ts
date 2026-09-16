// proxy.ts
// CSRF protection for cookie-authed mutating API routes + per-request
// correlation IDs for structured logging.
//
// CSRF: Next.js App Router route handlers don't have built-in CSRF
// protection. A malicious origin can `fetch(..., {credentials: 'include'})`
// from another tab/site and the browser will send the user's session
// cookie; without an Origin/Referer check the route happily acts on
// behalf of the victim. We compare the request's Origin host against
// the request host on every mutating verb (POST/PATCH/PUT/DELETE) and
// reject mismatches.
//
// Request ID: every request gets an `x-request-id` (preserved if the
// caller supplied one, generated otherwise). It's stamped on both the
// inbound request headers (so route handlers can read it via
// `lib/requestContext.ts`) and the outbound response headers (so clients
// + logs can correlate). See `lib/requestContext.ts`.
//
// Routes we explicitly skip CSRF for: webhooks (no Origin from third
// parties, they auth via signed payloads), cron (Bearer token), and the
// public embeddable chat endpoints (they use wildcard CORS, not cookies,
// so there's nothing to CSRF). Request-ID stamping applies to every
// request (no skip list).

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { evaluateAdminSession, ADMIN_SESSION_COOKIE, ADMIN_SESSION_COOKIE_OPTIONS } from '@/lib/auth/adminSession'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

const REQUEST_ID_HEADER = 'x-request-id'

// Stamps `x-request-id` on the inbound request (so handlers can read it)
// and returns a NextResponse that echoes it on the way out.
function passWithRequestId(req: NextRequest, requestId: string, adminStamp?: string): NextResponse {
  const fwdHeaders = new Headers(req.headers)
  fwdHeaders.set(REQUEST_ID_HEADER, requestId)
  const res = NextResponse.next({ request: { headers: fwdHeaders } })
  res.headers.set(REQUEST_ID_HEADER, requestId)
  if (adminStamp) res.cookies.set(ADMIN_SESSION_COOKIE, adminStamp, ADMIN_SESSION_COOKIE_OPTIONS)
  return res
}

// Exact paths that legitimately receive cross-origin requests. These
// authenticate via mechanisms other than session cookies (HMAC-signed
// webhook bodies, OAuth state, bearer tokens) so CSRF doesn't apply.
const EXACT_BYPASS = new Set<string>([
  '/api/campaigns/webhooks/resend',
  '/api/social/webhook',
  '/api/social/callback',
  '/api/bot-chat',
  '/api/clara-chat',
  '/api/nora-chat',
])

// Path prefixes for the same kind of bypass.
const PREFIX_BYPASS: string[] = [
  '/api/cron/',
  // MCO canvas-demo data endpoints — public, wildcard CORS, no cookies.
  // Used by /demo/mco's ParkingCard + RestaurantsCard.
  '/api/mco/',
]

// Path patterns (regex) for routes that match a dynamic segment.
const PATTERN_BYPASS: RegExp[] = [
  /^\/api\/bots\/[^/]+\/chat$/,        // public embeddable bot chat with wildcard CORS
  /^\/api\/bots\/[^/]+\/ui-hints$/,    // sibling extractor — same wildcard-CORS posture as chat
  /^\/api\/bots\/[^/]+\/impression$/,  // widget-open beacon — public, wildcard CORS, no cookies
]

function isBypassed(pathname: string): boolean {
  if (EXACT_BYPASS.has(pathname)) return true
  for (const p of PREFIX_BYPASS) if (pathname.startsWith(p)) return true
  for (const p of PATTERN_BYPASS) if (p.test(pathname)) return true
  return false
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Preserve a client-supplied request ID (lets external callers correlate
  // traces) or generate one. UUIDs are cheap and globally unique.
  const requestId = req.headers.get(REQUEST_ID_HEADER) || crypto.randomUUID()

  // Platform-admin session policy (SECURITY.md §3, ratified 2026-09-15):
  // a request carrying the signed admin stamp is re-stamped (this IS the
  // activity), or turned away once the idle / max window has passed — a 401
  // for API calls, a redirect to /login for pages. Requests without the
  // stamp are left to requireAdmin and app/admin/layout.tsx, which reconcile
  // against Supabase's last_sign_in_at (so stripping the cookie forces a
  // re-login rather than extending anything).
  let adminStamp: string | undefined
  const stamp = req.cookies.get(ADMIN_SESSION_COOKIE)?.value
  if (stamp) {
    const state = evaluateAdminSession({ cookie: stamp })
    if (!state.ok) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Admin session expired — sign in again', reason: state.reason }, { status: 401, headers: { [REQUEST_ID_HEADER]: requestId } })
      }
      const url = req.nextUrl.clone(); url.pathname = '/login'; url.search = '?reason=' + state.reason
      const res = NextResponse.redirect(url); res.cookies.delete(ADMIN_SESSION_COOKIE); return res
    }
    adminStamp = state.cookie
  }

  // Only API routes get the CSRF treatment — pages pass through (stamped if admin).
  if (!pathname.startsWith('/api/')) return passWithRequestId(req, requestId, adminStamp)
  if (SAFE_METHODS.has(req.method)) return passWithRequestId(req, requestId, adminStamp)
  if (isBypassed(pathname)) return passWithRequestId(req, requestId, adminStamp)

  // Same-origin enforcement. Modern browsers always send Origin on
  // cross-origin requests; the rare case where Origin is missing is
  // legitimate same-origin fetches that happen to omit it (some older
  // browsers, some non-browser clients we control). We use Sec-Fetch-Site
  // as a secondary signal: when it's `same-origin`, the browser is
  // explicitly telling us the request is in-bounds even without Origin.
  const origin = req.headers.get('origin')
  const sfs = req.headers.get('sec-fetch-site')
  const host = req.headers.get('host')

  if (origin) {
    let originHost: string
    try { originHost = new URL(origin).host } catch {
      return NextResponse.json({ error: 'CSRF: invalid Origin' }, { status: 403, headers: { [REQUEST_ID_HEADER]: requestId } })
    }
    if (originHost !== host) {
      return NextResponse.json({ error: 'CSRF: cross-origin request blocked' }, { status: 403, headers: { [REQUEST_ID_HEADER]: requestId } })
    }
    return passWithRequestId(req, requestId, adminStamp)
  }

  // No Origin header. Trust Sec-Fetch-Site if present; otherwise fall back
  // to Referer (older browsers, some embedded webviews). If neither signal
  // identifies the request as same-origin, reject — better to break a
  // non-browser caller than to leave the door open.
  if (sfs === 'same-origin' || sfs === 'none') return passWithRequestId(req, requestId, adminStamp)
  if (sfs === 'same-site') return passWithRequestId(req, requestId, adminStamp)  // subdomains share a site

  const referer = req.headers.get('referer')
  if (referer) {
    try {
      const refHost = new URL(referer).host
      if (refHost === host) return passWithRequestId(req, requestId, adminStamp)
    } catch {}
  }

  return NextResponse.json({ error: 'CSRF: cross-origin request blocked' }, { status: 403, headers: { [REQUEST_ID_HEADER]: requestId } })
}

export const config = {
  // /api/* for CSRF + request ids, and every page so the admin session stamp
  // is refreshed by navigation and an expired admin is redirected to /login
  // from any page (SECURITY.md §3). Static assets, the image optimizer and
  // files with an extension are skipped.
  matcher: ['/api/:path*', '/((?!_next/|favicon\\.ico|.*\\..*).*)'],
}
