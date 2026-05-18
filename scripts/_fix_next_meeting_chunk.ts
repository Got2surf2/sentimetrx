/* eslint-disable */
// Update the stale "Next Community Meeting" Q&A chunk with the confirmed March 2026 date.
// The original Q&A was answered before PM-2 was scheduled; the PM-1 deck (newer) confirms March 2026.
// Today (2026-05-18), both PM-1 and PM-2 have already happened — surface that fact too.

import { readFileSync } from 'fs'
import path from 'path'

const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

import { createClient } from '@supabase/supabase-js'

const BOT_ID = '5c468b90-13fc-46a2-8855-312dc0a1e428'

const NEW_CONTENT = `**Question:** When is the next community meeting, and will there be updates on issues raised during this meeting series?

**Response:** The NOWOCATS schedule includes two community meeting series. Series #1 was held January 26 and 28, 2026. Series #2 was held in March 2026. Both meeting series have now concluded. The project is heading to Local Planning Agency (LPA) and Board of County Commissioners (BCC) workshops and public hearings in May and June 2026. For specific upcoming hearing dates and to submit comments, visit www.NOWOCATS.com.`

async function embedOne(text: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: [text] }),
  })
  if (!res.ok) throw new Error(`Embeddings API ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.data[0].embedding
}

async function main() {
  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: rows, error } = await service
    .from('bot_knowledge_chunks')
    .select('id, title, content')
    .eq('bot_id', BOT_ID)
    .ilike('title', '%Next Community Meeting%')
  if (error) throw error
  if (!rows || rows.length === 0) { console.log('No matching chunk found.'); return }

  for (const row of rows) {
    console.log(`Updating chunk ${row.id} ("${row.title}")`)
    const newTitle = row.title
    const vec = await embedOne(`${newTitle}\n${NEW_CONTENT}`)
    const { error: uErr } = await service
      .from('bot_knowledge_chunks')
      .update({ content: NEW_CONTENT, embedding: JSON.stringify(vec) })
      .eq('id', row.id)
    if (uErr) throw uErr
    console.log(`  Updated and re-embedded.`)
  }
  console.log('Done.')
}

main().catch(e => { console.error(e); process.exit(1) })
