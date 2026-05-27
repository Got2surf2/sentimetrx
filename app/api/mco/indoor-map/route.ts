// app/api/mco/indoor-map/route.ts
//
// POST — pick the best Meridian floor map for a query and return its
// metadata + filtered placemarks. The SVG itself is fetched separately
// via /api/mco/indoor-map/svg/[id] so the JSON response stays small.
//
// Body shape:
//   { terminal?: "A"|"B"|"C", level?: string|number, gate?: string, category?: string }
//
// Response shape:
//   {
//     map: { id, name, group, groupName, level, levelLabel } | null,
//     placemarks: [{ id, name, type, typeName, x, y, … }],
//     svg_url: "/api/mco/indoor-map/svg/<map_id>" | null,
//     other_floors: [{ id, name, levelLabel, group, level }, …]  // sibling floors in the same group
//   }

import { NextResponse, type NextRequest } from 'next/server'
import { fetchMaps, fetchPlacemarks, fetchMapDimensions, findMap, placemarksForMap, type MapInfo } from '@/lib/meridian'

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

  // Sanitize inputs
  const terminal = body?.terminal === 'A' || body?.terminal === 'B' || body?.terminal === 'C' ? body.terminal : undefined
  const level = typeof body?.level === 'string' && body.level.length <= 8 ? body.level
              : typeof body?.level === 'number' ? body.level
              : undefined
  const gate = typeof body?.gate === 'string' && body.gate.length <= 12 ? body.gate : undefined
  const category = typeof body?.category === 'string' && body.category.length <= 64 ? body.category : undefined

  const [maps, placemarks] = await Promise.all([fetchMaps(), fetchPlacemarks()])
  const map = findMap(maps, { terminal, level, gate })

  if (!map) {
    return NextResponse.json({ map: null, placemarks: [], svg_url: null, other_floors: [] }, { headers: cors })
  }

  const pms = placemarksForMap(placemarks, map.id, category)
  const siblings: MapInfo[] = maps
    .filter(m => m.group === map.group && m.id !== map.id)
    .sort((a, b) => a.level - b.level)
    .map(m => ({ ...m, airport: m.airport }))

  // Dimensions are needed client-side to position placemark pins as %.
  // Fetched in parallel with the response — adds ~200ms first time then cached.
  const dims = await fetchMapDimensions(map.id)

  return NextResponse.json({
    map: {
      id: map.id,
      name: map.name,
      group: map.group,
      groupName: map.groupName,
      level: map.level,
      levelLabel: map.levelLabel,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
    },
    placemarks: pms.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      type: p.type,
      typeName: p.typeName,
      typeCategory: p.typeCategory,
      x: p.x,
      y: p.y,
      color: p.color,
    })),
    svg_url: '/api/mco/indoor-map/svg/' + encodeURIComponent(map.id),
    other_floors: siblings.map(m => ({
      id: m.id, name: m.name, level: m.level, levelLabel: m.levelLabel, group: m.group,
    })),
  }, { headers: cors })
}
