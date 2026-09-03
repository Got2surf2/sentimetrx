// lib/textmineNav.ts
// Pure state-mapping for the TextMine two-row navigation (Target B IA).
//
// TextMine is four PEER sections (row 1) × per-lens VIEWS (row 2). The content
// renderers in TextMineModule still key off the legacy (subTab, viewBy) tuple,
// so these helpers translate between the canonical (section, view) nav state and
// that legacy tuple. Kept pure + dependency-free so they can be unit-tested and
// shared by both TextMineModule and the standalone TextMineNav component.

export type SubTab = 'themes' | 'clouds' | 'compare' | 'comments' | 'dimensions'
export type Section = 'themes' | 'dimensions' | 'entities' | 'advanced'
export type LensView = 'overview' | 'clouds' | 'compare' | 'comments'

// (subTab, viewBy) → which section tab is highlighted.
export function sectionOf(subTab: SubTab, viewBy: 'theme' | 'entity'): Section {
  if (subTab === 'dimensions') return 'dimensions'
  return viewBy === 'entity' ? 'entities' : 'themes'
}

// (subTab) → which view tab is highlighted. themes/dimensions are each a
// section's Overview; clouds/compare/comments map straight across.
export function viewOf(subTab: SubTab): LensView {
  if (subTab === 'clouds') return 'clouds'
  if (subTab === 'compare') return 'compare'
  if (subTab === 'comments') return 'comments'
  return 'overview'
}

// (section, view) → the legacy (subTab, viewBy) the renderers understand.
export function deriveLegacy(section: Section, view: LensView): { subTab: SubTab; viewBy: 'theme' | 'entity' } {
  if (section === 'dimensions') {
    if (view === 'comments') return { subTab: 'comments', viewBy: 'theme' }
    return { subTab: 'dimensions', viewBy: 'theme' }
  }
  const viewBy: 'theme' | 'entity' = section === 'entities' ? 'entity' : 'theme'
  if (view === 'clouds') return { subTab: 'clouds', viewBy }
  if (view === 'compare') return { subTab: 'compare', viewBy }
  if (view === 'comments') return { subTab: 'comments', viewBy }
  return { subTab: 'themes', viewBy }   // overview
}

// The lens sections share one uniform sub-menu. Cells without a renderer yet
// (see cellHasContent) surface a graceful placeholder rather than being hidden.
export function viewsFor(_section: Section): LensView[] {
  return ['overview', 'clouds', 'compare', 'comments']
}

// Which (section, view) cells have a real renderer. Every lens cell now has one
// (Dimensions Clouds/Compare were built in Phase 2). Kept as the single gate so
// a future not-yet-built cell is one edit away from the graceful placeholder.
export function cellHasContent(_section: Section, _view: LensView): boolean {
  return true
}

// A view is locked (needs a theme model) when its underlying subTab is
// clouds/compare/comments and no themes exist — matching the legacy per-tab lock.
// Dimensions cells, whose subTab stays 'dimensions', are never theme-locked.
export function viewLocked(section: Section, view: LensView, hasThemes: boolean): boolean {
  const st = deriveLegacy(section, view).subTab
  return (st === 'clouds' || st === 'compare' || st === 'comments') && !hasThemes
}

// Which sections a dataset supports — the single source of truth for the row-1
// gates (shared by TextMineModule's bar and the reset-if-unavailable guard).
// Returned in bar order: Themes, Dimensions, Entities, Advanced.
// taxonomySuppressed: AI detected non-food-service data → hide the restaurant
// taxonomy even for google_reviews. It overrides ONLY the source proxy, never an
// explicit taxonomyEnabled (the dataset's own `taxonomy_enabled` flag; org
// capability alone no longer lights the tab — owner decision 2026-09-03).
export interface SectionGateOpts {
  datasetSource?: string; taxonomyEnabled?: boolean; taxonomySuppressed?: boolean
  hasEntities?: boolean; outletCount?: number
  /** Org `outletReporting` feature OR the dataset's `schema_config.outletReporting`. */
  outletReportingEnabled?: boolean
}
export function availableSections(opts: SectionGateOpts): Section[] {
  const out: Section[] = ['themes']   // Themes is always available (the mining home)
  if (opts.taxonomyEnabled || (opts.datasetSource === 'google_reviews' && !opts.taxonomySuppressed)) out.push('dimensions')
  if (opts.hasEntities) out.push('entities')
  // Advanced = outlet-level reporting (Leaderboard + Outlet Deep-Dive).
  //
  // Two independent conditions, both required (2026-08-18, owner direction):
  //   1. ENABLED — the org capability or the per-dataset Schema toggle. Until
  //      today there was no enable at all: every google_reviews brand with ≥5
  //      locations got these surfaces automatically, with no way to turn them
  //      off, and no other dataset could ever get them.
  //   2. The data can actually support it. Outlet identity still comes from
  //      `review_source_locations`, so that remains google_reviews + ≥5. Once
  //      outlets can be derived from a schema-designated location column
  //      (`hierarchyLevel`), THIS is the clause that widens — the enable above
  //      does not change.
  const outletDataReady = opts.datasetSource === 'google_reviews' && (opts.outletCount || 0) >= 5
  if (opts.outletReportingEnabled && outletDataReady) out.push('advanced')
  return out
}
// Default landing section = the first AVAILABLE section (always Themes today,
// but kept derived so a future themes-less dataset lands somewhere valid).
export function defaultSection(opts: SectionGateOpts): Section {
  return availableSections(opts)[0]
}
