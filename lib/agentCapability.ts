// lib/agentCapability.ts
// AGENT_TIERS Phase 1 — the single source of truth for capability knobs.
//
// One engine (chatCore), capability by config. A "super agent" is not a second
// code path — it's this raised knob set resolved from `agents.capability` +
// `agents.capability_config`. Every per-tier literal lives here so chatCore
// carries no scattered magic numbers.
//
// Owner decisions (2026-07-14, AGENT_TIERS §7): super default model = Opus 4.8
// with a per-agent editor dropdown (Sonnet 4.6 available); pricing is a flat
// monthly fee (the quota is an abuse backstop, see lib/featureFlags).

export type Capability = 'standard' | 'super'

export interface CapabilityConfig {
  model?: string   // super only: per-agent model override (editor dropdown)
}

export interface CapabilityKnobs {
  capability: Capability
  /** Explicit model for callAI.modelOverride. undefined → tier default (Sonnet 4.6). */
  modelOverride?: string
  maxTokens: number
  ragChunks: number       // top-K knowledge chunks injected per turn
  historyWindow: number   // verbatim messages kept before summary compression
  inputCap: number        // max user input chars
  verbosityScale: number  // multiplier on the word-cap ladder
  hardLimit: boolean      // "HARD LIMIT" framing (standard) vs a soft aim (super)
}

// The super-tier model dropdown (editor). First entry is the default.
export const SUPER_MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: 'claude-opus-4-8', label: 'Opus 4.8 — deepest reasoning (default)' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6 — faster, lower cost' },
]
export const SUPER_DEFAULT_MODEL = SUPER_MODEL_OPTIONS[0].value
const VALID_SUPER_MODELS = new Set(SUPER_MODEL_OPTIONS.map((o) => o.value))

// Standard knobs are EXACTLY today's hardcoded values — a standard agent
// behaves identically after this change (no regression on existing agents).
const DEFAULTS: Record<Capability, Omit<CapabilityKnobs, 'capability' | 'modelOverride'>> = {
  standard: { maxTokens: 400,  ragChunks: 5,  historyWindow: 8,  inputCap: 1200, verbosityScale: 1,   hardLimit: true },
  super:    { maxTokens: 1200, ragChunks: 12, historyWindow: 24, inputCap: 4000, verbosityScale: 2.5, hardLimit: false },
}

/** Normalize a raw capability value (defensive against bad DB/casing). */
export function normalizeCapability(value: unknown): Capability {
  return value === 'super' ? 'super' : 'standard'
}

/**
 * Resolve the knob set for an agent. `modelOverride` is only set for super
 * agents — the per-agent choice from capability_config.model, falling back to
 * the Opus 4.8 default when unset or not an allowed value. Standard agents
 * return no override, so callAI uses the tier default (Sonnet 4.6) unchanged.
 */
export function resolveCapability(
  agent: { capability?: string | null; capability_config?: CapabilityConfig | null } | null | undefined,
): CapabilityKnobs {
  const capability = normalizeCapability(agent?.capability)
  const base = DEFAULTS[capability]
  let modelOverride: string | undefined
  if (capability === 'super') {
    const chosen = agent?.capability_config?.model
    modelOverride = chosen && VALID_SUPER_MODELS.has(chosen) ? chosen : SUPER_DEFAULT_MODEL
  }
  return { capability, modelOverride, ...base }
}

/**
 * Sanitize an incoming capability_config for persistence (POST/PATCH /api/bots).
 * Only a valid super-model string survives; everything else is dropped so we
 * never store junk that the resolver would ignore anyway.
 */
export function sanitizeCapabilityConfig(raw: unknown): CapabilityConfig {
  if (!raw || typeof raw !== 'object') return {}
  const model = (raw as CapabilityConfig).model
  return model && VALID_SUPER_MODELS.has(model) ? { model } : {}
}
