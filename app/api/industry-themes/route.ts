// app/api/industry-themes/route.ts
// Serves the proprietary INDUSTRY_THEMES object.
// Never expose this data directly in client bundles.

import { NextResponse } from 'next/server'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { INDUSTRY_THEMES } from '@/lib/industryThemes'

export async function GET() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  return NextResponse.json(INDUSTRY_THEMES)
}
