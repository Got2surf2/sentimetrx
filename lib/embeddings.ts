import 'server-only'

// lib/embeddings.ts
// OpenAI text-embedding-3-small wrapper for vector search.
//
// Per-org AI mode is enforced here:
//   off    → returns null/null-array (caller already handles "no embedding available")
//   byo + openai → uses the customer's OpenAI key
//   byo + anthropic → falls back to platform OPENAI_API_KEY (Anthropic has
//                     no equivalent endpoint; we eat the cost so semantic
//                     search keeps working)
//   platform → platform OPENAI_API_KEY
//
// orgId is intentionally REQUIRED (typed string | undefined): pass `undefined`
// only from admin-only / platform-only paths that genuinely have no tenant.

import { resolveOrgAiConfig } from '@/lib/aiKey'
import { logUsage } from '@/lib/usageLog'

const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_DIMS = 1536

// Log the OpenAI embedding spend to usage_logs (this path bypasses callAI, so it
// was previously invisible to cost accounting). input_tokens = prompt_tokens
// from OpenAI's response; embeddings have no output/cache tokens.
function logEmbeddingUsage(orgId: string | undefined, promptTokens: number): void {
  if (!promptTokens || promptTokens <= 0) return
  logUsage(
    { org_id: orgId, resource_type: 'system', event_type: 'embedding' },
    { input_tokens: promptTokens, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, model: EMBEDDING_MODEL, provider: 'openai', tier: 'fast' },
  )
}

async function resolveOpenAIKey(orgId: string | undefined): Promise<string | null> {
  if (orgId) {
    const cfg = await resolveOrgAiConfig(orgId)
    if (cfg.mode === 'off') return null
    if (cfg.mode === 'byo' && cfg.provider === 'openai' && cfg.key) return cfg.key
    // mode='byo' + provider='anthropic': platform absorbs OpenAI cost.
  }
  return process.env.OPENAI_API_KEY || null
}

/** Generate embedding for a single text string. Returns null if AI disabled or no key. */
export async function generateEmbedding(text: string, orgId: string | undefined): Promise<number[] | null> {
  const key = await resolveOpenAIKey(orgId)
  if (!key) return null

  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text.slice(0, 8000), dimensions: EMBEDDING_DIMS }),
  })

  if (!res.ok) {
    console.error('[embeddings] OpenAI error:', res.status, await res.text().catch(function() { return '' }))
    return null
  }

  const data = await res.json()
  logEmbeddingUsage(orgId, data.usage?.prompt_tokens || 0)
  return data.data?.[0]?.embedding || null
}

/** Generate embeddings for multiple texts in one batch call. Returns array aligned with input (null for failures). */
export async function generateEmbeddings(texts: string[], orgId: string | undefined): Promise<(number[] | null)[]> {
  const key = await resolveOpenAIKey(orgId)
  if (!key) return texts.map(function() { return null })
  if (texts.length === 0) return []

  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts.map(function(t) { return t.slice(0, 8000) }), dimensions: EMBEDDING_DIMS }),
  })

  if (!res.ok) {
    console.error('[embeddings] OpenAI batch error:', res.status, await res.text().catch(function() { return '' }))
    return texts.map(function() { return null })
  }

  const data = await res.json()
  logEmbeddingUsage(orgId, data.usage?.prompt_tokens || 0)
  const embeddings: (number[] | null)[] = texts.map(function() { return null })
  if (data.data && Array.isArray(data.data)) {
    for (var i = 0; i < data.data.length; i++) {
      var item = data.data[i]
      if (item.embedding && typeof item.index === 'number') {
        embeddings[item.index] = item.embedding
      }
    }
  }
  return embeddings
}
