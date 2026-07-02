import 'server-only'

// lib/secretbox.ts
// Application-layer encryption for secrets stored in Postgres (currently the
// per-org BYOK AI key, organizations.ai_api_key). AES-256-GCM (authenticated)
// with a key derived from the AI_KEY_ENC_SECRET env var.
//
// Design goals:
//  - Backward compatible in BOTH directions. Ciphertext carries an `enc:v1:`
//    marker; decryptSecret() returns un-marked values verbatim, so legacy
//    plaintext keys already in the DB keep working with no backfill.
//  - Safe before the secret is provisioned. If AI_KEY_ENC_SECRET is unset,
//    encryptSecret() stores plaintext (exactly today's behavior) — so deploying
//    this code without the env var set changes nothing. Once the var is set,
//    new writes are encrypted; existing plaintext continues to read fine.
//
// ⚠️ AI_KEY_ENC_SECRET is a decryption key: once org keys are encrypted with it,
// losing/rotating it makes those stored keys unreadable (org falls back to
// re-entering the key). Treat it like any other production secret.

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto'

const MARKER = 'enc:v1:'

// Derive a stable 32-byte key from the env secret (any length/encoding in →
// 32 bytes out). Returns null when unconfigured so callers degrade to plaintext.
function keyMaterial(): Buffer | null {
  const s = process.env.AI_KEY_ENC_SECRET
  if (!s) return null
  return createHash('sha256').update(s, 'utf8').digest()
}

/** True if a stored value is in our encrypted envelope format. */
export function isEncrypted(stored: string | null | undefined): boolean {
  return typeof stored === 'string' && stored.startsWith(MARKER)
}

/**
 * Encrypt a secret for storage. Returns an `enc:v1:<iv>:<tag>:<ct>` envelope
 * (base64 parts). If no key is configured, returns the plaintext unchanged so
 * behavior matches the pre-encryption code until AI_KEY_ENC_SECRET is set.
 */
export function encryptSecret(plaintext: string): string {
  const key = keyMaterial()
  if (!key) return plaintext
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return MARKER + [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':')
}

/**
 * Decrypt a stored secret. Un-marked (legacy plaintext) values are returned as-is.
 * Returns undefined only when a marked value can't be decrypted (missing key or
 * tampering) — callers treat that like "no usable key".
 */
export function decryptSecret(stored: string | null | undefined): string | undefined {
  if (!stored) return undefined
  if (!stored.startsWith(MARKER)) return stored // legacy plaintext
  const key = keyMaterial()
  if (!key) {
    console.warn('[secretbox] encrypted value present but AI_KEY_ENC_SECRET is unset — cannot decrypt')
    return undefined
  }
  try {
    const [ivB64, tagB64, ctB64] = stored.slice(MARKER.length).split(':')
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
    const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()])
    return pt.toString('utf8')
  } catch (e: any) {
    console.warn('[secretbox] decrypt failed: ' + (e?.message || e))
    return undefined
  }
}
