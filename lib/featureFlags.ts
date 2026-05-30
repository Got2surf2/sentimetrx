// lib/featureFlags.ts
//
// Feature gating with monthly quotas. Backed by sql/089_org_user_features.sql.
//
// Resolution:
//   1. user_features row for this (user, feature) wins if enabled IS NOT NULL
//      (enabled=false explicitly blocks; enabled=true explicitly allows).
//   2. Otherwise fall back to org_features.enabled (default false / no row = disabled).
//   3. quota_per_month: same precedence (user override → org). NULL = unlimited.
//
// Usage counting is feature-specific. Today only 'recording' has a counter;
// add a branch to countFeatureUsageThisMonth() when wiring up the next feature.
//
// SERVER-ONLY: imports the service-role client.

import 'server-only'
import { createServiceRoleClient } from '@/lib/supabase/server'

export type FeatureName = 'recording'  // expand as features come online

export type FeatureCheck =
  | { allowed: true; quotaPerMonth: number | null; used: number }
  | { allowed: false; reason: 'disabled' | 'quota_exceeded'; quotaPerMonth?: number | null; used?: number }

interface AssertOpts {
  unitsConsumed?: number   // units the pending request would consume; default 1
}

export async function assertFeatureAllowed(
  feature: FeatureName,
  orgId: string,
  userId: string,
  opts: AssertOpts = {}
): Promise<FeatureCheck> {
  const unitsConsumed = opts.unitsConsumed ?? 1
  const service = createServiceRoleClient()

  const [{ data: userRow }, { data: orgRow }] = await Promise.all([
    service
      .from('user_features')
      .select('enabled, quota_per_month')
      .eq('user_id', userId)
      .eq('feature', feature)
      .maybeSingle(),
    service
      .from('org_features')
      .select('enabled, quota_per_month')
      .eq('org_id', orgId)
      .eq('feature', feature)
      .maybeSingle(),
  ])

  const enabled =
    userRow?.enabled !== null && userRow?.enabled !== undefined
      ? userRow.enabled
      : (orgRow?.enabled ?? false)

  if (!enabled) return { allowed: false, reason: 'disabled' }

  const quotaPerMonth =
    userRow?.quota_per_month !== null && userRow?.quota_per_month !== undefined
      ? (userRow.quota_per_month as number)
      : ((orgRow?.quota_per_month as number | null | undefined) ?? null)

  if (quotaPerMonth === null) {
    return { allowed: true, quotaPerMonth: null, used: 0 }
  }

  const used = await countFeatureUsageThisMonth(feature, orgId)
  if (used + unitsConsumed > quotaPerMonth) {
    return { allowed: false, reason: 'quota_exceeded', quotaPerMonth, used }
  }
  return { allowed: true, quotaPerMonth, used }
}

async function countFeatureUsageThisMonth(feature: FeatureName, orgId: string): Promise<number> {
  const service = createServiceRoleClient()
  const startOfMonth = new Date()
  startOfMonth.setUTCDate(1)
  startOfMonth.setUTCHours(0, 0, 0, 0)

  if (feature === 'recording') {
    // A "consumed unit" = a recording that's reached or passed the analyze stage.
    // Uploading / cancelled / failed-before-analyze don't count.
    const { count } = await service
      .from('recordings')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .gte('created_at', startOfMonth.toISOString())
      .in('status', ['analyzing', 'rendering', 'complete'])
    return count ?? 0
  }
  return 0
}
