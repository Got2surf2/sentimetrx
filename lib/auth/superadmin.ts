// lib/auth/superadmin.ts
// Per-user superadmin gate for Datanautix-internal product surfaces (e.g.
// "include AI labels in this share for a prospect demo"). Distinct from
// `organizations.is_admin_org` — that flag distinguishes admin orgs from
// tenant orgs, and Datanautix Demo carries it too. is_superadmin is set
// only on internal Datanautix users, see migration 076.

import type { createClient, createServiceRoleClient } from '@/lib/supabase/server'

export async function isCallerSuperadmin(
  client: ReturnType<typeof createClient> | ReturnType<typeof createServiceRoleClient>,
  userId: string,
): Promise<boolean> {
  const { data } = await (client as any)
    .from('users')
    .select('is_superadmin')
    .eq('id', userId)
    .single()
  return !!(data as any)?.is_superadmin
}
