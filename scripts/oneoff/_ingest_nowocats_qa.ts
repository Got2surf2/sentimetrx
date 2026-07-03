/* eslint-disable */
// One-off: ingest the NOWOCATS Community Meeting #1 Q&A Forum into Sarina's
// bot_knowledge_chunks. Mirrors the chunking + embedding pipeline used by
// app/api/bots/[id]/knowledge/route.ts (## headings -> chunks, OpenAI
// text-embedding-3-small for vectors).
//
// Run: node_modules/.bin/tsx scripts/_ingest_nowocats_qa.ts

import { readFileSync } from 'fs'
import path from 'path'

// Load env vars before anything that needs them
const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '')
}

import { createClient } from '@supabase/supabase-js'

const BOT_ID = '5c468b90-13fc-46a2-8855-312dc0a1e428' // Sarina (slug=sarina, org=Datanautix)
const SOURCE = 'NOWOCATS Community Meeting #1 Q&A Forum'
const SOURCE_TYPE = 'qa_forum'

// Each ## heading becomes one chunk. Content includes question + response so
// semantic search matches on both. Topic prefix in the title gives context.
const MARKDOWN = `## About this Q&A
This is a summary of resident questions and project-team responses from the first NOWOCATS Community Meeting series, held on Monday, January 26, 2026, and Wednesday, January 28, 2026. Comments were received in several forms — written comment forms, verbal comments after live presentations, emails, and website entries. Comments received through February 6, 2026, are included here. Comments received after February 6 will be recorded as part of the study record.

## Project Overview — Timeline and Study Area Definition
**Question:** What is the overall project timeline, and how was the study area defined? Are known congestion and safety problem areas included? (Specifically congestion issues near Wild Oaks development and the new Orange County Park; and pedestrian safety concerns near Sadler Road and US 441 intersection.)

**Response:** An existing conditions inventory is currently underway, with future conditions to be evaluated in later phases of the study. Approved developments from recent years are being incorporated into the analysis to establish baseline and future traffic conditions. Additional findings and potential improvements will be presented at future community meetings, and public input will continue to be considered throughout the study.

In coordination with Commissioner Moore and inspired by the recently completed North East Orange County Areawide Transportation Study (NEOCATS), the study area encompasses the northwest portion of Orange County and includes the majority of District 2.

While the existing conditions inventory and analysis for the study are extensive, the purpose of this first meeting series is to get local input on other known congestion and safety problem areas for further consideration as part of the study. We will look further into the specific locations identified from local feedback.

## Project Overview — When the Study Began
**Question:** When did this planning study begin, and could growth-related impacts have been addressed earlier?

**Response:** The study officially began in 2025, with preliminary discussions occurring about a year prior. Transportation improvements are closely tied to development timing, impact fees, and evolving growth patterns, which influence when projects can be implemented.

## Traffic Forecasting — Verification After Development (Harmon and Binion)
**Question:** Are traffic projections verified after development occurs, and how does this align with safety goals such as reducing fatalities? (Specifically area near Harmon and Binion.)

**Response:** Transportation agencies conduct studies both before and after development, including pre-development traffic analysis and ongoing monitoring of roadways and intersections. These efforts help identify safety concerns and establish priorities for improvements. If residents raise concerns, locations may be studied further and monitored over time to inform future projects. We will look further into the specific locations identified from local feedback.

## Traffic Forecasting — Are Traffic Studies Required for New Developments
**Question:** Are traffic studies required prior to approving new developments, and how can the public access these studies?

**Response:** Traffic studies are typically required as part of the development review process for new subdivisions and major developments. These studies are reviewed by the lead jurisdiction during project evaluation. Opportunities to view public documents vary by project, and information on approved developments is available through County planning and public records processes.

## Traffic Forecasting — Why Development Continues When Infrastructure Lags
**Question:** Why does development continue when infrastructure appears to lag behind?

**Response:** Transportation improvements are influenced by multiple factors, including development timing, impact fees, and funding availability. Community members are encouraged to engage with elected officials regarding growth and infrastructure policies.

## Traffic Forecasting — Truck Traffic from Industrial Development (US 441)
**Question:** How is truck traffic from existing or future industrial development considered, particularly where congestion is already a concern? (Specifically along US 441.)

**Response:** This is one of several factors the County monitors as part of the overall evaluation process. Truck percentages and traffic from approved but not-yet-built developments are evaluated as part of traffic forecasting. Expected traffic from these developments is included in future projects and roadway performance assessments.

## Roadway Improvements — What Widening Involves
**Question:** What does roadway widening involve, and how are decisions made about adding lanes?

**Response:** This study will identify roadways that have a need for added capacity, and document it in the needs plan. Each project will go through a project development life cycle. If a particular roadway is recommended for widening, a study will be performed to analyze that roadway in more detail. Multiple widening alternatives will be developed and compared to determine the most feasible solution. The overall process will involve evaluating the transportation network, followed by detailed design and ultimately construction.

## Roadway Improvements — Cost of Widening Existing Roads
**Question:** Does widening a roadway mean simply adding lanes to the existing road, with cost for just the additional lanes?

**Response:** No. Widening typically requires full reconstruction of the roadway, including drainage system to meet current design standards. While there are cost savings for widening an existing roadway over a newly constructed roadway, the cost for the widening includes reconstruction of the existing road.

## Roadway Improvements — Kelly Park Road Timeline
**Question:** What is the timeline for design and construction of improvements on Kelly Park Road west of Plymouth Sorrento Road?

**Response:** A funding agreement is in place for the construction of the segment from Kelly Park Road to Waypointe Boulevard. The design phase is approximately 90% complete. Construction is expected to proceed following completion of final design activities.

## Roadway Improvements — Unpaved Roads (Foliage Way)
**Question:** Are improvements planned for unpaved roads that currently lack utilities or emergency access? (Specifically Foliage Way.)

**Response:** Orange County noted the request and will discuss it with the city staff.

## Funding — Near-Term vs. Long-Term Improvements
**Question:** Are near-term improvements already funded, and how will longer-term needs be addressed?

**Response:** Improvements programmed within the next five years are funded. Additional improvements identified through this study will be prioritized into short-, mid-, and long-term categories based on available funding. No funding has been identified at this stage of the study for the needs plan.

## Funding — Accelerating Improvements if Development Accelerates (Kelly Park Road)
**Question:** If development accelerates, can roadway improvements be moved up in the funding schedule? (Specifically Kelly Park Road, which has a portion planned for improvements in the five-year plan, but the remainder needs work sooner than long-term.)

**Response:** The existing conditions analysis identified a limited number of roadways operating at failing conditions, though others are expected to worsen over time without improvement. As government agencies, we must identify needs, review budgets, assess fees and funding sources, and collaborate across jurisdictions to address these challenges. Ongoing coordination with partner agencies will continue, and future meetings will provide additional information on funding strategies.

## Funding — If Major Funding Sources Change
**Question:** How would transportation projects be affected if major funding sources changed?

**Response:** If funding sources are altered, agencies would need to reassess budgets and re-evaluate project priorities.

## Funding — Traffic Safety Project Funding (ATSP)
**Question:** Is funding for traffic safety projects still active and can I make a request for safety improvements?

**Response:** Yes, the Accelerated Transportation Safety Program (ATSP) funding is still active, and the public can make requests for safety improvements to be incorporated into next year's budget.

## Right-of-Way Acquisition — Process
**Question:** How is right-of-way acquired for transportation projects?

**Response:** Once a public need is identified and approved by elected officials, coordination begins to advance the project, including right-of-way acquisition. This process can be challenging and follows a right-of-way acquisition process involving surveying, appraising property, and negotiating with owners based on fair market value.

## Lighting and Short-Term Safety — High School Traffic Areas
**Question:** Can lighting be implemented quickly to improve safety? (Specifically high school traffic areas.)

**Response:** Some improvements, such as lighting, can often be implemented faster than major roadway projects. These efforts are coordinated with utility providers and depend on available funding.

## Access and Connectivity — Neighborhood Circulation (Bear Island Lake)
**Question:** How will access and circulation issues for neighborhoods and the several new developments be addressed? (Specifically Bear Island Lake access.)

**Response:** Local agencies continue to coordinate with regional and state partners to improve connectivity. Many projects must be included in long-range transportation plans before funding can be secured. Due to funding constraints, it can be challenging to keep pace with the level of growth occurring in the area, as traffic demand may increase significantly by the time funding becomes available. Collaboration across agencies remains ongoing to address these challenges and advance improvements where feasible. We will look further into the specific locations identified from local feedback.

## Access and Connectivity — Welch Road / I-4 Conflict
**Question:** What improvements are planned for areas where access from neighborhoods conflict with heavy traffic volumes? (Specifically difficulty of exiting the development onto Welch Road, which conflicts with I-4 exiting traffic.)

**Response:** Orange County has recently conducted operational reviews at several key intersections to identify improvements that maximize efficiency within existing right-of-way. Larger improvements requiring additional right-of-way will take more time. These locations remain a priority, and agencies are continuing to coordinate on feasible near-term and long-term solutions.

## Access and Connectivity — Emergency Vehicle Access (US 441 from Boy Scout Road)
**Question:** Are there improvements planned to help emergency vehicles navigate congested corridors? (Specifically fire department attempting to travel on US 441 from Boy Scout Road.)

**Response:** Operational improvements such as Intelligent Transportation Systems (ITS) are being considered. These may allow emergency vehicles to pre-empt traffic signals to reduce delays when responding to incidents. We will look further into the specific locations identified from local feedback.

## Access and Connectivity — SR 429 Effect on Apopka Traffic
**Question:** Did major regional road projects reduce traffic through local communities as anticipated? (Specifically SR 429 reducing traffic passing through Apopka.)

**Response:** Some freight traffic was expected to divert; however, traffic patterns will continue to be evaluated to better understand outcomes and identify future needs.

## Community Involvement — Importance of Public Participation
**Question:** How important is public participation in transportation decisions? (Noted that in addition to events and community meetings, TransMAC meetings are another opportunity to provide local input.)

**Response:** Public participation is critical. Attending meetings, submitting comments, and engaging with elected officials helps agencies understand community priorities and informs decision-making, especially given funding and timing constraints. It is important to show up at meetings and events to better understand the planning process.

## Community Involvement — Next Community Meeting
**Question:** When is the next community meeting, and will there be updates on issues raised during this meeting series?

**Response:** The next community meeting is tentatively planned for Spring 2026. While an exact date has not been set, updates on previously raised topics are anticipated at that time.

## Community Involvement — How Input Is Used
**Question:** How will community input from these meetings be used, and are project decisions already determined?

**Response:** The purpose of these meetings is to share information, answer questions, and gather community input that will help inform future planning and decision-making. No final decisions have been made at this stage. Feedback received through these meetings is documented and considered as the study progresses to ensure the planning process and needs plan is meaningful and responsive to community concerns. Questions and concerns beyond the scope of this study are being forwarded to appropriate departments and agencies to continue engagement.

## Pedestrian and Bicycle Safety — High-Traffic Areas with Limited Facilities (Nelson Park, Sadler Road)
**Question:** What is being done to improve pedestrian and bicycle safety in areas with high traffic and limited facilities? (Specifically Nelson Park — no crosswalks over Park Avenue and Sadler Road where a new park is coming.)

**Response:** Several corridors have been identified as high priority for safety improvements. Ongoing and future studies will evaluate options such as crosswalks, sidewalks, bike facilities, and other safety enhancements, which will be reflected in the needs plan. We will look further into the specific locations identified from local feedback.

## Intersection Operations — Sadler Road
**Question:** Can specific intersections be recommended for improvements due to safety concerns? (Specifically Sadler Road.)

**Response:** Yes, we will look further into the specific locations identified from local feedback.

## Intersection Operations — Apopka Blvd / South Lake Pleasant Rd
**Question:** Can the intersection of Apopka Boulevard and South Lake Pleasant Road be converted from a two-way stop to a four-way stop to improve safety and address difficulties exiting South Lake Pleasant Road?

**Response:** A four-way stop may be considered as part of a broader operation and safety review. Based on documented crash patterns, additional safety measures — such as enhanced curve warning signage, flashing beacons, improved pavement markings, and lighting — may also be effective in improving driver awareness and nighttime visibility. Due to ongoing concerns about traffic gaps and access from South Lake Pleasant Road, this intersection will be included on the evaluation list for further review. Coordination with traffic engineering staff will occur as part of the assessment process.

## Intersection Operations — US 441 at Sadler Road
**Question:** What safety improvements are being considered for the areas along US 441 at Sadler Road, where residents have raised concerns about limited access, lack of pedestrian facilities, and recent crashes?

**Response:** US 441 is a state roadway, and coordination with the Florida Department of Transportation (FDOT) is required for any improvements. As part of this study, the County will coordinate with FDOT and review the concerns internally to determine appropriate next steps. The safety issues identified — including turning movements, signage, lighting, and pedestrian infrastructure — are valid and will be considered as the evaluation process moves forward.

## Intersection Operations — Golden Gem Road Widening (Jespersen Street)
**Question:** As part of the proposed widening of Golden Gem Road, will this study evaluate the need for a dedicated left-turn movement at Jespersen Street to prevent potential traffic bottlenecks as traffic volumes increase?

**Response:** This comment has been noted and will be shared with the City for review and consideration as part of their future planning and coordination efforts for the Golden Gem Road widening project.

## Environmental Protection — Lake Ola and the Wekiva Protection Zone
**Question:** How are environmental resources being protected as part of transportation planning? (Specifically Lake Ola and the surrounding natural resources, highlighting the impact of drainage on the lake.)

**Response:** The County acknowledges the importance of environmental protection in the area, noting that Lake Ola falls within the Wekiva Protection Zone, which has strict regulations and significant oversight. The existing environmental features have been cataloged as part of this study and are being considered on a broader level as the needs plan progresses and potential future projects are identified. Future phases will include detailed evaluation of drainage, natural resources, and regulatory compliance for specific corridors, as applicable.

## Environmental Protection — Welch Road Multi-Use Trail / Wekiwa Springs State Park
**Question:** What is the status of the proposed multi-use trail extension along Welch Road, and how are environmental impacts, particularly within Wekiwa Springs State Park, being addressed?

**Response:** The trail extension was evaluated as part of a previously completed study that included public outreach. NOWOCATS is focused on the broader project area and identifying needs and potential future projects. If the trail advances into design, additional public engagement will occur, and environmental considerations, including impacts to the state park, will be addressed in detail.

## Transit Opportunities — SunRail / Orange Blossom Express
**Question:** Are rail projects being considered for this area? (Specifically extending SunRail into Apopka.)

**Response:** The Orange Blossom Express was previously studied as a rail alternative by FDOT. However, the projected ridership, based on projected population growth, was not enough to support the funding requirements. The project remains in planning and could move forward if future growth increases potential ridership.
`

// ── Chunking (mirrors app/api/bots/[id]/knowledge/route.ts chunkText) ──
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

// ── Embedding via OpenAI directly (avoid 'server-only' import) ──
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

  // Verify bot exists
  const { data: bot, error: botErr } = await service.from('bots').select('id, name, slug, org_id').eq('id', BOT_ID).single()
  if (botErr || !bot) throw new Error(`Bot ${BOT_ID} not found: ${botErr?.message}`)
  console.log(`Target bot: ${bot.name} (slug=${bot.slug})`)

  const chunks = chunkText(MARKDOWN, SOURCE, SOURCE_TYPE)
  console.log(`Chunked into ${chunks.length} sections`)

  // Dedup against existing chunks for this bot
  const { data: existingChunks } = await service.from('bot_knowledge_chunks').select('content').eq('bot_id', BOT_ID)
  const existingSet = new Set((existingChunks || []).map((c: any) => c.content.trim()))
  const deduped = chunks.filter(c => !existingSet.has(c.content.trim()))
  console.log(`After dedup: ${deduped.length} new chunks (${chunks.length - deduped.length} already exist)`)

  if (deduped.length === 0) {
    console.log('Nothing to insert.')
    return
  }

  // Insert chunks
  const rows = deduped.map(c => ({ bot_id: BOT_ID, title: c.title, content: c.content, metadata: c.metadata }))
  const { data: inserted, error: insErr } = await service.from('bot_knowledge_chunks').insert(rows).select('id, title, content')
  if (insErr) throw new Error(`Insert failed: ${insErr.message}`)
  console.log(`Inserted ${inserted!.length} chunks`)

  // Generate + store embeddings
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
