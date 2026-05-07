// sentry.client.config.ts
// Initialised in browser. Catches uncaught exceptions and unhandled promise
// rejections from any 'use client' code or any browser-driven action.
//
// Disabled in development so test errors don't pollute the production feed —
// only initialises when NEXT_PUBLIC_SENTRY_DSN is set (we set it on Production
// and Preview in Vercel only).

import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
if (dsn) {
  Sentry.init({
    dsn,
    // Keep the SDK lean — no session replay (eats free quota fast).
    integrations: [],
    // Sample 10% of transactions for performance tracing. Adjust later if quota
    // is tight or if we need finer-grained data.
    tracesSampleRate: 0.1,
    // Always send errors. tracesSampleRate is for performance only.
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || 'production',
  })
}
