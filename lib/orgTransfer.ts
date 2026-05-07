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

export type TransferableResource = 'bot' | 'study' | 'dataset' | 'townhall_session'

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
    const { data } = await service.from('organizations').select('id, name').eq('id', fromOrgId).single()
    if (data) fromOrg = { id: (data as any).id, name: (data as any).name }
  }

  return { ok: true, toOrg: toOrg as any, fromOrg }
}

/**
 * Insert one row into org_transfers. Snapshot org names + actor email so
 * the log stays readable even if those rows get renamed later.
 */
export async function recordOrgTransfer(ctx: TransferContext): Promise<void> {
  try {
    let toOrgName: string | null = null
    let fromOrgName: string | null = null
    const { data: toOrg } = await ctx.service.from('organizations').select('name').eq('id', ctx.toOrgId).single()
    toOrgName = (toOrg as any)?.name || null
    if (ctx.fromOrgId) {
      const { data: fromOrg } = await ctx.service.from('organizations').select('name').eq('id', ctx.fromOrgId).single()
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
