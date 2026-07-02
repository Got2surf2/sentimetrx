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

import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'

export function serverError(
  err: unknown,
  where?: string,
  extra?: Record<string, unknown>,
): NextResponse {
  try {
    Sentry.captureException(err, {
      tags: where ? { where } : undefined,
      extra,
    })
  } catch { /* never let telemetry break the response */ }
  console.error({ at: where || 'api', err: err instanceof Error ? err.message : String(err) })
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}
