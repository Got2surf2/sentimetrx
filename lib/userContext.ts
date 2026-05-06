// lib/userContext.ts
// Single source of truth for the user/org context every authenticated page
// needs. Replaces the per-page pattern of fetching `users` + `organizations`
// separately and computing features inline. Use in server components:
//
//   import { getUserContext } from '@/lib/userContext'
//   const ctx = await getUserContext(supabase)
//   if (!ctx) redirect('/login')
//   if (!ctx.features.surveys) redirect('/dashboard')
//   return <TopNav features={ctx.features} ...ctx.navProps />
//
// The returned `features` are already the *intersection* of org-level and
// user-level overrides (see lib/resolveOrg.ts:effectiveFeatures).

import type { ModuleFeatures } from './types'
import { effectiveFeatures } from './resolveOrg'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface UserContext {
  userId:        string
  userEmail:     string
  fullName:      string | null
  isAdmin:       boolean
  isAdminOrg:    boolean
  orgId:         string
  orgName:       string | null
  logoUrl:       string | null
  /** Effective features = org features ∩ user features. */
  features:      ModuleFeatures
  /** Raw org features as stored. */
  orgFeatures:   ModuleFeatures
  /** Raw user features as stored (may be null if user inherits all org features). */
  userFeatures:  ModuleFeatures | null
  /** Convenience prop bundle for <TopNav>. */
  navProps: {
    logoUrl:   string | null
    orgName:   string | null
    isAdmin:   boolean
    userEmail: string
    fullName:  string | null
    features:  ModuleFeatures
  }
}

/**
 * Returns null if no authenticated session OR if the user's profile is
 * incomplete (missing org_id). Caller should redirect to /login on null.
 */
export async function getUserContext(supabase: SupabaseClient): Promise<UserContext | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: userRow } = await supabase
    .from('users')
    .select('id, email, full_name, is_admin, org_id, features, disabled')
    .eq('id', user.id)
    .single()
  if (!userRow || !userRow.org_id) return null
  // If the user has been disabled, treat them as signed out at the app layer.
  // Their auth.users.banned_until prevents *new* logins; this catches the
  // case where a disabled user still has a valid JWT from before disabling.
  if ((userRow as any).disabled) {
    await supabase.auth.signOut().catch(() => {})
    return null
  }

  const { data: orgRow } = await supabase
    .from('organizations')
    .select('id, name, logo_url, is_admin_org, features')
    .eq('id', userRow.org_id)
    .single()
  if (!orgRow) return null

  // Admin orgs get every feature implicitly.
  const orgFeatures: ModuleFeatures = orgRow.is_admin_org
    ? {
        surveys: true, analyze: true, googleReviews: true, reddit: true,
        substack: true, townhall: true, campaigns: true, bots: true, social: true,
      }
    : (orgRow.features as ModuleFeatures) || {}

  const userFeatures: ModuleFeatures | null = userRow.features as ModuleFeatures || null
  const features = effectiveFeatures(orgFeatures, userFeatures)

  const orgName  = (orgRow.name as string) || null
  const logoUrl  = (orgRow.logo_url as string) || null
  const fullName = (userRow.full_name as string) || null
  const userEmail = (userRow.email as string) || user.email || ''
  const isAdmin = !!userRow.is_admin || !!orgRow.is_admin_org

  return {
    userId:       user.id,
    userEmail,
    fullName,
    isAdmin,
    isAdminOrg:   !!orgRow.is_admin_org,
    orgId:        orgRow.id as string,
    orgName,
    logoUrl,
    features,
    orgFeatures,
    userFeatures,
    navProps: { logoUrl, orgName, isAdmin, userEmail, fullName, features },
  }
}
