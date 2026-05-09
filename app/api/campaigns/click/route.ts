// app/api/campaigns/click/route.ts
// Marks a campaign respondent as `clicked` when they land on the survey
// with a ?rid= query param. Used as a fallback when Resend's hosted
// click tracking isn't available (Free plan), so the respondent funnel
// still distinguishes "sent" from "engaged but didn't finish."
//
// Unauth on purpose — the rid is a UUID and the worst an attacker can
// do is mark someone's status as `clicked`. We only ever upgrade from
// `pending` or `sent`; `completed` and other terminal states are
// preserved.

import { createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: { rid?: string }
  try { body = await req.json() } catch { return NextResponse.json({ ok: true }) }

  const rid = body.rid
  // Always 200 so callers can fire-and-forget; we don't want to leak
  // whether a given rid is valid via response codes.
  if (!rid || typeof rid !== 'string') return NextResponse.json({ ok: true })

  const service = createServiceRoleClient()
  await service
    .from('campaign_respondents')
    .update({ status: 'clicked', clicked_at: new Date().toISOString() })
    .eq('recipient_guid', rid)
    .in('status', ['pending', 'sent'])

  return NextResponse.json({ ok: true })
}
