// app/api/me/ai-mode/route.ts
//
// Returns the caller's AI state along three dimensions:
//   - orgMode        : the org's AI ceiling (off | platform | byo)
//   - orgProvider    : configured provider when mode=byo
//   - userEnabled    : the caller's individual opt-in (users.ai_enabled)
//   - effective      : userEnabled AND orgMode != 'off'  (what the UI gates on)
//
// PATCH flips users.ai_enabled and inserts an ai_consent_audit row so
// every opt-in / opt-out is recorded with IP + UA. Org admins can set
// availability; users alone control their personal toggle. Rejected
// with 403 when the org has disabled AI entirely (can't opt in to
// something the org doesn't allow).
//
// The server-side AI gates in lib/ai.ts, lib/embeddings.ts,
// lib/moderation.ts, and the ask-ana streaming route are the actual
// runtime guarantees; this endpoint exists so the UI can reflect
// state and so per-user consent is recorded.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { resolveOrgAiConfig } from '@/lib/aiKey'
import { recordUserEvent } from '@/lib/userEvents'

export const dynamic = 'force-dynamic'

function getRequestIp(req: NextRequest): string | null {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    null
  )
}

export async function GET() {
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userRow } = await supabase
    .from('users')
    .select('org_id, ai_enabled')
    .eq('id', user.id)
    .single()
  const orgId = (userRow as { org_id?: string } | null)?.org_id
  const userEnabled = !!(userRow as { ai_enabled?: boolean } | null)?.ai_enabled

  if (!orgId) {
    return NextResponse.json({
      orgMode: 'platform',
      orgProvider: null,
      userEnabled,
      effective: userEnabled,
    })
  }

  const cfg = await resolveOrgAiConfig(orgId)
  return NextResponse.json({
    orgMode: cfg.mode,
    orgProvider: cfg.provider,
    userEnabled,
    effective: userEnabled && cfg.mode !== 'off',
  })
}

export async function PATCH(req: NextRequest) {
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { enabled?: unknown }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 })
  }
  const nextValue = body.enabled

  const { data: userRow } = await supabase
    .from('users')
    .select('org_id, ai_enabled')
    .eq('id', user.id)
    .single()
  const orgId = (userRow as { org_id?: string } | null)?.org_id
  const prevValue = !!(userRow as { ai_enabled?: boolean } | null)?.ai_enabled

  // Refuse to opt-in when the org has disabled AI entirely. Opting OUT
  // is always allowed (lets a user record a "no" even on a disabled org).
  if (nextValue === true && orgId) {
    const cfg = await resolveOrgAiConfig(orgId)
    if (cfg.mode === 'off') {
      return NextResponse.json(
        { error: 'AI is disabled by your organization' },
        { status: 403 },
      )
    }
  }

  // No-op if the value isn't actually changing — don't write an audit
  // row for a redundant toggle.
  if (prevValue === nextValue) {
    return NextResponse.json({ userEnabled: prevValue, audited: false })
  }

  // Write via service role so the audit insert isn't blocked by RLS.
  const service = createServiceRoleClient()
  await service
    .from('users')
    .update({ ai_enabled: nextValue })
    .eq('id', user.id)

  const ip = getRequestIp(req)
  const ua = req.headers.get('user-agent') || null
  await service.from('ai_consent_audit').insert({
    user_id:    user.id,
    org_id:     orgId || null,
    action:     nextValue ? 'enable' : 'disable',
    prev_value: prevValue,
    new_value:  nextValue,
    ip,
    user_agent: ua,
  })

  // Mirror into the activity stream for stickiness analysis.
  await recordUserEvent({
    userId:    user.id,
    orgId:     orgId || null,
    event:     'ai_toggled',
    metadata:  { action: nextValue ? 'enable' : 'disable' },
    ip,
    userAgent: ua,
  })

  return NextResponse.json({ userEnabled: nextValue, audited: true })
}
