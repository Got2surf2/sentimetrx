// lib/liveContext/registry.ts
// AGENT_TIERS Phase 2 P2f — the live-context adapter registry.
//
// Generalizes the two hand-wired live-data injections in chatCore into a typed
// adapter map. The wildfire agent (LIVE ON PROD, www.sentimetrx.ai/b/wildfire)
// and Ana/MCO are the first two adapters; their EXACT behavior is preserved:
//   - MCO: activated for the AskAna bot id (buildMcoLiveContext also self-gates).
//   - Wildfire: activated by the legacy `config.liveContext === 'wildfire'` flag.
// On top of those legacy gates, a Super Agent can opt into any registered
// adapter via the generalized knob `capability_config.liveContext:
// [{source, params}]` (super-tier only).

import 'server-only'
import { buildWildfireLiveContext } from '@/lib/wildfireLiveContext'
import { buildMcoLiveContext, ASKANA_BOT_ID } from '@/lib/mcoLiveContext'
import { normalizeCapability } from '@/lib/agentCapability'
import { sanitizeLiveContextRefs, type LiveContextSource } from '@/lib/liveContext/types'

export interface LiveContextBot {
  id: string
  config?: { liveContext?: string } | null
  capability?: string | null
  capability_config?: { liveContext?: unknown } | null
}

export interface LiveContextInput {
  bot: LiveContextBot
  /** The current user message. */
  userMessage: string
  /** Most recent prior assistant message (MCO follow-up resolution). */
  priorAssistant: string
  /** Recent user messages excluding the current one (wildfire location carry-forward). */
  recentUserMessages: string[]
  /** Per-invocation params from the super knob (forward-looking; wildfire/MCO ignore). */
  params?: Record<string, unknown>
}

export interface LiveContextAdapter {
  source: LiveContextSource
  build: (input: LiveContextInput) => Promise<string>
}

const WILDFIRE_ADAPTER: LiveContextAdapter = {
  source: 'wildfire',
  build: (i) => buildWildfireLiveContext(i.userMessage, i.recentUserMessages),
}
const MCO_ADAPTER: LiveContextAdapter = {
  source: 'mco',
  build: (i) => buildMcoLiveContext(i.bot.id, i.userMessage, i.priorAssistant),
}

export const LIVE_CONTEXT_ADAPTERS: Record<LiveContextSource, LiveContextAdapter> = {
  wildfire: WILDFIRE_ADAPTER,
  mco: MCO_ADAPTER,
}

export interface LiveContextResult {
  source: LiveContextSource
  /** The injected system-prompt block, or '' when the adapter had nothing for this turn. */
  block: string
  /** Set instead of a block when the adapter threw (fetch failure etc.). */
  error?: string
}

/**
 * Resolve which live-context adapters run this turn and invoke them in order.
 * Order = MCO, wildfire, then super-knob adapters; deduped by source so a source
 * already active via a legacy gate is never run twice. Each adapter is isolated:
 * a throw becomes a per-source `error` (never a failed turn), matching the old
 * per-block try/catch in chatCore.
 */
export async function resolveLiveContextBlocks(input: LiveContextInput): Promise<LiveContextResult[]> {
  const { bot } = input
  const active: { adapter: LiveContextAdapter; params?: Record<string, unknown> }[] = []
  const seen = new Set<LiveContextSource>()
  const add = (source: LiveContextSource, params?: Record<string, unknown>) => {
    if (seen.has(source)) return
    seen.add(source)
    active.push({ adapter: LIVE_CONTEXT_ADAPTERS[source], params })
  }

  // Legacy gates (tier-agnostic — the two live deployments). Order preserved:
  // MCO block was pushed before the wildfire block in the old chatCore code.
  if (bot.id === ASKANA_BOT_ID) add('mco')
  if (bot.config?.liveContext === 'wildfire') add('wildfire')

  // Generalized super-only knob.
  if (normalizeCapability(bot.capability) === 'super') {
    for (const ref of sanitizeLiveContextRefs(bot.capability_config?.liveContext)) {
      add(ref.source as LiveContextSource, ref.params)
    }
  }

  const results: LiveContextResult[] = []
  for (const { adapter, params } of active) {
    try {
      const block = await adapter.build({ ...input, params })
      results.push({ source: adapter.source, block })
    } catch (e) {
      results.push({ source: adapter.source, block: '', error: (e as Error)?.message || String(e) })
    }
  }
  return results
}
