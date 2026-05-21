// app/api/mco/parking/route.ts
//
// GET — live parking availability for MCO, sourced from the GOAA public API
// via lib/parking.ts. Public, unauthenticated, CORS-open — used by the
// /demo/mco canvas's ParkingCard.
//
// Cache lives in lib/parking.ts (60s in-memory); this route is a thin
// JSON pass-through.

import { NextResponse } from 'next/server'
import { fetchParkingAvailability } from '@/lib/parking'

export const dynamic = 'force-dynamic'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors })
}

export async function GET() {
  const lots = await fetchParkingAvailability()
  return NextResponse.json({ lots, fetched_at: Math.floor(Date.now() / 1000) }, { headers: cors })
}
