import 'server-only'

// lib/moderation.ts
// OpenAI Moderation API wrapper for social comment toxicity scoring.
// Free endpoint, no rate-limit concerns at our volume.
// Returns per-comment category scores that feed into the tagging pipeline.
//
// Per-org AI mode is enforced here (same rules as lib/embeddings.ts):
//   off    → returns empty scores (caller treats as "no moderation signal")
//   byo + openai → uses the customer's OpenAI key
//   byo + anthropic → falls back to platform OPENAI_API_KEY (we eat the cost)
//   platform → platform OPENAI_API_KEY

import { resolveOrgAiConfig } from '@/lib/aiKey'

export interface ModerationScore {
  toxicity: number       // harassment + hate combined peak
  threat: number         // violence + violence/graphic
  sexual: number         // sexual + sexual/minors
  selfHarm: number       // self-harm + self-harm/intent + self-harm/instructions
  identity: number       // hate + hate/threatening
  categories: string[]   // which categories flagged (above threshold)
}

async function resolveOpenAIKey(orgId: string | undefined): Promise<string | null> {
  if (orgId) {
    const cfg = await resolveOrgAiConfig(orgId)
    if (cfg.mode === 'off') return null
    if (cfg.mode === 'byo' && cfg.provider === 'openai' && cfg.key) return cfg.key
  }
  return process.env.OPENAI_API_KEY || null
}

export async function moderateTexts(texts: string[], orgId: string | undefined): Promise<ModerationScore[]> {
  const key = await resolveOpenAIKey(orgId)
  if (!key || texts.length === 0) return texts.map(() => emptyScore())

  // OpenAI moderation accepts an array of strings
  // Retry with backoff on rate limits
  var res: Response | null = null
  for (var attempt = 0; attempt < 3; attempt++) {
    res = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: texts }),
    })
    if (res.ok || res.status !== 429) break
    var wait = (attempt + 1) * 2000
    await new Promise(r => setTimeout(r, wait))
  }

  if (!res || !res.ok) {
    console.error('[moderation] OpenAI error:', res?.status, res ? await res.text() : 'no response')
    return texts.map(() => emptyScore())
  }

  const data = await res.json()
  return (data.results || []).map((r: any) => {
    const s = r.category_scores || {}
    const cats: string[] = []
    if (r.categories) {
      for (const [k, v] of Object.entries(r.categories)) {
        if (v) cats.push(k)
      }
    }
    return {
      toxicity: Math.max(s['harassment'] || 0, s['harassment/threatening'] || 0, s['hate'] || 0),
      threat: Math.max(s['violence'] || 0, s['violence/graphic'] || 0),
      sexual: Math.max(s['sexual'] || 0, s['sexual/minors'] || 0),
      selfHarm: Math.max(s['self-harm'] || 0, s['self-harm/intent'] || 0, s['self-harm/instructions'] || 0),
      identity: Math.max(s['hate'] || 0, s['hate/threatening'] || 0),
      categories: cats,
    } as ModerationScore
  })
}

function emptyScore(): ModerationScore {
  return { toxicity: 0, threat: 0, sexual: 0, selfHarm: 0, identity: 0, categories: [] }
}
