// AGENT_TIERS Phase 1 — capability knob resolver (lib/agentCapability).
// The standard knob set must equal today's hardcoded chatCore values exactly
// (no regression on existing agents); super raises them and carries a model
// override (Opus 4.8 default, or the per-agent editor choice).
import { describe, it, expect } from 'vitest'
import {
  resolveCapability,
  normalizeCapability,
  sanitizeCapabilityConfig,
  SUPER_DEFAULT_MODEL,
} from '@/lib/agentCapability'

describe('resolveCapability', () => {
  it('standard = today’s hardcoded values, no model override', () => {
    const k = resolveCapability({ capability: 'standard' })
    expect(k).toMatchObject({
      capability: 'standard',
      maxTokens: 400,
      ragChunks: 5,
      historyWindow: 8,
      inputCap: 1200,
      verbosityScale: 1,
      hardLimit: true,
    })
    expect(k.modelOverride).toBeUndefined()
  })

  it('missing / null / unknown capability defaults to standard', () => {
    expect(resolveCapability(null).capability).toBe('standard')
    expect(resolveCapability(undefined).capability).toBe('standard')
    expect(resolveCapability({}).capability).toBe('standard')
    expect(resolveCapability({ capability: 'ultra' }).capability).toBe('standard')
  })

  it('super raises every knob and defaults the model to Opus 4.8', () => {
    const k = resolveCapability({ capability: 'super' })
    expect(k).toMatchObject({
      capability: 'super',
      modelOverride: SUPER_DEFAULT_MODEL,
      maxTokens: 1200,
      ragChunks: 12,
      historyWindow: 24,
      inputCap: 4000,
      verbosityScale: 2.5,
      hardLimit: false,
    })
    expect(SUPER_DEFAULT_MODEL).toBe('claude-opus-4-8')
  })

  it('super honors a valid per-agent model choice', () => {
    const k = resolveCapability({ capability: 'super', capability_config: { model: 'claude-sonnet-4-6' } })
    expect(k.modelOverride).toBe('claude-sonnet-4-6')
  })

  it('super ignores an invalid model choice and falls back to the default', () => {
    const k = resolveCapability({ capability: 'super', capability_config: { model: 'gpt-4o' } })
    expect(k.modelOverride).toBe(SUPER_DEFAULT_MODEL)
  })

  it('standard never carries a model override even if capability_config has one', () => {
    const k = resolveCapability({ capability: 'standard', capability_config: { model: 'claude-opus-4-8' } })
    expect(k.modelOverride).toBeUndefined()
  })

  it('super knobs strictly exceed standard (the whole point of the tier)', () => {
    const s = resolveCapability({ capability: 'standard' })
    const u = resolveCapability({ capability: 'super' })
    expect(u.maxTokens).toBeGreaterThan(s.maxTokens)
    expect(u.ragChunks).toBeGreaterThan(s.ragChunks)
    expect(u.historyWindow).toBeGreaterThan(s.historyWindow)
    expect(u.inputCap).toBeGreaterThan(s.inputCap)
  })
})

describe('normalizeCapability / sanitizeCapabilityConfig', () => {
  it('normalizeCapability coerces anything but "super" to "standard" (CHECK-safe)', () => {
    expect(normalizeCapability('super')).toBe('super')
    expect(normalizeCapability('standard')).toBe('standard')
    expect(normalizeCapability('SUPER')).toBe('standard')
    expect(normalizeCapability(undefined)).toBe('standard')
    expect(normalizeCapability(42)).toBe('standard')
  })

  it('sanitizeCapabilityConfig keeps only a valid super-model string', () => {
    expect(sanitizeCapabilityConfig({ model: 'claude-opus-4-8' })).toEqual({ model: 'claude-opus-4-8' })
    expect(sanitizeCapabilityConfig({ model: 'claude-sonnet-4-6' })).toEqual({ model: 'claude-sonnet-4-6' })
    expect(sanitizeCapabilityConfig({ model: 'evil' })).toEqual({})
    expect(sanitizeCapabilityConfig({ junk: 1 })).toEqual({})
    expect(sanitizeCapabilityConfig(null)).toEqual({})
    expect(sanitizeCapabilityConfig('nope')).toEqual({})
  })
})
