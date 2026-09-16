// lib/auth/adminSession.ts — the ratified platform-admin policy (30 min idle,
// 24 h max) as pure evaluation over a signed stamp + last_sign_in_at.
import { describe, it, expect } from 'vitest'
import { evaluateAdminSession, encodeStamp, decodeStamp, ADMIN_IDLE_MS, ADMIN_MAX_MS } from '@/lib/auth/adminSession'

const KEY = 'test-key'
const T0 = Date.parse('2026-09-15T12:00:00Z')
const iso = (t: number) => new Date(t).toISOString()
const min = (n: number) => n * 60_000

describe('stamp signing', () => {
  it('round-trips and rejects tampering, wrong key, and malformed values', () => {
    const c = encodeStamp(T0, T0 + min(5), KEY)
    expect(decodeStamp(c, KEY)).toEqual({ start: T0, seen: T0 + min(5) })
    expect(decodeStamp(c.replace(/\d(?=\.[^.]*$)/, '9'), KEY)).toBeNull()      // payload edited
    expect(decodeStamp(c.slice(0, -2) + 'zz', KEY)).toBeNull()                  // signature edited
    expect(decodeStamp(c, 'other-key')).toBeNull()
    expect(decodeStamp('1.2', KEY)).toBeNull(); expect(decodeStamp('', KEY)).toBeNull(); expect(decodeStamp(c, '')).toBeNull()
  })
})

describe('evaluateAdminSession', () => {
  it('fresh sign-in, no cookie → ok and a stamp starting at the sign-in, seen = now', () => {
    const r = evaluateAdminSession({ lastSignInAt: iso(T0), now: T0 + min(1), key: KEY })
    expect(r.ok).toBe(true)
    expect(decodeStamp((r as { cookie: string }).cookie, KEY)).toEqual({ start: T0, seen: T0 + min(1) })
  })
  it('no cookie and a sign-in older than the idle window → idle (deleting the cookie cannot extend a session)', () => {
    expect(evaluateAdminSession({ lastSignInAt: iso(T0), now: T0 + ADMIN_IDLE_MS + 1, key: KEY })).toEqual({ ok: false, reason: 'idle' })
  })
  it('nothing to go on (no cookie, no sign-in time) → idle, never a pass', () => {
    expect(evaluateAdminSession({ now: T0, key: KEY })).toEqual({ ok: false, reason: 'idle' })
  })
  it('a valid stamp seen 29 min ago passes and is refreshed; 31 min ago is idle', () => {
    const c = encodeStamp(T0, T0 + min(60), KEY)
    const ok = evaluateAdminSession({ cookie: c, lastSignInAt: iso(T0), now: T0 + min(89), key: KEY })
    expect(ok.ok).toBe(true)
    expect(decodeStamp((ok as { cookie: string }).cookie, KEY)).toEqual({ start: T0, seen: T0 + min(89) })
    expect(evaluateAdminSession({ cookie: c, lastSignInAt: iso(T0), now: T0 + min(91), key: KEY })).toEqual({ ok: false, reason: 'idle' })
  })
  it('touch:false checks without counting the request as activity', () => {
    const c = encodeStamp(T0, T0 + min(10), KEY)
    const r = evaluateAdminSession({ cookie: c, now: T0 + min(20), touch: false, key: KEY })
    expect(decodeStamp((r as { cookie: string }).cookie, KEY)).toEqual({ start: T0, seen: T0 + min(10) })
  })
  it('active all day still ends at 24 h from the session start → max', () => {
    const c = encodeStamp(T0, T0 + ADMIN_MAX_MS - min(1), KEY)   // seen a minute ago
    expect(evaluateAdminSession({ cookie: c, now: T0 + ADMIN_MAX_MS + 1, key: KEY })).toEqual({ ok: false, reason: 'max' })
  })
  it('a sign-in newer than the stamp supersedes it (re-authentication starts a fresh session)', () => {
    const stale = encodeStamp(T0 - ADMIN_MAX_MS - min(60), T0 - ADMIN_MAX_MS, KEY)   // would be max/idle on its own
    const r = evaluateAdminSession({ cookie: stale, lastSignInAt: iso(T0), now: T0 + min(2), key: KEY })
    expect(r.ok).toBe(true)
    expect(decodeStamp((r as { cookie: string }).cookie, KEY)).toEqual({ start: T0, seen: T0 + min(2) })
  })
  it('a tampered stamp is ignored, falling back to the sign-in time', () => {
    const c = encodeStamp(T0, T0 + min(100), KEY).replace(/^\d/, '8')
    expect(evaluateAdminSession({ cookie: c, lastSignInAt: iso(T0), now: T0 + min(100), key: KEY })).toEqual({ ok: false, reason: 'idle' })
  })
})
