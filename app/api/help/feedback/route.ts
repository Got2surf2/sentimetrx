// app/api/help/feedback/route.ts
// POST — record a thumbs up/down on a Help (Sherpa, 🧭) answer. Signed-in only.
// This is the KB-gap detector (HELP_AGENT §9): repeated thumbs-down / unhelpful
// answers are the authoring backlog for the next help article. Writes via
// service-role, stamping org_id from the authenticated caller (RLS gives
// org-scoped read only).

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { checkRateLimit } from '@/lib/rateLimit'
import { logError } from '@/lib/log'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { userId, orgId } = await getCallerOrgContext(supabase)
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const rl = await checkRateLimit('help_feedback:user:' + userId, 60, 60000)
  if (rl.limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  let body: { rating?: unknown; session_id?: unknown; question?: unknown; answer?: unknown; page_route?: unknown }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const rating = body.rating === 1 || body.rating === -1 ? body.rating : null
  if (rating === null) return NextResponse.json({ error: 'rating must be 1 or -1' }, { status: 400 })

  const str = (v: unknown, cap: number) => (typeof v === 'string' ? v.slice(0, cap) : null)

  const service = createServiceRoleClient()
  const { error } = await service.from('help_feedback').insert({
    org_id: orgId,
    user_id: userId,
    session_id: str(body.session_id, 100),
    rating,
    question: str(body.question, 2000),
    answer: str(body.answer, 8000),
    page_route: str(body.page_route, 300),
  })
  if (error) { void logError('help.feedback.insert', error); return NextResponse.json({ error: 'Could not save feedback' }, { status: 500 }) }

  return NextResponse.json({ ok: true })
}
