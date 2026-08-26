// lib/retryTransient.ts
//
// Retry for TRANSPORT failures — the connection died, so the request never got
// a verdict. Nothing here retries an application error: a 4xx, a constraint
// violation or a Postgres error is a real answer and repeating it is pointless.
//
// Why this exists (2026-08-26). Two production failures inside eight minutes,
// both `TypeError: fetch failed` / `SocketError: other side closed
// (UND_ERR_SOCKET)` against Supabase, in the middle of a batched row upload
// that otherwise logged 587 successful inserts:
//
//   15:06 POST /api/datasets/…/rows  500  at datasets.rows.insert
//   15:13 POST /api/datasets/…/rows  401  inside supabase.auth.getUser()
//
// That is undici reusing a pooled keep-alive socket the far side had already
// closed. It is intermittent by construction and correlates with bursty
// traffic, so a single immediate retry recovers almost all of it — the pool
// simply opens a fresh connection.
//
// The 401 is the more damaging shape: a dropped socket during the auth call is
// indistinguishable from "not signed in" unless the error is inspected, so a
// network blip logs the user out mid-upload. See getCallerOrgContext.

/** Error codes that mean "the connection failed", not "the server said no". */
const TRANSPORT_CODES = new Set([
  'UND_ERR_SOCKET',           // undici: other side closed
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',                // transient DNS
])

const TRANSPORT_TEXT = /fetch failed|other side closed|socket hang up|network error|terminated|ECONNRESET|ETIMEDOUT/i

/**
 * True when the failure is at the transport layer. Walks the `cause` chain,
 * because undici reports these as a bare `TypeError: fetch failed` whose cause
 * carries the real code — matching on the top-level message alone misses them.
 */
export function isTransientTransportError(err: unknown): boolean {
  let cur: unknown = err
  for (let depth = 0; cur && depth < 5; depth++) {
    if (typeof cur === 'object') {
      const e = cur as { code?: unknown; name?: unknown; message?: unknown; cause?: unknown }
      if (typeof e.code === 'string' && TRANSPORT_CODES.has(e.code)) return true
      // supabase-js wraps its own retryable fetch failures under this name.
      if (e.name === 'AuthRetryableFetchError') return true
      if (typeof e.message === 'string' && TRANSPORT_TEXT.test(e.message)) return true
      cur = e.cause
      continue
    }
    break
  }
  return false
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Run `fn`, retrying ONLY transport failures. Re-throws anything else
 * immediately — an application error is a real answer.
 *
 * Deliberately short: these run inside user-facing requests, so the worst case
 * adds roughly 150ms + 300ms rather than seconds. The failure being defended
 * against is a stale pooled socket, which the very next attempt gets past.
 */
export async function retryTransient<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseMs?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3
  const baseMs = opts.baseMs ?? 150
  let last: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      if (!isTransientTransportError(err) || i === attempts - 1) throw err
      last = err
      // Exponential with jitter, so a burst of parallel batches hitting the
      // same dead pool doesn't retry in lockstep and recreate the spike.
      await sleep(baseMs * 2 ** i + Math.floor(Math.random() * baseMs))
    }
  }
  throw last
}

/**
 * Some clients (supabase-js, postgrest) return `{ data, error }` instead of
 * throwing, so a transport failure never reaches a `catch`. This retries on
 * that shape too. Generic over the whole result object so the caller's
 * discriminated union survives — narrowing `data` here would erase it.
 *
 * If the last attempt still carries a transient error, the result is returned
 * as-is rather than thrown: the caller already has an `error` branch, and this
 * keeps the function a drop-in wrapper.
 */
export async function retryTransientResult<R extends { error: unknown }>(
  fn: () => Promise<R>,
  opts: { attempts?: number; baseMs?: number } = {},
): Promise<R> {
  const attempts = opts.attempts ?? 3
  const baseMs = opts.baseMs ?? 150
  const wait = (i: number) => sleep(baseMs * 2 ** i + Math.floor(Math.random() * baseMs))
  let lastRes: R | undefined
  for (let i = 0; i < attempts; i++) {
    let res: R
    try {
      res = await fn()
    } catch (err) {
      if (!isTransientTransportError(err) || i === attempts - 1) throw err
      await wait(i)
      continue
    }
    if (res.error && isTransientTransportError(res.error) && i < attempts - 1) {
      lastRes = res
      await wait(i)
      continue
    }
    return res
  }
  return lastRes as R
}

/** Thrown when the auth backend could not be reached — NOT "unauthenticated". */
export class AuthUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('Authentication service unreachable')
    this.name = 'AuthUnavailableError'
    this.cause = cause
  }
}
