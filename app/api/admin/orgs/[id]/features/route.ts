// app/api/admin/orgs/[id]/features/route.ts
// Super-admin management of the org_features gate (sql/089). Distinct from the
// ModuleFeatures JSONB toggles in /api/admin/orgs/[id] — this table backs
// quota-metered, per-org+per-user features like recordings (lib/featureFlags.ts).
//
//   GET ?feature=recording — current org setting + every member's user_features
//                            override, so the admin panel can render both levels
//                            in one round-trip.
//   PUT { feature, enabled, quota_per_month } — upsert the org-level row.

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string }> }

// Only features that exist in lib/featureFlags.ts FeatureName are writable here.
const KNOWN_FEATURES = new Set(['recording'])

export async function GET(req: NextRequest, props: Params) {
  const params = await props.params;
  const denied = await requireAdmin()
  if (denied) return denied

  const feature = req.nextUrl.searchParams.get('feature') || 'recording'
  if (!KNOWN_FEATURES.has(feature)) {
    return NextResponse.json({ error: 'unknown feature' }, { status: 400 })
  }

  const service = createServiceRoleClient()

  const { data: orgRow } = await service
    .from('org_features')
    .select('enabled, quota_per_month')
    .eq('org_id', params.id)
    .eq('feature', feature)
    .maybeSingle()

  // Members of this org + their per-user override (if any) for this feature.
  const { data: members } = await service
    .from('users')
    .select('id, email, full_name')
    .eq('org_id', params.id)
    .order('full_name', { ascending: true })

  const memberIds = (members || []).map(m => m.id)
  const { data: overrides } = memberIds.length
    ? await service
        .from('user_features')
        .select('user_id, enabled, quota_per_month')
        .eq('feature', feature)
        .in('user_id', memberIds)
    : { data: [] as any[] }

  const byUser = new Map((overrides || []).map(o => [o.user_id, o]))
  const users = (members || []).map(m => ({
    user_id:         m.id,
    email:           m.email,
    full_name:       m.full_name,
    enabled:         byUser.get(m.id)?.enabled ?? null,          // null = inherit org
    quota_per_month: byUser.get(m.id)?.quota_per_month ?? null,
  }))

  return NextResponse.json({
    feature,
    org: orgRow ? { enabled: !!orgRow.enabled, quota_per_month: orgRow.quota_per_month ?? null } : null,
    users,
  })
}

export async function PUT(req: NextRequest, props: Params) {
  const params = await props.params;
  const denied = await requireAdmin()
  if (denied) return denied

  const supabase = await createClient()
  const actor = await getAuthUser(supabase)

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const feature = body?.feature
  if (!KNOWN_FEATURES.has(feature)) {
    return NextResponse.json({ error: 'unknown feature' }, { status: 400 })
  }
  if (typeof body?.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled (boolean) is required' }, { status: 400 })
  }
  const quota = normalizeQuota(body?.quota_per_month)
  if (quota === 'invalid') {
    return NextResponse.json({ error: 'quota_per_month must be a positive integer or null' }, { status: 400 })
  }

  const service = createServiceRoleClient()
  const { error } = await service
    .from('org_features')
    .upsert({
      org_id:          params.id,
      feature,
      enabled:         body.enabled,
      quota_per_month: quota,
      enabled_by:      actor?.id ?? null,
    }, { onConflict: 'org_id,feature' })

  if (error) return serverError(error, 'admin.orgs.features.upsert', { orgId: params.id })
  return NextResponse.json({ ok: true, feature, enabled: body.enabled, quota_per_month: quota })
}

// Accepts a positive int, or null/'' (unlimited). Returns 'invalid' on bad input.
function normalizeQuota(v: unknown): number | null | 'invalid' {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isInteger(n) || n <= 0) return 'invalid'
  return n
}
