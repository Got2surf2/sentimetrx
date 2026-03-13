// app/api/industry-themes/route.ts
// Serves the proprietary INDUSTRY_THEMES object.
// Never expose this data directly in client bundles.
// No auth required -- anyone on the platform can access industry libraries.

import { NextResponse } from 'next/server'
import { INDUSTRY_THEMES } from '@/lib/industryThemes'

export async function GET() {
  return NextResponse.json(INDUSTRY_THEMES)
}
