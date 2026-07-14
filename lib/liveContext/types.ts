// lib/liveContext/types.ts
// AGENT_TIERS Phase 2 P2f — pure types + validation for the live-context adapter
// registry. NO server-only / heavy imports so agentCapability.ts (which the
// client agent editor imports) can validate the super `liveContext` knob without
// pulling the server-only adapter builders (wildfire/MCO fetchers) into the
// browser bundle. The server registry (registry.ts) imports these same names.

/** One entry in a Super Agent's `capability_config.liveContext` knob. */
export interface LiveContextRef {
  source: string
  params?: Record<string, unknown>
}

// The adapter names the registry knows. Single source of truth shared by the
// server registry and the persistence sanitizer so they can never disagree.
export const LIVE_CONTEXT_SOURCES = ['wildfire', 'mco'] as const
export type LiveContextSource = (typeof LIVE_CONTEXT_SOURCES)[number]

export function isLiveContextSource(v: unknown): v is LiveContextSource {
  return typeof v === 'string' && (LIVE_CONTEXT_SOURCES as readonly string[]).includes(v)
}

/**
 * Validate a raw super `liveContext` knob into clean refs. Drops entries whose
 * `source` is not a known adapter; keeps `params` only when it's a plain object;
 * dedups by source (first wins). Returns [] for anything malformed — so a bad
 * knob is a no-op, never a crash.
 */
export function sanitizeLiveContextRefs(raw: unknown): LiveContextRef[] {
  if (!Array.isArray(raw)) return []
  const out: LiveContextRef[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    const source = (entry as LiveContextRef | null)?.source
    if (!isLiveContextSource(source) || seen.has(source)) continue
    seen.add(source)
    const params = (entry as LiveContextRef).params
    out.push(params && typeof params === 'object' && !Array.isArray(params) ? { source, params } : { source })
  }
  return out
}
