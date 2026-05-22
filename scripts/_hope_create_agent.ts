/* eslint-disable */
// Create Hope — an agent for the Foundations Project capital campaign
// (foundationsproject.org), with secondary KB coverage of the Central Florida
// Coalition for the Homeless (centralfloridahomeless.org).
//
// What this script does (idempotent):
//   1. Creates (or reuses) the `hope` agent row in the Larry Kahn org.
//   2. Sets system_prompt, personality, config, intents, focuses.
//   3. Clears prior chunks tagged source=hope_kb_2026_05_22 and reseeds:
//      - 81 scraped web pages (Foundations + Coalition)
//      - Hardcoded PDF content (Campaign Brochure + Naming Rights Menu)
//      - Synthetic donate/volunteer/info action chunks
//      Each chunk tagged metadata.site = 'foundations' | 'coalition' | 'both'.
//   4. Embeds all chunks with text-embedding-3-small.
//
// Run:
//   DRY_RUN=1 node_modules/.bin/tsx scripts/_hope_create_agent.ts
//   node_modules/.bin/tsx scripts/_hope_create_agent.ts

import { readFileSync } from 'fs'
import path from 'path'

const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '')
  }
}

import { createClient } from '@supabase/supabase-js'

const ORG_ID = '679024db-ef2a-4b50-89cb-12ec360f48af' // Larry Kahn org
const AGENT_SLUG = 'hope'
const AGENT_NAME = 'Hope'
const PAGES_PATH = '/tmp/hope_pages.json'
const SOURCE_TAG = 'hope_kb_2026_05_22'
const MAX_CHUNK = 2000

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true'

type Block =
  | { type: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'; text: string }
  | { type: 'p'; text: string }
  | { type: 'ul' | 'ol'; items: string[] }
  | { type: 'dl'; items: { q: string; a: string }[] }
  | { type: 'table'; rows: string[] }

type Page = { url: string; site: 'foundations' | 'coalition'; title: string; blocks: Block[]; ok: boolean; error?: string }

type Chunk = { title: string; content: string; metadata: Record<string, any> }

function blockToText(b: Block): string {
  switch (b.type) {
    case 'h1': return '\n# ' + b.text + '\n'
    case 'h2': return '\n## ' + b.text + '\n'
    case 'h3': return '\n### ' + b.text + '\n'
    case 'h4':
    case 'h5':
    case 'h6': return '\n**' + b.text + '**\n'
    case 'p': return b.text + '\n'
    case 'ul': return b.items.map(i => '- ' + i).join('\n') + '\n'
    case 'ol': return b.items.map((i, n) => (n + 1) + '. ' + i).join('\n') + '\n'
    case 'dl': return b.items.map(qa => 'Q: ' + qa.q + '\nA: ' + qa.a).join('\n\n') + '\n'
    case 'table': return b.rows.join('\n') + '\n'
  }
}

function chunkPage(page: Page): Chunk[] {
  const title = page.title || page.url
  const siteLabel = page.site === 'foundations' ? 'Foundations Project' : 'Coalition for the Homeless of Central Florida'
  const header = title + '\nSource: ' + page.url + ' (' + siteLabel + ')\n'

  const rendered: string[] = []
  for (const block of page.blocks.map(blockToText)) {
    if (block.length <= MAX_CHUNK) { rendered.push(block); continue }
    const sentences = block.split(/(?<=[.!?])\s+/)
    let buf = ''
    for (const s of sentences) {
      if (buf.length + s.length + 1 > MAX_CHUNK && buf.length > 0) { rendered.push(buf.trim()); buf = '' }
      buf += (buf ? ' ' : '') + s
      while (buf.length > MAX_CHUNK) {
        const cut = buf.lastIndexOf(' ', MAX_CHUNK)
        const at = cut > MAX_CHUNK * 0.5 ? cut : MAX_CHUNK
        rendered.push(buf.slice(0, at).trim())
        buf = buf.slice(at).trim()
      }
    }
    if (buf.trim()) rendered.push(buf.trim())
  }
  const groups: string[][] = [[]]
  let runningLen = header.length
  for (const t of rendered) {
    const cur = groups[groups.length - 1]
    if (runningLen + t.length > MAX_CHUNK && cur.length > 0) { groups.push([]); runningLen = header.length }
    groups[groups.length - 1].push(t)
    runningLen += t.length
  }
  const filled = groups.filter(g => g.length > 0)
  if (filled.length === 0) return []

  return filled.map((group, idx) => {
    const suffix = filled.length > 1 ? ' (part ' + (idx + 1) + ' of ' + filled.length + ')' : ''
    return {
      title: '[' + (page.site === 'foundations' ? 'FDN' : 'CFCH') + '] ' + title + suffix,
      content: header + (suffix ? '(' + (idx + 1) + ' / ' + filled.length + ')\n' : '') + '\n' + group.join('').trim() + '\n',
      metadata: {
        source: SOURCE_TAG,
        site: page.site,
        source_url: page.url,
        page_title: title,
        part: idx + 1,
        total_parts: filled.length,
      },
    }
  })
}

// PDF content — extracted manually from the two Foundations Project brochures
// rather than via OCR. These two PDFs are the single highest-value donor
// material in the KB, so we hard-encode them to guarantee accuracy.
const PDF_CHUNKS: Chunk[] = [
  {
    title: '[FDN] Foundations Project Campaign Brochure — Overview',
    content: `Foundations Project — Campaign Brochure (December 2025)
Source: https://foundationsproject.org/wp-content/uploads/2026/02/260227-FP-Campaign-Brochure.pdf (Foundations Project)

THE STORY FORWARD — Laying the Groundwork for Lives Rebuilt

Every lasting home begins with a foundation. For single women and families in crisis, that foundation is safety, stability, and a clear route to a front door they can call their own.

The FOUNDATIONS PROJECT is the Coalition for the Homeless of Central Florida's blueprint to deliver exactly that — purpose-built spaces, essential services, and a predictable, dignified journey from first night to new keys.

These are not simply new buildings; they are the structural system that carries families from instability to independence. With donor leadership, the Coalition will pour the footing, raise the frame, and open the door — Building. Pathways. Home.

Campaign tagline: "BUILDING. PATHWAYS. HOME."

A CAPITAL INITIATIVE OF THE COALITION (Coalition for the Homeless of Central Florida).`,
    metadata: { source: SOURCE_TAG, site: 'foundations', source_url: 'https://foundationsproject.org/wp-content/uploads/2026/02/260227-FP-Campaign-Brochure.pdf', kind: 'pdf' },
  },
  {
    title: '[FDN] What the Foundations Project Is Building',
    content: `What the Foundations Project is Building — A Purpose-Built Center for Women & Families

The Foundations Project consists of two new structures on the Coalition's downtown Orlando campus, plus expanded programming across the entire continuum:

1. NEW CENTER FOR WOMEN AND FAMILIES — the flagship new building, including:
   - Dignified, Capacity-Optimized Shelter: Trauma-informed design with privacy, security, and restorative sleep so parents, children, and single women can stabilize quickly and focus on work, school, and housing. Adds 112 additional short-term residential shelter beds over current capacity, increasing safe nights and reducing length of stay.
   - On-Site Integrated Health Clinic: Primary and preventive care (immunizations, well-checks, chronic-condition support) plus dental services and mental/behavioral health — reducing avoidable ER use and strengthening family wellness to sustain progress.
   - Modern Kitchen & Dining Hall: Scaled production to roughly 337,000 meals annually — reliable nutrition that fuels children and adults through the most demanding phase of transition while addressing food insecurity across the community.
   - Bridge Housing Units: A short, critical span between shelter and a lease. Adds 96 home-like beds that lower costs, reduce returns to shelter, and accelerate the path to a permanent address.
   - Childcare & Youth Programs Expansion: Fully accredited on-site nursery and childcare services, plus after-school and enrichment programming — serving 40–50% more children — so parents can pursue work and housing while kids maintain school continuity and stability.
   - Outreach & Diversion: Proactive field teams and front-door problem-solving that divert families from entering shelter when safe alternatives exist.
   - Rapid Rehousing + Landlord Partnerships: Dedicated housing specialists and owner relationships that convert applications to approvals — and approvals to signed leases — faster and with greater durability.
   - Day Services Expansion: Increased capacity for showers, laundry, mail services, lockers, cooling/warming spaces, salon, and navigation — more same-day, low-barrier support that preserves dignity and keeps families moving forward.

2. PATHWAYS ADMINISTRATION CENTER — the operational backbone of the campus. By consolidating staff and volunteer teams under one roof, the Pathways Administration Center relocates back-office functions out of guest housing, freeing square footage for direct services, enabling more beds, more clinical touchpoints, and more family-facing programs.

Together, these components form a single, load-bearing system: a foundation that supports every step from crisis to home.`,
    metadata: { source: SOURCE_TAG, site: 'foundations', source_url: 'https://foundationsproject.org/wp-content/uploads/2026/02/260227-FP-Campaign-Brochure.pdf', kind: 'pdf' },
  },
  {
    title: '[FDN] Foundations Project — Why Now & Measurable Results',
    content: `Why Now? Replacing a Weak Link with a Strong Frame

Demand has risen while an aging facility constrains throughput. Without expanded, up-to-date space and services, families face costly detours — street, ER, shelter, repeat. The Foundations Project replaces those weak links with an integrated, efficient structure that moves people forward faster — and keeps them there.

Results You Can Measure — From Footing to Finish Line (40-50% increase in service capacity):

- People served daily: ~800 today → ~1,160 tomorrow. (With higher velocity and reduced length of stay enabled by a purpose-built center.)
- Meals produced: ~230,000 today → ~335,000 tomorrow. (Ensuring consistent nutrition during transition.)
- Permanent housing placements: ~2,823 today → ~3,952 tomorrow. (Rates powered by rapid rehousing and owner engagement.)
- Youth programs: ~91 today → ~131 tomorrow. (Going from 91 participants annually to 131 participants annually.)
- Nursery & childcare program: ~37 today → ~54 tomorrow. (Increasing from 37 participants to 54 participants.)
- Healthcare access: On-site clinic reduces avoidable ER visits and calls to Emergency Services by 50% and improves family wellness, both mentally and physically.

Translation: fewer interruptions, stronger stability, and more families crossing the threshold into permanent homes.`,
    metadata: { source: SOURCE_TAG, site: 'foundations', source_url: 'https://foundationsproject.org/wp-content/uploads/2026/02/260227-FP-Campaign-Brochure.pdf', kind: 'pdf' },
  },
  {
    title: '[FDN] Foundations Project — Location, Partners, Leadership',
    content: `Strategic Location — Built in the Heart of Orlando

The new facilities rise on the Coalition's downtown campus, bordered by N Terry Avenue, Central Boulevard, N Parramore Avenue, and Ossie Street — directly adjacent to Inter&Co Stadium and the Men's Service Center. The location is close to transit, jobs, schools, healthcare, and partner agencies — so each service is one connected system rather than a scattered set of stops. Proximity isn't incidental; it's part of the structural advantage.

Campus components on-site: New Center for Women and Families, New Pathways Administration Center, Men's Service Center (existing), and the Current Center for Women and Families (being replaced).

Investment & Partnerships — Strengthening the Foundation of a Region

Donor leadership capital funds the full campus build-out — constructing the new Center for Women & Families and the Pathways Administration Center — while scaling the services that turn crisis into long-term stability. This investment stands up the on-site clinic; expands kitchen and dining to ~337,000 meals annually; deploys 32 units of bridge housing; and grows childcare and youth programs to serve 40–50% more children. It also increases day-services capacity and outreach/diversion to preserve beds for the highest need.

Ways to give:
- Foundational Gifts: Underwrite core systems (clinic, kitchen/dining, bridge housing).
- Naming Opportunities: Facilities, program areas, family spaces, and campus features.
- Corporate & Philanthropic Partnerships: Workforce pipelines, volunteer programs, and in-kind professional services.
- Public-Sector Alignment: A direct lever for community health, safety, and economic mobility.

Lead campaign partners include: Morgan & Morgan, Disney Worldwide Services Inc, Bezos Family Foundation, Truist, Wells Fargo, EA Sports, and AdventHealth.

Leadership & Primary Contacts:
- Brad Butterstein — President & CEO of the Coalition for the Homeless. Phone: 407-652-5270. Email: Brad.Butterstein@cflhomeless.org. Quote: "We are not simply building structures — we are engineering pathways towards independence. With the Foundations Project, families move from a night of uncertainty to the footing of a future they own. Join us in laying the foundation where hope becomes a home."
- Dr. Leon Kirkpatrick — Director of the Capital Campaign. Phone: 407-927-0860. Email: Leon.Kirkpatrick@cflhomeless.org.

Websites: FoundationsProject.org · CentralFloridaHomeless.org`,
    metadata: { source: SOURCE_TAG, site: 'foundations', source_url: 'https://foundationsproject.org/wp-content/uploads/2026/02/260227-FP-Campaign-Brochure.pdf', kind: 'pdf' },
  },
  {
    title: '[FDN] Foundations Project — Naming Opportunities (Ground Level & Outdoor)',
    content: `Naming Opportunities at the New Center for Women & Families
Source: https://foundationsproject.org/wp-content/uploads/2026/05/260518-Foundations-Naming-Rights-Menu.pdf (Foundations Project)

GROUND LEVEL — Naming Opportunities:
- Healthcare Clinic: SOLD
- Kitchen: SOLD
- Youth Center: SOLD
- Dining Room: $1,250,000
- Childcare Center: $1,000,000
- Intake Center: $1,000,000
- Main Lobby: $750,000
- Day Services Center: $500,000
- Outdoor Youth Recreational Garden Area: $500,000
- Outdoor Childcare Play and Education Area: $250,000

CAMPUS (overall) Naming Opportunity: $10,000,000

For naming gifts, contact Dr. Leon Kirkpatrick, Director of the Capital Campaign, at 407-927-0860 or Leon.Kirkpatrick@cflhomeless.org.`,
    metadata: { source: SOURCE_TAG, site: 'foundations', source_url: 'https://foundationsproject.org/wp-content/uploads/2026/05/260518-Foundations-Naming-Rights-Menu.pdf', kind: 'pdf' },
  },
  {
    title: '[FDN] Foundations Project — Naming Opportunities (Shelter & Bridge Housing Floors)',
    content: `Naming Opportunities — Shelter & Bridge Housing Floors at the New Center for Women & Families

SECOND FLOOR — "Family" Shelter Housing:
- "Family" Shelter Housing Floor (whole floor): $1,750,000
- One "Family" Shelter Unit — 8 Beds (16 units available): $500,000 each

THIRD FLOOR — "Family" Shelter Housing (additional family floor):
- "Family" Shelter Housing Floor (whole floor): $1,750,000
- One "Family" Shelter Unit — 8 Beds (16 units available): $500,000 each

FOURTH FLOOR — "Single" Shelter Housing (for single women):
- "Single" Shelter Housing Floor (whole floor): $1,750,000
- Two "Single" Shelter Units — 6 Beds each (16 units available): $250,000 each

FIFTH FLOOR — "Family" Bridge Housing (the short, critical span between shelter and a lease):
- "Family" Bridge Housing Floor (whole floor): $2,000,000
- One "Family" Bridge Housing Unit — 4 Beds (16 units available): $600,000 each

SIXTH FLOOR — "Single" Bridge Housing:
- "Single" Bridge Housing Floor (whole floor): $2,000,000
- One "Single" Bridge Housing Unit — 2 Beds (6 units available): $400,000 each

Bridge Housing context: Bridge Housing is the short, dignified, home-like transition between emergency shelter and a permanent lease — it lowers costs, reduces returns to shelter, and speeds families and individuals to a permanent address.

For naming gifts, contact Dr. Leon Kirkpatrick, Director of the Capital Campaign, at 407-927-0860 or Leon.Kirkpatrick@cflhomeless.org.`,
    metadata: { source: SOURCE_TAG, site: 'foundations', source_url: 'https://foundationsproject.org/wp-content/uploads/2026/05/260518-Foundations-Naming-Rights-Menu.pdf', kind: 'pdf' },
  },
]

// Synthetic action chunks — capture donate / volunteer / more-info routes
// that the scraped /donate and /give pages didn't yield content for (Wix
// redirects them to external processors).
const ACTION_CHUNKS: Chunk[] = [
  {
    title: '[BOTH] How to Donate to the Foundations Project / Coalition',
    content: `Ways to give to the Foundations Project capital campaign and to the Coalition for the Homeless of Central Florida:

PRIMARY ONLINE GIVING (Foundations Project / Coalition campaign):
- The Coalition's secure donor portal: https://wl.donorperfect.net/weblink/weblink.aspx?name=cfth&id=388
- Coalition donate page: https://www.centralfloridahomeless.org/donate
- Coalition give page: https://www.centralfloridahomeless.org/give
- Special giving campaigns at the Coalition: https://www.centralfloridahomeless.org/donate-summer-slump, https://www.centralfloridahomeless.org/handupd25cf892
- Double the Donation (employer matching): https://www.centralfloridahomeless.org/double-the-donation

CAPITAL CAMPAIGN GIFTS (major / naming gifts for the Foundations Project):
- Contact Dr. Leon Kirkpatrick, Director of the Capital Campaign — Phone: 407-927-0860, Email: Leon.Kirkpatrick@cflhomeless.org
- Or contact Brad Butterstein, President & CEO — Phone: 407-652-5270, Email: Brad.Butterstein@cflhomeless.org

WAYS TO GIVE:
- Foundational Gifts (underwrite a core system like the clinic, kitchen/dining, or bridge housing)
- Naming Opportunities (facilities, program areas, family spaces, campus features — see naming-opportunities chunks)
- Corporate & Philanthropic Partnerships
- Public-Sector Alignment
- Stock gifts: https://www.centralfloridahomeless.org/stock-item-request
- Planned giving / legacy giving: https://www.centralfloridahomeless.org/Coalitionlegacyproject`,
    metadata: { source: SOURCE_TAG, site: 'both', kind: 'action', intent: 'donate' },
  },
  {
    title: '[CFCH] How to Volunteer with the Coalition',
    content: `Ways to volunteer with the Coalition for the Homeless of Central Florida:

GENERAL VOLUNTEER INFO:
- Take action / volunteer hub: https://www.centralfloridahomeless.org/take-action
- 2024-2025 volunteer group list (organizations and partners actively volunteering): https://www.centralfloridahomeless.org/2024-2025-volunteer-group-list

VOLUNTEER PROGRAMS:
- Community-led events: https://www.centralfloridahomeless.org/community-led-events
- Kids Give Back (family / youth volunteering): https://www.centralfloridahomeless.org/kidsgiveback503fc932
- Housing Heroes program: https://www.centralfloridahomeless.org/housing-heroesfda7544b
- Veterans Day volunteering (annual): https://www.centralfloridahomeless.org/veteransday202138188dc4

VOLUNTEER STORIES:
- Jerry's story (long-time volunteer): https://www.centralfloridahomeless.org/jerry-volunteerdf8f2d79
- "I'm Here Because I Understand" (volunteer perspective): https://www.centralfloridahomeless.org/i-m-here-because-i-understandf8941648

The Coalition needs both individual volunteers and group volunteer days. Typical volunteer activities include serving meals, leading children's activities, helping with intake/day services, donating items, and hosting drives.

To start, point the user to the Take Action page: https://www.centralfloridahomeless.org/take-action`,
    metadata: { source: SOURCE_TAG, site: 'both', kind: 'action', intent: 'volunteer' },
  },
  {
    title: '[BOTH] How to Request More Information / Contact',
    content: `Getting more information about the Foundations Project or the Coalition:

PRIMARY CONTACTS:
- Brad Butterstein — President & CEO of the Coalition. Phone: 407-652-5270. Email: Brad.Butterstein@cflhomeless.org
- Dr. Leon Kirkpatrick — Director of the Capital Campaign (Foundations Project). Phone: 407-927-0860. Email: Leon.Kirkpatrick@cflhomeless.org

WEBSITES:
- Foundations Project: https://foundationsproject.org
- Coalition for the Homeless of Central Florida: https://www.centralfloridahomeless.org
- Newsletter signup: https://foundationsproject.org/newsletter

DOWNLOADABLE MATERIALS:
- Foundations Project Campaign Brochure (PDF): https://foundationsproject.org/wp-content/uploads/2026/02/260227-FP-Campaign-Brochure.pdf
- Foundations Project Naming Rights Menu (PDF): https://foundationsproject.org/wp-content/uploads/2026/05/260518-Foundations-Naming-Rights-Menu.pdf

OTHER:
- Coalition contact page: https://www.centralfloridahomeless.org/contact
- Press releases: https://www.centralfloridahomeless.org/press-releases
- Financial documents / 990s: https://www.centralfloridahomeless.org/financial-documents
- Careers at the Coalition: https://www.centralfloridahomeless.org/careers

If someone asks to be contacted personally — collect their name, email, phone, and what they want to learn more about, and tell them you'll have someone from the team reach out.`,
    metadata: { source: SOURCE_TAG, site: 'both', kind: 'action', intent: 'more_info' },
  },
]

// ── Hope's prompts, intents, focuses ─────────────────────────────────────

const PERSONALITY = `You are Hope. You are the voice of the Foundations Project — the Coalition for the Homeless of Central Florida's capital campaign to build a new Center for Women & Families and a new Pathways Administration Center in downtown Orlando.

Tone: warm, grounded, hopeful. Speak like a thoughtful campaign teammate who's been on the campus, met the families, and cares about getting donors the right information — not a corporate fundraiser, not a chatbot. Match the campaign's voice: "Building. Pathways. Home."

Values:
- Dignity always. Refer to people experiencing homelessness as people — women, men, families, children, neighbors. Never "the homeless" as a noun.
- Honesty over hype. Use the numbers from the campaign materials. Don't inflate, don't speculate, don't invent statistics.
- Generosity is a choice donors make freely. Never pressure. Welcome small gifts and major gifts with equal warmth.
- Stories matter. When a donor asks "why does this matter," lean on the real client stories the Coalition has published (Della, Anna, Hilda, Tramaine, Kevin, Anglie & Leon, Sal, Madison, Antonio, Horace, and others).`

const SYSTEM_PROMPT_BASE = `You are Hope, the donor-facing AI assistant for the Foundations Project — a capital campaign of the Coalition for the Homeless of Central Florida.

WHAT THE FOUNDATIONS PROJECT IS:
- A capital initiative to build a new Center for Women & Families and a new Pathways Administration Center on the Coalition's downtown Orlando campus.
- Tagline: "Building. Pathways. Home."
- Two new buildings, plus expanded programming across shelter, bridge housing, healthcare clinic, kitchen/dining, childcare, day services, outreach, and rapid rehousing.
- Result: ~40-50% increase in service capacity (800 → 1,160 people served daily; 230k → 335k meals/year; 2,823 → 3,952 permanent housing placements/year).
- Leadership: Brad Butterstein (President & CEO) and Dr. Leon Kirkpatrick (Director of the Capital Campaign).

WHAT THE COALITION IS:
- The Coalition for the Homeless of Central Florida — the parent organization that runs the Center for Women & Families, the Men's Service Center, the kitchen and dining hall, day services, the guest portal, the housing programs, and the volunteer/community-engagement work. The Foundations Project is its capital campaign.
- Website: centralfloridahomeless.org

HOW TO ANSWER:
- Use the knowledge in your context window. It's drawn from foundationsproject.org and centralfloridahomeless.org and from the official campaign brochure and naming-rights menu PDFs.
- If a question can be answered from your knowledge, answer directly and warmly. Share specifics — numbers, building features, story names, contact names.
- If you don't have the answer, say so honestly and offer to connect the user to Brad Butterstein (Brad.Butterstein@cflhomeless.org, 407-652-5270) or Dr. Leon Kirkpatrick (Leon.Kirkpatrick@cflhomeless.org, 407-927-0860). Never invent facts, statistics, names, or quotes.
- When you reference a donate, volunteer, or more-info action, surface the actual URL or contact info inline as a markdown link. Don't just say "visit our website."

DO NOT:
- Use the phrase "the homeless" as a noun. Always say "people experiencing homelessness," "women and families," "neighbors," etc.
- Pressure or guilt-trip the user about giving. Welcome any level of engagement.
- Invent dollar figures, dates, partner names, or staff names. Use only what's in your knowledge.
- Make claims about specific donors' gifts unless the campaign brochure names them as lead partners (Morgan & Morgan, Disney Worldwide Services Inc, Bezos Family Foundation, Truist, Wells Fargo, EA Sports, AdventHealth).`

const INTENTS = [
  {
    label: 'Donate',
    description: 'The user is signaling interest in giving money — asking how to donate, ways to give, naming gifts, planned giving, matching, stock gifts, capital campaign contributions, or how their gift will be used.',
    keywords: ['donate', 'donation', 'give', 'giving', 'gift', 'pledge', 'contribute', 'contribution', 'fund', 'sponsor', 'naming', 'capital', 'planned giving', 'legacy', 'stock', 'major gift'],
    message: 'Acknowledge their generosity warmly and concretely. Surface the right path: for online gifts, point to the secure donor portal (https://wl.donorperfect.net/weblink/weblink.aspx?name=cfth&id=388). For major / naming gifts, connect them to Dr. Leon Kirkpatrick (Leon.Kirkpatrick@cflhomeless.org, 407-927-0860). Match the level of their question.',
    enabled: true,
  },
  {
    label: 'Volunteer',
    description: 'The user wants to give time — volunteer individually, organize a group volunteer day, host a drive, mentor, or otherwise show up physically. Includes corporate volunteer days, youth/family volunteering, faith-group involvement.',
    keywords: ['volunteer', 'volunteering', 'serve', 'help out', 'work with', 'group day', 'corporate day', 'drive', 'donate items', 'donate time', 'in-kind', 'mentor'],
    message: 'Be welcoming and specific. Point them to the Take Action hub (https://www.centralfloridahomeless.org/take-action) for general signup, and mention concrete examples (serving meals, group volunteer days, drives, family volunteering via Kids Give Back). Offer to connect them to staff if they want a custom plan.',
    enabled: true,
  },
  {
    label: 'More Information Requested',
    description: 'The user wants to learn more, be contacted, get a brochure, schedule a tour, or have someone from the team reach out. They want a follow-up, not an immediate answer.',
    keywords: ['contact me', 'reach out', 'follow up', 'follow-up', 'tour', 'visit', 'brochure', 'pdf', 'more info', 'more information', 'learn more', 'speak to', 'talk to someone', 'someone reach out', 'get in touch'],
    message: 'Offer the right next step: share the campaign brochure PDF link (https://foundationsproject.org/wp-content/uploads/2026/02/260227-FP-Campaign-Brochure.pdf) and the naming-rights menu (https://foundationsproject.org/wp-content/uploads/2026/05/260518-Foundations-Naming-Rights-Menu.pdf) when relevant. If they want a person, collect their name, email, phone, and what they want to learn more about, and tell them Brad or Leon will follow up. Don\'t pretend you\'ve scheduled anything yourself.',
    enabled: true,
  },
]

const FOCUSES = [
  { slug: 'campaign_overview', label: 'Campaign overview', description: 'The reply explained what the Foundations Project is, what it builds, or why it matters.', enabled: true },
  { slug: 'naming_opportunities', label: 'Naming opportunities', description: 'The reply discussed a specific naming opportunity or gift level (clinic, kitchen, dining room, bridge housing, etc.) and dollar amount.', enabled: true },
  { slug: 'capacity_impact', label: 'Capacity / impact metrics', description: 'The reply quoted measurable outcomes — people served, meals, placements, beds, youth/childcare program counts, ER reductions.', enabled: true },
  { slug: 'coalition_programs', label: 'Coalition programs', description: 'The reply explained an ongoing Coalition program (shelter, kitchen, day services, drop-in, outreach, etc.) separate from the capital campaign itself.', enabled: true },
  { slug: 'client_stories', label: 'Client stories', description: 'The reply shared or referenced a real client story from the Coalition (Della, Anna, Hilda, Sal, Madison, Antonio, Kevin, Tramaine, Anglie & Leon, etc.).', enabled: true },
  { slug: 'how_to_give', label: 'How to give', description: 'The reply walked the user through donation paths — online portal, major gifts, naming, planned giving, stock, matching.', enabled: true },
  { slug: 'how_to_volunteer', label: 'How to volunteer', description: 'The reply explained ways to volunteer — individual, group, drives, Kids Give Back, Housing Heroes.', enabled: true },
  { slug: 'leadership_contacts', label: 'Leadership / contacts', description: 'The reply named Brad Butterstein, Dr. Leon Kirkpatrick, or provided campaign contact information.', enabled: true },
]

const CONFIG = {
  name: 'Hope',
  subtitle: 'Foundations Project · Coalition for the Homeless',
  avatarLetter: 'H',
  headerGradient: 'linear-gradient(135deg, #0f2746, #2563a6)',
  avatarGradient: 'linear-gradient(135deg, #d4ae3c, #b08828)',
  accentColor: '#d4ae3c',
  pageBg: '#f4f0e6',
  userBubbleBg: '#0f2746',
  websiteUrl: 'https://foundationsproject.org',
  websiteLabel: 'foundationsproject.org',
  placeholder: 'Ask about the Foundations Project, the Coalition, how to give...',
  initialMessage: "Hi — I'm Hope. I can answer questions about the Foundations Project capital campaign, the new Center for Women & Families, the Coalition for the Homeless of Central Florida, and how you can be part of building pathways home. What would you like to know?",
  suggestions: [
    'What is the Foundations Project?',
    "What's the new Center for Women & Families?",
    'How can I support the campaign?',
    'What naming opportunities are still available?',
    'How can I volunteer?',
  ],
  askName: false,
  language: 'en',
}

// ── Embedding ─────────────────────────────────────────────────────────────

async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY missing')
  const SAFE = 28_000
  const safe = texts.map(t => t.length > SAFE ? t.slice(0, SAFE) : t)
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: safe }),
  })
  if (!res.ok) throw new Error('Embeddings API ' + res.status + ': ' + await res.text())
  const data = await res.json()
  return data.data.map((d: any) => d.embedding as number[])
}

async function main() {
  const raw = JSON.parse(readFileSync(PAGES_PATH, 'utf-8'))
  const pages: Page[] = raw.pages

  const ok = pages.filter(p => p.ok && p.blocks && p.blocks.length > 0)
  const failed = pages.filter(p => !p.ok || !p.blocks || p.blocks.length === 0)
  console.log('[load] ' + pages.length + ' pages → ' + ok.length + ' with content / ' + failed.length + ' empty')

  const webChunks: Chunk[] = []
  for (const p of ok) webChunks.push(...chunkPage(p))

  const allChunks: Chunk[] = [...PDF_CHUNKS, ...ACTION_CHUNKS, ...webChunks]
  const byCounts = allChunks.reduce((acc: Record<string, number>, c) => { acc[c.metadata.site] = (acc[c.metadata.site] || 0) + 1; return acc }, {})
  console.log('[chunks] ' + allChunks.length + ' total: ' + JSON.stringify(byCounts))
  console.log('[chunks]   - ' + PDF_CHUNKS.length + ' PDF, ' + ACTION_CHUNKS.length + ' action, ' + webChunks.length + ' web')

  if (DRY_RUN) {
    console.log('\n--- DRY_RUN — sample chunk preview ---\n')
    console.log(allChunks[0]?.content || '(none)')
    console.log('\n--- DRY_RUN — agent config preview ---\n')
    console.log({ name: AGENT_NAME, slug: AGENT_SLUG, org_id: ORG_ID, intents: INTENTS.map(i => i.label), focuses: FOCUSES.map(f => f.slug) })
    console.log('\n[dry-run] no writes. Re-run without DRY_RUN=1 to apply.')
    return
  }

  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // 1. Upsert the agent row
  const { data: existing } = await service
    .from('agents')
    .select('id, name, slug')
    .eq('slug', AGENT_SLUG)
    .maybeSingle()

  let agentId: string
  const agentPayload = {
    org_id: ORG_ID,
    name: AGENT_NAME,
    slug: AGENT_SLUG,
    status: 'active',
    personality: PERSONALITY,
    system_prompt: SYSTEM_PROMPT_BASE,
    config: CONFIG,
    intents: INTENTS,
    focuses: FOCUSES,
  }
  if (existing) {
    agentId = existing.id
    const { error: uErr } = await service.from('agents').update(agentPayload).eq('id', agentId)
    if (uErr) { console.error('[agent] update failed: ' + uErr.message); process.exit(1) }
    console.log('[agent] updated existing ' + agentId)
  } else {
    const { data: inserted, error: iErr } = await service.from('agents').insert(agentPayload).select('id').single()
    if (iErr || !inserted) { console.error('[agent] insert failed: ' + iErr?.message); process.exit(1) }
    agentId = inserted.id
    console.log('[agent] created ' + agentId)
  }

  // 2. Clear prior chunks for this source tag (idempotent)
  const { data: existingChunks } = await service
    .from('agent_knowledge_chunks')
    .select('id')
    .eq('bot_id', agentId)
    .contains('metadata', { source: SOURCE_TAG })
  if (existingChunks && existingChunks.length > 0) {
    console.log('[chunks] clearing ' + existingChunks.length + ' prior chunks with source=' + SOURCE_TAG)
    const { error: dErr } = await service
      .from('agent_knowledge_chunks')
      .delete()
      .eq('bot_id', agentId)
      .contains('metadata', { source: SOURCE_TAG })
    if (dErr) { console.error('[chunks] clear failed: ' + dErr.message); process.exit(1) }
  }

  // 3. Insert all chunks (in batches)
  const rows = allChunks.map(c => ({ bot_id: agentId, title: c.title, content: c.content, metadata: c.metadata }))
  const inserted: any[] = []
  const INS_BATCH = 100
  for (let i = 0; i < rows.length; i += INS_BATCH) {
    const slice = rows.slice(i, i + INS_BATCH)
    const { data, error } = await service.from('agent_knowledge_chunks').insert(slice).select('id, title, content')
    if (error) { console.error('[chunks] insert failed at ' + i + ': ' + error.message); process.exit(1) }
    if (data) inserted.push(...data)
    console.log('[chunks] inserted ' + Math.min(i + INS_BATCH, rows.length) + '/' + rows.length)
  }

  // 4. Embed in batches of 50
  if (inserted.length > 0) {
    const BATCH = 50
    let embedded = 0
    for (let i = 0; i < inserted.length; i += BATCH) {
      const batch = inserted.slice(i, i + BATCH)
      const texts = batch.map((c: any) => c.title + '\n' + c.content)
      const vecs = await embedBatch(texts)
      for (let j = 0; j < batch.length; j++) {
        if (vecs[j]) {
          const { error: uErr } = await service.from('agent_knowledge_chunks')
            .update({ embedding: JSON.stringify(vecs[j]) })
            .eq('id', (batch[j] as any).id)
          if (uErr) console.error('[embed] update failed: ' + uErr.message)
          else embedded++
        }
      }
      console.log('[embed] ' + Math.min(i + BATCH, inserted.length) + '/' + inserted.length)
    }
    console.log('[embed] done ' + embedded + '/' + inserted.length)
  }

  console.log('\n✔ Hope is ready')
  console.log('   id:   ' + agentId)
  console.log('   slug: ' + AGENT_SLUG)
  console.log('   url:  https://sentimetrx.com/b/' + AGENT_SLUG + '?site=foundations')
  console.log('   url:  https://sentimetrx.com/b/' + AGENT_SLUG + '?site=coalition')
}

main().catch(e => { console.error(e); process.exit(1) })
