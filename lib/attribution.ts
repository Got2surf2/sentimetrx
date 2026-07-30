// lib/attribution.ts
// Provenance capture for embedded agents — WHERE a conversation came from:
// a QR code on a postcard, a QR placard at a live meeting, a partner site
// that iframes the agent, an email link.
//
// SECURITY MODEL — read before extending this.
// These values arrive from the public widget URL, so anyone can set them to
// anything. They are stored as DATA ONLY and must NEVER be injected into the
// system prompt. The allowlisted `?site=` param (see BotClient + chatCore's
// DEPLOYMENT CONTEXT block) is the one that reaches the prompt, and it stays
// allowlisted precisely because of that. Because attribution never reaches the
// model, it needs no allowlist — a length cap and empty-string rejection are
// the whole hardening story.
//
// Values land in two places:
//   1. agent_impressions (widget-open beacon) — every open, even ones that
//      never become a conversation.
//   2. conversations.source/medium/campaign — so responses and themes can be
//      segmented by where the participant came from.

/** Matches the cap already applied by the impression beacon route. */
export const ATTRIBUTION_MAX_LEN = 80

export interface Attribution {
  source?: string
  medium?: string
  campaign?: string
}

/** Trim, cap, drop empties. Returns null for anything unusable. */
export function cleanAttributionValue(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  if (!trimmed) return null
  return trimmed.slice(0, ATTRIBUTION_MAX_LEN)
}

function build(source: unknown, medium: unknown, campaign: unknown): Attribution {
  const out: Attribution = {}
  const s = cleanAttributionValue(source)
  const m = cleanAttributionValue(medium)
  const c = cleanAttributionValue(campaign)
  if (s) out.source = s
  if (m) out.medium = m
  if (c) out.campaign = c
  return out
}

/**
 * Pull attribution off a URL query. Accepts the bare names and the standard
 * `utm_*` aliases so a link built by any campaign tool works unchanged; the
 * bare name wins when both are present.
 */
export function attributionFromParams(get: (key: string) => string | null | undefined): Attribution {
  const pick = (bare: string, utm: string) => get(bare) ?? get(utm)
  return build(pick('source', 'utm_source'), pick('medium', 'utm_medium'), pick('campaign', 'utm_campaign'))
}

/**
 * Re-clean whatever the client put in the chat POST body. The client already
 * sanitizes, but the endpoint is public and cookie-free — anyone can POST it
 * directly, so the server never trusts the client's version.
 */
export function attributionFromBody(body: { source?: unknown; medium?: unknown; campaign?: unknown }): Attribution {
  return build(body.source, body.medium, body.campaign)
}

/** True when at least one field survived cleaning. */
export function hasAttribution(a: Attribution): boolean {
  return !!(a.source || a.medium || a.campaign)
}
