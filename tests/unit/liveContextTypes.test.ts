// AGENT_TIERS Phase 2 P2f — pure validation of the super `liveContext` knob
// (lib/liveContext/types) and its round-trip through sanitizeCapabilityConfig.
import { describe, it, expect } from 'vitest'
import { sanitizeLiveContextRefs, isLiveContextSource } from '@/lib/liveContext/types'
import { sanitizeCapabilityConfig } from '@/lib/agentCapability'

describe('sanitizeLiveContextRefs', () => {
  it('keeps known sources and drops unknown ones', () => {
    expect(sanitizeLiveContextRefs([{ source: 'wildfire' }, { source: 'nope' }, { source: 'mco' }]))
      .toEqual([{ source: 'wildfire' }, { source: 'mco' }])
  })

  it('dedups by source (first wins)', () => {
    expect(sanitizeLiveContextRefs([{ source: 'wildfire' }, { source: 'wildfire', params: { x: 1 } }]))
      .toEqual([{ source: 'wildfire' }])
  })

  it('keeps params only when a plain object', () => {
    expect(sanitizeLiveContextRefs([{ source: 'mco', params: { radius: 10 } }])).toEqual([{ source: 'mco', params: { radius: 10 } }])
    expect(sanitizeLiveContextRefs([{ source: 'mco', params: [1, 2] }])).toEqual([{ source: 'mco' }])
    expect(sanitizeLiveContextRefs([{ source: 'mco', params: 'bad' }])).toEqual([{ source: 'mco' }])
  })

  it('returns [] for non-array / malformed input', () => {
    expect(sanitizeLiveContextRefs(null)).toEqual([])
    expect(sanitizeLiveContextRefs('wildfire')).toEqual([])
    expect(sanitizeLiveContextRefs([null, 5, { source: 42 }])).toEqual([])
  })

  it('isLiveContextSource guards the known set', () => {
    expect(isLiveContextSource('wildfire')).toBe(true)
    expect(isLiveContextSource('mco')).toBe(true)
    expect(isLiveContextSource('weather')).toBe(false)
  })
})

describe('sanitizeCapabilityConfig preserves a validated liveContext knob', () => {
  it('keeps model + validated liveContext, drops junk', () => {
    expect(sanitizeCapabilityConfig({ model: 'claude-opus-4-8', liveContext: [{ source: 'wildfire' }, { source: 'bad' }] }))
      .toEqual({ model: 'claude-opus-4-8', liveContext: [{ source: 'wildfire' }] })
  })

  it('omits liveContext entirely when nothing valid survives', () => {
    expect(sanitizeCapabilityConfig({ liveContext: [{ source: 'bad' }] })).toEqual({})
    expect(sanitizeCapabilityConfig({ model: 'claude-opus-4-8' })).toEqual({ model: 'claude-opus-4-8' })
  })
})
