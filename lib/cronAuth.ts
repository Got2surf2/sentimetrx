// lib/cronAuth.ts
// Fail-closed cron authentication for /api/cron/* routes.
//
// Why: every cron route used to read `process.env.CRON_SECRET` and only
// reject mismatches when the env var was set. If CRON_SECRET was unset
// or empty, the auth check became `if (false && ...)` — i.e. anyone on
// the internet could hit the cron endpoint and trigger real work
// (campaign sends, token refreshes, etc.). This helper inverts that:
// no secret configured -> 503; mismatch -> 401; only the exact
// timing-safe match continues.

import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'

/**
 * Returns null if the request is authorized to invoke a cron route.
 * Returns a 401/503 NextResponse otherwise — caller should `return` it.
 */
export function checkCronAuth(authHeader: string | null): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || cronSecret.length < 16) {
    console.error('[cron-auth] CRON_SECRET missing or too short — refusing cron request')
    return NextResponse.json({ error: 'Cron secret not configured' }, { status: 503 })
  }

  const expected = `Bearer ${cronSecret}`
  if (!authHeader || authHeader.length !== expected.length) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Constant-time compare: a plain `!==` lets an attacker measure how
  // many bytes of CRON_SECRET match per request and recover the secret
  // byte-by-byte.
  const a = Buffer.from(authHeader)
  const b = Buffer.from(expected)
  if (!timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return null
}
