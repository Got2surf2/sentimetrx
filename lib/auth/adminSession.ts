// lib/auth/adminSession.ts
// Platform-admin session policy — SECURITY.md §3, ratified 2026-09-15:
// **30 minutes idle, 24 hours maximum.** Supabase's JWT lifetime is
// project-wide, so this is enforced by the app for `is_admin_org` users.
//
// Mechanism: a signed activity stamp in an HttpOnly cookie —
// `<sessionStart>.<lastSeen>.<hmac>` — refreshed on every admin request
// (lib/auth/requireAdmin for API routes, proxy.ts for page navigations).
// Evaluation reconciles the stamp with Supabase's `last_sign_in_at`:
//   - no / tampered stamp → only a sign-in inside the idle window counts, so
//     deleting the cookie cannot extend a session — it forces re-login;
//   - a sign-in newer than the stamp supersedes it (the admin re-authenticated).
// The HMAC key is the existing server secret (AI_KEY_ENC_SECRET, else the
// service-role key) under a fixed context string — no new env, no migration.
import { createHmac, timingSafeEqual } from 'node:crypto'

export const ADMIN_IDLE_MS = 30 * 60_000
export const ADMIN_MAX_MS = 24 * 60 * 60_000
export const ADMIN_SESSION_COOKIE = 'sx_admin_session'
export const ADMIN_SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: ADMIN_MAX_MS / 1000,
}

export type AdminSessionReason = 'idle' | 'max'
export type AdminSessionResult = { ok: true; cookie: string } | { ok: false; reason: AdminSessionReason }

function serverKey(): string {
  return process.env.AI_KEY_ENC_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
}
function sign(payload: string, key: string): string {
  return createHmac('sha256', key).update('admin-session-v1:' + payload).digest('base64url')
}

export function encodeStamp(start: number, seen: number, key: string = serverKey()): string {
  const payload = `${start}.${seen}`
  return `${payload}.${sign(payload, key)}`
}

/** null for a missing, malformed, or tampered stamp — never a partial trust. */
export function decodeStamp(value: string | null | undefined, key: string = serverKey()): { start: number; seen: number } | null {
  if (!value || !key) return null
  const parts = value.split('.')
  if (parts.length !== 3) return null
  const [a, b, sig] = parts
  const expected = Buffer.from(sign(`${a}.${b}`, key))
  const given = Buffer.from(sig)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  const start = Number(a), seen = Number(b)
  if (!Number.isFinite(start) || !Number.isFinite(seen)) return null
  return { start, seen }
}

export function evaluateAdminSession(input: {
  cookie?: string | null
  lastSignInAt?: string | null
  now?: number
  /** false = check only, do not count this request as activity (heartbeats, page renders). */
  touch?: boolean
  key?: string
}): AdminSessionResult {
  const now = input.now ?? Date.now()
  const key = input.key ?? serverKey()
  const stamp = decodeStamp(input.cookie, key)
  const signIn = input.lastSignInAt ? Date.parse(input.lastSignInAt) : NaN

  let start = stamp ? stamp.start : signIn
  let seen = stamp ? stamp.seen : signIn
  if (Number.isFinite(signIn) && signIn > start) { start = signIn; seen = Math.max(seen, signIn) }

  if (!Number.isFinite(start)) return { ok: false, reason: 'idle' }   // nothing proves recent activity
  if (now - start > ADMIN_MAX_MS) return { ok: false, reason: 'max' }
  if (now - seen > ADMIN_IDLE_MS) return { ok: false, reason: 'idle' }
  return { ok: true, cookie: encodeStamp(start, input.touch === false ? seen : now, key) }
}
