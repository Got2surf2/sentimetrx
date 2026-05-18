/* eslint-disable */
// Ingest NOWOCATS PM-2 postcard (Meeting Notice #2 — June 16, 2026) into Sarina's knowledge base
// AND replace the stale "Spring 2026 TBD" Q&A chunk with the verified June 16, 2026 date.
// Run: node_modules/.bin/tsx scripts/_ingest_nowocats_pm2_postcard.ts

import { readFileSync } from 'fs'
import path from 'path'

const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

import { createClient } from '@supabase/supabase-js'

const BOT_ID = '5c468b90-13fc-46a2-8855-312dc0a1e428'
const SOURCE = 'NOWOCATS Community Meeting #2 Postcard (Meeting Notice No. 2)'
const SOURCE_TYPE = 'meeting_materials'

const PM2_MARKDOWN = `
## Community Meeting #2 — Date, Time, and Location

The NOWOCATS Community Meeting #2 will be held on **Monday, June 16, 2026, from 6:00 to 8:00 PM** at the **Apopka Community Center, 519 S Central Avenue, Apopka, FL 32703**.

The meeting will begin with an open house at 6:00 PM to allow attendees to view the meeting materials. The formal presentation begins promptly at 6:30 PM and is followed by a public comment period.

Unlike Community Meeting Series #1 (which had two identical meeting nights — January 26 and January 28, 2026 — at two different locations), Community Meeting #2 is a single meeting at one venue.

All meeting materials, including the presentation, will be available before the meeting on the project website at www.NOWOCATS.com.

## Purpose of Community Meeting #2

The purpose of this meeting — the second of two community meetings in the NOWOCATS study — is to present the findings and recommendations of the proposed future-year 2050 transportation needs plan, and to obtain attendee feedback on those initial recommendations.

The types of recommendations being considered include:
- Roadway widening
- New roadways
- Safety improvements
- Intersection improvements
- Pedestrian and bicycle improvements
- Transit improvements

Whereas Community Meeting #1 (January 2026) focused on presenting existing traffic conditions and the 2050 traffic forecasts, Community Meeting #2 is about what should be done about those conditions.

## How to Get Help Attending the June 16 Meeting (Translation, ADA)

The June 16, 2026 NOWOCATS Community Meeting #2 is open to the public without regard to race, color, national origin, age, sex, religion, income, disability, or familial status.

If you need language translation or interpretive services (provided at no cost), contact Orange County Title VI/Nondiscrimination Coordinator Natalia Garcia at 407-836-7334 or natalia.garcia@ocfl.net **at least seven (7) days before the meeting** (so on or before June 9, 2026).

If you need ADA accommodations under the Americans with Disabilities Act of 1990, contact County ADA Coordinator Nicola Norton at 407-836-6568 or nicola.norton@ocfl.net **at least seven (7) days before the meeting** (so on or before June 9, 2026).
`

function chunkText(md: string): Array<{ title: string; content: string }> {
  const chunks: Array<{ title: string; content: string }> = []
  const sections = md.split(/\n## /).filter(Boolean)
  for (let i = 0; i < sections.length; i++) {
    let section = sections[i].trim()
    if (i === 0 && section.startsWith('## ')) section = section.slice(3)
    const newlineIdx = section.indexOf('\n')
    if (newlineIdx === -1) continue
    const title = section.slice(0, newlineIdx).trim()
    const content = section.slice(newlineIdx + 1).trim()
    if (title && content) chunks.push({ title, content })
  }
  return chunks
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
  })
  if (!res.ok) throw new Error(`Embeddings API ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.data.map((d: any) => d.embedding as number[])
}

const REPLACEMENT_NEXT_MEETING = `**Question:** When is the next community meeting?

**Response:** Community Meeting #2 will be held on **Monday, June 16, 2026, from 6:00 to 8:00 PM** at the **Apopka Community Center, 519 S Central Avenue, Apopka, FL 32703**. Doors open at 6:00 PM for an open house with meeting materials; the formal presentation begins at 6:30 PM, followed by a public comment period. This is the second and final scheduled community meeting in the NOWOCATS study; it will present the proposed 2050 transportation needs plan and gather public feedback on the initial recommendations. Meeting materials will be available on www.NOWOCATS.com beforehand.`

async function main() {
  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // ---------- Part 1: Ingest the PM-2 postcard chunks ----------
  const allChunks = chunkText(PM2_MARKDOWN)
  console.log(`PM-2 postcard chunked into ${allChunks.length} sections`)

  const { data: existing, error: exErr } = await service
    .from('bot_knowledge_chunks')
    .select('title, content, metadata')
    .eq('bot_id', BOT_ID)
  if (exErr) throw exErr

  const existingKeys = new Set(
    (existing ?? [])
      .filter((r: any) => (r.metadata?.source ?? '') === SOURCE)
      .map((r: any) => `${r.title}|${(r.content || '').slice(0, 200)}`)
  )
  const toInsert = allChunks.filter(c => !existingKeys.has(`${c.title}|${c.content.slice(0, 200)}`))
  console.log(`After dedup: ${toInsert.length} new chunks to insert`)

  if (toInsert.length > 0) {
    const rows = toInsert.map(c => ({
      bot_id: BOT_ID,
      title: c.title,
      content: c.content,
      metadata: { source: SOURCE, source_type: SOURCE_TYPE },
    }))
    const { data: inserted, error: insErr } = await service
      .from('bot_knowledge_chunks')
      .insert(rows)
      .select('id, title, content')
    if (insErr) throw insErr
    console.log(`Inserted ${inserted?.length ?? 0} PM-2 chunks`)

    const texts = (inserted ?? []).map(c => `${c.title}\n${c.content}`)
    const vecs = await embedBatch(texts)
    let embedded = 0
    for (let j = 0; j < (inserted ?? []).length; j++) {
      if (vecs[j]) {
        const { error: uErr } = await service
          .from('bot_knowledge_chunks')
          .update({ embedding: JSON.stringify(vecs[j]) })
          .eq('id', inserted![j].id)
        if (uErr) console.error(`Embed update failed for ${inserted![j].id}: ${uErr.message}`)
        else embedded++
      }
    }
    console.log(`Embedded ${embedded}/${inserted?.length ?? 0} PM-2 chunks`)
  } else {
    console.log('PM-2 chunks already present; skipping insert.')
  }

  // ---------- Part 2: Replace stale "next meeting" Q&A chunk ----------
  const { data: staleRows, error: staleErr } = await service
    .from('bot_knowledge_chunks')
    .select('id, title, content')
    .eq('bot_id', BOT_ID)
    .ilike('title', '%Next Community Meeting%')
  if (staleErr) throw staleErr

  if (staleRows && staleRows.length > 0) {
    for (const row of staleRows) {
      const vec = (await embedBatch([`${row.title}\n${REPLACEMENT_NEXT_MEETING}`]))[0]
      const { error: uErr } = await service
        .from('bot_knowledge_chunks')
        .update({ content: REPLACEMENT_NEXT_MEETING, embedding: JSON.stringify(vec) })
        .eq('id', row.id)
      if (uErr) throw uErr
      console.log(`Updated stale chunk: ${row.id} ("${row.title}")`)
    }
  } else {
    console.log('No stale "next meeting" Q&A chunk found.')
  }

  console.log('Done.')
}

main().catch(e => { console.error(e); process.exit(1) })
