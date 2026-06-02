// lib/requestContext.ts
// Per-request correlation ID for structured logging.
//
// proxy.ts stamps every inbound request with `x-request-id` (generating
// one if the client didn't supply it) and echoes it on the response. Route
// handlers and any server-side code further down the call stack call
// `getRequestId()` to grab it for log payloads.
//
// Why headers() instead of AsyncLocalStorage: Next.js 14 middleware runs in
// the Edge runtime, which doesn't expose AsyncLocalStorage. The `headers()`
// helper from `next/headers` is already request-scoped (Next.js wraps every
// request in its own async context), so it gives equivalent ergonomics
// without a runtime split.

import { headers } from 'next/headers'

export const REQUEST_ID_HEADER = 'x-request-id'

// Returns the current request's correlation ID, or `null` outside a request
// scope (e.g. cron initialization, module-load side effects).
// Async because `headers()` is async as of Next.js 15.
export async function getRequestId(): Promise<string | null> {
  try {
    return (await headers()).get(REQUEST_ID_HEADER)
  } catch {
    // headers() throws outside a request scope.
    return null
  }
}
