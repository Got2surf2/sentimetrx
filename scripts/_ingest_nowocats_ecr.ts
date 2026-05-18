/* eslint-disable */
// One-off: ingest NOWOCATS Existing Conditions Report (Sept 2025) into Sarina's knowledge base.
// Run: node_modules/.bin/tsx scripts/_ingest_nowocats_ecr.ts

import { readFileSync } from 'fs'
import path from 'path'

const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

import { createClient } from '@supabase/supabase-js'

const BOT_ID = '5c468b90-13fc-46a2-8855-312dc0a1e428'
const SOURCE = 'NOWOCATS Existing Conditions Report (September 2025)'
const SOURCE_TYPE = 'study_report'

const ECR_MARKDOWN = `
## NOWOCATS Study Area Quick Facts

The Northwest Orange County Areawide Transportation Study (NOWOCATS) covers approximately 143.8 square miles in the northwest corner of Orange County, Florida. Most of the study area falls within the City of Apopka and unincorporated Orange County.

For the existing conditions analysis, the study team focused on 44 specific intersections and 27 roadway segments along the major corridors that move traffic through the area. These include US 441 / Orange Blossom Trail, SR 436 / Semoran Boulevard, Piedmont-Wekiwa Road, Wekiwa Springs Road, Plymouth Sorrento Road, N Park Avenue / Rock Springs Road, W Kelly Park Road, Ocoee Apopka Road, Hiawassee Road, and several connecting collectors and arterials.

The study examines both today's conditions (2025) and looks ahead to 2050 with and without planned roadway improvements. The "build" 2050 scenario includes only roadway projects that are already funded or formally planned.

## How the Existing Conditions Report Was Put Together

The Existing Conditions Report dated September 2025 documents everything the project team measured about how the NOWOCATS roadway network works today. It pulls from many data sources:
- New field traffic counts collected by VHB in April 2025
- Orange County's Concurrency Management System (CMS) for roadway capacity references
- City of Apopka's 2025 CMS for roads inside Apopka city limits
- FDOT pavement and bridge inspection reports
- Google Earth aerial imagery from 2025 for sidewalk, bike facility, and lighting inventories
- Three years of crash data (Jan 2022 – Dec 2024) from the Signal 4 Analytics system
- LYNX (the regional transit agency) for current bus route and ridership data

The report is the foundation that the rest of the study builds on. Future-year traffic forecasts, alternatives analysis, and recommended improvements all start from these existing conditions numbers.

## How the Traffic Data Was Collected

VHB conducted the field traffic data collection in April 2025. The work included:
- 48-hour pneumatic tube counts at 23 mid-block locations along the study corridors to measure how many vehicles use each road across two full days
- 4-hour turning movement counts (TMCs) at all 44 study intersections during the AM peak (7-9 AM) and PM peak (4-6 PM)
- Seasonal adjustment factors applied so the April counts represent typical year-round conditions

For each roadway, the team also calculated K-factors (the percentage of daily traffic that happens during the peak hour) and D-factors (how much of that peak traffic moves in one direction vs. the other). K-factors in the study area range from 7.8% to 10.1%, and D-factors range from 52% to about 65%, which is typical for suburban arterials.

This is the most comprehensive set of fresh field counts done in this part of Orange County in many years.

## Intersections That Are Already Failing — 2025 AM Peak

A traffic engineer rates how well an intersection works using "Level of Service" (LOS), from A (great) through F (failing). LOS E or worse on an arterial usually means a vehicle has to wait through more than one signal cycle to get through during peak hours.

In the AM peak (7-9 AM) today, the following NOWOCATS intersections are operating at LOS E or F:
- US 441 / Orange Blossom Trail & Hiawassee Road / Piedmont-Wekiwa Road — LOS F
- US 441 / Orange Blossom Trail & Central Avenue — LOS F
- US 441 / Orange Blossom Trail & SR 429 Connector Road / Kitt Avenue — LOS F
- US 441 / Orange Blossom Trail & Sadler Road — LOS F
- Piedmont-Wekiwa Road / Wekiwa Springs Road & SR 436 / Semoran Boulevard — LOS F

Most of the AM problem locations cluster along US 441 inside Apopka and at the major Piedmont-Wekiwa/SR 436 entry from Altamonte Springs.

## Intersections That Are Already Failing — 2025 PM Peak

In the PM peak (4-6 PM) today, the failing intersections are:
- US 441 / Orange Blossom Trail & Central Avenue — LOS F
- US 441 / Orange Blossom Trail & W Orange Avenue — LOS F
- US 441 / Orange Blossom Trail & SR 429 Connector Road / Kitt Avenue — LOS F
- Piedmont-Wekiwa Road / Wekiwa Springs Road & SR 436 / Semoran Boulevard — LOS F

US 441 through downtown Apopka and the SR 436 / Piedmont-Wekiwa intersection are the worst single points in the study area in both peak periods.

## Roadway Segments That Are Already Failing in 2025

Beyond individual intersections, the report also rates how well full stretches of road perform between intersections. Today, these segments are operating at LOS E or F (over capacity for the lane configuration they have):

- Kelly Park Road (Round Lake Road to Plymouth Sorrento Road) — over capacity
- Welch Road (Rock Springs Road to N Thompson Road; N Thompson Road to Wekiwa Springs Road) — over capacity
- Ocoee Apopka Road (West Road / Ocoee Crown Point Parkway to Binion Road; Binion Road to Harmon Road) — over capacity
- US 441 / Orange Blossom Trail (SR 436 / Semoran Boulevard to Park Avenue; Western Beltway to Plymouth Sorrento Road) — LOS F
- Clarcona Road (Gilliam Road to Keene Road) — LOS F

The arterial speed analysis on US 441 also shows particular slow points: northbound between Bradshaw Road and Vick Road averages just 14.2 mph in the PM peak (LOS F), and the Park Avenue to Central Avenue stretch averages 15-20 mph in both directions.

## How Walking and Biking Work in the Study Area Today

The study team inventoried bicycle and pedestrian facilities along every study corridor. The findings are summarized in three figures (existing bike facilities, existing sidewalks, multimodal LTS scores).

Bicycle facilities are limited. The only segments with marked bike lanes are:
- Rock Springs Road (Ponkan Road to Kelly Park Road) — 4-foot marked bike lane
- SR 436 / Semoran Boulevard (full length through the study area) — 4-6 foot marked bike lanes
- US 441 / Orange Blossom Trail (SR 436 to Earlwood Avenue) — 4-5 foot marked bike lanes

Multi-use paths (shared with pedestrians) exist on:
- N Park Avenue / Rock Springs Road (Lake McCoy Drive to Lester Road) — 12-15 feet wide
- S Binion Road (Lust Road to S of Verde View Drive) — 12-15 feet, not continuous
- Clarcona Road (Gilliam Road to Cleveland Street) — 12-15 feet, mostly on the east side

Everywhere else on the study corridors, cyclists either share the lane with traffic, use a paved shoulder, or have no facility at all. The bike Level of Traffic Stress (LTS) score is 3 or 4 ("uncomfortable for most riders") on essentially every study corridor — and pedestrian LTS is also 3 or 4 in most places.

Sidewalks are continuous on both sides through most of the Apopka core, but absent or non-continuous along Sadler Road, Jones Avenue, Old Highway US 441, Round Lake Road, W Kelly Park Road, the Plymouth Sorrento Road north end, and the very north end of US 441 / Orange Blossom Trail.

## LYNX Bus Service in NOWOCATS

The NOWOCATS area is served by four LYNX bus routes, all of which connect at or near the Apopka SuperStop in downtown Apopka:

- **Route 44** — 60-minute service from the Pine Hills Transfer Center to Holly Street, passing through Hiawassee Road, Apopka, and Zellwood
- **Route 106 (US 441 / Apopka Line)** — 30-minute service connecting downtown Orlando to Apopka, primarily traveling along North and South US 441 / Orange Blossom Trail
- **Route 405** — 60-minute service linking residential neighborhoods, key community destinations, and the Apopka SuperStop, with transfers to Routes 44, 106, 436N, and NeighborLink 652
- **Route 436N** — 30-minute service connecting Altamonte Springs to South Central Avenue and M.A. Broad Street in Apopka, primarily traveling along SR 436

For most study corridors outside of these four routes, transit Level of Service is F (either no service at all or service every 60+ minutes), which is reflected in the multimodal LOS tables. SR 436 / Semoran Boulevard has the only LOS D transit corridor in the study area (30-minute headways).

## Roadway Pavement Conditions

The FDOT pavement condition report rates pavement on a 0-10 scale for both "Cracking" and "Ride." Anything 6.0 or below is considered deficient and a candidate for resurfacing.

On FDOT-owned roads (US 441 / Orange Blossom Trail and SR 436 / Semoran Boulevard), one section is currently deficient: US 441 northbound between Vick Road and Errol Parkway (cracking score 2.5). Six more deficient sections are projected by 2030 — five on US 441 and one on SR 436 — meaning these roads will be candidates for resurfacing within the next few years if not already programmed.

On county and city roads, Orange County and the City of Apopka use the Pavement Condition Index (PCI) on a 1-100 scale. PCI scores below 60 indicate the worst conditions. The lowest-rated county segments are:
- Ponkan Road (Plymouth Sorrento Road to Rock Springs Road) — PCI 53-57
- W Kelly Park Road (Round Lake Road to Effie Drive) — PCI 55-59
- N Park Avenue (E Laurel Street to Welch Road) — PCI 54
- Jones Avenue — PCI 61-66
- W Kelly Park Road (Plymouth Sorrento Road to Mt Plymouth Road and Mt Plymouth to Holstein) — PCI 65-79

These ratings come from the Orange County Pavement Inventory Summary (2024) and the City of Apopka Pavement Management Report (2021).

## Bridges and Structures in NOWOCATS

The Federal Highway Administration's National Bridge Inventory (NBI) lists about 30 bridges and structures along the NOWOCATS study corridors. They are almost entirely girder bridges built between 2000 and 2018, including the bridges that carry SR 414, SR 429, SR 451, and SR 453 over local roads (W Kelly Park Road, Ponkan Road, Plymouth Sorrento Road, Hiawassee Road, US 441, Ocoee Apopka Road, and several others).

Every bridge in the study area has a sufficiency rating of 75 or higher on the 0-100 scale. FHWA classifies any structure rated 80-100 as "no action needed" and 50-80 as a candidate for possible rehabilitation. So none of the NOWOCATS structures are in poor condition, and most are in excellent condition. Inspections in the inventory range from 2022 through early 2024.

## Crash Summary — Three Years of Data (2022 through 2024)

Over the three calendar years 2022 through 2024, the study area saw a total of 3,445 reported crashes. They break down by severity as:
- 2,233 property damage only (no injuries)
- 1,112 injury crashes
- 80 serious-injury crashes
- 20 fatal crashes (21 people killed)

Crashes were roughly evenly distributed across the three years: 1,169 in 2022, 1,107 in 2023, and 1,169 in 2024.

Of the 3,445 crashes, 770 happened at the 44 study intersections and 2,675 along the segments between them.

## Highest-Crash Intersections in the Study Area

A "crash rate" adjusts for how busy an intersection is, so a moderately busy intersection with many crashes can still rank higher than a very busy one with fewer crashes. The study area average rate varies by intersection type, but the intersections whose 3-year crash rate is well above their peer-group average are:

- US 441 / Orange Blossom Trail & Park Avenue — 54 crashes, rate 1.083 (vs. average 0.720)
- Ocoee Apopka Road & Ocoee Crown Point Parkway / West Road — 50 crashes, rate 1.336 (vs. average 0.676)
- US 441 / Orange Blossom Trail & Hiawassee Road / Piedmont-Wekiwa Road — 46 crashes, rate 0.738
- Hiawassee Road & Apopka Boulevard — 33 crashes, rate 1.066
- Park Avenue / Rock Springs Road & Welch Road — 43 crashes (2 fatal), rate 1.027
- Ocoee Apopka Road & Harmon Road — 23 crashes, rate 1.225
- Ocoee Apopka Road & SR 429 NB Ramps — 24 crashes, rate 1.042
- Sheeler Avenue & Apopka Boulevard — 18 crashes, rate 0.898
- US 441 / Orange Blossom Trail & Boy Scout Boulevard — 30 crashes (1 fatal), rate 0.892

A total of 17 of 44 study intersections have crash rates above their peer-group average. The most common crash types at intersections are left-turn (34%), rear-end (28%), sideswipe (11%), and angle (11%).

## Highest-Crash Roadway Segments

For roadway segments (the stretches between intersections), the segments with the highest crash rates above their peer-group average are:

- US 441 / Orange Blossom Trail (SR 436 / Semoran Boulevard to Park Avenue) — 207 crashes (50 injury), crash rate 6.12 — the worst segment crash rate in the entire study area
- Sheeler Avenue (Apopka Boulevard to SR 436 / Semoran Boulevard) — 47 crashes, rate 5.22
- US 441 / Orange Blossom Trail (Park Avenue to Western Beltway) — 216 crashes (2 fatal), rate 3.62
- US 441 / Orange Blossom Trail (Roger Williams Road to SR 436 / Semoran Boulevard) — 94 crashes, rate 2.80
- W Welch Road (Rock Springs Road to N Thompson Road) — 72 crashes, rate 2.75
- W Welch Road (Vick Road to Rock Springs Road) — 32 crashes, rate 2.48
- Lake View Drive (Binion Road to US 441 / Orange Blossom Trail) — 5 crashes, rate 2.36
- US 441 / Orange Blossom Trail (Seminole County Line to Piedmont-Wekiwa Road) — 84 crashes, rate 2.34
- Thompson Road (SR 436 / Semoran Boulevard to Votaw Road) — 22 crashes, rate 2.27
- N Park Avenue / Rock Springs Road (Orange Blossom Trail to Martin Street) — 76 crashes, rate 2.22
- Hiawassee Road (Maitland Boulevard Extension to Apopka Boulevard) — 54 crashes, rate 2.19
- N Park Avenue / Rock Springs Road (Lester Road to Ponkan Road) — 91 crashes (1 fatal), rate 2.06

Twenty-two of 59 study segments are above their peer-group average. SR 436 / Semoran Boulevard through the entire study area absorbed 288 crashes over the three years — the most of any single segment — but its much higher volume puts its crash rate close to the 8-lane-divided peer average.

The most common crash types on segments are rear-end (51%), sideswipe (16%), and off-road (8%).

## Pedestrian and Cyclist Crashes

Walking and biking crashes are a small share of total crashes but disproportionately serious. Across the three years:
- 24 pedestrian/cyclist crashes occurred at the 44 study intersections (3.1% of intersection crashes)
- 46 pedestrian/cyclist crashes occurred along study segments (1.7% of segment crashes)

Two of the 20 fatal crashes in the study period involved pedestrians or cyclists:
- A cyclist crossing US 441 / Orange Blossom Trail near CR 435 was struck by a vehicle in December 2022 (cyclist had BAC of 0.107)
- A pedestrian crossing US 441 / Orange Blossom Trail at Stoneybrook Hills Parkway in an unmarked crosswalk under dark conditions was struck in May 2023

The lack of bicycle facilities and the LTS 3-4 ratings throughout the study area are consistent with these crashes happening on roads that were not designed with vulnerable users in mind.

## Patterns in the Fatal Crashes

Out of the 21 fatalities (in 20 separate crashes) between January 2022 and December 2024, the breakdown by crash type was:
- 7 off-road crashes (vehicle left the roadway)
- 4 head-on crashes
- 3 left-turn crashes
- 2 rear-end crashes
- 2 pedestrian-related crashes
- 1 angle crash
- 1 other

Five of the 20 fatal crashes (25%) involved a driver under the influence of alcohol or drugs. Several others involved speeding (one crash had a vehicle traveling 74 mph in a 45 mph zone), reckless driving, failure to wear a seatbelt, or wrong-way driving (one fatality on Christmas Eve 2024 was caused by a vehicle traveling northbound in the southbound lanes of US 441).

Fatal crashes were geographically scattered — US 441 / Orange Blossom Trail and its parallel routes (Old Highway 441, Jones Avenue) account for about half, with the rest on Welch Road / CR 435, Round Lake Road, S Binion Road, Hiawassee Road, Ocoee Apopka Road, W Kelly Park Road, and Rock Springs Road.

## Crashes by Time of Day and Lighting

About 64% of intersection crashes (and 73% of segment crashes) occurred during daylight hours. But a significant share — 26% at intersections and 16% along segments — occurred under "dark but lighted" conditions, and another 4-7% under "dark, not lighted" conditions. That means roughly 30% of crashes happened in low-light conditions. The study area has notable lighting gaps along Sadler Road, Jones Avenue, Old Highway US 441, parts of Plymouth Sorrento Road, W Orange Avenue, S Binion Road, and parts of Ocoee Apopka Road.

About 90% of crashes occurred on dry pavement (10% in wet conditions).

## Right-of-Way and Roadway Cross-Sections

"Right-of-way" (ROW) is the strip of land owned by the public for a road and everything that goes with it — pavement, shoulders, sidewalks, signs, utilities, drainage, future widening. ROW determines how much physical room any future improvement has to work with.

ROW widths along the NOWOCATS study corridors vary widely:
- Narrowest: Jones Avenue (50-70 feet), Ocoee Apopka Road West Road segment (45-125 ft)
- Mid-range: most county collectors at 60-90 ft
- Wider: US 441 / Orange Blossom Trail (80-225 ft, depending on segment), Hiawassee Road (100-250 ft)
- Widest: SR 436 / Semoran Boulevard (185-230 ft)

These figures come from the Orange County Property Appraiser. They matter because any future widening, sidewalk addition, or shared-use path needs to fit within the existing ROW or require additional land acquisition.

## How Land Use Around a Road Shapes Design (Context Classification)

FDOT classifies every road by the kind of place it runs through, because the right design for a rural farm road is very different from the right design for a downtown street. The eight FDOT context classes range from C1 (Natural) to C6 (Urban Core). Six of these are present in the NOWOCATS study area:

- **Rural (C2)** — sparsely settled agricultural / woodland (Jones Avenue, W Kelly Park Road western end)
- **Rural Town (C2T)** — small concentration in rural land (Sadler Road, Round Lake Road)
- **Suburban Residential (C3R)** — mostly residential in large blocks with sparse street network (most local collectors)
- **Suburban Commercial (C3C)** — non-residential with large parking lots (most of US 441, SR 436, Ocoee Apopka Road)
- **Urban General (C4)** — mix of uses on small blocks (N Park Avenue near Apopka core, Park Avenue near downtown)
- **Urban Center (C5)** — only one stretch in the study area: US 441 / Orange Blossom Trail between SR 436 and Park Avenue (downtown Apopka)

This classification informs the recommended cross-sections, speed limits, and pedestrian/cyclist treatments for each road.

## Jurisdiction and Maintenance Agency

Roads in the NOWOCATS study area are owned and maintained by three different agencies:

- **FDOT** owns and maintains the state highway system in the study area — US 441 / Orange Blossom Trail and SR 436 / Semoran Boulevard
- **Orange County** owns and maintains most of the collector and arterial network, including Sadler Road, Jones Avenue, Plymouth Sorrento Road, Kelly Park Road outside Apopka, Wekiwa Springs Road, S Binion Road, Ocoee Apopka Road, Hiawassee Road, Lakeville Road, Ponkan Road, Lake View Drive, Thompson Road, and Sheeler Avenue's southern half
- **City of Apopka** owns several local streets within city limits, with Orange County still handling most maintenance

The functional classification mostly comes back as "Major Collector," with US 441 and SR 436 classified as "Principal Arterial — Other," and Old Highway US 441, Piedmont-Wekiwa Road, Wekiwa Springs Road, and Hiawassee Road as "Minor Arterials." Knowing which agency owns each road matters because they have to coordinate any change — a single intersection improvement may involve FDOT, Orange County, and the City of Apopka.

## Lighting and Intelligent Transportation Systems (ITS)

The study inventoried lighting along every study corridor based on Google Earth aerial imagery. FDOT standards generally recommend two lights per signalized intersection crosswalk — about eight lights total. Many of the 44 study intersections fall well short of that target. Five intersections have zero lights (W Orange Avenue at US 441, Plymouth Sorrento at US 441, Stoneybrook Hills at US 441, Lowes Driveway at US 441, Boy Scout Boulevard at US 441), and several others have only 1-3 lights. These gaps line up with the 30% of crashes that occurred in low-light conditions.

For intelligent transportation systems, traffic signals are managed by a regional Traffic Management Center. The study identified Miovision cameras and CCTV cameras at 18 intersections, with fiber optic communications along Hiawassee Road, Piedmont-Wekiwa Road, Wekiwa Springs Road, and parts of US 441 and SR 436. There are no "Master Hut" controller cabinets at any study intersection.

## Evacuation Routes, Freight, and Rail

Two roadways in the study area are designated hurricane / emergency evacuation routes by Orange County:
- US 441 / Orange Blossom Trail (from SR 436 / Semoran Boulevard to the Lake County Line)
- SR 436 / Semoran Boulevard (from US 441 to the Seminole County Line)

The purpose of an evacuation route is to funnel coastal-area traffic inland, away from storm surge zones.

None of the study area roads are part of FDOT's Strategic Intermodal System (SIS) or designated freight routes, although the Florida Central Railroad runs adjacent to US 441 / Orange Blossom Trail through most of the study area. Freight planning and rail crossing considerations remain part of the study scope even though no SIS corridor is involved.
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
    if (!title || !content) continue
    if (content.length <= 1500) {
      chunks.push({ title, content })
    } else {
      const paragraphs = content.split(/\n\n+/)
      let buf = ''
      let part = 1
      for (const p of paragraphs) {
        if ((buf + '\n\n' + p).length > 1500 && buf) {
          chunks.push({ title: `${title} (part ${part})`, content: buf.trim() })
          buf = p
          part += 1
        } else {
          buf = buf ? `${buf}\n\n${p}` : p
        }
      }
      if (buf) chunks.push({ title: part === 1 ? title : `${title} (part ${part})`, content: buf.trim() })
    }
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

  const allChunks = chunkText(ECR_MARKDOWN)
  console.log(`Chunked into ${allChunks.length} sections`)

  // Dedup against existing chunks (by title + first 200 chars of content)
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
  console.log(`After dedup: ${toInsert.length} new chunks`)

  if (toInsert.length === 0) {
    console.log('Nothing to insert. Done.')
    return
  }

  // Insert chunks (without embeddings first)
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
  console.log(`Inserted ${inserted?.length ?? 0} chunks`)

  // Embed in batches of 50
  const BATCH = 50
  let embedded = 0
  for (let i = 0; i < (inserted ?? []).length; i += BATCH) {
    const batch = (inserted ?? []).slice(i, i + BATCH)
    const texts = batch.map(c => `${c.title}\n${c.content}`)
    const vecs = await embedBatch(texts)
    for (let j = 0; j < batch.length; j++) {
      if (vecs[j]) {
        const { error: uErr } = await service
          .from('bot_knowledge_chunks')
          .update({ embedding: JSON.stringify(vecs[j]) })
          .eq('id', batch[j].id)
        if (uErr) console.error(`Embed update failed for ${batch[j].id}: ${uErr.message}`)
        else embedded++
      }
    }
  }
  console.log(`Stored embeddings for ${embedded}/${inserted?.length ?? 0} chunks`)
  console.log('Done.')
}

main().catch(e => { console.error(e); process.exit(1) })
