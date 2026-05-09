// middleware.ts
// CSRF protection for cookie-authed mutating API routes.
//
// Why: Next.js App Router route handlers don't have built-in CSRF
// protection. A malicious origin can `fetch(..., {credentials: 'include'})`
// from another tab/site and the browser will send the user's session
// cookie; without an Origin/Referer check the route happily acts on
// behalf of the victim. We compare the request's Origin host against
// the request host on every mutating verb (POST/PATCH/PUT/DELETE) and
// reject mismatches.
//
// Routes we explicitly skip: webhooks (no Origin from third parties,
// they auth via signed payloads), cron (Bearer token), and the public
// embeddable chat endpoints (they use wildcard CORS, not cookies, so
// there's nothing to CSRF).

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

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
]

// Path patterns (regex) for routes that match a dynamic segment.
const PATTERN_BYPASS: RegExp[] = [
  /^\/api\/bots\/[^/]+\/chat$/,  // public embeddable bot chat with wildcard CORS
]

function isBypassed(pathname: string): boolean {
  if (EXACT_BYPASS.has(pathname)) return true
  for (const p of PREFIX_BYPASS) if (pathname.startsWith(p)) return true
  for (const p of PATTERN_BYPASS) if (p.test(pathname)) return true
  return false
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Only API routes — let pages, _next/*, static assets pass through untouched.
  if (!pathname.startsWith('/api/')) return NextResponse.next()
  if (SAFE_METHODS.has(req.method)) return NextResponse.next()
  if (isBypassed(pathname)) return NextResponse.next()

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
      return NextResponse.json({ error: 'CSRF: invalid Origin' }, { status: 403 })
    }
    if (originHost !== host) {
      return NextResponse.json({ error: 'CSRF: cross-origin request blocked' }, { status: 403 })
    }
    return NextResponse.next()
  }

  // No Origin header. Trust Sec-Fetch-Site if present; otherwise fall back
  // to Referer (older browsers, some embedded webviews). If neither signal
  // identifies the request as same-origin, reject — better to break a
  // non-browser caller than to leave the door open.
  if (sfs === 'same-origin' || sfs === 'none') return NextResponse.next()
  if (sfs === 'same-site') return NextResponse.next()  // subdomains share a site

  const referer = req.headers.get('referer')
  if (referer) {
    try {
      const refHost = new URL(referer).host
      if (refHost === host) return NextResponse.next()
    } catch {}
  }

  return NextResponse.json({ error: 'CSRF: cross-origin request blocked' }, { status: 403 })
}

export const config = {
  // Run only on /api/* — skip pages, static, image optimizer.
  matcher: ['/api/:path*'],
}
