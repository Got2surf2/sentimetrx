/* eslint-disable */
// Seed Sarina's focuses — the 8 information topics + 7 feedback topics + 2 anchor
// asks already enumerated in her system prompt. Idempotent: running this twice
// is fine; existing slugs are overwritten by this canonical list.
// Run: node_modules/.bin/tsx scripts/_seed_sarina_focuses.ts

import { readFileSync } from 'fs'
import path from 'path'

const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

import { createClient } from '@supabase/supabase-js'

const BOT_ID = '5c468b90-13fc-46a2-8855-312dc0a1e428'
const ORG_ID = 'b72e9ee6-0466-459a-8440-988a8bd6d3c5'

const FOCUSES = [
  // 8 information topics
  { slug: 'study-overview', label: 'Study Overview', description: 'What NOWOCATS is, why it is happening now, and who is leading it' },
  { slug: 'study-area-boundaries', label: 'Study Area Boundaries', description: 'The geographic limits of the study — north of Clarcona-Ocoee Rd, south of the Orange/Seminole county line, between Lake and Seminole county lines' },
  { slug: 'current-traffic-conditions', label: 'Current Traffic Conditions', description: 'Failing intersections, failing roadway segments, congestion patterns, and existing peak-hour delays today (2025)' },
  { slug: 'traffic-forecasts-2050', label: '2050 Traffic Forecasts', description: 'Future-year travel demand forecasts comparing the no-build scenario to the build scenario with funded and planned improvements' },
  { slug: 'multimodal-scope', label: 'Multimodal Scope', description: 'How transit, bicycle, pedestrian, and freight modes are included alongside roadway analysis — not just cars' },
  { slug: 'programmed-vs-planned', label: 'Programmed vs Planned Improvements', description: 'The difference between projects already programmed (funded and scheduled) and projects planned for the long-range vision' },
  { slug: 'environmental-considerations', label: 'Environmental Considerations', description: 'Impacts on the Wekiva Protection Zone, Lake Apopka, state parks, and other environmental resources within the study area' },
  { slug: 'decision-process', label: 'Decision Process and Timeline', description: 'How recommendations move through the Local Planning Agency (LPA) workshops and Board of County Commissioners (BCC) hearings to become real projects' },

  // 7 feedback topics
  { slug: 'feedback-user-type', label: 'Feedback — User Type', description: 'Whether the resident is a resident, business owner, commuter, or other type of stakeholder' },
  { slug: 'feedback-location', label: 'Feedback — Where They Live or Travel', description: 'Where in Northwest Orange County the resident lives, works, or travels most often' },
  { slug: 'feedback-travel-mode', label: 'Feedback — How They Get Around', description: 'How the resident mostly travels — driving, transit, biking, walking, or some combination' },
  { slug: 'feedback-frustration', label: 'Feedback — Biggest Frustration', description: "The resident's biggest transportation frustration today — specific roads, intersections, times of day" },
  { slug: 'feedback-2050-concern', label: 'Feedback — 2050 Growth Concern', description: 'What concerns the resident most about growth and traffic in the area by 2050' },
  { slug: 'feedback-priority-category', label: 'Feedback — Priority Improvement Category', description: 'Which of the six improvement categories matters most to the resident: roadway widening, new roads, safety, intersections, pedestrian/bicycle, or transit' },
  { slug: 'feedback-specific-locations', label: 'Feedback — Specific Locations Flagged', description: 'Specific intersections, road segments, or stretches the resident wants the project team to look at' },

  // 2 anchor asks (also surfaced explicitly before closing)
  { slug: 'anchor-user-type', label: 'Anchor Ask — User Type', description: 'Explicit close-out question confirming whether the resident is a resident, business owner, commuter, or other' },
  { slug: 'anchor-priority', label: 'Anchor Ask — Priority Category', description: 'Explicit close-out question asking which improvement category would make the biggest difference for the resident' },
].map(f => ({ ...f, enabled: true }))

async function main() {
  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: existing, error: rdErr } = await service
    .from('bots')
    .select('id, name, focuses, org_id')
    .eq('id', BOT_ID)
    .eq('org_id', ORG_ID)
    .single()
  if (rdErr || !existing) throw rdErr || new Error('Sarina bot not found')

  console.log(`Existing focuses on ${existing.name}: ${(existing.focuses || []).length}`)
  console.log(`Setting ${FOCUSES.length} canonical focuses`)

  const { error: uErr } = await service
    .from('bots')
    .update({ focuses: FOCUSES, updated_at: new Date().toISOString() })
    .eq('id', BOT_ID)
    .eq('org_id', ORG_ID)
  if (uErr) throw uErr

  console.log('Done.')
}

main().catch(e => { console.error(e); process.exit(1) })
