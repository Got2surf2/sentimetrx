// lib/oauthState.ts
// HMAC-signed OAuth state parameter for the Meta connect flow.
//
// Why: the `state` parameter on the OAuth round-trip used to be plain
// `base64(JSON.stringify({userId}))`. Anyone could craft a state for a
// different victim org's user and complete the flow with their own FB
// account, attaching their pages/tokens to the victim's org_id.
//
// Now we sign payload+nonce+expiry with HMAC-SHA256 using a server-only
// secret and verify on callback. Tampered or replayed states are rejected.

import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

const STATE_TTL_MS = 10 * 60 * 1000 // 10 minutes is plenty for an OAuth round-trip.

function getSecret(): string {
  const s = process.env.OAUTH_STATE_SECRET
  if (!s || s.length < 16) {
    throw new Error('OAUTH_STATE_SECRET must be set (>=16 chars) for OAuth state signing')
  }
  return s
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(s: string): Buffer {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  return Buffer.from(padded, 'base64')
}

export function signOauthState(payload: Record<string, unknown>): string {
  const body = {
    ...payload,
    nonce: randomBytes(16).toString('hex'),
    exp: Date.now() + STATE_TTL_MS,
  }
  const json = JSON.stringify(body)
  const bodyB64 = b64url(Buffer.from(json, 'utf8'))
  const sig = createHmac('sha256', getSecret()).update(bodyB64).digest()
  return `${bodyB64}.${b64url(sig)}`
}

export function verifyOauthState<T extends Record<string, unknown> = Record<string, unknown>>(raw: string): T | null {
  if (!raw || typeof raw !== 'string' || !raw.includes('.')) return null
  const [bodyB64, sigB64] = raw.split('.')
  if (!bodyB64 || !sigB64) return null

  let providedSig: Buffer
  try { providedSig = fromB64url(sigB64) } catch { return null }

  const expectedSig = createHmac('sha256', getSecret()).update(bodyB64).digest()
  if (providedSig.length !== expectedSig.length) return null
  if (!timingSafeEqual(providedSig, expectedSig)) return null

  let payload: unknown
  try {
    payload = JSON.parse(fromB64url(bodyB64).toString('utf8'))
  } catch { return null }

  if (typeof payload !== 'object' || payload === null) return null
  const exp = (payload as { exp?: unknown }).exp
  if (typeof exp !== 'number' || Date.now() > exp) return null
  return payload as T
}
