import type { ModuleFeatures } from './types'
import { RESTAURANT_INDUSTRIES } from './industryDefaults'

/**
 * Whether an org gets the Dimensions (taxonomy) capability: the explicit
 * `taxonomy` feature flag, OR the org's industry is a restaurant type (the
 * dictionary is restaurant-specific, so restaurant clients get it automatically).
 * Pages also OR in a per-dataset flag (`datasets.taxonomy_enabled`).
 */
export function orgTaxonomyEnabled(orgFeatures: { taxonomy?: boolean; primaryIndustries?: string[] } | null | undefined): boolean {
  if (!orgFeatures) return false
  if (orgFeatures.taxonomy) return true
  const inds = orgFeatures.primaryIndustries
  return Array.isArray(inds) && inds.some(function(i) { return (RESTAURANT_INDUSTRIES as string[]).indexOf(i) !== -1 })
}

const ALL_MODULE_KEYS: (keyof ModuleFeatures)[] = [
  'surveys', 'analyze', 'googleReviews', 'reddit', 'substack', 'recordings',
  'townhall', 'campaigns', 'bots', 'social', 'taxonomy',
]

// Features only reachable *through* the Analyze module. When analyze is off,
// these are forced off too — single source of truth for the dependency.
// NOTE: `recordings` was promoted out of here (2026-06) — it's the standalone
// top-level "Town Hall" product now, independent of Analyze.
const ANALYZE_CHILDREN: (keyof ModuleFeatures)[] = [
  'googleReviews', 'reddit', 'substack', 'taxonomy',
]

export function resolveOrg(raw: unknown): { is_admin_org?: boolean; logo_url?: string; name?: string; features?: any } | null {
  if (!raw) return null
  const org = (Array.isArray(raw) ? raw[0] : raw) as any
  if (!org) return null
  // Admin org gets all features enabled automatically
  if (org.is_admin_org) {
    org.features = {
      ...org.features,
      surveys: true, analyze: true, googleReviews: true, reddit: true,
      substack: true, recordings: true, townhall: true, campaigns: true, bots: true, social: true, taxonomy: true,
    }
  }
  return org
}

/**
 * Compute the *effective* feature flags for a user — the intersection of their
 * org's features and their per-user overrides. The standard pricing semantic:
 * a feature is visible to the user only if both the org has it enabled AND the
 * user is permitted that feature. If userFeatures is null/undefined, the user
 * inherits all of the org's features.
 */
export function effectiveFeatures(
  orgFeatures: ModuleFeatures | null | undefined,
  userFeatures: ModuleFeatures | null | undefined,
): ModuleFeatures {
  const out: ModuleFeatures = {}
  if (!orgFeatures) return out
  for (const k of ALL_MODULE_KEYS) {
    const orgOn = !!orgFeatures[k]
    if (!orgOn) { out[k] = false; continue }
    // If a per-user override exists, it must also be true. Otherwise inherit
    // the org's value (i.e. the user has the org's full set by default).
    if (userFeatures !== undefined && userFeatures !== null && k in userFeatures) {
      out[k] = !!userFeatures[k]
    } else {
      out[k] = true
    }
  }
  // Analytics is the parent: its sub-features are unreachable without it.
  if (!out.analyze) {
    for (const child of ANALYZE_CHILDREN) out[child] = false
  }
  return out
}

/** Check if a specific module is enabled for an org (or org+user). */
export function hasFeature(
  orgFeatures: ModuleFeatures | null | undefined,
  module: keyof ModuleFeatures,
  userFeatures?: ModuleFeatures | null,
): boolean {
  return !!effectiveFeatures(orgFeatures, userFeatures)[module]
}

/** Return all module keys enabled for an org (or intersection of org+user). */
export function enabledFeatures(
  orgFeatures: ModuleFeatures | null | undefined,
  userFeatures?: ModuleFeatures | null,
): (keyof ModuleFeatures)[] {
  const eff = effectiveFeatures(orgFeatures, userFeatures)
  return ALL_MODULE_KEYS.filter(function(k) { return !!eff[k] })
}

/** Validate that at least one feature is enabled. */
export function hasAnyFeature(features: ModuleFeatures | null | undefined): boolean {
  if (!features) return false
  return ALL_MODULE_KEYS.some(function(k) { return !!features[k] })
}
