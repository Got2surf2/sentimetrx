// sentry.edge.config.ts
// Initialised in the Edge runtime (middleware, edge functions).

import * as Sentry from '@sentry/nextjs'
import { scrubSentryEvent } from './lib/sentryScrub'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    environment: process.env.VERCEL_ENV || 'production',
    beforeSend: scrubSentryEvent,
  })
}
