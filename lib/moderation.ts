// lib/moderation.ts
// OpenAI Moderation API wrapper for social comment toxicity scoring.
// Free endpoint, no rate-limit concerns at our volume.
// Returns per-comment category scores that feed into the tagging pipeline.

export interface ModerationScore {
  toxicity: number       // harassment + hate combined peak
  threat: number         // violence + violence/graphic
  sexual: number         // sexual + sexual/minors
  selfHarm: number       // self-harm + self-harm/intent + self-harm/instructions
  identity: number       // hate + hate/threatening
  categories: string[]   // which categories flagged (above threshold)
}

export async function moderateTexts(texts: string[]): Promise<ModerationScore[]> {
  const key = process.env.OPENAI_API_KEY
  if (!key || texts.length === 0) return texts.map(() => emptyScore())

  // OpenAI moderation accepts an array of strings
  const res = await fetch('https://api.openai.com/v1/moderations', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: texts }),
  })

  if (!res.ok) {
    console.error('[moderation] OpenAI error:', res.status, await res.text())
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
