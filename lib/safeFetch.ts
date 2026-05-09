// lib/safeFetch.ts
// SSRF-safe wrapper around `fetch` for any route that fetches a
// user-supplied URL (bot training, crawl, research). Without this, an
// authed user could ask the server to fetch
//   http://169.254.169.254/latest/meta-data/iam/security-credentials/
// (the AWS instance metadata endpoint), or anything on the platform's
// internal network that's not exposed publicly.
//
// What we block:
//   - Non-http(s) schemes (file:, gopher:, etc.)
//   - Hostnames that DNS-resolve to a loopback / private / link-local /
//     multicast / reserved IP — IPv4 and IPv6 alike, including
//     IPv4-mapped IPv6 (::ffff:10.0.0.1).
//   - Redirects whose Location resolves to any of the above (revalidate
//     each hop instead of using fetch's `redirect: 'follow'`).

import { lookup } from 'dns/promises'
import { isIP } from 'net'

const MAX_REDIRECTS = 5

export class SafeFetchError extends Error {
  constructor(message: string, public readonly status: number = 400) {
    super(message)
  }
}

/** True when an IPv4 dotted-quad lives in a range we never want to talk to. */
function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some(n => isNaN(n) || n < 0 || n > 255)) return true
  const [a, b] = parts
  // 0.0.0.0/8 — "this network" (including 0.0.0.0 itself)
  if (a === 0) return true
  // 10.0.0.0/8 — RFC1918 private
  if (a === 10) return true
  // 100.64.0.0/10 — CGNAT
  if (a === 100 && b >= 64 && b <= 127) return true
  // 127.0.0.0/8 — loopback
  if (a === 127) return true
  // 169.254.0.0/16 — link-local AND cloud metadata (169.254.169.254)
  if (a === 169 && b === 254) return true
  // 172.16.0.0/12 — RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true
  // 192.0.0.0/24, 192.0.2.0/24 — IETF protocol assignments / TEST-NET-1
  if (a === 192 && b === 0) return true
  // 192.168.0.0/16 — RFC1918
  if (a === 192 && b === 168) return true
  // 198.18.0.0/15 — benchmark
  if (a === 198 && (b === 18 || b === 19)) return true
  // 198.51.100.0/24 — TEST-NET-2
  if (a === 198 && b === 51 && parts[2] === 100) return true
  // 203.0.113.0/24 — TEST-NET-3
  if (a === 203 && b === 0 && parts[2] === 113) return true
  // 224.0.0.0/4 — multicast
  if (a >= 224 && a <= 239) return true
  // 240.0.0.0/4 — reserved + 255.255.255.255 broadcast
  if (a >= 240) return true
  return false
}

/** True for any IPv6 address we don't want to talk to. */
function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  // Loopback ::1 and unspecified ::
  if (lower === '::1' || lower === '::' || lower === '0:0:0:0:0:0:0:1' || lower === '0:0:0:0:0:0:0:0') return true
  // IPv4-mapped IPv6: ::ffff:a.b.c.d → check the embedded v4
  const v4MappedMatch = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (v4MappedMatch) return isBlockedIPv4(v4MappedMatch[1])
  // fc00::/7 — unique local
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true
  // fe80::/10 — link-local
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true
  // ff00::/8 — multicast
  if (/^ff[0-9a-f]{2}:/.test(lower)) return true
  return false
}

async function ensurePublicHost(hostname: string): Promise<void> {
  // If it's already a literal IP, validate directly.
  const ipKind = isIP(hostname)
  if (ipKind === 4) {
    if (isBlockedIPv4(hostname)) throw new SafeFetchError('URL resolves to a private/loopback address', 400)
    return
  }
  if (ipKind === 6) {
    if (isBlockedIPv6(hostname)) throw new SafeFetchError('URL resolves to a private/loopback address', 400)
    return
  }
  // Resolve all addresses; reject if any one is private. Belt-and-suspenders
  // against DNS rebinding where a hostname returns mixed public+private records.
  let addrs: { address: string; family: number }[]
  try {
    addrs = await lookup(hostname, { all: true })
  } catch {
    throw new SafeFetchError('Hostname could not be resolved', 400)
  }
  if (addrs.length === 0) throw new SafeFetchError('Hostname could not be resolved', 400)
  for (const a of addrs) {
    if (a.family === 4 && isBlockedIPv4(a.address)) {
      throw new SafeFetchError('URL resolves to a private/loopback address', 400)
    }
    if (a.family === 6 && isBlockedIPv6(a.address)) {
      throw new SafeFetchError('URL resolves to a private/loopback address', 400)
    }
  }
}

/**
 * Drop-in replacement for `fetch` for any user-supplied URL.
 * Always validates the URL before each network hop and refuses non-http(s).
 * Caller-supplied options' `redirect` is ignored — we always handle redirects manually.
 */
export async function safeFetch(rawUrl: string, init: RequestInit = {}): Promise<Response> {
  let currentUrl: URL
  try { currentUrl = new URL(rawUrl) } catch {
    throw new SafeFetchError('Invalid URL', 400)
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (currentUrl.protocol !== 'http:' && currentUrl.protocol !== 'https:') {
      throw new SafeFetchError('Only http(s) URLs are allowed', 400)
    }
    await ensurePublicHost(currentUrl.hostname)

    const res = await fetch(currentUrl.toString(), { ...init, redirect: 'manual' })

    // 30x — re-validate the next hop instead of letting fetch follow blind.
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) return res
      let nextUrl: URL
      try { nextUrl = new URL(location, currentUrl) } catch {
        throw new SafeFetchError('Invalid redirect target', 502)
      }
      currentUrl = nextUrl
      continue
    }
    return res
  }
  throw new SafeFetchError('Too many redirects', 502)
}
