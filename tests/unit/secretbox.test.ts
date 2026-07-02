// Tests for lib/secretbox.ts — the at-rest encryption for per-org BYOK AI keys.
// The load-bearing guarantees: (1) round-trip fidelity, (2) legacy plaintext
// still reads (no backfill needed), (3) safe degradation when the env secret is
// absent (behaves like the pre-encryption code), (4) tamper detection.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const KEY = 'test-enc-secret-value-do-not-use-in-prod'

// secretbox reads process.env.AI_KEY_ENC_SECRET at call time (inside keyMaterial),
// so we can flip it per-test with a fresh import each time.
async function loadFresh() {
  vi.resetModules()
  return await import('@/lib/secretbox')
}

describe('secretbox with a configured key', () => {
  beforeEach(() => { process.env.AI_KEY_ENC_SECRET = KEY })
  afterEach(() => { delete process.env.AI_KEY_ENC_SECRET })

  it('round-trips a secret through encrypt → decrypt', async () => {
    const { encryptSecret, decryptSecret, isEncrypted } = await loadFresh()
    const plain = 'sk-ant-api03-super-secret-value'
    const enc = encryptSecret(plain)
    expect(enc).not.toBe(plain)
    expect(isEncrypted(enc)).toBe(true)
    expect(enc.startsWith('enc:v1:')).toBe(true)
    expect(decryptSecret(enc)).toBe(plain)
  })

  it('produces a different ciphertext each call (random IV) but decrypts the same', async () => {
    const { encryptSecret, decryptSecret } = await loadFresh()
    const a = encryptSecret('same-input')
    const b = encryptSecret('same-input')
    expect(a).not.toBe(b)
    expect(decryptSecret(a)).toBe('same-input')
    expect(decryptSecret(b)).toBe('same-input')
  })

  it('returns legacy plaintext (un-marked) verbatim — no backfill needed', async () => {
    const { decryptSecret, isEncrypted } = await loadFresh()
    expect(isEncrypted('sk-legacy-plaintext')).toBe(false)
    expect(decryptSecret('sk-legacy-plaintext')).toBe('sk-legacy-plaintext')
  })

  it('returns undefined on a tampered ciphertext (GCM auth fails)', async () => {
    const { encryptSecret, decryptSecret } = await loadFresh()
    const enc = encryptSecret('secret')
    const tampered = enc.slice(0, -4) + (enc.endsWith('A') ? 'B' : 'A') + enc.slice(-3)
    expect(decryptSecret(tampered)).toBeUndefined()
  })
})

describe('secretbox with NO key configured (pre-provisioning)', () => {
  beforeEach(() => { delete process.env.AI_KEY_ENC_SECRET })

  it('encryptSecret stores plaintext unchanged (matches pre-encryption behavior)', async () => {
    const { encryptSecret, isEncrypted } = await loadFresh()
    const out = encryptSecret('sk-plain')
    expect(out).toBe('sk-plain')
    expect(isEncrypted(out)).toBe(false)
  })

  it('decryptSecret passes plaintext through and returns undefined for un-decryptable ciphertext', async () => {
    const { decryptSecret } = await loadFresh()
    expect(decryptSecret('sk-plain')).toBe('sk-plain')
    expect(decryptSecret('enc:v1:aaa:bbb:ccc')).toBeUndefined()
  })

  it('returns undefined/empty for nullish input', async () => {
    const { decryptSecret } = await loadFresh()
    expect(decryptSecret(null)).toBeUndefined()
    expect(decryptSecret(undefined)).toBeUndefined()
    expect(decryptSecret('')).toBeUndefined()
  })
})
