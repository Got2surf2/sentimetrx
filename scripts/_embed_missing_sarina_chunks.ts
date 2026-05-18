/* eslint-disable */
// One-off: backfill embeddings for any Sarina chunks that lack them.
// Run: node_modules/.bin/tsx scripts/_embed_missing_sarina_chunks.ts

import { readFileSync } from 'fs'
import path from 'path'

const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

import { createClient } from '@supabase/supabase-js'

const BOT_ID = '5c468b90-13fc-46a2-8855-312dc0a1e428'

async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY missing')
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
  })
  if (!res.ok) throw new Error(`Embeddings API ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.data.map((d: any) => d.embedding as number[])
}

async function main() {
  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: chunks, error } = await service
    .from('bot_knowledge_chunks')
    .select('id, title, content')
    .eq('bot_id', BOT_ID)
    .is('embedding', null)
  if (error) throw error
  if (!chunks || chunks.length === 0) { console.log('All chunks already embedded.'); return }

  console.log(`Embedding ${chunks.length} chunks...`)

  // Batch in groups of 50 to stay well under OpenAI request limits
  const BATCH = 50
  let embedded = 0
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH)
    const texts = batch.map(c => `${c.title}\n${c.content}`)
    const vecs = await embedBatch(texts)
    for (let j = 0; j < batch.length; j++) {
      if (vecs[j]) {
        const { error: uErr } = await service
          .from('bot_knowledge_chunks')
          .update({ embedding: JSON.stringify(vecs[j]) })
          .eq('id', batch[j].id)
        if (uErr) console.error(`Update failed for ${batch[j].id}: ${uErr.message}`)
        else embedded++
      }
    }
  }
  console.log(`Done. ${embedded}/${chunks.length} embeddings stored.`)
}

main().catch(e => { console.error(e); process.exit(1) })
