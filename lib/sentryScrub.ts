// lib/sentryScrub.ts
// Sentry beforeSend hook: strips PII from events + filters known
// false-positive noise before payloads leave the process.
//
// Covers SECURITY.md §5 ("never put PII in logs / Sentry") and Open
// TBD #1. Applied at all three runtimes (client / server / edge) via
// sentry.{client,server,edge}.config.ts.
//
// Scrub targets:
//   - request.data / request.body  (free-text survey / agent responses)
//   - request.cookies              (session)
//   - request.headers.{authorization,cookie}
//   - request.query_string values that look like emails or phones
//   - email/phone/password fields anywhere in extra, contexts, tags, user
//   - breadcrumbs: same redaction inside data/message
//
// Noise filter:
//   - drops the "Object Not Found Matching Id:X, MethodName:update,
//     ParamCount:4" Microsoft Office content-script false positive
//     (see project notes / SECURITY.md Sentry signal section).
//
// We type the event as `unknown` and narrow internally to avoid pinning
// to a specific @sentry/types version.

const REDACTED = '[redacted]'

// Conservative patterns. Goal: drop high-confidence PII without trying
// to be an IDS — over-scrub is fine, under-scrub is the bug shape we
// care about.
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g

// Key names that we redact whole. Case-insensitive substring match.
const SENSITIVE_KEY_PARTS = [
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'api_key',
  'authorization',
  'cookie',
  'session',
  'email',
  'phone',
  'mobile',
  'ssn',
  'credit',
  'card',
]

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase()
  return SENSITIVE_KEY_PARTS.some(p => k.includes(p))
}

function scrubString(s: string): string {
  if (!s) return s
  return s.replace(EMAIL_RE, REDACTED).replace(PHONE_RE, REDACTED)
}

function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return REDACTED
  if (value == null) return value
  if (typeof value === 'string') return scrubString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(v => scrubValue(v, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(k)) {
        out[k] = REDACTED
      } else {
        out[k] = scrubValue(v, depth + 1)
      }
    }
    return out
  }
  return value
}

function scrubRequest(request: Record<string, unknown> | undefined) {
  if (!request) return
  // request.data / request.body — free-text survey/response payloads,
  // always treat as PII. SECURITY.md §5 row "Survey / agent responses".
  if ('data' in request) request.data = REDACTED
  if ('body' in request) request.body = REDACTED
  if ('cookies' in request) request.cookies = REDACTED
  const headers = request.headers as Record<string, unknown> | undefined
  if (headers && typeof headers === 'object') {
    for (const k of Object.keys(headers)) {
      if (isSensitiveKey(k)) headers[k] = REDACTED
    }
  }
  if (typeof request.query_string === 'string') {
    request.query_string = scrubString(request.query_string)
  }
}

function shouldDrop(event: Record<string, unknown>): boolean {
  // Microsoft Office content-script false positive. The exception value
  // is a fixed template — match on the prefix to be resilient to id /
  // param-count variance.
  const exception = event.exception as { values?: Array<{ value?: string }> } | undefined
  const values = exception?.values
  if (Array.isArray(values)) {
    for (const v of values) {
      const msg = String(v?.value || '')
      if (msg.startsWith('Object Not Found Matching Id:')) return true
    }
  }
  const message = event.message
  if (typeof message === 'string' && message.startsWith('Object Not Found Matching Id:')) {
    return true
  }
  return false
}

// Loosely typed: the Sentry SDK passes us either an `ErrorEvent` or a
// `TransactionEvent`, and the shape varies by runtime. We treat the
// event as a free-form object — Sentry's `beforeSend` contract permits
// returning either the (possibly-mutated) event or `null` to drop it.
export function scrubSentryEvent(event: any): any {
  if (event == null || typeof event !== 'object') return event
  if (shouldDrop(event)) return null

  scrubRequest(event.request)

  if (event.extra) event.extra = scrubValue(event.extra)
  if (event.contexts) event.contexts = scrubValue(event.contexts)
  if (event.tags) event.tags = scrubValue(event.tags)

  // user: keep id only. Drop email, ip_address, username, anything else
  // that could carry PII.
  const user = event.user
  if (user && typeof user === 'object') {
    const id = user.id
    event.user = id != null ? { id } : {}
  }

  const breadcrumbs = event.breadcrumbs
  if (Array.isArray(breadcrumbs)) {
    event.breadcrumbs = breadcrumbs.map((b: any) => {
      if (b == null || typeof b !== 'object') return b
      const copy: Record<string, unknown> = { ...b }
      if (typeof copy.message === 'string') copy.message = scrubString(copy.message)
      if (copy.data) copy.data = scrubValue(copy.data)
      return copy
    })
  }

  return event
}
