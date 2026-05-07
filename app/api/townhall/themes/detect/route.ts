// app/api/townhall/themes/detect/route.ts
// POST — manually trigger theme detection for a Town Hall session (auth required)

import { NextResponse } from 'next/server'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { detectThemesForSession } from '@/lib/townhallThemeDetection'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: Request) {
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { session_id } = body
  if (!session_id) return NextResponse.json({ error: 'Missing session_id' }, { status: 400 })

  const result = await detectThemesForSession(session_id)
  return NextResponse.json(result)
}
