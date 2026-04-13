// POST /api/nora-chat
// Public endpoint — AI chatbot for answering questions about Tabla Cuisine.
// Uses Claude with a comprehensive knowledge base about the restaurant.

import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

const ALLOWED_ORIGINS = [
  'https://www.tablacuisine.com',
  'https://tablacuisine.com',
]

function corsHeaders(origin: string | null) {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  return headers
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin')
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) })
}

const KNOWLEDGE_BASE = `
# TABLA CUISINE — Complete Knowledge Base

## Restaurant Overview
Tabla Indian Restaurant is a multi-location Indian, Indo-Chinese, and Thai restaurant chain established in 2008. Known for authentic flavors using aromatic spices ground in-house and fresh herbs. The tagline is "Excellence in every bite. Tradition in every delivery."

Website: https://www.tablacuisine.com
Email: info@tablacuisine.com
Phone: (407) 248-9400

## Cuisine
- Authentic Indian, Indo-Chinese, and Thai food
- Spices ground in-house, fresh herbs
- Caters to all dietary needs: vegetarian, non-vegetarian, gluten-free, and vegan
- Signature dishes: Butter Chicken, Dal Makhani, Garlic Naan, Tandoori classics, Kebabs, Biryanis, Kadai specialties
- Affordable pricing

## Locations (11 total)

### Florida
- **Orlando** — 5847 Grand National Drive, FL 32819
- **Winter Park** — 216 N Park Ave Suite H, FL 32789
- **Lake Nona** — 9971 Tagore Place Suite 9, Orlando, FL 32832
- **Oviedo** — 945 City Plaza Way Ste 1001, FL 32765
- **Orlando Cafe** — 5829 Grand National Dr Suite A, FL 32819
- **Clermont** — 2447 S. Hwy 27, FL 34711

### Other States
- **Schaumburg, IL** — 1091 N Salem Dr, IL 60194
- **Richmond, KY** — 467 Eastern Bypass A, KY 40475
- **The Colony, TX** — 4940 State Hwy 121 Ste 120, TX 75056
- **Eden Prairie, MN** — 16518 W 78th, MN 55346
- **Grapevine, TX** — 1000 Texan Trail #130, TX 76051
- **Lexington, KY** — 2270 Nicholasville Rd #120

### Typical Hours
- Monday-Friday: 11:30 AM – 3:00 PM (lunch), 4:00 PM – 9:00/11:00 PM (dinner)
- Saturday-Sunday: 11:30 AM – 9:00/10:00/11:00 PM (varies by location)
- Hours may vary by location — check the website for specifics

## Services
- **Dine-In** — Reserve via OpenTable at most locations
- **Order Online** — Pickup and delivery available
- **Catering** — Full catering services for events and ballrooms via tablacatering.com
- **Gift Cards** — Available for all occasions
- **Mobile App** — Order online via the Tabla app (Google Play), with faster checkout and app-only pricing
- **Franchise** — Franchise opportunities available via tablafranchise.com

## Masala Club Loyalty Program
- 10,000+ members
- Earn points on every visit
- Exclusive rewards and special birthday treats
- "Royal privileges" for members
- Sign up via Toast Tab

## Dining Experience
- Modern and traditional design blend
- Elegant wooden tables, warm lighting, contemporary bar seating
- Described as an "artisanal sanctuary"
- Known for royal hospitality

## Notable Recognition
- Multiple awards (see website Awards page)
- Highly rated by food critics and local guides
- Praised for authentic flavors, ambiance, and hospitality

## Charity
Tabla is involved in charitable activities — details on the Charity page at tablacuisine.com
`

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin')
  const cors = corsHeaders(origin)

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
  const rl = checkRateLimit('nora-chat:' + ip, 30, 60000)
  if (rl.limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: cors })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: cors }) }

  const { messages } = body
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'messages required' }, { status: 400, headers: cors })
  }

  const recentMessages = messages.slice(-20)

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: `You are Nora, the Tabla Cuisine AI assistant. You're warm, welcoming, and passionate about great food — like a friendly host at the restaurant.

HARD LIMIT: 1-3 sentences max. Treat every word as expensive. If you can say it in fewer words, do.

TONE: Warm and inviting like a great restaurant host. Be enthusiastic about the food without being over-the-top. Never sound like a corporate FAQ.

DISCOVERY: If someone asks a vague question, ask what they need — looking for a location, want to make a reservation, curious about the menu, or planning an event?

LOCATION-AWARE: Tabla has 11 locations across FL, IL, KY, TX, and MN. If someone asks about a location, give them the specific address and suggest they check tablacuisine.com for current hours since they vary.

STYLE: No preamble. No "Great question!" No bullet lists unless 3+ items and each under 8 words. End with a helpful next step when natural — like suggesting they reserve on OpenTable or order online.

ACCURACY: Don't invent menu items or prices not in the knowledge base. For specific menu questions, suggest checking the menu on tablacuisine.com or the Tabla app. Point unknowns to info@tablacuisine.com or (407) 248-9400.

${KNOWLEDGE_BASE}`,
        messages: recentMessages,
      }),
      signal: AbortSignal.timeout(15000),
    })

    if (!response.ok) throw new Error('API error: ' + response.status)

    const data = await response.json()
    const text = data.content?.[0]?.text || 'Sorry, I had trouble generating a response. Please try again.'

    return NextResponse.json({ reply: text }, { headers: cors })
  } catch (err: any) {
    console.error('Nora chat error:', err)
    return NextResponse.json({ reply: "I'm having trouble connecting right now. Please try again in a moment, or reach out to info@tablacuisine.com for help." }, { headers: cors })
  }
}
