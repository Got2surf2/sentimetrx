import 'server-only'

// lib/ai.ts
// Provider-agnostic AI abstraction layer.
// Supports Anthropic (default), OpenAI, and Azure OpenAI.
// All AI call sites route through callAI() for consistent behavior.
// IMPORTANT: Always pass `usage` context so calls are logged for cost tracking.

import { recordCreditError, isCreditError } from '@/lib/serviceHealth'
import { TIER_DEFAULT_MODEL } from '@/lib/usageRates'

// ── Types ────────────────────────────────────────────────────────────────────

export type AIProvider = 'anthropic' | 'openai' | 'azure-openai'
export type ModelTier = 'fast' | 'standard' | 'advanced'

export interface AIProviderConfig {
  provider: AIProvider
  apiKey?: string
  azureEndpoint?: string
  azureApiVersion?: string
}

export interface AIUsageContext {
  org_id?: string
  resource_type: 'bot' | 'townhall' | 'social' | 'dataset' | 'study' | 'recording' | 'system'
  resource_id?: string
  event_type: string
}

// A system prompt may be a plain string or split into blocks. Marking a block
// `cache: true` enables Anthropic prompt caching (cache_control: ephemeral) so
// repeated prefixes don't count against the input-tokens-per-minute rate limit
// or the per-call cost. Non-Anthropic providers receive the blocks joined into
// a single string (no caching there).
export type SystemBlock = { type: 'text'; text: string; cache?: boolean }

// Multimodal message content. Plain strings keep working everywhere; the block
// array form carries images for Claude vision (Anthropic only — the OpenAI/Azure
// builders pass it through but their image schema differs, so vision callers must
// use the Anthropic provider). Anthropic accepts these blocks in messages[].content.
export type TextContentBlock = { type: 'text'; text: string }
export type ImageContentBlock = {
  type: 'image'
  source:
    | { type: 'base64'; media_type: string; data: string }
    | { type: 'url'; url: string }     // Anthropic fetches the (time-limited signed) URL
}
export type MessageContent = string | Array<TextContentBlock | ImageContentBlock>

export interface AIRequestOptions {
  tier: ModelTier
  system?: string | SystemBlock[]
  messages: Array<{ role: 'user' | 'assistant'; content: MessageContent }>
  maxTokens?: number
  timeoutMs?: number
  providerConfig?: AIProviderConfig   // explicit override
  apiKey?: string                     // shorthand: user-provided key (uses env AI_PROVIDER)
  usage?: AIUsageContext              // if provided, auto-logs token usage for cost tracking
  modelOverride?: string              // explicit model name, bypasses MODEL_MAP[provider][tier]
                                      // (tier is still used as the usage-log label)
}

export interface AIUsage {
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  model: string
  provider: AIProvider
  tier: ModelTier
}

export interface AIResponse {
  text: string
  stopReason: 'end_turn' | 'max_tokens' | string
  usage?: AIUsage
}

// ── Model mapping ────────────────────────────────────────────────────────────

const MODEL_MAP: Record<AIProvider, Record<ModelTier, string>> = {
  // Anthropic tier→model is the single source of truth in lib/usageRates.ts
  // (TIER_DEFAULT_MODEL) so cost estimation and live calls can never drift.
  anthropic: TIER_DEFAULT_MODEL,
  openai: {
    fast:     'gpt-4o-mini',
    standard: 'gpt-4o',
    advanced: 'gpt-4o',
  },
  'azure-openai': {
    fast:     'gpt-4o-mini',
    standard: 'gpt-4o',
    advanced: 'gpt-4o',
  },
}

// ── Default max tokens per tier ──────────────────────────────────────────────

const DEFAULT_MAX_TOKENS: Record<ModelTier, number> = {
  fast: 350,
  standard: 4000,
  advanced: 3500,
}

// ── Provider resolution ──────────────────────────────────────────────────────

function getEnvKey(provider: AIProvider): string {
  switch (provider) {
    case 'anthropic':    return process.env.ANTHROPIC_API_KEY || ''
    case 'openai':       return process.env.OPENAI_API_KEY || ''
    case 'azure-openai': return process.env.AZURE_OPENAI_API_KEY || ''
  }
}

interface ResolvedProvider {
  provider: AIProvider
  apiKey: string
  azureEndpoint?: string
  azureApiVersion: string
  model: string
}

function resolveProvider(opts: AIRequestOptions): ResolvedProvider {
  // Priority 1: explicit providerConfig
  if (opts.providerConfig) {
    const p = opts.providerConfig
    return {
      provider: p.provider,
      apiKey: p.apiKey || getEnvKey(p.provider),
      azureEndpoint: p.azureEndpoint || process.env.AZURE_OPENAI_ENDPOINT,
      azureApiVersion: p.azureApiVersion || process.env.AZURE_OPENAI_API_VERSION || '2024-02-01',
      model: opts.modelOverride || MODEL_MAP[p.provider][opts.tier],
    }
  }

  // Priority 2: user-provided API key — detect provider from env or default to anthropic
  const envProvider = (process.env.AI_PROVIDER || 'anthropic') as AIProvider
  const key = opts.apiKey || getEnvKey(envProvider)

  return {
    provider: envProvider,
    apiKey: key,
    azureEndpoint: process.env.AZURE_OPENAI_ENDPOINT,
    azureApiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-02-01',
    model: opts.modelOverride || MODEL_MAP[envProvider][opts.tier],
  }
}

// ── Request builders ─────────────────────────────────────────────────────────

// Render a string-or-blocks system prompt for Anthropic (preserves cache markers)
function anthropicSystem(system: string | SystemBlock[] | undefined) {
  if (!system) return undefined
  if (typeof system === 'string') return system
  return system.map(b => b.cache
    ? { type: 'text', text: b.text, cache_control: { type: 'ephemeral' } }
    : { type: 'text', text: b.text })
}

// Flatten string-or-blocks to a single string for providers without prompt caching
function flattenSystem(system: string | SystemBlock[] | undefined): string | undefined {
  if (!system) return undefined
  if (typeof system === 'string') return system
  return system.map(b => b.text).join('\n\n')
}

function buildAnthropicRequest(resolved: ResolvedProvider, opts: AIRequestOptions) {
  const sys = anthropicSystem(opts.system)
  return {
    url: 'https://api.anthropic.com/v1/messages',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': resolved.apiKey,
      'anthropic-version': '2023-06-01',
    } as Record<string, string>,
    body: {
      model: resolved.model,
      max_tokens: opts.maxTokens || DEFAULT_MAX_TOKENS[opts.tier],
      ...(sys ? { system: sys } : {}),
      messages: opts.messages,
    },
  }
}

function buildOpenAIRequest(resolved: ResolvedProvider, opts: AIRequestOptions) {
  const sys = flattenSystem(opts.system)
  const messages: Array<{ role: string; content: MessageContent }> = []
  if (sys) messages.push({ role: 'system', content: sys })
  messages.push(...opts.messages)

  return {
    url: 'https://api.openai.com/v1/chat/completions',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${resolved.apiKey}`,
    } as Record<string, string>,
    body: {
      model: resolved.model,
      max_tokens: opts.maxTokens || DEFAULT_MAX_TOKENS[opts.tier],
      messages,
    },
  }
}

function buildAzureRequest(resolved: ResolvedProvider, opts: AIRequestOptions) {
  const endpoint = resolved.azureEndpoint
  if (!endpoint) throw new Error('AZURE_OPENAI_ENDPOINT is required for azure-openai provider')

  const sys = flattenSystem(opts.system)
  const messages: Array<{ role: string; content: MessageContent }> = []
  if (sys) messages.push({ role: 'system', content: sys })
  messages.push(...opts.messages)

  const base = endpoint.replace(/\/$/, '')

  return {
    url: `${base}/openai/deployments/${resolved.model}/chat/completions?api-version=${resolved.azureApiVersion}`,
    headers: {
      'Content-Type': 'application/json',
      'api-key': resolved.apiKey,
    } as Record<string, string>,
    body: {
      max_tokens: opts.maxTokens || DEFAULT_MAX_TOKENS[opts.tier],
      messages,
    },
  }
}

// ── Response parsers ─────────────────────────────────────────────────────────

function parseAnthropicResponse(data: any, model: string, tier: ModelTier): AIResponse {
  const text = (data.content || [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text || '')
    .join('')
  const u = data.usage || {}
  return {
    text,
    stopReason: data.stop_reason === 'max_tokens' ? 'max_tokens' : 'end_turn',
    usage: {
      input_tokens: u.input_tokens || 0,
      output_tokens: u.output_tokens || 0,
      cache_read_tokens: u.cache_read_input_tokens || 0,
      cache_creation_tokens: u.cache_creation_input_tokens || 0,
      model,
      provider: 'anthropic',
      tier,
    },
  }
}

function parseOpenAIResponse(data: any, model: string, tier: ModelTier): AIResponse {
  const choice = data.choices?.[0]
  const u = data.usage || {}
  return {
    text: choice?.message?.content || '',
    stopReason: choice?.finish_reason === 'length' ? 'max_tokens' : 'end_turn',
    usage: {
      input_tokens: u.prompt_tokens || 0,
      output_tokens: u.completion_tokens || 0,
      cache_read_tokens: u.prompt_tokens_details?.cached_tokens || 0,
      cache_creation_tokens: 0,
      model,
      provider: 'openai',
      tier,
    },
  }
}

// ── Main export ──────────────────────────────────────────────────────────────

export async function callAI(opts: AIRequestOptions): Promise<AIResponse> {
  // Per-org AI gate. Three modes:
  //   off       → throw AIDisabledError (no outbound vendor call, full stop)
  //   byo       → force providerConfig to the customer's provider + key,
  //               overriding any explicit opts.apiKey the caller passed
  //   platform  → fall through to env-key resolution (current default)
  // The org check runs unconditionally when usage.org_id is set, even if
  // the caller passed an explicit apiKey — otherwise export routes that
  // hardcode ANTHROPIC_API_KEY would bypass both the off gate AND the
  // BYOK redirect. Cached per-org for 60s in lib/aiKey.
  let effective = opts
  if (opts.usage?.org_id) {
    const { resolveOrgAiConfig, AIDisabledError } = await import('@/lib/aiKey')
    const cfg = await resolveOrgAiConfig(opts.usage.org_id)
    if (cfg.mode === 'off') throw new AIDisabledError(opts.usage.org_id)
    if (cfg.mode === 'byo' && cfg.key) {
      effective = {
        ...opts,
        apiKey: undefined,
        providerConfig: { provider: cfg.provider, apiKey: cfg.key },
      }
    }
  }
  const resolved = resolveProvider(effective)

  if (!resolved.apiKey) {
    throw new Error(`No API key configured for provider: ${resolved.provider}`)
  }

  // Build provider-specific request
  let url: string
  let headers: Record<string, string>
  let body: any

  switch (resolved.provider) {
    case 'anthropic': {
      const r = buildAnthropicRequest(resolved, opts)
      url = r.url; headers = r.headers; body = r.body
      break
    }
    case 'openai': {
      const r = buildOpenAIRequest(resolved, opts)
      url = r.url; headers = r.headers; body = r.body
      break
    }
    case 'azure-openai': {
      const r = buildAzureRequest(resolved, opts)
      url = r.url; headers = r.headers; body = r.body
      break
    }
  }

  // Execute with timeout
  const timeoutMs = opts.timeoutMs || 15000
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!response.ok) {
    let errMsg = `AI API error: ${response.status}`
    try {
      const errData = await response.json()
      errMsg = errData?.error?.message || errMsg
    } catch { /* ignore */ }
    // Out-of-credit / quota failures feed the service-credit monitor. These
    // vendors expose no balance API (tier-2), so a failed call is the only
    // signal we get. anthropic → 'anthropic'; openai/azure → 'openai'.
    if (isCreditError(response.status, errMsg)) {
      void recordCreditError(resolved.provider === 'anthropic' ? 'anthropic' : 'openai', {
        code: response.status, message: errMsg,
      })
    }
    const err = new Error(errMsg) as any
    err.status = response.status
    throw err
  }

  const data = await response.json()

  // Parse response based on provider
  const result = resolved.provider === 'anthropic'
    ? parseAnthropicResponse(data, resolved.model, opts.tier)
    : parseOpenAIResponse(data, resolved.model, opts.tier)

  // Auto-log usage if context provided
  if (opts.usage && result.usage) {
    try {
      const { logUsage } = require('@/lib/usageLog')
      logUsage(opts.usage, result.usage)
    } catch {}
  }

  return result
}
