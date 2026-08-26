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
import { logError } from '@/lib/log'
import { retryTransientResult, isTransientTransportError, AuthUnavailableError } from '@/lib/retryTransient'

type AuthCookiedClient = Awaited<ReturnType<typeof createBrowserClient>>

export interface CallerOrgContext {
  userId:  string | null
  orgId:   string | null
  isAdmin: boolean
}

export async function getCallerOrgContext(
  supabase: AuthCookiedClient,
  opts?: { requireReachable?: boolean },
): Promise<CallerOrgContext> {
  // The `error` from getUser() used to be discarded, which made "the socket to
  // Supabase died" indistinguishable from "not signed in" — so a dropped
  // connection returned 401 and logged the user out mid-request. Seen twice in
  // production on 2026-08-26 during a row upload. See lib/retryTransient.
  //
  // The retry is unconditional and benefits all ~83 call sites: a stale pooled
  // socket is fixed by the very next attempt, so the blip never surfaces.
  // Turning an exhausted retry into a THROW is opt-in (`requireReachable`),
  // because public/anonymous surfaces legitimately treat "no user" as a valid
  // state and should degrade rather than error. Mutating routes should opt in —
  // silently treating an unreachable auth service as "anonymous" is how a write
  // gets rejected as unauthorized when the caller was signed in all along.
  const { data, error } = await retryTransientResult(() => supabase.auth.getUser())
  if (error && isTransientTransportError(error)) {
    void logError('orgAccess.authUnreachable', error)
    if (opts?.requireReachable) throw new AuthUnavailableError(error)
    return { userId: null, orgId: null, isAdmin: false }
  }
  const user = data?.user
  if (!user) return { userId: null, orgId: null, isAdmin: false }

  const { data: userData, error: userDataErr } = await retryTransientResult(async () => await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single())
  if (userDataErr) void logError('orgAccess.getCallerOrgContext', userDataErr)

  type OrgRel = { is_admin_org?: boolean | null }
  const orgRel = (userData as { organizations?: OrgRel | OrgRel[] | null } | null)?.organizations
  const isAdmin = Array.isArray(orgRel)
    ? orgRel[0]?.is_admin_org === true
    : orgRel?.is_admin_org === true

  return {
    userId:  user.id,
    orgId:   (userData?.org_id as string | null) ?? null,
    isAdmin,
  }
}
