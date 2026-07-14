// AGENT_TIERS Phase 2 P2f — the live-context adapter registry.
// The two hand-wired deployments are preserved EXACTLY as the first two adapters
// (MCO gated by the AskAna bot id, wildfire gated by config.liveContext), and a
// Super Agent can additionally opt in via capability_config.liveContext. Adapter
// builders are mocked — this is selection/orchestration, no network.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { ASKANA, wildfireBuild, mcoBuild } = vi.hoisted(() => {
  const ASKANA = '920c571b-5a09-4d3a-a20e-904a417d20b3'
  return {
    ASKANA,
    wildfireBuild: vi.fn(async (..._a: unknown[]) => 'WILDFIRE BLOCK'),
    mcoBuild: vi.fn(async (botId: string, ..._a: unknown[]) => (botId === ASKANA ? 'MCO BLOCK' : '')),
  }
})

vi.mock('@/lib/wildfireLiveContext', () => ({ buildWildfireLiveContext: (...a: unknown[]) => wildfireBuild(...(a as [])) }))
vi.mock('@/lib/mcoLiveContext', () => ({
  ASKANA_BOT_ID: ASKANA,
  buildMcoLiveContext: (botId: string, ...a: unknown[]) => mcoBuild(botId, ...(a as [])),
}))

import { resolveLiveContextBlocks } from '@/lib/liveContext/registry'

const input = (bot: Record<string, unknown>) => ({
  bot: bot as never,
  userMessage: 'is there a fire near 83702?',
  priorAssistant: 'prior',
  recentUserMessages: ['earlier msg'],
})

beforeEach(() => { wildfireBuild.mockClear(); mcoBuild.mockClear() })

describe('resolveLiveContextBlocks', () => {
  it('activates wildfire via the legacy config.liveContext flag (any tier)', async () => {
    const res = await resolveLiveContextBlocks(input({ id: 'b1', config: { liveContext: 'wildfire' }, capability: 'standard' }))
    expect(wildfireBuild).toHaveBeenCalledTimes(1)
    // Preserves the (userMessage, recentUserMessages) call shape.
    expect(wildfireBuild.mock.calls[0]).toEqual(['is there a fire near 83702?', ['earlier msg']])
    expect(res).toEqual([{ source: 'wildfire', block: 'WILDFIRE BLOCK' }])
  })

  it('activates MCO for the AskAna bot id and passes prior assistant', async () => {
    const res = await resolveLiveContextBlocks(input({ id: ASKANA, capability: 'standard' }))
    expect(mcoBuild).toHaveBeenCalledWith(ASKANA, 'is there a fire near 83702?', 'prior')
    expect(res).toEqual([{ source: 'mco', block: 'MCO BLOCK' }])
  })

  it('does NOT activate MCO for a non-Ana bot', async () => {
    const res = await resolveLiveContextBlocks(input({ id: 'other', capability: 'standard' }))
    expect(mcoBuild).not.toHaveBeenCalled()
    expect(res).toEqual([])
  })

  it('activates an adapter from the SUPER liveContext knob without any legacy gate', async () => {
    const res = await resolveLiveContextBlocks(input({ id: 'b2', capability: 'super', capability_config: { liveContext: [{ source: 'wildfire' }] } }))
    expect(wildfireBuild).toHaveBeenCalledTimes(1)
    expect(res.map((r) => r.source)).toEqual(['wildfire'])
  })

  it('IGNORES the liveContext knob for a standard agent (super-only)', async () => {
    const res = await resolveLiveContextBlocks(input({ id: 'b3', capability: 'standard', capability_config: { liveContext: [{ source: 'wildfire' }] } }))
    expect(wildfireBuild).not.toHaveBeenCalled()
    expect(res).toEqual([])
  })

  it('dedups a source active via both a legacy gate and the knob (runs once)', async () => {
    const res = await resolveLiveContextBlocks(input({ id: 'b4', config: { liveContext: 'wildfire' }, capability: 'super', capability_config: { liveContext: [{ source: 'wildfire' }] } }))
    expect(wildfireBuild).toHaveBeenCalledTimes(1)
    expect(res).toHaveLength(1)
  })

  it('preserves MCO-before-wildfire order when both are active', async () => {
    const res = await resolveLiveContextBlocks(input({ id: ASKANA, config: { liveContext: 'wildfire' }, capability: 'super', capability_config: {} }))
    expect(res.map((r) => r.source)).toEqual(['mco', 'wildfire'])
  })

  it('isolates an adapter throw into a per-source error, never a failed turn', async () => {
    wildfireBuild.mockRejectedValueOnce(new Error('feed down'))
    const res = await resolveLiveContextBlocks(input({ id: 'b5', config: { liveContext: 'wildfire' }, capability: 'standard' }))
    expect(res).toEqual([{ source: 'wildfire', block: '', error: 'feed down' }])
  })
})
