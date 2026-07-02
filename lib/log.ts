import 'server-only'

// lib/log.ts
// One place to emit a structured server log line AND — for errors — a Sentry
// event tagged with the per-request correlation id and the tenant org, so a
// customer's `x-request-id` (echoed on their failing response by proxy.ts)
// joins to both the server logs and the Sentry event. Before this, caught
// errors were `console.error`'d with no request id and Sentry carried no
// org/user/request dimension, so per-tenant debugging meant reproducing from
// scratch.
//
// Best-effort: never throws, and safe to call un-awaited (`void logError(...)`)
// at fire-and-forget sites — the request-id lookup still resolves and the event
// still lands.

import * as Sentry from '@sentry/nextjs'
import { getRequestId } from '@/lib/requestContext'

export interface LogFields {
  where?: string
  orgId?: string
  [key: string]: unknown
}

function extras(f: LogFields): Record<string, unknown> {
  const { where: _w, orgId: _o, ...rest } = f
  return rest
}

/**
 * Log an error + capture it to Sentry with `where` / `request_id` / `org_id`
 * tags. Use at catch-sites and — critically — at the `if (error)` branches that
 * currently swallow a Supabase error and return a plausible-but-wrong 200.
 */
export async function logError(where: string, err: unknown, fields: LogFields = {}): Promise<void> {
  const requestId = await getRequestId().catch(() => null)
  const message = err instanceof Error ? err.message : String(err)
  try {
    console.error({ at: where, request_id: requestId, org_id: fields.orgId ?? null, err: message, ...extras(fields) })
  } catch { /* logging must never break the caller */ }
  try {
    Sentry.captureException(err instanceof Error ? err : new Error(message), {
      tags: {
        where,
        ...(requestId ? { request_id: requestId } : {}),
        ...(fields.orgId ? { org_id: fields.orgId } : {}),
      },
      extra: extras(fields),
    })
  } catch { /* never break the caller */ }
}

/** Structured warning with the request correlation id. No Sentry capture. */
export async function logWarn(where: string, msg: string, fields: LogFields = {}): Promise<void> {
  const requestId = await getRequestId().catch(() => null)
  try {
    console.warn({ at: where, request_id: requestId, org_id: fields.orgId ?? null, msg, ...extras(fields) })
  } catch { /* never throw */ }
}
