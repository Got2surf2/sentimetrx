// app/api/townhall/grade-description/route.ts
// POST — AI grades the event description for completeness (1-5 scale).
// Thin wrapper around lib/townhallActivationGate.gradeEventDescription so
// the create/edit UIs and the activation gate share the same scoring rubric.

import { NextResponse } from 'next/server'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { gradeEventDescription } from '@/lib/townhallActivationGate'

export const dynamic = 'force-dynamic'
export const maxDuration = 10

export async function POST(req: Request) {
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { description, industry } = body
  const grade = await gradeEventDescription(description || '', industry)
  return NextResponse.json(grade)
}
