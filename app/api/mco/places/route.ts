// app/api/mco/places/route.ts
//
// POST — resolve { place_ids, context } → PlaceCard[] using lib/places.ts.
// Public, unauthenticated, CORS-open. Caller is the /demo/mco canvas's
// RestaurantsCard which gets place_ids + context from the ui_hints extractor.
//
// No GOOGLE_PLACES_API_KEY env var? lib/places.ts gracefully returns mock
// data scoped to the provided context — the demo still works locally.

import { NextRequest, NextResponse } from 'next/server'
import { fetchPlaceCards } from '@/lib/places'

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
  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: cors })
  }

  const place_ids: string[] = Array.isArray(body?.place_ids)
    ? body.place_ids.filter((s: any) => typeof s === 'string' && s.length <= 96).slice(0, 12)
    : []
  const context: string | undefined =
    typeof body?.context === 'string' && body.context.length <= 64 ? body.context : undefined

  const places = await fetchPlaceCards(place_ids, { fallbackContext: context })
  return NextResponse.json({ places, has_live_data: places.length > 0 && !places[0].is_mock }, { headers: cors })
}
