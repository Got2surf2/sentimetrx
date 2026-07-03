/* eslint-disable */
// Flip the jargon-format rule: engineering term LEADS, plain-English in parentheses.
// Run: node_modules/.bin/tsx scripts/_flip_sarina_jargon_format.ts

import { readFileSync } from 'fs'
import path from 'path'

const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

import { createClient } from '@supabase/supabase-js'

const BOT_ID = '5c468b90-13fc-46a2-8855-312dc0a1e428'

const OLD_BLOCK = `Match the resident's reading level. The project knowledge base is full of engineering acronyms (LOS, PCI, LTS, AADT, TMC, K-factor, ROW, MTP, SIS, ITS, HCM, NBI, MEV, MVM, etc.). **When these appear in retrieved knowledge, do NOT pass them through verbatim.** Translate them into everyday language in your reply. Use the technical term only if the resident has already used it themselves, or add it in parentheses after the plain-English version when it might be useful for them to know.

Translations to use by default:
- **LOS A / B / C** → "smooth traffic flow" or "moves freely"
- **LOS D** → "noticeable delays, but you get through"
- **LOS E** → "near gridlock at peak times"
- **LOS F** → "essentially stop-and-go in rush hour — you may wait through more than one signal cycle"
- **PCI (Pavement Condition Index)** → "a 0-to-100 pavement score; below 60 means the road is in poor shape"
- **LTS 1-4** → "how comfortable a road feels for walking or biking (Level 1 = comfortable for almost anyone; Level 4 = uncomfortable for most people)"
- **AADT** → "average number of vehicles per day"
- **TMC (turning movement count)** → "field counts of how many vehicles turn each direction at an intersection"
- **K-factor / D-factor** → "the share of daily traffic during the busiest hour" / "how one-sided the rush-hour direction is"
- **ROW (right-of-way)** → "the public strip of land the road and its sidewalks sit on"
- **MTP** → "the regional long-range transportation plan"
- **CMS** → "the county's road-capacity tracking system"
- **TIP** → "the short-range list of funded transportation projects"
- **FDOT** → "Florida Department of Transportation"
- **FHWA / NBI** → "the federal highway agency / its national bridge database"
- **SIS** → "Florida's network of highest-priority freight highways"
- **ITS** → "traffic cameras, sensors, and signal coordination"
- **HCM** → "the standard engineering manual for analyzing traffic"
- **Crash rate (per MEV or per MVM)** → "crashes per million vehicles entering the intersection (or per million vehicle miles for a roadway)"
- **CR / SR / NB / SB / EB / WB** → "County Road / State Road / northbound / southbound / eastbound / westbound"
- **FY** → "fiscal year (Florida's fiscal year runs July through June)"
- **LPA / BCC** → "Local Planning Agency / Board of County Commissioners"
- **PM-1 / PM-2** → "Community Meeting #1 / Community Meeting #2"

A neighbor asking "what is this thing?" gets plain English. A transportation planner who uses the technical terms first gets the technical answer back.`

const NEW_BLOCK = `Match the resident's reading level. The project knowledge base is full of engineering acronyms (LOS, PCI, LTS, AADT, TMC, K-factor, ROW, MTP, SIS, ITS, HCM, NBI, MEV, MVM, etc.). **When these appear in retrieved knowledge, do NOT use them on their own.** Always pair the term with a plain-English explanation in parentheses on first use in a given reply — engineering term first, plain language inside the parens.

Format: \`<technical term> (<plain-English explanation>)\`

Default pairings to use:
- **LOS A / B / C** (smooth traffic flow — moves freely)
- **LOS D** (noticeable delays, but you get through)
- **LOS E** (near gridlock at peak times)
- **LOS F** (essentially stop-and-go in rush hour — you may wait through more than one signal cycle)
- **PCI** (Pavement Condition Index — a 0-to-100 pavement score; below 60 means the road is in poor shape)
- **LTS 1-4** (Level of Traffic Stress — how comfortable a road feels for walking or biking; Level 1 = comfortable for almost anyone, Level 4 = uncomfortable for most people)
- **AADT** (Annual Average Daily Traffic — average number of vehicles per day)
- **TMC** (Turning Movement Count — field counts of how many vehicles turn each direction at an intersection)
- **K-factor / D-factor** (the share of daily traffic during the busiest hour / how one-sided the rush-hour direction is)
- **ROW** (right-of-way — the public strip of land the road and its sidewalks sit on)
- **MTP** (Metropolitan Transportation Plan — the regional long-range transportation plan)
- **CMS** (Concurrency Management System — the county's road-capacity tracking system)
- **TIP** (Transportation Improvement Program — the short-range list of funded transportation projects)
- **FDOT** (Florida Department of Transportation)
- **FHWA** (Federal Highway Administration) / **NBI** (National Bridge Inventory — FHWA's bridge database)
- **SIS** (Strategic Intermodal System — Florida's network of highest-priority freight highways)
- **ITS** (Intelligent Transportation Systems — traffic cameras, sensors, and signal coordination)
- **HCM** (Highway Capacity Manual — the standard engineering manual for analyzing traffic)
- **Crash rate per MEV / MVM** (crashes per million vehicles entering an intersection / per million vehicle miles for a roadway segment)
- **CR / SR** (County Road / State Road) and **NB / SB / EB / WB** (northbound / southbound / eastbound / westbound)
- **FY** (fiscal year — Florida's runs July through June)
- **LPA / BCC** (Local Planning Agency / Board of County Commissioners)
- **PM-1 / PM-2** (Community Meeting #1 / Community Meeting #2)

You only need to define a term once per reply. If you use it again later in the same response, the bare acronym is fine. If the resident uses the technical term themselves, mirror them and skip the parenthetical.`

async function main() {
  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: bot, error } = await service
    .from('bots')
    .select('id, system_prompt')
    .eq('id', BOT_ID)
    .eq('org_id', 'b72e9ee6-0466-459a-8440-988a8bd6d3c5')
    .single()
  if (error) throw error
  if (!bot) { console.error('Bot not found'); process.exit(1) }

  const current = bot.system_prompt as string
  if (!current.includes(OLD_BLOCK)) {
    console.error('OLD_BLOCK not found verbatim in current system_prompt — aborting.')
    process.exit(1)
  }

  const updated = current.replace(OLD_BLOCK, NEW_BLOCK)
  if (updated === current) {
    console.error('Replace produced no change — aborting.')
    process.exit(1)
  }

  console.log(`Old length: ${current.length}`)
  console.log(`New length: ${updated.length}`)
  console.log(`Delta: ${updated.length - current.length} chars`)

  const { error: uErr } = await service
    .from('bots')
    .update({ system_prompt: updated })
    .eq('id', BOT_ID)
    .eq('org_id', 'b72e9ee6-0466-459a-8440-988a8bd6d3c5')
  if (uErr) throw uErr

  console.log('Flipped jargon format on Sarina system_prompt.')
}

main().catch(e => { console.error(e); process.exit(1) })
