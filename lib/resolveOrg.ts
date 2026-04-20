import type { ModuleFeatures, MODULE_KEYS } from './types'

export function resolveOrg(raw: unknown): { is_admin_org?: boolean; logo_url?: string; name?: string; features?: any } | null {
  if (!raw) return null
  const org = Array.isArray(raw) ? raw[0] : raw
  return org ?? null
}

/** Check if a specific module is enabled for an org (or org+user). */
export function hasFeature(
  orgFeatures: ModuleFeatures | null | undefined,
  module: keyof ModuleFeatures,
  userFeatures?: ModuleFeatures | null,
): boolean {
  if (!orgFeatures || !orgFeatures[module]) return false
  // If user features provided, user must also have it enabled
  if (userFeatures !== undefined && userFeatures !== null) {
    return !!userFeatures[module]
  }
  return true
}

/** Return all module keys enabled for an org (or intersection of org+user). */
export function enabledFeatures(
  orgFeatures: ModuleFeatures | null | undefined,
  userFeatures?: ModuleFeatures | null,
): (keyof ModuleFeatures)[] {
  if (!orgFeatures) return []
  const keys: (keyof ModuleFeatures)[] = ['surveys', 'analyze', 'googleReviews', 'reddit', 'substack', 'townhall', 'campaigns', 'bots']
  return keys.filter(function(k) {
    if (!orgFeatures[k]) return false
    if (userFeatures !== undefined && userFeatures !== null) return !!userFeatures[k]
    return true
  })
}

/** Validate that at least one feature is enabled. */
export function hasAnyFeature(features: ModuleFeatures | null | undefined): boolean {
  if (!features) return false
  return ['surveys', 'analyze', 'googleReviews', 'reddit', 'substack', 'townhall', 'campaigns', 'bots'].some(function(k) {
    return !!(features as any)[k]
  })
}
