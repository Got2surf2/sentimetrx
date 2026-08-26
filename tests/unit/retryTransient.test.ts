// Retry must fire on TRANSPORT failures and never on application errors.
// Getting that boundary wrong in either direction is bad: retrying a constraint
// violation is pointless load, and NOT retrying a dropped socket is the bug this
// exists to fix (production 2026-08-26 — one dead keep-alive socket failed a
// single batch out of ~590 and aborted a whole upload).
import { describe, it, expect } from 'vitest'
import { isTransientTransportError, retryTransient, retryTransientResult } from '@/lib/retryTransient'

// The exact shape undici produces: a bare TypeError whose cause carries the code.
const socketClosed = () => {
  const e = new TypeError('fetch failed')
  ;(e as { cause?: unknown }).cause = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' })
  return e
}

describe('isTransientTransportError', () => {
  it('sees through the cause chain to the undici code', () => {
    expect(isTransientTransportError(socketClosed())).toBe(true)
  })

  it('recognises supabase-js AuthRetryableFetchError by name', () => {
    expect(isTransientTransportError(Object.assign(new Error('x'), { name: 'AuthRetryableFetchError' }))).toBe(true)
  })

  it('recognises bare transport codes and messages', () => {
    expect(isTransientTransportError(Object.assign(new Error('read'), { code: 'ECONNRESET' }))).toBe(true)
    expect(isTransientTransportError(new Error('socket hang up'))).toBe(true)
  })

  it('does NOT treat application errors as transient', () => {
    // A Postgres error is a real answer — repeating it just doubles the load.
    expect(isTransientTransportError({ code: '23505', message: 'duplicate key value violates unique constraint' })).toBe(false)
    expect(isTransientTransportError({ code: '57014', message: 'canceling statement due to statement timeout' })).toBe(false)
    expect(isTransientTransportError(new Error('Unauthorized'))).toBe(false)
    expect(isTransientTransportError(null)).toBe(false)
  })

  it('terminates on a cyclic cause chain', () => {
    const a = new Error('a') as Error & { cause?: unknown }
    a.cause = a
    expect(isTransientTransportError(a)).toBe(false)
  })
})

describe('retryTransient', () => {
  it('recovers when a stale socket fails the first attempt', async () => {
    let calls = 0
    const out = await retryTransient(async () => {
      calls++
      if (calls === 1) throw socketClosed()
      return 'ok'
    }, { baseMs: 1 })
    expect(out).toBe('ok')
    expect(calls).toBe(2)
  })

  it('re-throws an application error immediately, without retrying', async () => {
    let calls = 0
    await expect(retryTransient(async () => { calls++; throw new Error('duplicate key') }, { baseMs: 1 }))
      .rejects.toThrow('duplicate key')
    expect(calls).toBe(1)
  })

  it('gives up after the attempt budget and throws the transport error', async () => {
    let calls = 0
    await expect(retryTransient(async () => { calls++; throw socketClosed() }, { attempts: 3, baseMs: 1 }))
      .rejects.toThrow('fetch failed')
    expect(calls).toBe(3)
  })
})

describe('retryTransientResult', () => {
  it('retries a transient error returned in { data, error } rather than thrown', async () => {
    // supabase-js hands transport failures back as a value, so they never reach
    // a catch — that is exactly how the false 401 got through.
    let calls = 0
    const res = await retryTransientResult(async () => {
      calls++
      return calls === 1
        ? { data: null, error: Object.assign(new Error('fetch failed'), { name: 'AuthRetryableFetchError' }) }
        : { data: { user: { id: 'u1' } }, error: null }
    }, { baseMs: 1 })
    expect(calls).toBe(2)
    expect(res.error).toBeNull()
    expect(res.data).toEqual({ user: { id: 'u1' } })
  })

  it('returns an application error on the first pass without retrying', async () => {
    let calls = 0
    const res = await retryTransientResult(async () => {
      calls++
      return { data: null, error: { code: '23505', message: 'duplicate key' } }
    }, { baseMs: 1 })
    expect(calls).toBe(1)
    expect(res.error).toMatchObject({ code: '23505' })
  })

  it('returns the last result when retries are exhausted, so callers keep their error branch', async () => {
    const res = await retryTransientResult(async () => ({ data: null, error: socketClosed() }), { attempts: 2, baseMs: 1 })
    expect(res.error).toBeTruthy()
  })
})

// The bug this file exists to prevent a second time.
//
// The row-insert shipped wrapped in `retryTransient` — the THROW-based helper —
// against a supabase-js call. supabase-js does not throw on a transport failure;
// it RETURNS `{ error: { message: 'TypeError: fetch failed', code: '' } }`.
// So the retry never fired, and the "fix" for a production incident was a no-op
// that typechecked, passed review and deployed.
describe('supabase-js result shape (the wrapper must match the client)', () => {
  // Verified against the real client on 2026-08-26 by pointing it at an
  // unroutable host: THREW? false. This is the exact object it hands back.
  const supabaseTransportError = {
    message: 'TypeError: fetch failed',
    details: 'TypeError: fetch failed\n\nCaused by: Error: bad port',
    hint: '',
    code: '',
  }

  it('classifies the RETURNED postgrest error as transient (code is empty — match on message)', () => {
    expect(isTransientTransportError(supabaseTransportError)).toBe(true)
  })

  it('retryTransientResult RETRIES it — the value-based path', async () => {
    let calls = 0
    const res = await retryTransientResult(async () => {
      calls++
      return calls === 1 ? { data: null, error: supabaseTransportError } : { data: [{ id: 1 }], error: null }
    }, { baseMs: 1 })
    expect(calls).toBe(2)
    expect(res.error).toBeNull()
  })

  it('retryTransient does NOT retry it — proving the two are not interchangeable', async () => {
    // Nothing throws, so the throw-based helper returns the first result
    // untouched. This assertion is the regression guard: if someone swaps the
    // wrapper back, the insert silently stops retrying again.
    let calls = 0
    const out = await retryTransient(async () => {
      calls++
      return { data: null, error: supabaseTransportError }
    }, { baseMs: 1 })
    expect(calls).toBe(1)
    expect(out.error).toBe(supabaseTransportError)
  })
})
