// app/api/admin/orgs/[id]/route.ts
// PATCH  -- update org features (super-admin only)
// GET    -- preview what would be deleted by DELETE (for the confirmation UI)
// DELETE -- hard-delete an org. Suspended-first + type-the-name confirmation.
// Used by AdminClientDetail.tsx to toggle analyze module per org and by the
// delete-org modal.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { recordAdminCrossOrgAction } from '@/lib/orgTransfer'

export const dynamic = 'force-dynamic'

interface Params { params: { id: string } }

export async function PATCH(req: Request, { params }: Params) {
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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, features: merged })
}

// GET — preview what DELETE would affect. Counts every org-scoped table
// so the confirmation modal can show "this will delete N users, M datasets,
// K studies, …" before the user types the org name.
export async function GET(_req: Request, { params }: Params) {
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
export async function DELETE(req: Request, { params }: Params) {
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

  const { data: callerData } = await supabase
    .from('users').select('org_id').eq('id', user.id).single()

  // Audit FIRST so we still have a record even if the cascade fails.
  await recordAdminCrossOrgAction({
    service,
    actionType:       'org.delete',
    resourceType:     'dataset', // schema uses an enum; reuse a permitted value, real semantics in metadata
    resourceId:       (org as any).id,
    resourceName:     (org as any).name,
    targetOrgId:      (org as any).id,
    actorOrgId:       (callerData as any)?.org_id ?? null,
    initiatedBy:      user.id,
    initiatedByEmail: user.email ?? null,
    metadata:         { action: 'org_hard_delete', org_name: (org as any).name },
  })

  // The destructive step. FK CASCADE on org_id is expected to clean up
  // children; if any FK is RESTRICT we'll get an error here. We surface
  // the underlying DB error so the operator can investigate rather than
  // pretending the delete succeeded.
  const { error } = await service.from('organizations').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: 'Delete failed: ' + error.message }, { status: 500 })

  return NextResponse.json({ ok: true, deleted: { id: (org as any).id, name: (org as any).name } })
}
