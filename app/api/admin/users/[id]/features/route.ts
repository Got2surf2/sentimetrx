// app/api/admin/users/[id]/features/route.ts
// Super-admin per-user override for the user_features gate (sql/089).
//   PUT { feature, enabled, quota_per_month }
//     enabled: true  → explicitly allow (wins over org)
//             false  → explicitly block (wins over org)
//             null   → inherit from org (the row is deleted)
//     quota_per_month: positive int, or null to inherit org quota.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string }> }

const KNOWN_FEATURES = new Set(['recording'])

export async function PUT(req: NextRequest, props: Params) {
  const params = await props.params;
  const denied = await requireAdmin()
  if (denied) return denied

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const feature = body?.feature
  if (!KNOWN_FEATURES.has(feature)) {
    return NextResponse.json({ error: 'unknown feature' }, { status: 400 })
  }
  if (body?.enabled !== null && typeof body?.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be true, false, or null (inherit)' }, { status: 400 })
  }
  const quota = normalizeQuota(body?.quota_per_month)
  if (quota === 'invalid') {
    return NextResponse.json({ error: 'quota_per_month must be a positive integer or null' }, { status: 400 })
  }

  const service = createServiceRoleClient()

  // Pure inherit (no explicit enable/disable and no quota override) → drop the
  // row entirely so resolution falls back to the org level.
  if (body.enabled === null && quota === null) {
    const { error } = await service
      .from('user_features')
      .delete()
      .eq('user_id', params.id)
      .eq('feature', feature)
    if (error) return serverError(error, 'admin.users.features.delete')
    return NextResponse.json({ ok: true, feature, enabled: null, quota_per_month: null })
  }

  const { error } = await service
    .from('user_features')
    .upsert({
      user_id:         params.id,
      feature,
      enabled:         body.enabled,        // may be null = inherit, with a quota override
      quota_per_month: quota,
    }, { onConflict: 'user_id,feature' })

  if (error) return serverError(error, 'admin.users.features.upsert')
  return NextResponse.json({ ok: true, feature, enabled: body.enabled, quota_per_month: quota })
}

function normalizeQuota(v: unknown): number | null | 'invalid' {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isInteger(n) || n <= 0) return 'invalid'
  return n
}
