// app/api/mco/indoor-map/svg/[id]/route.ts
//
// Server-side proxy for Meridian floor-plan SVGs. The upstream endpoint at
// edit.meridianapps.com requires a Token auth header and isn't directly
// callable from the browser without baking the token into the bundle.
// Proxying here keeps the token server-side AND lets us cache aggressively
// (floor plans rarely change — 1-day public cache).
//
// 404 (not 500) if Meridian rejects; the card renders a fallback.

import { NextResponse } from 'next/server'
import { fetchMapSvg } from '@/lib/meridian'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const id = (params?.id || '').slice(0, 64).replace(/[^a-z0-9_-]/gi, '')
  if (!id) return new NextResponse('bad id', { status: 400 })
  const svg = await fetchMapSvg(id)
  if (!svg) return new NextResponse('upstream unavailable', { status: 502 })
  return new NextResponse(svg, {
    status: 200,
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      // Long client cache — Meridian SVGs are versioned by hash internally
      // and we refetch on the server every 1 h. Public so CDN/Vercel cache.
      'cache-control': 'public, max-age=86400, stale-while-revalidate=604800',
      'access-control-allow-origin': '*',
    },
  })
}
