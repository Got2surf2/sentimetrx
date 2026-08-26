// lib/postJsonWithRetry.ts
//
// Client-side POST that survives a transient upstream blip. Deliberately NOT
// `server-only` — both upload flows are browser components.
//
// Why (2026-08-26): a row upload is hundreds of sequential POSTs, so it is the
// likeliest thing in the app to hit a stale keep-alive socket to Supabase. When
// it did, `!res.ok` on ONE batch out of ~590 was fatal at both call sites —
// `analyze/new/UploadClient` rolled back every uploaded batch AND DELETED THE
// WHOLE DATASET, and `settings/SettingsClient` aborted the append. A single
// dropped connection therefore destroyed an in-progress load.
//
// The server retries the insert too (lib/retryTransient), which should stop
// almost all of this at source. This is the second layer: if the server gives
// up and answers 503, the client tries again rather than throwing the upload
// away. Only retries responses that mean "try again" — a 4xx is a real answer
// and is returned to the caller untouched.

/** Statuses that mean "the request never got a verdict — try again". */
const RETRYABLE_STATUS = new Set([429, 502, 503, 504])

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Honour Retry-After when the server sends one; otherwise exponential + jitter. */
function delayFor(res: Response | null, attempt: number, baseMs: number): number {
  const hdr = res?.headers.get('retry-after')
  if (hdr) {
    const secs = Number(hdr)
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 10_000)
  }
  return baseMs * 2 ** attempt + Math.floor(Math.random() * baseMs)
}

/**
 * POST `body` as JSON, retrying transient failures. Resolves with the final
 * Response — including a non-ok one once retries are spent, so callers keep
 * their existing error handling. Rejects only if the network kept failing.
 */
export async function postJsonWithRetry(
  url: string,
  body: unknown,
  opts: { attempts?: number; baseMs?: number; signal?: AbortSignal } = {},
): Promise<Response> {
  const attempts = opts.attempts ?? 3
  const baseMs = opts.baseMs ?? 400
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: opts.signal,
      })
      if (!RETRYABLE_STATUS.has(res.status) || i === attempts - 1) return res
      await sleep(delayFor(res, i, baseMs))
    } catch (err) {
      // An aborted request is the caller's intent, never a retry.
      if ((err as { name?: string })?.name === 'AbortError') throw err
      if (i === attempts - 1) throw err
      lastErr = err
      await sleep(delayFor(null, i, baseMs))
    }
  }
  throw lastErr
}
