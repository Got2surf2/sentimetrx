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

// Which (section, view) cells have a real renderer today; the rest show a
// graceful placeholder. Single gate so a not-yet-built cell is one edit away
// from the placeholder. (Dimensions Clouds/Compare are filled in during Phase 2.)
export function cellHasContent(section: Section, view: LensView): boolean {
  if (section === 'dimensions') return view !== 'compare'   // Compare is the last Phase-2 build
  return true
}

// A view is locked (needs a theme model) when its underlying subTab is
// clouds/compare/comments and no themes exist — matching the legacy per-tab lock.
// Dimensions cells, whose subTab stays 'dimensions', are never theme-locked.
export function viewLocked(section: Section, view: LensView, hasThemes: boolean): boolean {
  const st = deriveLegacy(section, view).subTab
  return (st === 'clouds' || st === 'compare' || st === 'comments') && !hasThemes
}
