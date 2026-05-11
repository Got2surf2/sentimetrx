// lib/auth/orgAccess.ts
// Resolves the caller's org_id + is_admin_org in one call. Used to gate
// per-org resource access while preserving the Phase E rule that
// platform admins can read/edit/delete cross-org.
//
// Pattern at every gate:
//
//   const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
//   if (!userId) return 401
//   const { data: row } = await supabase.from('foo').select('org_id').eq('id', x).single()
//   if (!row) return 404
//   if (!isAdmin && row.org_id !== orgId) return 404   // ← THE gate
//
// Return 404 (not 403) on the cross-org branch so a non-admin doesn't
// learn whether the resource exists. Admins get full visibility.

import 'server-only'
import type { createClient as createBrowserClient } from '@/lib/supabase/server'

type AuthCookiedClient = ReturnType<typeof createBrowserClient>

export interface CallerOrgContext {
  userId:  string | null
  orgId:   string | null
  isAdmin: boolean
}

export async function getCallerOrgContext(supabase: AuthCookiedClient): Promise<CallerOrgContext> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { userId: null, orgId: null, isAdmin: false }

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()

  const orgRel = (userData as any)?.organizations
  const isAdmin = Array.isArray(orgRel)
    ? orgRel[0]?.is_admin_org === true
    : orgRel?.is_admin_org === true

  return {
    userId:  user.id,
    orgId:   (userData?.org_id as string | null) ?? null,
    isAdmin,
  }
}
