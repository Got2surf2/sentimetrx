// lib/orgTransfer.ts
// Shared helpers for the cross-org resource transfer flow used by
// /api/bots/[id], /api/studies/[id], /api/datasets/[datasetId],
// /api/townhall/sessions/[id]. Centralizes:
//   - active-org gating (you can only transfer TO an active org)
//   - append-only audit logging to the org_transfers table
//
// Each PATCH endpoint that handles { org_id } in the body should call
// recordOrgTransfer() right after the update succeeds so the log captures
// who moved what, when, between which orgs.

import type { SupabaseClient } from '@supabase/supabase-js'
import { logError } from '@/lib/log'

export type TransferableResource = 'bot' | 'study' | 'dataset' | 'townhall_session' | 'recording'

export interface TransferContext {
  service:           SupabaseClient   // service-role client
  resourceType:      TransferableResource
  resourceId:        string
  resourceName?:     string | null
  fromOrgId:         string | null
  toOrgId:           string
  initiatedBy:       string | null    // auth user id
  initiatedByEmail?: string | null
}

export interface ActiveOrgCheck {
  ok:      boolean
  toOrg?:  { id: string; name: string; status: string }
  fromOrg?: { id: string; name: string }
  error?:  string
  status?: number
}

/**
 * Verify the destination org exists, is currently active (not suspended /
 * archived), and that the resource isn't already there. Returns a snapshot
 * of both orgs for use in the audit log.
 */
export async function checkTransferTarget(
  service: SupabaseClient,
  fromOrgId: string | null,
  toOrgId: string,
): Promise<ActiveOrgCheck> {
  if (!toOrgId) return { ok: false, error: 'Target org_id required', status: 400 }
  if (toOrgId === fromOrgId) return { ok: false, error: 'Resource is already in that org', status: 400 }

  // Try with status; fall back to no-status query if the column hasn't been
  // added yet (migration 035 not applied). Pre-migration behavior: allow
  // any existing org. Post-migration: only active orgs.
  const { data: toOrg, error } = await service
    .from('organizations')
    .select('id, name, status')
    .eq('id', toOrgId)
    .single()
  if (error) void logError('orgTransfer.checkTransferTarget', error, { orgId: toOrgId })
  if (error) {
    const fallback = await service.from('organizations').select('id, name').eq('id', toOrgId).single()
    if (fallback.error || !fallback.data) return { ok: false, error: 'Target org not found', status: 404 }
    return { ok: true, toOrg: { ...(fallback.data as any), status: 'active' } }
  }
  if (!toOrg) return { ok: false, error: 'Target org not found', status: 404 }
  if ((toOrg as any).status !== 'active') {
    return { ok: false, error: 'Target org is ' + (toOrg as any).status + ' — only active orgs can receive transfers', status: 400 }
  }

  let fromOrg: { id: string; name: string } | undefined
  if (fromOrgId) {
    const { data, error: fromOrgErr } = await service.from('organizations').select('id, name').eq('id', fromOrgId).single()
    if (fromOrgErr) void logError('orgTransfer.checkTransferTarget', fromOrgErr, { orgId: fromOrgId })
    if (data) fromOrg = { id: (data as any).id, name: (data as any).name }
  }

  return { ok: true, toOrg: toOrg as any, fromOrg }
}

/**
 * Record a destructive or state-changing operation that a platform admin
 * ran against another tenant's resource. Separate from recordOrgTransfer
 * (which captures ownership moves) — this is for admin cross-org actions
 * like full re-syncs, row trims, and deletes. SOC 2 evidence.
 *
 * No-op for same-org actions (only logged when actorOrgId differs from
 * targetOrgId) so the table doesn't fill with routine same-org work.
 */
export interface AdminActionContext {
  service:           SupabaseClient   // service-role client
  actionType:        string           // 'dataset.sync_full' | 'dataset.trim' | 'dataset.delete' | ...
  resourceType:      TransferableResource
  resourceId:        string
  resourceName?:     string | null
  targetOrgId:       string | null
  actorOrgId:        string | null    // caller's own org_id
  initiatedBy:       string | null
  initiatedByEmail?: string | null
  metadata?:         Record<string, unknown>
}

/**
 * Record an explicit admin action to admin_action_log — ALWAYS (no same-org
 * skip). Use this from platform-admin routes that mutate a customer's config or
 * data (credential changes, snapshot restores, deletes) where traceability is
 * required regardless of whose org it is. `resourceType` is free text so it can
 * cover resources beyond the transferable set. Best-effort: never throws.
 */
export async function recordAdminAction(ctx: {
  service:           SupabaseClient
  actionType:        string
  resourceType:      string
  resourceId:        string
  resourceName?:     string | null
  targetOrgId?:      string | null
  initiatedBy?:      string | null
  initiatedByEmail?: string | null
  metadata?:         Record<string, unknown>
}): Promise<void> {
  try {
    let targetOrgName: string | null = null
    if (ctx.targetOrgId) {
      const { data: orgRow, error: orgRowErr } = await ctx.service
        .from('organizations').select('name').eq('id', ctx.targetOrgId).single()
      if (orgRowErr) void logError('orgTransfer.recordAdminAction', orgRowErr, { orgId: ctx.targetOrgId })
      targetOrgName = (orgRow as { name?: string } | null)?.name || null
    }
    const { error } = await ctx.service.from('admin_action_log').insert({
      action_type:        ctx.actionType,
      resource_type:      ctx.resourceType,
      resource_id:        ctx.resourceId,
      resource_name:      ctx.resourceName || null,
      target_org_id:      ctx.targetOrgId || null,
      target_org_name:    targetOrgName,
      initiated_by:       ctx.initiatedBy || null,
      initiated_by_email: ctx.initiatedByEmail || null,
      metadata:           ctx.metadata || {},
    })
    if (error) console.warn('[adminAction] failed to record audit row: ' + error.message)
  } catch (e: any) {
    console.warn('[adminAction] audit log threw: ' + (e?.message || e))
  }
}

export async function recordAdminCrossOrgAction(ctx: AdminActionContext): Promise<void> {
  // Same-org actions don't need a row — they're just regular user activity.
  if (!ctx.targetOrgId || ctx.targetOrgId === ctx.actorOrgId) return
  try {
    let targetOrgName: string | null = null
    const { data: orgRow, error: orgRowErr } = await ctx.service
      .from('organizations').select('name').eq('id', ctx.targetOrgId).single()
    if (orgRowErr) void logError('orgTransfer.recordAdminCrossOrgAction', orgRowErr, { orgId: ctx.targetOrgId })
    targetOrgName = (orgRow as any)?.name || null

    const { error } = await ctx.service.from('admin_action_log').insert({
      action_type:        ctx.actionType,
      resource_type:      ctx.resourceType,
      resource_id:        ctx.resourceId,
      resource_name:      ctx.resourceName || null,
      target_org_id:      ctx.targetOrgId,
      target_org_name:    targetOrgName,
      initiated_by:       ctx.initiatedBy,
      initiated_by_email: ctx.initiatedByEmail || null,
      metadata:           ctx.metadata || {},
    })
    if (error) console.warn('[adminAction] failed to record audit row: ' + error.message)
  } catch (e: any) {
    console.warn('[adminAction] audit log threw: ' + (e?.message || e))
  }
}

/**
 * Insert one row into org_transfers. Snapshot org names + actor email so
 * the log stays readable even if those rows get renamed later.
 */
export async function recordOrgTransfer(ctx: TransferContext): Promise<void> {
  try {
    let toOrgName: string | null = null
    let fromOrgName: string | null = null
    const { data: toOrg, error: toOrgErr } = await ctx.service.from('organizations').select('name').eq('id', ctx.toOrgId).single()
    if (toOrgErr) void logError('orgTransfer.recordOrgTransfer', toOrgErr, { orgId: ctx.toOrgId })
    toOrgName = (toOrg as any)?.name || null
    if (ctx.fromOrgId) {
      const { data: fromOrg, error: fromOrgErr } = await ctx.service.from('organizations').select('name').eq('id', ctx.fromOrgId).single()
      if (fromOrgErr) void logError('orgTransfer.recordOrgTransfer', fromOrgErr, { orgId: ctx.fromOrgId })
      fromOrgName = (fromOrg as any)?.name || null
    }

    const { error } = await ctx.service.from('org_transfers').insert({
      resource_type:    ctx.resourceType,
      resource_id:      ctx.resourceId,
      resource_name:    ctx.resourceName || null,
      from_org_id:      ctx.fromOrgId,
      from_org_name:    fromOrgName,
      to_org_id:        ctx.toOrgId,
      to_org_name:      toOrgName,
      initiated_by:     ctx.initiatedBy,
      initiated_by_email: ctx.initiatedByEmail || null,
    })
    // Don't fail the response if logging fails — the transfer itself
    // already succeeded by the time we get here. Just warn.
    if (error) console.warn('[orgTransfer] failed to record audit row: ' + error.message)
  } catch (e: any) {
    console.warn('[orgTransfer] audit log threw: ' + (e?.message || e))
  }
}
