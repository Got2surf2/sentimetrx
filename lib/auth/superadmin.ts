// lib/auth/superadmin.ts
// Per-user gate for Datanautix-internal product surfaces (e.g.
// "include AI labels in this share for a prospect demo"). Distinct from
// `organizations.is_admin_org` — that flag distinguishes admin orgs from
// tenant orgs, and Datanautix Demo carries it too. The gate here checks
// `users.role = 'platform_admin'`, which is the same role surfaced by
// the SQL helper `is_platform_admin()` and used elsewhere in the codebase
// for cross-org reads.

import type { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { logError } from '@/lib/log'

export async function isCallerSuperadmin(
  client: Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createServiceRoleClient>,
  userId: string,
): Promise<boolean> {
  const { data, error: roleErr } = await client
    .from('users')
    .select('role')
    .eq('id', userId)
    .single()
  if (roleErr) void logError('superadmin.isCallerSuperadmin', roleErr)
  return (data as { role?: string } | null)?.role === 'platform_admin'
}
