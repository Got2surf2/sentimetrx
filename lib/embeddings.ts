import 'server-only'

// lib/embeddings.ts
// OpenAI text-embedding-3-small wrapper for vector search
// Falls back gracefully when no OPENAI_API_KEY is set

const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_DIMS = 1536

/** Generate embedding for a single text string. Returns null if no API key. */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  const key = process.env.OPENAI_API_KEY
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
  return data.data?.[0]?.embedding || null
}

/** Generate embeddings for multiple texts in one batch call. Returns array aligned with input (null for failures). */
export async function generateEmbeddings(texts: string[]): Promise<(number[] | null)[]> {
  const key = process.env.OPENAI_API_KEY
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
