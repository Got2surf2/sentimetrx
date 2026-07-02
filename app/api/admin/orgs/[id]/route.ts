// app/api/admin/orgs/[id]/route.ts
// PATCH  -- update org features (super-admin only)
// GET    -- preview what would be deleted by DELETE (for the confirmation UI)
// DELETE -- hard-delete an org. Suspended-first + type-the-name confirmation.
// Used by AdminClientDetail.tsx to toggle analyze module per org and by the
// delete-org modal.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { recordAdminAction } from '@/lib/orgTransfer'
import { deleteOrgScopedData, deleteOrgStorage, purgeOrgAuthUsers } from '@/lib/orgDelete'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string }> }

export async function PATCH(req: Request, props: Params) {
  const params = await props.params;
  const denied = await requireAdmin()
  if (denied) return denied

  const body = await req.json()
  const { features } = body
  if (!features || typeof features !== 'object') {
    return NextResponse.json({ error: 'features object is required' }, { status: 400 })
  }

  const service = createServiceRoleClient()

  // Merge new features with existing ones (don't overwrite unrelated keys)
  const { data: existing } = await service
    .from('organizations')
    .select('features')
    .eq('id', params.id)
    .single()

  const currentFeatures = existing?.features || {}
  const merged = { ...currentFeatures, ...features }

  const { error } = await service
    .from('organizations')
    .update({ features: merged })
    .eq('id', params.id)

  if (error) return serverError(error, 'admin.orgs.updateFeatures', { orgId: params.id })
  return NextResponse.json({ ok: true, features: merged })
}

// GET — preview what DELETE would affect. Counts every org-scoped table
// so the confirmation modal can show "this will delete N users, M datasets,
// K studies, …" before the user types the org name.
export async function GET(_req: Request, props: Params) {
  const params = await props.params;
  const denied = await requireAdmin()
  if (denied) return denied

  const service = createServiceRoleClient()
  const { data: org } = await service
    .from('organizations')
    .select('id, name, plan, status, is_admin_org')
    .eq('id', params.id)
    .single()
  if (!org) return NextResponse.json({ error: 'Org not found' }, { status: 404 })

  // Count rows in every org-scoped table. Used to give the human-readable
  // "this will erase …" preview. Lean on `count: 'exact', head: true` so
  // no row payload comes back.
  const tables = [
    'users', 'studies', 'datasets', 'bots', 'campaigns', 'townhall_sessions',
    'collections', 'review_sources', 'reddit_sources', 'social_connections',
    'invites', 'org_transfers',
  ]
  const counts: Record<string, number> = {}
  await Promise.all(tables.map(async t => {
    const { count } = await service.from(t).select('id', { count: 'exact', head: true }).eq('org_id', params.id)
    counts[t] = count || 0
  }))

  return NextResponse.json({ org, counts })
}

// DELETE — hard-delete the org and its data. Defense layers, in order:
//   1) super-admin gate (requireAdmin)
//   2) can't delete the platform admin org
//   3) org must be suspended first (plan='suspended' OR status='suspended')
//   4) caller must POST a `confirm_name` body matching the org's name
//   5) audit log entry written BEFORE the destructive delete
export async function DELETE(req: Request, props: Params) {
  const params = await props.params;
  const denied = await requireAdmin()
  if (denied) return denied

  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  const confirmName: string | undefined = body?.confirm_name

  const service = createServiceRoleClient()
  const { data: org } = await service
    .from('organizations')
    .select('id, name, plan, status, is_admin_org')
    .eq('id', params.id)
    .single()
  if (!org) return NextResponse.json({ error: 'Org not found' }, { status: 404 })

  if ((org as any).is_admin_org) {
    return NextResponse.json({ error: 'Cannot delete the platform admin org' }, { status: 400 })
  }
  if ((org as any).plan !== 'suspended' && (org as any).status !== 'suspended') {
    return NextResponse.json({ error: 'Suspend the org first — active orgs cannot be hard-deleted' }, { status: 400 })
  }
  if (!confirmName || String(confirmName).trim().toLowerCase() !== String((org as any).name).trim().toLowerCase()) {
    return NextResponse.json({ error: 'confirm_name must match the org name exactly' }, { status: 400 })
  }

  // Audit FIRST so we still have a record even if the delete fails.
  await recordAdminAction({
    service,
    actionType:       'org.delete',
    resourceType:     'org',
    resourceId:       (org as any).id,
    resourceName:     (org as any).name,
    targetOrgId:      (org as any).id,
    initiatedBy:      user.id,
    initiatedByEmail: user.email ?? null,
    metadata:         { action: 'org_hard_delete', org_name: (org as any).name },
  })

  // Collect the org's auth user ids BEFORE the sweep clears public.users —
  // auth.users lives outside the public schema and the row sweep can't touch it.
  const { data: orgUsers } = await service.from('users').select('id').eq('org_id', params.id)
  const userIds = ((orgUsers || []) as { id: string }[]).map(u => u.id)

  // Explicitly erase all org-scoped data. Deleting the organizations row does
  // NOT cascade to every table (many carry org_id with no cascading FK — see
  // lib/orgDelete), so relying on cascade orphaned tenant content. Fail closed:
  // if any table couldn't be cleared, DON'T delete the org row — leave it
  // suspended and surface which tables blocked, so we never half-erase and
  // report success. The sweep is idempotent, so the operator can re-run.
  const sweep = await deleteOrgScopedData((org as any).id)
  if (Object.keys(sweep.failed).length > 0) {
    console.error('[org.delete] incomplete erasure for ' + (org as any).id + ':', JSON.stringify(sweep.failed))
    return NextResponse.json({
      error: 'Erasure incomplete — these tables could not be cleared: ' + Object.keys(sweep.failed).join(', ') + '. Org left suspended; investigate and retry.',
      failed: sweep.failed,
    }, { status: 500 })
  }

  // Non-Postgres tenant data: Storage objects + auth users. Best-effort — the
  // DB data is already erased, so a partial failure here shouldn't strand the
  // org row; surface any leftovers as `warnings` for manual follow-up. (S3
  // org-snapshots are a documented break-glass purge — the backup role has no
  // delete permission by design.)
  const storage = await deleteOrgStorage((org as any).id)
  const auth = await purgeOrgAuthUsers(userIds)
  const warnings = [...storage.errors.map(e => 'storage: ' + e), ...auth.errors.map(e => 'auth: ' + e)]
  if (warnings.length > 0) console.error('[org.delete] cleanup warnings for ' + (org as any).id + ':', JSON.stringify(warnings))

  // Finally the org row itself (cascades the few org_id-CASCADE tables, already
  // emptied by the sweep above).
  const { error } = await service.from('organizations').delete().eq('id', params.id)
  if (error) return serverError(error, 'admin.orgs.delete', { orgId: params.id })

  return NextResponse.json({
    ok: true,
    deleted: { id: (org as any).id, name: (org as any).name },
    tables_cleared: sweep.deleted.length,
    storage_objects_removed: storage.removed,
    auth_users_deleted: auth.deleted,
    ...(warnings.length > 0 ? { warnings } : {}),
  })
}
