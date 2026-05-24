// app/api/mco/security/route.ts
//
// GET — live TSA security wait times for MCO, sourced from the GOAA public
// API via lib/securityWait.ts. Public, unauthenticated, CORS-open — used by
// the /demo/mco canvas's SecurityWaitCard.
//
// Cache lives in lib/securityWait.ts (60s in-memory).

import { NextResponse } from 'next/server'
import { fetchSecurityWaits } from '@/lib/securityWait'

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
  const checkpoints = await fetchSecurityWaits()
  return NextResponse.json({ checkpoints, fetched_at: Math.floor(Date.now() / 1000) }, { headers: cors })
}
