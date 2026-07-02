import 'server-only'

// lib/apiError.ts
// Standard 500 response for API route handlers.
//
// Two problems this fixes, both flagged in the 2026-07-02 audit:
//  1. Observability — most handlers catch their errors and return JSON, so the
//     error never reaches Sentry's auto-instrumentation (which only sees
//     UNhandled throws). This captures explicitly at the catch-site.
//  2. Info leak — returning `{ error: err.message }` ships raw Postgres/driver
//     error strings (schema names, constraint details) to the client. This
//     returns a generic message; the real detail goes to Sentry + server logs.
//
// Use at every catch-site and Supabase-error branch instead of
// `NextResponse.json({ error: err.message }, { status: 500 })`.
//
// Now async: it routes through lib/log so the Sentry event carries the
// request-id + org tags. Call sites `return serverError(...)` inside async
// route handlers, so returning the promise is transparent — no call-site
// change needed. Pass `{ orgId }` in `fields` to tag the tenant.

import { NextResponse } from 'next/server'
import { logError, type LogFields } from '@/lib/log'

export async function serverError(
  err: unknown,
  where?: string,
  fields?: LogFields,
): Promise<NextResponse> {
  await logError(where || 'api', err, fields || {})
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}
