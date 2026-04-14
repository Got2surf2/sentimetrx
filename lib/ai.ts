// lib/ai.ts
// Provider-agnostic AI abstraction layer.
// Supports Anthropic (default), OpenAI, and Azure OpenAI.
// All 18 AI call sites route through callAI() for consistent behavior.

// ── Types ────────────────────────────────────────────────────────────────────

export type AIProvider = 'anthropic' | 'openai' | 'azure-openai'
export type ModelTier = 'fast' | 'standard' | 'advanced'

export interface AIProviderConfig {
  provider: AIProvider
  apiKey?: string
  azureEndpoint?: string
  azureApiVersion?: string
}

export interface AIRequestOptions {
  tier: ModelTier
  system?: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  maxTokens?: number
  timeoutMs?: number
  providerConfig?: AIProviderConfig   // explicit override
  apiKey?: string                     // shorthand: user-provided key (uses env AI_PROVIDER)
}

export interface AIResponse {
  text: string
  stopReason: 'end_turn' | 'max_tokens' | string
}

// ── Model mapping ────────────────────────────────────────────────────────────

const MODEL_MAP: Record<AIProvider, Record<ModelTier, string>> = {
  anthropic: {
    fast:     'claude-haiku-4-5-20251001',
    standard: 'claude-sonnet-4-20250514',
    advanced: 'claude-sonnet-4-6',
  },
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
      model: MODEL_MAP[p.provider][opts.tier],
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
    model: MODEL_MAP[envProvider][opts.tier],
  }
}

// ── Request builders ─────────────────────────────────────────────────────────

function buildAnthropicRequest(resolved: ResolvedProvider, opts: AIRequestOptions) {
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
      ...(opts.system ? { system: opts.system } : {}),
      messages: opts.messages,
    },
  }
}

function buildOpenAIRequest(resolved: ResolvedProvider, opts: AIRequestOptions) {
  const messages: Array<{ role: string; content: string }> = []
  if (opts.system) messages.push({ role: 'system', content: opts.system })
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

  const messages: Array<{ role: string; content: string }> = []
  if (opts.system) messages.push({ role: 'system', content: opts.system })
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

function parseAnthropicResponse(data: any): AIResponse {
  const text = (data.content || [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text || '')
    .join('')
  return {
    text,
    stopReason: data.stop_reason === 'max_tokens' ? 'max_tokens' : 'end_turn',
  }
}

function parseOpenAIResponse(data: any): AIResponse {
  const choice = data.choices?.[0]
  return {
    text: choice?.message?.content || '',
    stopReason: choice?.finish_reason === 'length' ? 'max_tokens' : 'end_turn',
  }
}

// ── Main export ──────────────────────────────────────────────────────────────

export async function callAI(opts: AIRequestOptions): Promise<AIResponse> {
  const resolved = resolveProvider(opts)

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
    const err = new Error(errMsg) as any
    err.status = response.status
    throw err
  }

  const data = await response.json()

  // Parse response based on provider
  return resolved.provider === 'anthropic'
    ? parseAnthropicResponse(data)
    : parseOpenAIResponse(data)
}
