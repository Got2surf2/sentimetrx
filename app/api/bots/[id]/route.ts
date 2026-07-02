// app/api/bots/[id]/route.ts
// GET    — fetch a single bot
// PATCH  — update bot config/content
// DELETE — delete a bot

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { checkTransferTarget, recordOrgTransfer } from '@/lib/orgTransfer'
import { logBotChange, snapshotForDiff, diffSnapshots } from '@/lib/auditLog'
import { rollupAgentEntitiesToBrand } from '@/lib/correction/rollup'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string }> }

async function getAuth(supabase: Awaited<ReturnType<typeof createClient>>) {
  const user = await getAuthUser(supabase)
  if (!user) return null
  const { data } = await supabase.from('users').select('org_id, organizations(is_admin_org)').eq('id', user.id).single()
  const orgData = Array.isArray(data?.organizations) ? (data.organizations as any)[0] : data?.organizations as any
  return { userId: user.id, orgId: data?.org_id as string | null, isAdmin: !!orgData?.is_admin_org }
}

export async function GET(req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const auth = await getAuth(supabase)
  if (!auth?.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Admin-org users can view bots across orgs (Phase E parity — they can
  // see other-org bot cards on /bots, so they need to read them too).
  // Non-admins are scoped to their own org.
  const service = createServiceRoleClient()
  const { data, error } = await service
    .from('agents')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  if (!auth.isAdmin && data.org_id !== auth.orgId) {
    return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  }
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const auth = await getAuth(supabase)
  if (!auth?.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const allowed = ['name', 'slug', 'status', 'config', 'system_prompt', 'personality', 'knowledge_base', 'training_urls', 'review_interval_hours', 'next_review_at', 'faq', 'facts', 'guardrails', 'subject', 'negative_content_mode', 'opponents', 'contrast_mode', 'sensitive_topics', 'focus_topics', 'deflection_enabled', 'deflection_message', 'ask_profile', 'profile_question', 'intents', 'focuses', 'demographic_inference', 'probe_focus_enabled', 'brand_tag']
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (body[key] !== undefined) updates[key] = body[key]
  }

  // Admin-only: allow changing org_id (transfer agent to another org)
  // Validates target is an active org, then logs to org_transfers.
  let isTransfer = false
  let transferFromOrgId: string | null = null
  let resourceSnapshot: { name: string | null } | null = null
  if ('org_id' in body) {
    if (!auth.isAdmin) {
      return NextResponse.json({ error: 'Only admins can transfer agents' }, { status: 403 })
    }
    const service = createServiceRoleClient()
    // The "from" org is the AGENT's current org — NOT the caller's (auth.orgId).
    // Using the caller's org made an admin moving a cross-org agent back into
    // the admin's own org fail with a false "already in that org" (target ==
    // caller org), even when the agent lived in a different org.
    const { data: cur } = await service.from('agents').select('org_id, name').eq('id', params.id).single()
    transferFromOrgId = (cur as any)?.org_id ?? null
    const check = await checkTransferTarget(service, transferFromOrgId, body.org_id)
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status || 400 })
    resourceSnapshot = { name: (cur as any)?.name ?? null }
    // org_id is NOT set on `updates` — the cascading RPC below moves it (plus
    // all the agent's owned data) atomically. A bare agents.org_id update here
    // would strand conversations/turns/questions/etc. in the old org.
    isTransfer = true
  }

  // Validate slug if changing
  if (updates.slug) {
    if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(updates.slug as string)) {
      return NextResponse.json({ error: 'Invalid slug format' }, { status: 400 })
    }
    const service = createServiceRoleClient()
    const { data: existing } = await service.from('agents').select('id').eq('slug', updates.slug as string).neq('id', params.id).limit(1)
    if (existing && existing.length > 0) {
      return NextResponse.json({ error: 'This URL is already taken' }, { status: 409 })
    }
  }

  // Use service role for transfers (org_id change bypasses RLS) AND for
  // admin cross-org edits (Phase E parity). Non-admins remain scoped to
  // their own org.
  const service = createServiceRoleClient()

  // Snapshot the bot row before the update so the change log can diff.
  const { data: beforeRow } = await service.from('agents').select('*').eq('id', params.id).single()

  // Defense-in-depth: a non-admin may only touch their own org's agent. The
  // update below is already org-paired, but guarding here (same as GET) also
  // stops a cross-org id from writing a spurious audit-log entry / success:true.
  if (!auth.isAdmin && beforeRow && (beforeRow as any).org_id !== auth.orgId) {
    return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  }

  let updateQuery = service.from('agents').update(updates).eq('id', params.id)
  if (!auth.isAdmin) updateQuery = updateQuery.eq('org_id', auth.orgId)
  const { error } = await updateQuery

  if (error) return serverError(error, 'bots.update')

  // Phase 3 (shared brand-correction layer): tagging an agent with a brand seeds
  // that brand's shared entity catalog from the agent's curated entities, so the
  // brand glossary is authoritative immediately. Best-effort; skip on org
  // transfers (handled by their own cascade).
  if (updates.brand_tag !== undefined && !isTransfer && beforeRow) {
    await rollupAgentEntitiesToBrand(service, {
      agentId: params.id,
      orgId: (beforeRow as any).org_id,
      brandTag: updates.brand_tag as string,
    })
  }

  if (isTransfer) {
    // Cascade the org move to ALL the agent's owned data (conversations, turns,
    // logged questions, reviews, change log, impressions, study cache) in one
    // transaction — sql/127. Repairs already-split agents too (idempotent).
    const { error: xferErr } = await service.rpc('transfer_agent_org', { p_agent_id: params.id, p_to_org: body.org_id })
    if (xferErr) return serverError(xferErr, 'bots.transfer', { orgId: auth.orgId })
    const user = await getAuthUser(supabase)
    await recordOrgTransfer({
      service, resourceType: 'bot', resourceId: params.id,
      resourceName: resourceSnapshot?.name ?? null,
      fromOrgId: transferFromOrgId ?? auth.orgId, toOrgId: body.org_id as string,
      initiatedBy: auth.userId, initiatedByEmail: user?.email || null,
    })
  }

  // Audit log: write a 'status_change' or 'update' depending on what changed.
  if (beforeRow) {
    const { data: afterRow } = await service.from('agents').select('*').eq('id', params.id).single()
    const before = snapshotForDiff(beforeRow as any)
    const after = snapshotForDiff(afterRow as any)
    const diff = diffSnapshots(before, after)
    const changedKeys = Object.keys(diff.after)
    if (changedKeys.length > 0) {
      const user = await getAuthUser(supabase)
      const isStatusOnly = changedKeys.length === 1 && changedKeys[0] === 'status'
      let summary: string
      if (isStatusOnly) {
        summary = 'Status changed: ' + String((diff.before as any).status) + ' → ' + String((diff.after as any).status)
      } else {
        summary = 'Updated ' + changedKeys.length + ' field' + (changedKeys.length > 1 ? 's' : '') + ': ' + changedKeys.slice(0, 6).join(', ') + (changedKeys.length > 6 ? '…' : '')
      }
      void logBotChange({
        botId: params.id,
        orgId: (afterRow as any)?.org_id || auth.orgId,
        actorId: auth.userId,
        actorEmail: user?.email || null,
        action: isStatusOnly ? 'status_change' : 'update',
        summary,
        before: diff.before,
        after: diff.after,
      })
    }
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const auth = await getAuth(supabase)
  if (!auth?.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Same Phase E parity as GET/PATCH — admins can delete other-org bots.
  const service = createServiceRoleClient()

  // Snapshot the bot row before delete so the change log entry survives.
  // (The bot_change_log row gets removed by ON DELETE CASCADE shortly,
  // but it lives long enough to write to a polymorphic mirror later.)
  const { data: beforeRow } = await service.from('agents').select('*').eq('id', params.id).single()

  // Defense-in-depth: non-admins may only delete their own org's agent (the
  // delete below is already org-paired; this guards the snapshot read too).
  if (!auth.isAdmin && beforeRow && (beforeRow as any).org_id !== auth.orgId) {
    return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  }

  let q = service.from('agents').delete().eq('id', params.id)
  if (!auth.isAdmin) q = q.eq('org_id', auth.orgId)
  const { error } = await q

  if (error) return serverError(error, 'bots.delete')

  if (beforeRow) {
    const user = await getAuthUser(supabase)
    void logBotChange({
      botId: params.id,
      orgId: (beforeRow as any).org_id || auth.orgId,
      actorId: auth.userId,
      actorEmail: user?.email || null,
      action: 'delete',
      summary: 'Deleted agent "' + ((beforeRow as any).name || params.id) + '"',
      before: snapshotForDiff(beforeRow as any),
    })
  }

  return NextResponse.json({ success: true })
}
