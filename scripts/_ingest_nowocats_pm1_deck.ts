/* eslint-disable */
// One-off: ingest the NOWOCATS PM-1 Community Meeting Presentation (44 slides)
// into Sarina's bot_knowledge_chunks. Sister to _ingest_nowocats_qa.ts.
// Run: node_modules/.bin/tsx scripts/_ingest_nowocats_pm1_deck.ts

import { readFileSync } from 'fs'
import path from 'path'

const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

import { createClient } from '@supabase/supabase-js'

const BOT_ID = '5c468b90-13fc-46a2-8855-312dc0a1e428'
const SOURCE = 'NOWOCATS PM-1 Community Meeting Presentation (Jan 26 & 28, 2026)'
const SOURCE_TYPE = 'pm1_presentation'

const MARKDOWN = `## About the PM-1 Community Meeting Presentation
This is the technical presentation delivered at the first NOWOCATS Community Meeting Series, held on January 26 and 28, 2026. Two meetings were held — Monday Jan 26 from 6:00–8:00 p.m. at Apopka Community Center (519 S Central Avenue, Apopka FL 32703) and Wednesday Jan 28 from 6:00–8:00 p.m. at Kelly Park School (4790 Jason Dwelley Parkway, Apopka FL 32712). The presentation covered seven topics: Welcome and Opening Remarks, Study Purpose and Objectives, Existing Conditions Evaluation, Programmed and Planned Improvements, Future Conditions Evaluation, Study Timeline, and Public Engagement. Opening remarks were delivered by District 2 Commissioner Christine Moore.

## Project Contacts
Orange County Project Contact: Hatem A. Abou-Senna, PhD., P.E., Project Manager, Transportation Planning Division, Orange County Public Works Department, 4200 John Young Parkway, Orlando, FL 32839. Email: Hatem.Abou-Senna@ocfl.net. Phone: (407) 836-8023. Fax: (407) 836-8079.

Consultant Project Contact: Babuji Ambikapathy, P.E., AICP, VHB, 225 E. Robinson Street, Suite 300, Landmark Center Two, Orlando, FL 32801. Email: BAmbikapathy@VHB.com. Phone: (407) 459-1630.

Project website: www.NOWOCATS.com

## Study Purpose
The Northwest Orange County Areawide Transportation Study (NOWOCATS) is being conducted to identify and prioritize potential transportation projects to support future growth in Northwest Orange County. The study has three objectives: improve network connectivity, provide relief to constrained corridors, and identify short-term, mid-term, and long-term improvements for all road users.

## Identifying Improvements — Balancing User Needs
NOWOCATS will document project need and balance the needs of all users across four dimensions: Safety, Mobility, Connectivity, and Accessibility. User types considered include trucks, transit/school buses, passenger vehicles, bicycles, pedestrians, and people using mobility aids.

## Study Process
NOWOCATS follows a five-step process: (1) Data Collection and Analysis, (2) Project Future Conditions, (3) Evaluate Future Conditions, (4) Public and Stakeholder Input, and (5) Develop Transportation Needs Plan. The process iterates — public and stakeholder input loops back into future-conditions evaluation before the needs plan is finalized.

## Study Area Overview
The NOWOCATS study area is in Northwest Orange County, with the City of Apopka as the core urban center. The study area encompasses the majority of District 2 and was defined in coordination with Commissioner Moore, inspired by the recently completed North East Orange County Areawide Transportation Study (NEOCATS).

Three parks anchor the study area: Wekiva Springs State Park, Kelly Park, and Kit Land Nelson Park. Major developments include the Sweetwater Country Club DRI (Development of Regional Impact) and the Kelly Park Interchange Form-Based Code Area. Other developments tracked include Kelly Park Crossing.

The study area also includes multiple Rural Settlements: Bridlepath RS, Clarcona RS, North Apopka / Wekiva RS, Otter Lake RS, Paradise Heights RS, Rainbow Ridge RS, Tangerine RS, Zellwood RS, and Zellwood Station RS.

The existing conditions analysis covers 44 intersections and 27 roadways.

## Cultural Resources in the Study Area
The study area contains 915 cultural-resource structures, 2 bridges, and 21 resource groups identified through the State Historic Preservation Office (SHPO). Five known resources are eligible for National Register listing. Cultural resources are concentrated around Lake Ola, Oak Tree Park, Rock Springs Ridge Golf Club, Wekiwa Swamp, Errol Estates Country Club, and South Apopka.

## Social Resources in the Study Area
Public facilities in the study area include: 10 police/fire stations, 32 health care facilities/hospitals, 112 religious centers, 39 schools, and 26 parks/natural lands. The study area also contains 36 utility-agency/owned lands and 21 conservation/public lands.

## Natural and Physical Resources
The study area has potential habitat for 54 protected wildlife species. It falls within the U.S. Fish and Wildlife Service (USFWS) Consultation Area for the Everglade Snail Kite, Florida Scrub Jay, Sand Skink, and Wood Stork (specifically core foraging area for three Wood Stork colonies). Six potential wildlife crossings or habitat-connectivity enhancements have been identified.

Wetlands total approximately 37,787.75 acres, including: the Wekiva River and its tributaries, Lake Apopka North Shore, Lakes Apopka, Bartho, Lerla, Lucie, Carlton, Ola, Prevatt, Alden, Prevatt, McCoy, Upper and Lower Lake Doe, Grassmere, Standish, Page, and Pleasant, Rock Springs and Rock Springs Run, and unnamed water systems.

The study area also includes 1,787 sites with known or potential contamination.

## Roadway Segment Operations (Existing Conditions)
Across the study area's roadway segments, current Level of Service (LOS) breaks down as: LOS A through C — 69%, LOS D — 22%, LOS E — 2%, LOS F — 8%.

Failing roadway segments (LOS E or F) include:
- Welch Road from Rock Springs Road to Wekiva Springs Road — LOS F
- Ocoee Apopka Road from West Road / Ocoee Crown Pointe Parkway to Binion Road — LOS E
- US 441 from SR 436 to Park Avenue — LOS F
- US 441 from Western Beltway to Plymouth Sorrento Road — LOS F
- Clarcona Road / Park Avenue from Gilliam Road to Keene Road — LOS F

## Intersection Operations (Existing Conditions)
Across the 44 study-area intersections, current LOS breaks down as: LOS A through C — 61%, LOS D — 20%, LOS E — 7%, LOS F — 11%.

Failing intersections (LOS F) include:
- US 441 and Piedmont Wekiwa Road
- US 441 and Central Avenue
- US 441 and West Orange Avenue
- US 441 and Sadler Road
- Piedmont Wekiwa Road and SR 436

## Bicycle Facilities — Existing Inventory
The study area has three types of bicycle facilities: Bicycle Lanes, Paved Shoulders, and Multi-use Paths. The study area does NOT have any Sharrows or Buffered Bike Lanes.

## Pedestrian Facilities — Existing Inventory
Pedestrian facilities in the study area are primarily Sidewalks, Curb/Grass treatments, and Paved Shoulders.

## Pedestrian Level of Traffic Stress (LTS) Analysis
Pedestrian LTS is a four-tier rating where LTS 1 is most comfortable for all users (children, elderly, mobility-aid users) and LTS 4 is suitable only for those with limited route or mode choices. Factors considered: presence of sidewalk, posted speed, and whether there is separation from the roadway.

In the NOWOCATS study area, the pedestrian LTS distribution is:
- LTS 1 — 0%
- LTS 2 — 10%
- LTS 3 — 27%
- LTS 4 — 63%

This means 63% of the pedestrian network is in the highest-stress category, suitable only for those with limited mode choices.

## Bicycle Level of Traffic Stress (LTS) Analysis
Bicycle LTS is a four-tier rating where LTS 1 is suitable for children and LTS 4 is tolerated only by cycling enthusiasts in stressful conditions. Factors considered: presence of bicycle facility, width of bicycle lane, separation, posted speed, and AADT (average annual daily traffic).

In the NOWOCATS study area, the bicycle LTS distribution is:
- LTS 1 — 5%
- LTS 2 — 0%
- LTS 3 — 5%
- LTS 4 — 90%

This means 90% of the bicycle network is in the highest-stress category — a significant barrier to making cycling a viable option for most residents.

## Transit Level of Service (LOS) Analysis
The majority of transit segments in the study area have an LOS of E or F. The two main drivers are: lack of bus routes (geographic gaps in coverage) and low service frequency where routes do exist.

## Transit Route Characteristics
Four LYNX bus routes serve the study area, with the following FY 2024 ridership and service frequency:
- Route 44 — 140,493 total annual riders, frequency every 60 minutes
- Route 106 — 434,914 total annual riders, frequency every 30 minutes
- Route 405 — 51,535 total annual riders, frequency every 60 minutes
- Route 436N — 324,572 total annual riders, frequency every 30 minutes

## Lighting Conditions
Roadway and intersection lighting was evaluated through a desktop review, looking at lighting spacing along segments and number of lights at intersections. The majority of intersections in the study area have 0–3 lights.

## ITS (Intelligent Transportation Systems) Features
Traffic signals in the study area are connected to the Regional Traffic Management Center. Most ITS-enabled signals use Miovision cellular connections for communication. Fiber-optic coverage exists mainly along key north–south corridors. The study area has Miovision Cameras (WiFi-linked) and CCTV Cameras at various locations.

## Historic Crash Analysis 2022–2024
Over the three-year period from 2022 to 2024, the NOWOCATS study area recorded 3,445 total crashes (combining roadways and intersections). The severity breakdown was:
- 20 fatalities
- 1,192 injury crashes
- 2,233 property-damage-only (PDO) crashes

Crashes by year — 2022: 30 serious injuries, 6 fatalities, 394 injury, 739 PDO. 2023: 27 serious injuries, 5 fatalities, 349 injury, 726 PDO. 2024: 23 serious injuries, 9 fatalities, 369 injury, 768 PDO.

Major crash types: Rear End, Left Turn, Sideswipe, and Angle.

Location split: 770 crashes (22.4%) occurred at intersections; 2,675 crashes (77.6%) occurred at mid-segments.

## Intersection Crash Hot Spots
Of the study area's intersections, 57% have a below-average crash rate and 43% have an above-average crash rate. The above-average intersections are concentrated along US 441 and the eastern portion of the study area.

## Roadway Segment Crash Hot Spots
Of the study area's roadway segments, 63% have a below-average crash rate and 37% have an above-average crash rate. The above-average segments include portions of US 441, Welch Road, and parts of the eastern study area.

## Fatal Crashes — Detailed Breakdown
The 20 fatal crashes recorded between 2022 and 2024 break down as:
- 18 vehicular fatalities (90%)
- 2 pedestrian fatalities (10%)

Leading fatal-crash types: Off Road, Head On, and Left Turn. 85% of fatal crashes occurred in low-light conditions (dark, dusk, or dawn).

Additional pedestrian fatal crashes occurred outside the 2022–2024 window: 6 in 2021 and 1 in 2025.

## Programmed Improvements
"Programmed" improvements are projects that have funding agreements in place and are moving through design or construction. Programmed improvements in the NOWOCATS study area include:
- W Kelly Park Road
- Sadler Road
- Golden Gem Road
- Effie Drive South
- Rock Springs Road (with intersection improvements)
- Ocoee-Apopka Road
- SR 429 / Binion Road Interchange (new interchange)
- Lakeville Road
- All American Boulevard Extension
- Kennedy Boulevard
- Crown Point Parkway Extension
- Clarcona-Ocoee Road

Improvement types in the programmed list include new 2-lane extensions, new 4-lane extensions, widening to 3 lanes, widening to 4 lanes, widening to 6 lanes, complete streets treatments, new roundabouts, new interchanges, and intersection improvements.

## Planned Improvements
"Planned" improvements are projects identified for the future that do not yet have funding agreements. Planned improvements in the NOWOCATS study area include:
- Mt Plymouth Road
- Golden Gem Road
- Kelly Park Road
- Sadler Road
- Jones Avenue
- Plymouth Sorrento Road
- Vick Road
- Ponkan Road
- Welch Road
- Wekiwa Springs Road
- Ocoee Apopka Road
- Clarcona Road
- Maitland Boulevard

Improvement types in the planned list include new 2-lane extensions, widening to 4 lanes, and widening to 6 lanes.

## 2050 No Build Roadway Segment Operations
"2050 No Build" projects what conditions look like in 2050 if ONLY the currently-programmed improvements get built (no additional planned improvements). Under that scenario, roadway segment LOS shifts dramatically worse:
- LOS A through C — 36% (down from 69% today)
- LOS D — 17%
- LOS E — 6%
- LOS F — 41% (up from 8% today)

So under No Build, 41% of segments would be at LOS F by 2050.

## 2050 Build Roadway Segment Operations
"2050 Build" projects what conditions look like in 2050 if BOTH the programmed AND the planned improvements get built. Under that scenario, roadway segment LOS holds up much better:
- LOS A through C — 55%
- LOS D — 16%
- LOS E — 7%
- LOS F — 22%

Compared to the No Build scenario, the Build scenario reduces LOS F segments from 41% to 22% — meaningful relief but still a significant share of the network operating at failing conditions.

## Future Year Needs Plan — Time Horizons
The needs plan organizes improvements into three time horizons:

Short-term — 2030 (low-cost improvements, Transportation Systems Management & Operations / TSM&O):
- Signal retiming
- Safety improvements
- New signals
- Lighting upgrades
- Low-cost multimodal improvements
- Turn lane extensions

Mid-term — 2040 (may need additional funding; can be constructed within 10–15 years):
- Multimodal improvements / Complete Streets
- Capacity improvements
- Access management
- ITS (Intelligent Transportation Systems)

Long-term — 2050 (major improvements, more than 20 years out):
- Innovative intersections
- Bus Rapid Transit (BRT)
- New roadways
- Transportation Demand Management (TDM)
- AV / CV scenarios (Autonomous Vehicle / Connected Vehicle)

## Project Schedule
The NOWOCATS schedule runs from spring 2025 through summer 2026:
- April–June 2025: Project Kick-Off, Data Collection & Analysis begin
- July–September 2025: Transportation Modeling
- October–December 2025: Evaluation of Scenarios & Needs Plan begins
- January 2026: First Community Meeting series (Jan 26 and Jan 28)
- March 2026: Second Community Meeting series
- May–June 2026: Local Planning Agency (LPA) and Board of County Commissioners (BCC) Workshops & Public Hearings
- May–July 2026: Final Report & Project Wrap Up

Environmental Analysis runs in parallel from April through August 2025.

## Public Engagement Opportunities
Residents and stakeholders can engage with NOWOCATS in four ways:
1. Attend Community Meetings (held in January and March 2026)
2. Visit the project website at www.NOWOCATS.com
3. Call or email the project contacts (Hatem Abou-Senna at Orange County, Babuji Ambikapathy at VHB)
4. Attend Local Planning Agency (LPA) and Board of County Commissioners (BCC) Hearings (May–June 2026)

The project website includes a study process overview, study schedule, project documents, and a "Submit Feedback" form. Public participation is voluntary and free; no member of the public will be excluded from participation in or denied benefits of any service on the basis of race, color, national origin, age, sex, religion, disability, or family status. Persons requiring special accommodations under the Americans with Disabilities Act (ADA) or persons who require language translation services should contact the project team in advance.
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

  const { data: bot, error: botErr } = await service.from('bots').select('id, name, slug').eq('id', BOT_ID).single()
  if (botErr || !bot) throw new Error(`Bot ${BOT_ID} not found: ${botErr?.message}`)
  console.log(`Target bot: ${bot.name} (slug=${bot.slug})`)

  const chunks = chunkText(MARKDOWN, SOURCE, SOURCE_TYPE)
  console.log(`Chunked into ${chunks.length} sections`)

  const { data: existingChunks } = await service.from('bot_knowledge_chunks').select('content').eq('bot_id', BOT_ID)
  const existingSet = new Set((existingChunks || []).map((c: any) => c.content.trim()))
  const deduped = chunks.filter(c => !existingSet.has(c.content.trim()))
  console.log(`After dedup: ${deduped.length} new chunks (${chunks.length - deduped.length} already exist)`)
  if (deduped.length === 0) { console.log('Nothing to insert.'); return }

  const rows = deduped.map(c => ({ bot_id: BOT_ID, title: c.title, content: c.content, metadata: c.metadata }))
  const { data: inserted, error: insErr } = await service.from('bot_knowledge_chunks').insert(rows).select('id, title, content')
  if (insErr) throw new Error(`Insert failed: ${insErr.message}`)
  console.log(`Inserted ${inserted!.length} chunks`)

  const texts = inserted!.map((c: any) => `${c.title}\n${c.content}`)
  const embeddings = await embedBatch(texts)
  let embedded = 0
  for (let i = 0; i < inserted!.length; i++) {
    if (embeddings[i]) {
      const { error } = await service.from('bot_knowledge_chunks').update({ embedding: JSON.stringify(embeddings[i]) }).eq('id', (inserted![i] as any).id)
      if (!error) embedded++
    }
  }
  console.log(`Stored embeddings for ${embedded}/${inserted!.length} chunks`)
  console.log('Done.')
}

main().catch(e => { console.error(e); process.exit(1) })
