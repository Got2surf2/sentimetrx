// app/api/mco/shops/route.ts
//
// POST — return shop cards for the /demo/mco canvas's ShopsCard.
// Body: { context?: "terminal_a_airside" | "terminal_b_airside" |
//                  "terminal_c_airside" | "landside_main_terminal" }
// Public, CORS-open. No live API call — backed by data/mco_shops.json.

import { NextResponse, type NextRequest } from 'next/server'
import { shopsForContext } from '@/lib/shops'

export const dynamic = 'force-dynamic'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors })
}

export async function POST(req: NextRequest) {
  let body: any = {}
  try { body = await req.json() } catch {}
  const context = typeof body?.context === 'string' ? body.context.slice(0, 64) : undefined
  const shops = shopsForContext(context)
  return NextResponse.json({ shops }, { headers: cors })
}
