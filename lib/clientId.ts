// lib/clientId.ts
// Opaque ids minted on the client (chat session ids, visitor ids, simulator
// session ids). These travel to the server as the handle for a conversation —
// the agent widget fetches `/session/<id>/turns` by it — so they must not be
// guessable. `Math.random()` (≈52 bits, non-cryptographic) was used at nine
// sites (CodeQL js/insecure-randomness); this is the one replacement.
//
// Works in browsers and Node ≥ 19 via the WebCrypto global; falls back to
// getRandomValues where randomUUID is missing (older WebViews).

export function randomId(prefix = ''): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return prefix + c.randomUUID()
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = c.getRandomValues(new Uint8Array(16))
    return prefix + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  }
  // No WebCrypto at all (should not happen in any supported runtime): fail
  // loudly rather than mint a guessable id.
  throw new Error('randomId: WebCrypto unavailable')
}
