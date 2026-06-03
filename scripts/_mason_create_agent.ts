/* eslint-disable */
// Create Mason — a focused, donor-facing agent for the FOUNDATIONS PROJECT
// capital campaign only (foundationsproject.org). Unlike the broader "Hope"
// agent (which carries the full Coalition for the Homeless KB), Mason is scoped
// to the capital raise: what's being built, the impact, naming opportunities,
// and how to give. Mason knows just enough about the Coalition to hand people
// off to centralfloridahomeless.org for shelter services, getting help,
// volunteering, and ongoing programs.
//
// Name: "Mason" = one who builds — a nod to "Building. Pathways. Home."
//
// What this script does (idempotent — upserts by slug):
//   1. Creates (or reuses) the `mason` agent row in the Larry Kahn org.
//   2. Sets system_prompt, personality, config, intents, focuses.
//   3. Clears prior chunks tagged source=mason_kb_2026_06_03 and reseeds a
//      hand-encoded, fact-verified KB drawn from the June 2026 crawl of
//      foundationsproject.org (homepage + Campaign Brochure PDF + the
//      June 1 Naming Rights Menu PDF + the news articles).
//   4. Embeds all chunks with text-embedding-3-small.
//
// Every fact below was verified against the live site / PDFs on 2026-06-03.
// Do not add numbers, names, or quotes that aren't in that source material.
//
// Run:
//   DRY_RUN=1 node_modules/.bin/tsx scripts/_mason_create_agent.ts
//   node_modules/.bin/tsx scripts/_mason_create_agent.ts

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

const ORG_ID = '679024db-ef2a-4b50-89cb-12ec360f48af' // Larry Kahn org (same as Hope)
const AGENT_SLUG = 'mason'
const AGENT_NAME = 'Mason'
const SOURCE_TAG = 'mason_kb_2026_06_03'

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true'

const BROCHURE_URL = 'https://foundationsproject.org/wp-content/uploads/2026/02/260227-FP-Campaign-Brochure.pdf'
const NAMING_URL = 'https://foundationsproject.org/wp-content/uploads/2026/06/260601-Naming-Rights-Menu-LR.pdf'
const DONOR_PORTAL = 'https://wl.donorperfect.net/weblink/weblink.aspx?name=cfth&id=388'
const COALITION_SITE = 'https://www.centralfloridahomeless.org'

type Chunk = { title: string; content: string; metadata: Record<string, any> }

const m = (extra: Record<string, any> = {}): Record<string, any> => ({ source: SOURCE_TAG, site: 'foundations', ...extra })

// ── Knowledge base — hand-encoded from the verified June 2026 crawl ──────────
const CHUNKS: Chunk[] = [
  {
    title: 'Foundations Project — What it is (overview)',
    content: `The FOUNDATIONS PROJECT is the capital campaign of the Coalition for the Homeless of Central Florida. Its purpose is to build a new Center for Women & Families and a new Pathways Administration Center on the Coalition's downtown Orlando campus, and to scale the services that move people from crisis to permanent housing.

Campaign tagline: "Building. Pathways. Home."

Vision: "The Coalition envisions a community where no woman or child sleeps unsheltered. The Foundations Project will create pathways from crisis to stability for 1,160 people a day, restoring safety, dignity, and home."

The Story Forward — Laying the Groundwork for Lives Rebuilt: Every lasting home begins with a foundation. For single women and families in crisis, that foundation is safety, stability, and a clear route to a front door they can call their own. The Foundations Project is the blueprint to deliver exactly that — purpose-built spaces, essential services, and a predictable, dignified journey from first night to new keys. These are not simply new buildings; they are the structural system that carries families from instability to independence.

The Foundations Project is a capital initiative of The Coalition (the Coalition for the Homeless of Central Florida). Website: FoundationsProject.org.`,
    metadata: m({ kind: 'overview', source_url: 'https://foundationsproject.org/' }),
  },
  {
    title: 'What the Foundations Project is Building — Center for Women & Families',
    content: `The flagship of the Foundations Project is a NEW CENTER FOR WOMEN & FAMILIES — a purpose-built, six-story building that replaces the Coalition's aging Center for Women and Families. It includes:

- Dignified, Capacity-Optimized Shelter: Trauma-informed design with privacy, security, and restorative sleep so parents, children, and single women can stabilize quickly and focus on work, school, and housing. Adds 112 additional short-term residential shelter beds over current capacity, increasing safe nights and reducing length of stay.
- On-Site Integrated Health Clinic: Primary and preventive care (immunizations, well-checks, chronic-condition support) plus dental services and mental/behavioral health — reducing avoidable ER use and strengthening family wellness.
- Modern Kitchen & Dining Hall: A commercial kitchen engineered for high-volume production — roughly 337,000 meals annually once fully built — reliable nutrition that fuels children and adults through the most demanding phase of transition while addressing food insecurity across the community.
- Bridge Housing Units: A short, critical span between shelter and a lease. Adds 96 home-like beds (32 bridge housing units) that lower costs, reduce returns to shelter, and accelerate the path to a permanent address.
- Childcare & Youth Programs Expansion: Fully accredited on-site nursery and childcare, plus after-school and enrichment programming — serving 40–50% more children — so parents can pursue work and housing while kids maintain school continuity.
- Outreach & Diversion: Proactive field teams and front-door problem-solving that divert families from entering shelter when safe alternatives exist.
- Rapid Rehousing + Landlord Partnerships: Dedicated housing specialists and owner relationships that convert applications to approvals — and approvals to signed leases — faster and more durably.
- Day Services Expansion: Increased capacity for showers, laundry, mail, lockers, cooling/warming spaces, a salon, and navigation — more same-day, low-barrier support that preserves dignity.`,
    metadata: m({ kind: 'project', source_url: BROCHURE_URL }),
  },
  {
    title: 'The Building — facts, design, and address',
    content: `The new Center for Women & Families is a six-story, 92,000-square-foot building designed by Zyscovich Architects to resemble a mixed-use apartment building rather than an institutional shelter. The project's reported cost is approximately $60 million, and funding is still being raised before and during construction.

The new building replaces the Coalition's current Center for Women and Families, nearly doubling its capacity with 112 new beds.

Location: the Coalition's downtown Orlando campus in the Parramore neighborhood, bordered by N Terry Avenue, Central Boulevard, N Parramore Avenue, and Ossie Street — directly adjacent to Inter&Co Stadium and the existing Men's Service Center. The current Center for Women and Families / shelter intake is at 18 N. Terry Avenue, Orlando.

In January 2025 the Orlando City Council passed the first reading of an ordinance to consolidate seven properties to modernize the Coalition's campus, advancing the expansion.

A live Construction Cam (updates beginning Q2 2026) and a Campaign Tracker are available on FoundationsProject.org.`,
    metadata: m({ kind: 'building', source_url: 'https://foundationsproject.org/news/coalition-for-the-homeless-planned-orlando-shelter-will-look-like-apartments/' }),
  },
  {
    title: 'Pathways Administration Center — the operational backbone',
    content: `The second new building in the Foundations Project is the PATHWAYS ADMINISTRATION CENTER — the operational backbone of the campus.

By consolidating staff and volunteer teams under one roof, the Pathways Administration Center relocates back-office functions out of guest housing, freeing square footage for direct services — enabling more beds, more clinical touchpoints, and more family-facing programs. The result is a stronger ecosystem of community partnerships, clearer accountability, and a measurable lift in throughput from first contact to stable housing.

In short, this building transforms overhead into impact infrastructure. Together with the new Center for Women & Families, it forms a single, load-bearing system: a foundation that supports every step from crisis to home.`,
    metadata: m({ kind: 'project', source_url: BROCHURE_URL }),
  },
  {
    title: 'Why Now & Measurable Results — capacity and impact',
    content: `Why Now? Demand has risen while an aging facility constrains throughput. Without expanded, up-to-date space and services, families face costly detours — street, ER, shelter, repeat. The Foundations Project replaces those weak links with an integrated, efficient structure that moves people forward faster and keeps them there.

Results You Can Measure — a roughly 40–50% increase in service capacity:
- People served daily: ~800 today → ~1,160 tomorrow (higher velocity and reduced length of stay).
- Meals produced: ~230,000 today → ~335,000 tomorrow (kitchen engineered for ~337,000 annual capacity).
- Permanent housing placements: ~2,823 today → ~3,952 tomorrow (powered by rapid rehousing and owner engagement).
- Youth programs: ~91 participants annually today → ~131 tomorrow.
- Nursery & childcare program: ~37 participants today → ~54 tomorrow.
- Healthcare access: the on-site clinic is projected to reduce avoidable ER visits and calls to Emergency Services by about 50% and improve family wellness, mentally and physically.

Translation: fewer interruptions, stronger stability, and more families crossing the threshold into permanent homes.`,
    metadata: m({ kind: 'impact', source_url: BROCHURE_URL }),
  },
  {
    title: 'Strategic Location — built in the heart of Orlando',
    content: `The new facilities rise on the Coalition's downtown Orlando campus in Parramore — close to transit, jobs, schools, healthcare, and partner agencies — so each service is one connected system rather than a scattered set of stops. Proximity isn't incidental; it's part of the structural advantage.

Campus components: the New Center for Women and Families, the New Pathways Administration Center, the existing Men's Service Center, and the current Center for Women and Families (being replaced). The campus sits directly adjacent to Inter&Co Stadium, in the west-side gateway district of downtown Orlando — positioned to help catalyze a safer, more vibrant area.

Outdoor campus features include a community mural courtyard, a family dining courtyard, a playground, a basketball court, and a multi-sport turf field.`,
    metadata: m({ kind: 'location', source_url: BROCHURE_URL }),
  },
  {
    title: 'Naming Opportunities — Building, Campus & Ground Level',
    content: `Naming opportunities at the New Center for Women & Families let individuals, families, and companies attach their name to transformative spaces. (Prices and availability as of the June 1, 2026 Naming Rights Menu — confirm current status with the campaign.)

BUILDING + CAMPUS:
- Building (the whole new Center for Women & Families): SOLD
- Campus (overall campus naming): $10,000,000

GROUND LEVEL:
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

For naming gifts, contact Dr. Leon Kirkpatrick, Director of the Capital Campaign — 407-927-0860, Leon.Kirkpatrick@cflhomeless.org.`,
    metadata: m({ kind: 'naming', source_url: NAMING_URL }),
  },
  {
    title: 'Naming Opportunities — Shelter & Bridge Housing Floors',
    content: `Naming opportunities on the shelter and bridge-housing floors of the New Center for Women & Families (as of the June 1, 2026 Naming Rights Menu):

SECOND FLOOR — "Family" Shelter Housing:
- "Family" Shelter Housing Floor (whole floor): $1,750,000
- One "Family" Shelter Unit — 8 Beds (16 units available): $500,000 each

THIRD FLOOR — "Family" Shelter Housing (additional family floor):
- "Family" Shelter Housing Floor (whole floor): $1,750,000
- One "Family" Shelter Unit — 8 Beds (16 units available): $500,000 each

FOURTH FLOOR — "Single" Shelter Housing (for single women):
- "Single" Shelter Housing Floor (whole floor): $1,750,000
- Two "Single" Shelter Units — 6 Beds (16 units available): $250,000 each

FIFTH FLOOR — "Family" Bridge Housing:
- "Family" Bridge Housing Floor (whole floor): $2,000,000
- One "Family" Bridge Housing Unit — 4 Beds (16 units available): $600,000 each

SIXTH FLOOR — "Single" Bridge Housing:
- "Single" Bridge Housing Floor (whole floor): $2,000,000
- One "Single" Bridge Housing Unit — 2 Beds (6 units available): $400,000 each

Bridge Housing is the short, dignified, home-like transition between emergency shelter and a permanent lease — it lowers costs, reduces returns to shelter, and speeds families and individuals to a permanent address.

For naming gifts, contact Dr. Leon Kirkpatrick, Director of the Capital Campaign — 407-927-0860, Leon.Kirkpatrick@cflhomeless.org.`,
    metadata: m({ kind: 'naming', source_url: NAMING_URL }),
  },
  {
    title: 'Investment & Partnerships — how a gift is used and who has joined',
    content: `Strengthening the Foundation of a Region: Leadership capital funds the full campus build-out — constructing the new Center for Women & Families and the Pathways Administration Center — while scaling the services that turn crisis into long-term stability. This investment stands up the on-site clinic; expands kitchen and dining to ~337,000 meals annually; deploys 32 units of bridge housing; and grows childcare and youth programs to serve 40–50% more children. It also increases day-services capacity and outreach/diversion to preserve beds for the highest need.

Ways to give:
- Foundational Gifts: Underwrite core systems (clinic, kitchen/dining, bridge housing).
- Naming Opportunities: Facilities, program areas, family spaces, and campus features.
- Corporate & Philanthropic Partnerships: Workforce pipelines, volunteer programs, and in-kind professional services.
- Public-Sector Alignment: A direct lever for community health, safety, and economic mobility.

Lead campaign partners include: Morgan & Morgan, Disney Worldwide Services Inc, Bezos Family Foundation, Truist, Wells Fargo, EA Sports, and AdventHealth. The broader Foundations Project community partners also include the City of Orlando, Orange County Government, Foundry Commercial, VHB, and others. (Only name a partner as a supporter if it appears on these published lists.)`,
    metadata: m({ kind: 'investment', source_url: BROCHURE_URL }),
  },
  {
    title: 'Leadership & Primary Contacts',
    content: `Leadership and primary contacts for the Foundations Project capital campaign:

- Brad Butterstein — President & CEO of the Coalition for the Homeless of Central Florida. Phone: 407-652-5270. Email: Brad.Butterstein@cflhomeless.org.
  Quote: "We are not simply building structures — we are engineering pathways towards independence. With the Foundations Project, families move from a night of uncertainty to the footing of a future they own. Join us in laying the foundation where hope becomes a home."

- Dr. Leon Kirkpatrick — Director of the Capital Campaign. Phone: 407-927-0860. Email: Leon.Kirkpatrick@cflhomeless.org. (Best contact for major gifts and naming opportunities.)

Websites: FoundationsProject.org and CentralFloridaHomeless.org.`,
    metadata: m({ kind: 'contacts', source_url: BROCHURE_URL }),
  },
  {
    title: 'Funding & Momentum',
    content: `Recent funding and momentum for the campaign and campus:

- In February 2026, Congressman Maxwell Frost announced that federal funding legislation signed into law includes $13.4 million for community projects across Central Florida — in addition to $11.9 million he secured in 2024 — strengthening housing, transportation, environmental resilience, and community services. (The published article does not break out exactly how much of the $13.4 million is allocated to the Coalition specifically.)
- In January 2025, the Orlando City Council advanced the expansion by passing the first reading of an ordinance to consolidate seven properties to modernize the Coalition's campus (the six-story, 92,000-square-foot facility).
- May 2026: Central Florida leaders gathered to celebrate a major funding milestone and kick off the Foundations Project / new Center for Women and Families in Parramore.

Funding is still being raised; donor leadership is what moves the project from footing to finish line.`,
    metadata: m({ kind: 'news', source_url: 'https://foundationsproject.org/news/congressman-maxwell-frost-secures-13-4-million-for-central-florida-community-projects/' }),
  },
  {
    title: 'About the Coalition — and when to point people there',
    content: `The Foundations Project is the capital campaign. The Coalition for the Homeless of Central Florida is the parent organization that actually runs the day-to-day services: the Center for Women & Families, the Men's Service Center, the kitchen and dining hall, day services, the housing programs, outreach, and volunteer/community engagement. The Coalition works with the Orlando Police Department (OPD), which transports individuals and families to the shelter at 18 N. Terry Avenue.

Mason's scope is the Foundations Project capital campaign. For anything outside that scope — someone who needs shelter or help right now, questions about ongoing Coalition programs and services, volunteering, careers, or financial documents — point them to the Coalition:
- Coalition website: https://www.centralfloridahomeless.org
- Get help / shelter intake: the Center for Women & Families at 18 N. Terry Avenue, Orlando; or see https://www.centralfloridahomeless.org
- Volunteer / Take Action: https://www.centralfloridahomeless.org/take-action
- Coalition contact page: https://www.centralfloridahomeless.org/contact

If someone appears to be in crisis or needs immediate shelter, be warm and direct: point them to the Coalition and the Center for Women & Families at 18 N. Terry Avenue right away — don't make them work through campaign details first.`,
    metadata: m({ site: 'both', kind: 'coalition_pointer', source_url: COALITION_SITE }),
  },
  // ── Action chunks (intent routing) ─────────────────────────────────────────
  {
    title: 'How to Donate / Ways to Give',
    content: `Ways to give to the Foundations Project capital campaign:

ONLINE GIFTS (any amount): the Coalition's secure donor portal — ${DONOR_PORTAL}

MAJOR & NAMING GIFTS: contact Dr. Leon Kirkpatrick, Director of the Capital Campaign — 407-927-0860, Leon.Kirkpatrick@cflhomeless.org. (Or Brad Butterstein, President & CEO — 407-652-5270, Brad.Butterstein@cflhomeless.org.)

GIVING OPTIONS:
- One-time gifts
- Multi-year commitments / pledges (sustain programs and expand care)
- Foundational Gifts (underwrite a core system — clinic, kitchen/dining, bridge housing)
- Naming Opportunities (facilities, program areas, family spaces, campus features — see the Naming Opportunities entries and the Naming Rights Menu: ${NAMING_URL})
- Corporate & philanthropic partnerships and in-kind support

Welcome every gift warmly, at any level. Never pressure or guilt-trip. Match the response to the size and intent of the question — surface the donor portal for online gifts and Dr. Leon Kirkpatrick for major/naming conversations.`,
    metadata: m({ site: 'both', kind: 'action', intent: 'donate' }),
  },
  {
    title: 'More Information / Request a Follow-up',
    content: `Getting more information about the Foundations Project, or asking someone to follow up:

DOWNLOADABLE MATERIALS:
- Campaign Brochure (PDF): ${BROCHURE_URL}
- Naming Rights Menu (PDF): ${NAMING_URL}

CONTACTS:
- Brad Butterstein — President & CEO — 407-652-5270, Brad.Butterstein@cflhomeless.org
- Dr. Leon Kirkpatrick — Director of the Capital Campaign — 407-927-0860, Leon.Kirkpatrick@cflhomeless.org

OTHER:
- Foundations Project site: https://foundationsproject.org
- Newsletter signup: https://foundationsproject.org/newsletter
- Coalition site: ${COALITION_SITE}

If someone wants a person to reach out, or wants to schedule a tour, collect their name, email, phone, and what they'd like to learn more about, and tell them you'll pass it to Brad or Dr. Leon Kirkpatrick to follow up. Don't claim you've scheduled or sent anything yourself — you can't.`,
    metadata: m({ site: 'both', kind: 'action', intent: 'more_info' }),
  },
]

// ── Mason's prompts, intents, focuses, config ────────────────────────────────

const PERSONALITY = `You are Mason, the voice of the FOUNDATIONS PROJECT — the Coalition for the Homeless of Central Florida's capital campaign to build a new Center for Women & Families and a new Pathways Administration Center in downtown Orlando.

Your name, Mason, means "one who builds" — fitting for a campaign whose promise is "Building. Pathways. Home."

Tone: warm, grounded, hopeful, and concise. Speak like a thoughtful campaign teammate who has walked the campus and cares about getting people the right information — not a corporate fundraiser, not a generic chatbot.

Values:
- Dignity always. Refer to people as women, men, families, children, neighbors, or people experiencing homelessness. Never "the homeless" as a noun.
- Honesty over hype. Use only the numbers and names from the campaign materials. Never inflate, speculate, or invent figures, dates, partners, or quotes.
- Generosity is a free choice. Never pressure or guilt-trip. Welcome small gifts and major gifts with equal warmth.`

const SYSTEM_PROMPT_BASE = `You are Mason, the donor-facing assistant for the FOUNDATIONS PROJECT — the capital campaign of the Coalition for the Homeless of Central Florida.

YOUR SCOPE (what you're for):
- The Foundations Project capital campaign: what it is, what it's building (the new Center for Women & Families and the Pathways Administration Center), the impact and capacity numbers, the building and location, naming opportunities and gift levels, how to give, and campaign leadership/contacts.
- Tagline: "Building. Pathways. Home."

KEY FACTS:
- The campaign builds two new buildings on the Coalition's downtown Orlando (Parramore) campus, plus expanded shelter, bridge housing, an on-site health clinic, kitchen/dining, childcare, day services, outreach, and rapid rehousing.
- Impact once built: ~40–50% more service capacity — ~800 → ~1,160 people served daily; ~230,000 → ~335,000 meals/year; ~2,823 → ~3,952 permanent housing placements/year; clinic projected to cut avoidable ER use ~50%.
- The new Center for Women & Families is a six-story, 92,000 sq ft building (≈$60M) by Zyscovich Architects that replaces the current center and adds 112 shelter beds.
- Leadership: Brad Butterstein (President & CEO, 407-652-5270, Brad.Butterstein@cflhomeless.org) and Dr. Leon Kirkpatrick (Director of the Capital Campaign, 407-927-0860, Leon.Kirkpatrick@cflhomeless.org).

WHAT IS *NOT* YOUR SCOPE — hand off to the Coalition:
- The Coalition for the Homeless of Central Florida runs the ongoing day-to-day services. If someone needs shelter or help right now, asks about current programs/services, wants to volunteer, asks about careers, or otherwise asks something outside the capital campaign, warmly point them to the Coalition at ${COALITION_SITE} (and 18 N. Terry Avenue for the Center for Women & Families). Don't try to deeply answer Coalition-program questions yourself — your sibling resources at centralfloridahomeless.org are the right home for those.
- If anyone seems to be in crisis or needs shelter tonight, lead with warmth and point them straight to the Coalition / 18 N. Terry Avenue — don't bury that under campaign details.

HOW TO ANSWER:
- Use the knowledge in your context (it's from foundationsproject.org and the official Campaign Brochure and Naming Rights Menu PDFs). Answer directly, warmly, and briefly. Share specifics — numbers, building features, gift levels, contact names.
- When you reference a way to give, a PDF, or a contact, surface the actual link or email/phone inline as a markdown link — don't just say "visit our website."
- If you don't know something, say so honestly and offer to connect the person to Brad Butterstein or Dr. Leon Kirkpatrick. Never invent facts, dollar figures, dates, partner names, or quotes.

DO NOT:
- Use "the homeless" as a noun. Say "people experiencing homelessness," "women and families," "neighbors."
- Pressure or guilt-trip anyone about giving.
- Invent dollar figures, dates, partners, or staff names. Only name a partner if it's on the published lists (Morgan & Morgan, Disney Worldwide Services Inc, Bezos Family Foundation, Truist, Wells Fargo, EA Sports, AdventHealth, City of Orlando, Orange County Government, Foundry Commercial, VHB).
- Claim you've scheduled a tour, sent an email, or registered a gift — you can only share the information and ask the team to follow up.`

const INTENTS = [
  {
    label: 'Donate',
    description: 'The user is signaling interest in giving money — asking how to donate, ways to give, gift levels, naming gifts, pledges, multi-year commitments, corporate gifts, or how their gift will be used.',
    keywords: ['donate', 'donation', 'give', 'giving', 'gift', 'pledge', 'contribute', 'contribution', 'fund', 'sponsor', 'naming', 'name a', 'capital', 'major gift', 'commitment'],
    message: `Acknowledge their generosity warmly and concretely. For online gifts of any size, surface the secure donor portal (${DONOR_PORTAL}). For major or naming gifts, connect them to Dr. Leon Kirkpatrick (Leon.Kirkpatrick@cflhomeless.org, 407-927-0860). Match the level of their question; never pressure.`,
    enabled: true,
  },
  {
    label: 'More Information Requested',
    description: 'The user wants to learn more, be contacted, get the brochure or naming menu, schedule a tour, or have someone from the team reach out — they want a follow-up or materials, not just an inline answer.',
    keywords: ['contact me', 'reach out', 'follow up', 'follow-up', 'tour', 'visit', 'brochure', 'pdf', 'menu', 'more info', 'more information', 'learn more', 'speak to', 'talk to someone', 'get in touch', 'email me', 'call me'],
    message: `Offer the right next step: share the Campaign Brochure (${BROCHURE_URL}) and the Naming Rights Menu (${NAMING_URL}) when relevant. If they want a person, collect their name, email, phone, and what they want to learn more about, and tell them Brad Butterstein or Dr. Leon Kirkpatrick will follow up. Don't claim you've scheduled or sent anything yourself.`,
    enabled: true,
  },
  {
    label: 'Coalition Services & Help',
    description: 'The user is asking about something outside the capital campaign — needing shelter or help now, current Coalition programs/services, how to get assistance, volunteering, donating items, careers, or general questions about the Coalition for the Homeless.',
    keywords: ['help', 'shelter', 'need a place', 'homeless', 'stay tonight', 'get help', 'services', 'volunteer', 'volunteering', 'donate items', 'drive', 'careers', 'job', 'programs', 'meals', 'day services', 'intake'],
    message: `Be warm and route them to the Coalition for the Homeless of Central Florida (${COALITION_SITE}) — that's the right home for ongoing services, getting help, and volunteering (Take Action: ${COALITION_SITE}/take-action). If they need shelter or help now, point them to the Center for Women & Families at 18 N. Terry Avenue, Orlando right away. Don't try to fully answer Coalition-program questions yourself.`,
    enabled: true,
  },
]

const FOCUSES = [
  { slug: 'campaign_overview', label: 'Campaign overview', description: 'The reply explained what the Foundations Project is, what it builds, or why it matters.', enabled: true },
  { slug: 'what_were_building', label: "What's being built", description: 'The reply described the new Center for Women & Families, the Pathways Administration Center, or specific spaces/features.', enabled: true },
  { slug: 'capacity_impact', label: 'Capacity / impact metrics', description: 'The reply quoted measurable outcomes — people served, meals, placements, beds, youth/childcare counts, ER reductions.', enabled: true },
  { slug: 'naming_opportunities', label: 'Naming opportunities', description: 'The reply discussed a specific naming opportunity or gift level and its dollar amount.', enabled: true },
  { slug: 'how_to_give', label: 'How to give', description: 'The reply walked the user through donation paths — online portal, major gifts, naming, pledges, corporate.', enabled: true },
  { slug: 'leadership_contacts', label: 'Leadership / contacts', description: 'The reply named Brad Butterstein, Dr. Leon Kirkpatrick, or provided campaign contact information.', enabled: true },
  { slug: 'coalition_referral', label: 'Coalition referral', description: 'The reply pointed the user to the Coalition (centralfloridahomeless.org) for services, help, or volunteering outside the capital campaign.', enabled: true },
]

const CONFIG = {
  name: 'Mason',
  subtitle: 'Foundations Project · Capital Campaign',
  avatarLetter: 'M',
  // Palette matched to foundationsproject.org: brand navy #1b3a5e + warm gold
  // #f7b200 on near-white, with the theme's brick-red #9e2a2f as the CTA accent
  // (gold fails contrast as hover text, so it's reserved for the avatar badge).
  headerGradient: 'linear-gradient(135deg, #1b3a5e, #29527d)',
  avatarGradient: 'linear-gradient(135deg, #f7b200, #d99500)',
  avatarTextColor: '#1b3a5e',
  accentColor: '#9e2a2f',
  pageBg: '#f5f7fa',
  userBubbleBg: '#1b3a5e',
  websiteUrl: 'https://foundationsproject.org',
  websiteLabel: 'foundationsproject.org',
  placeholder: 'Ask about the Foundations Project, the new Center, naming gifts, or how to give…',
  fontFamily: undefined as unknown as string,
  initialMessage: "Hi — I'm Mason. I can tell you about the Foundations Project, the Coalition's capital campaign to build a new Center for Women & Families in downtown Orlando — what we're building, the impact, naming opportunities, and how you can help lay the foundation. What would you like to know?",
  suggestions: [
    'What is the Foundations Project?',
    "What's being built?",
    'What impact will it have?',
    'What naming opportunities are available?',
    'How can I make a gift?',
  ],
  // Name-ask ON (personal touch the user wanted): Mason opens with
  // "Hi, I'm Mason! What's your name?", then greets the person by name and
  // follows with the topical opener below. BotClient resolves askName via
  // `config.askName !== 'false'`, so any non-'false' value enables it.
  askName: 'true',
  language: 'en',
}

// ── Embedding ────────────────────────────────────────────────────────────────
async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY missing')
  const SAFE = 28_000
  const safe = texts.map(t => (t.length > SAFE ? t.slice(0, SAFE) : t))
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: safe }),
  })
  if (!res.ok) throw new Error('Embeddings API ' + res.status + ': ' + (await res.text()))
  const data = await res.json()
  return data.data.map((d: any) => d.embedding as number[])
}

async function main() {
  console.log('[chunks] ' + CHUNKS.length + ' hand-encoded chunks')

  if (DRY_RUN) {
    console.log('\n--- DRY_RUN — agent config preview ---\n')
    console.log({
      name: AGENT_NAME,
      slug: AGENT_SLUG,
      org_id: ORG_ID,
      chunks: CHUNKS.length,
      intents: INTENTS.map(i => i.label),
      focuses: FOCUSES.map(f => f.slug),
    })
    console.log('\n--- DRY_RUN — first chunk ---\n')
    console.log(CHUNKS[0].content)
    console.log('\n[dry-run] no writes. Re-run without DRY_RUN=1 to apply.')
    return
  }

  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // 1. Upsert the agent row (by slug)
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

  // 3. Insert all chunks
  const rows = CHUNKS.map(c => ({ bot_id: agentId, title: c.title, content: c.content, metadata: c.metadata }))
  const { data: inserted, error: insErr } = await service
    .from('agent_knowledge_chunks')
    .insert(rows)
    .select('id, title, content')
  if (insErr || !inserted) { console.error('[chunks] insert failed: ' + insErr?.message); process.exit(1) }
  console.log('[chunks] inserted ' + inserted.length)

  // 4. Embed
  const texts = inserted.map((c: any) => c.title + '\n' + c.content)
  const vecs = await embedBatch(texts)
  let embedded = 0
  for (let j = 0; j < inserted.length; j++) {
    if (vecs[j]) {
      const { error: uErr } = await service
        .from('agent_knowledge_chunks')
        .update({ embedding: JSON.stringify(vecs[j]) })
        .eq('id', (inserted[j] as any).id)
      if (uErr) console.error('[embed] update failed: ' + uErr.message)
      else embedded++
    }
  }
  console.log('[embed] done ' + embedded + '/' + inserted.length)

  console.log('\n✔ Mason is ready')
  console.log('   id:   ' + agentId)
  console.log('   slug: ' + AGENT_SLUG)
  console.log('   url:  https://www.sentimetrx.ai/b/' + AGENT_SLUG)
}

main().catch(e => { console.error(e); process.exit(1) })
