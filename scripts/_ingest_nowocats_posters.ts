/* eslint-disable */
// One-off: ingest the NOWOCATS Meeting Notice + Programmed/Planned Improvements
// poster + plain-language LOS definitions (from the Existing / 2050 Build /
// 2050 No-Build Traffic Operations posters) into Sarina's bot_knowledge_chunks.
//
// LOS percentages themselves are already in the PM-1 deck ingestion; this
// script adds resident-friendly explainer chunks + meeting venue / contact
// details + Programmed-vs-Planned definitions that the PM-1 deck doesn't cover.
//
// Run: node_modules/.bin/tsx scripts/_ingest_nowocats_posters.ts

import { readFileSync } from 'fs'
import path from 'path'

const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '')
}

import { createClient } from '@supabase/supabase-js'

const BOT_ID = '5c468b90-13fc-46a2-8855-312dc0a1e428'
const SOURCE = 'NOWOCATS Community Meeting #1 Materials (Notice + Posters)'
const SOURCE_TYPE = 'meeting_materials'

const MARKDOWN = `## Community Meeting #1 — Notice and Logistics
The first NOWOCATS Community Meeting was held in two sessions in late January 2026, hosted by Orange County Mayor Jerry L. Demings and Commissioner Christine Moore.

**Session 1:** Monday, January 26, 2026 — Apopka Community Center, 519 S Central Avenue, Apopka.
**Session 2:** Wednesday, January 28, 2026 — Kelly Park School, 4700 Jason Dwelley Parkway.

Both sessions followed the same format: open house beginning at 6:00 PM, formal presentation at 6:30 PM. Project staff were available before and after the presentation to answer individual questions.

The project is identified in Orange County's Capital Improvement Program as CIP #5156.

## Study Area — Boundary Description
The NOWOCATS study area covers the northwest portion of Orange County. The boundaries are:
- **North:** the Orange / Lake County line and Orange / Seminole County line
- **South:** north of Clarcona-Ocoee Road
- **East:** the Orange / Seminole County line
- **West:** the Orange / Lake County line

This area includes 27 roadways and 44 intersections that were studied for the existing conditions evaluation, and was chosen in coordination with Commissioner Christine Moore and informed by the recently completed North East Orange County Areawide Transportation Study (NEOCATS) for the adjacent area.

## Accommodations — ADA Requests
Persons needing accommodations under the Americans with Disabilities Act (ADA) — for example, sign language interpretation, large-print materials, or other assistance — may contact:

**Nicola Norton**, Orange County Public Works — Engineering Division
Phone: 407-836-6568
Email: nicola.norton@ocfl.net

Requests should be submitted at least seven days in advance of a meeting whenever possible.

## Accommodations — Title VI / Language Assistance
Persons who require language assistance services, or who believe they have been excluded from participation, denied benefits, or otherwise subjected to discrimination under Title VI of the Civil Rights Act of 1964, may contact:

**Natalia Garcia**, Orange County Public Works — Title VI Coordinator
Phone: 407-836-7334
Email: natalia.garcia@ocfl.net

Orange County does not discriminate on the basis of race, color, national origin, age, sex, religion, disability, or family status.

## What Is Level of Service (LOS)? — Plain Language
Level of Service (LOS) is the way transportation engineers describe how efficiently a road or intersection moves traffic from the driver's perspective. It uses letter grades, similar to grades in school:

- **LOS A, B, and C** — Traffic is generally flowing smoothly with shorter delays. Drivers reach their destinations without significant interruption.
- **LOS D** — Busier conditions, with noticeable slowing and more frequent stops. Drivers can still get through, but the trip takes longer than under free-flow conditions.
- **LOS E** — Heavy congestion and longer delays. The road is operating at or near its capacity.
- **LOS F** — Very congested, stop-and-go traffic with long wait times. The road or intersection cannot handle the volume of vehicles trying to use it during peak periods.

LOS is used in NOWOCATS to describe today's conditions and to compare future scenarios (2050 No Build vs. 2050 Build) so the community can see where the biggest problems are and how proposed improvements would help.

## Programmed vs. Planned Improvements — Definitions
The study distinguishes between two categories of improvements:

**Programmed improvements** are projects that have moved into the short-term work program, usually within the next 5 years. These projects have already been assigned funding for design, right-of-way acquisition, and construction. They are committed and on schedule.

**Planned improvements** are projects that have been identified as needed in long-range transportation plans, typically looking 20 to 25 years into the future. They identify where roads, intersections, and safety projects are anticipated based on growth, safety, and congestion. Planned improvements do not yet have funding committed.

This distinction matters because near-term relief (programmed) and long-term vision (planned) are evaluated separately when projecting 2050 conditions.

## Types of Improvements Considered in NOWOCATS
The programmed and planned improvements identified in the study area fall into several categories:
- **Complete Streets** — roadways redesigned to safely accommodate vehicles, pedestrians, bicyclists, and transit.
- **New 2-Lane or 4-Lane Roadway Extensions** — building new road segments where none exist today to improve connectivity.
- **Roadway Widening** — adding capacity to existing roads (typically from 2 to 3, 2 to 4, or 4 to 6 lanes).
- **Intersection Improvements** — operational and geometric changes such as added turn lanes, signal modifications, or safety enhancements.
- **New Roundabouts** — replacing stop-controlled or signalized intersections with roundabouts where appropriate.
- **New Interchange** — most notably the planned SR 429 / Binion Road interchange.

## Roadways with Programmed or Planned Improvements
The following roadways within the NOWOCATS study area have improvements that are either programmed (next 5 years, funded) or planned (long-range, identified need): Maitland Boulevard, Sadler Road, Kelly Park Road, Golden Gem Road, Welch Road, Ocoee-Apopka Road, Clarcona Road, Mt. Plymouth Road, Plymouth-Sorrento Road, Vick Road, Ponkan Road, Jones Avenue, Lakeville Road, Rock Springs Road, Park Avenue North, Votaw Road, Sandpiper Street, Wekiwa Springs Road, All American Boulevard Extension, Clarcona-Ocoee Boulevard, Kennedy Boulevard, SR 434 / Forest City Road, Effie Drive, and Binion Road.

Note: identification as "programmed" or "planned" does not by itself guarantee construction; planned projects still require funding to be programmed.

## Existing Traffic Operations — Summary for Residents
The 2025 (existing) traffic analysis evaluated 27 roadway segments and 44 intersections in the study area. The results:

- About 69% of roadway segments operate at LOS A, B, or C (acceptable conditions).
- About 22% operate at LOS D (busier, but still functioning).
- About 2% operate at LOS E (heavy congestion).
- About 8% operate at LOS F (failing — stop-and-go, long delays).

Intersections show a similar but slightly tougher picture: 61% at LOS A-C, 20% at LOS D, 7% at LOS E, and 11% at LOS F.

Most of the study area is not yet in crisis today, but the failing segments and intersections — concentrated along Welch Road, around the US 441 corridor, and at several signalized intersections — are already creating real congestion for residents.

## 2050 No Build Traffic Operations — Summary for Residents
The 2050 No Build scenario projects what happens if no additional improvements beyond those already programmed (funded in the next 5 years) are made. The result is a significant deterioration:

- Only 36% of roadway segments would operate at LOS A, B, or C — down from 69% today.
- 17% would be at LOS D.
- 6% would be at LOS E.
- 41% would be at LOS F (failing).

Stated plainly: nearly half (47%) of study-area roadways would operate at LOS E or F by 2050 under the No Build scenario. This is the baseline that demonstrates why the Needs Plan matters.

## 2050 Build Traffic Operations — Summary for Residents
The 2050 Build scenario projects conditions if both the programmed improvements (funded in the next 5 years) and the planned improvements (long-range, identified in this study) are implemented. The result is meaningfully better than No Build:

- 55% of roadway segments would operate at LOS A, B, or C.
- 16% would be at LOS D.
- 7% would be at LOS E.
- 22% would be at LOS F.

Compared to No Build, the LOS F share is roughly cut in half (41% to 22%), and acceptable LOS A-C conditions rise from 36% to 55%. The Build scenario does not eliminate congestion in 2050 — growth is significant — but it materially reduces the share of failing roadways and is the basis for the Needs Plan recommendations.
`

function chunkText(text: string, source: string, sourceType: string) {
  const lines = text.split('\n')
  const chunks: { title: string; content: string; metadata: Record<string, any> }[] = []
  let currentTitle = 'General'
  let currentLines: string[] = []
  const baseMeta = { source, source_type: sourceType }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const headingMatch = line.match(/^#{2,4}\s+(.+)/)
    const isSeparator = /^-{3,}\s*$/.test(line)

    if (headingMatch || isSeparator) {
      if (currentLines.length > 0) {
        const content = currentLines.join('\n').trim()
        if (content.length >= 20) chunks.push({ title: currentTitle, content, metadata: { ...baseMeta } })
      }
      currentTitle = headingMatch ? headingMatch[1].replace(/\*\*/g, '').trim() : 'General'
      currentLines = []
    } else {
      currentLines.push(line)
    }
  }
  if (currentLines.length > 0) {
    const content = currentLines.join('\n').trim()
    if (content.length >= 20) chunks.push({ title: currentTitle, content, metadata: { ...baseMeta } })
  }
  return chunks
}

async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.warn('OPENAI_API_KEY not set — chunks will be inserted without embeddings (full-text fallback only).')
    return texts.map(() => null)
  }
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
  })
  if (!res.ok) {
    console.error('Embeddings API failed:', res.status, await res.text())
    return texts.map(() => null)
  }
  const data = await res.json()
  return data.data.map((d: any) => d.embedding as number[])
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) throw new Error('Missing SUPABASE env vars')
  const service = createClient(supabaseUrl, serviceKey)

  const { data: bot, error: botErr } = await service.from('bots').select('id, name, slug, org_id').eq('id', BOT_ID).single()
  if (botErr || !bot) throw new Error(`Bot ${BOT_ID} not found: ${botErr?.message}`)
  console.log(`Target bot: ${bot.name} (slug=${bot.slug})`)

  const chunks = chunkText(MARKDOWN, SOURCE, SOURCE_TYPE)
  console.log(`Chunked into ${chunks.length} sections`)

  const { data: existingChunks } = await service.from('bot_knowledge_chunks').select('content').eq('bot_id', BOT_ID)
  const existingSet = new Set((existingChunks || []).map((c: any) => c.content.trim()))
  const deduped = chunks.filter(c => !existingSet.has(c.content.trim()))
  console.log(`After dedup: ${deduped.length} new chunks (${chunks.length - deduped.length} already exist)`)

  if (deduped.length === 0) {
    console.log('Nothing to insert.')
    return
  }

  const rows = deduped.map(c => ({ bot_id: BOT_ID, title: c.title, content: c.content, metadata: c.metadata }))
  const { data: inserted, error: insErr } = await service.from('bot_knowledge_chunks').insert(rows).select('id, title, content')
  if (insErr) throw new Error(`Insert failed: ${insErr.message}`)
  console.log(`Inserted ${inserted!.length} chunks`)

  const texts = inserted!.map((c: any) => `${c.title}\n${c.content}`)
  const embeddings = await embedBatch(texts)
  let embedded = 0
  for (let i = 0; i < inserted!.length; i++) {
    if (embeddings[i]) {
      const { error } = await service.from('bot_knowledge_chunks')
        .update({ embedding: JSON.stringify(embeddings[i]) })
        .eq('id', (inserted![i] as any).id)
      if (error) console.error(`Embedding update failed for chunk ${(inserted![i] as any).id}: ${error.message}`)
      else embedded++
    }
  }
  console.log(`Stored embeddings for ${embedded}/${inserted!.length} chunks`)
  console.log('Done.')
}

main().catch(e => { console.error(e); process.exit(1) })
