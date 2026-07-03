// app/api/townhall/sessions/[id]/duplicate/route.ts
// POST — duplicate a PulseIQ session (copies config + discussion guide into a
// new draft session).
//
// Tranche 2 (docs/CONVERGENCE.md § 4.2): duplicates on the new substrate —
// copies the source's dedicated agent row and inserts a pulseiq_sessions
// draft, mirroring the two-insert shape of POST /api/townhall/sessions.
// Topics are NOT copied: seeding happens on activate (console PATCH), same
// as the legacy setup→active flow.

import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { serverError } from '@/lib/apiError'

interface Params { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Resolve the caller's org + admin status so the duplicate is gated to the
  // owning org (or a platform admin) — a bare-id fetch with the service-role
  // client would otherwise let any logged-in user duplicate any org's session.
  const { data: userData } = await supabase
    .from('users').select('org_id, organizations(is_admin_org)').eq('id', user.id).single()
  const caller = userData as { org_id: string | null; organizations: { is_admin_org?: boolean } | { is_admin_org?: boolean }[] | null } | null
  const orgRel = caller?.organizations
  const isAdmin = Array.isArray(orgRel) ? !!orgRel[0]?.is_admin_org : !!orgRel?.is_admin_org
  const callerOrg = caller?.org_id ?? null

  const db = createServiceRoleClient()

  // Fetch the source session
  const { data: source } = await db
    .from('pulseiq_sessions')
    .select('name, cohort_config, discussion_guide, org_id, bot_id')
    .eq('id', params.id)
    .maybeSingle()

  if (!source) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (!isAdmin && source.org_id !== callerOrg) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  // Strip archived flag if present
  const cohortConfig = { ...(source.cohort_config as Record<string, unknown> | null || {}) }
  delete cohortConfig.archived

  // Fresh slug for the copy (slug is required + unique on pulseiq_sessions).
  const base = String(source.name || 'pulseiq').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'pulseiq'
  const slug = base + '-copy-' + Math.random().toString(36).slice(2, 7)

  // Copy the source's dedicated agent (persona fields travel with the session).
  const { data: srcAgent } = await db
    .from('agents')
    .select('name, personality, system_prompt, sensitive_topics')
    .eq('id', source.bot_id)
    .eq('org_id', source.org_id)
    .maybeSingle()
  const { data: agentRow, error: agentErr } = await db
    .from('agents')
    .insert({
      org_id: source.org_id,
      created_by: user.id,
      name: srcAgent?.name || source.name,
      slug: slug + '-agent',
      status: 'active',
      personality: srcAgent?.personality || 'Warm, curious facilitator. Keeps questions short and conversational, one at a time. Never lectures.',
      system_prompt: srcAgent?.system_prompt || 'You facilitate a live group feedback session. Draw out specific, honest feedback. Keep replies brief.',
      sensitive_topics: srcAgent?.sensitive_topics || [],
    })
    .select('id')
    .single()
  if (agentErr) return serverError(agentErr, 'townhall.sessions.duplicate.agent', { orgId: source.org_id })

  // Create duplicate (draft = legacy 'setup')
  const { data, error } = await db
    .from('pulseiq_sessions')
    .insert({
      org_id: source.org_id,
      bot_id: agentRow!.id,
      created_by: user.id,
      name: source.name + ' (Copy)',
      slug,
      status: 'draft',
      cohort_config: cohortConfig,
      discussion_guide: source.discussion_guide,
    })
    .select('id')
    .single()

  if (error) {
    // Don't strand the just-created agent if the session insert failed.
    await db.from('agents').delete().eq('id', agentRow!.id).eq('org_id', source.org_id)
    return serverError(error, 'townhall.sessions.duplicate', { orgId: source.org_id })
  }
  return NextResponse.json(data, { status: 201 })
}
