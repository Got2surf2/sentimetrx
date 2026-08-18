// Tests for the pure (section, view) ⇄ (subTab, viewBy) state map that drives
// the TextMine two-row navigation (Target B IA). These lock the round-trips so
// the canonical nav state and the legacy renderer state never desync.

import { describe, it, expect } from 'vitest'
import {
  sectionOf, viewOf, deriveLegacy, viewsFor, cellHasContent, viewLocked,
  availableSections, defaultSection,
  type Section, type LensView,
} from '@/lib/textmineNav'

const LENS_SECTIONS: Section[] = ['themes', 'dimensions', 'entities']
const VIEWS: LensView[] = ['overview', 'clouds', 'compare', 'comments']

describe('deriveLegacy', () => {
  it('maps each lens Overview to its renderer state', () => {
    expect(deriveLegacy('themes', 'overview')).toEqual({ subTab: 'themes', viewBy: 'theme' })
    expect(deriveLegacy('entities', 'overview')).toEqual({ subTab: 'themes', viewBy: 'entity' })
    expect(deriveLegacy('dimensions', 'overview')).toEqual({ subTab: 'dimensions', viewBy: 'theme' })
  })

  it('carries the lens into Clouds/Compare via viewBy', () => {
    expect(deriveLegacy('themes', 'clouds')).toEqual({ subTab: 'clouds', viewBy: 'theme' })
    expect(deriveLegacy('entities', 'clouds')).toEqual({ subTab: 'clouds', viewBy: 'entity' })
    expect(deriveLegacy('themes', 'compare')).toEqual({ subTab: 'compare', viewBy: 'theme' })
    expect(deriveLegacy('entities', 'compare')).toEqual({ subTab: 'compare', viewBy: 'entity' })
  })

  it('routes every Comments cell to the comments renderer', () => {
    expect(deriveLegacy('themes', 'comments').subTab).toBe('comments')
    expect(deriveLegacy('entities', 'comments').subTab).toBe('comments')
    expect(deriveLegacy('dimensions', 'comments').subTab).toBe('comments')
  })

  it('keeps Dimensions Clouds/Compare on the dimensions subTab (no theme lock)', () => {
    expect(deriveLegacy('dimensions', 'clouds')).toEqual({ subTab: 'dimensions', viewBy: 'theme' })
    expect(deriveLegacy('dimensions', 'compare')).toEqual({ subTab: 'dimensions', viewBy: 'theme' })
  })
})

describe('sectionOf / viewOf round-trips', () => {
  it('section→view→legacy→section recovers the section for non-Comments views', () => {
    for (const section of LENS_SECTIONS) {
      for (const view of (['overview', 'clouds', 'compare'] as LensView[])) {
        const { subTab, viewBy } = deriveLegacy(section, view)
        expect(sectionOf(subTab, viewBy)).toBe(section)
      }
    }
  })

  it('recovers the view for views that have a distinct subTab', () => {
    // Dimensions Clouds/Compare collapse onto the dimensions subTab by design
    // (they are placeholder/standalone cells), so viewOf can only recover the
    // view where the subTab is unique to it.
    expect(viewOf(deriveLegacy('themes', 'clouds').subTab)).toBe('clouds')
    expect(viewOf(deriveLegacy('entities', 'compare').subTab)).toBe('compare')
    expect(viewOf(deriveLegacy('themes', 'comments').subTab)).toBe('comments')
    expect(viewOf(deriveLegacy('themes', 'overview').subTab)).toBe('overview')
    expect(viewOf(deriveLegacy('dimensions', 'overview').subTab)).toBe('overview')
  })

  it('Comments collapses the lens distinction onto viewBy only', () => {
    // Both Themes and Dimensions Comments use subTab=comments,viewBy=theme — the
    // reason section/view must be the canonical state, not derived from legacy.
    expect(deriveLegacy('themes', 'comments')).toEqual(deriveLegacy('dimensions', 'comments'))
  })
})

describe('viewsFor', () => {
  it('offers the same four views for every lens section', () => {
    for (const section of LENS_SECTIONS) {
      expect(viewsFor(section)).toEqual(VIEWS)
    }
  })
})

describe('cellHasContent', () => {
  it('every lens cell has a renderer (all Phase-2 cells built)', () => {
    for (const section of LENS_SECTIONS) {
      for (const view of VIEWS) {
        expect(cellHasContent(section, view)).toBe(true)
      }
    }
  })
})

describe('availableSections', () => {
  it('plain upload with no entities = Themes only', () => {
    expect(availableSections({ datasetSource: 'upload' })).toEqual(['themes'])
  })

  it('taxonomy capability adds Dimensions', () => {
    expect(availableSections({ datasetSource: 'upload', taxonomyEnabled: true })).toEqual(['themes', 'dimensions'])
  })

  it('a non-empty entity catalog adds Entities', () => {
    expect(availableSections({ datasetSource: 'upload', hasEntities: true })).toEqual(['themes', 'entities'])
  })

  it('google_reviews implies Dimensions; ≥5 outlets AND the enable add Advanced', () => {
    expect(availableSections({ datasetSource: 'google_reviews', outletCount: 4, outletReportingEnabled: true })).toEqual(['themes', 'dimensions'])
    expect(availableSections({ datasetSource: 'google_reviews', hasEntities: true, outletCount: 5, outletReportingEnabled: true }))
      .toEqual(['themes', 'dimensions', 'entities', 'advanced'])
  })

  it('returns sections in bar order', () => {
    const all = availableSections({ datasetSource: 'google_reviews', taxonomyEnabled: true, hasEntities: true, outletCount: 10, outletReportingEnabled: true })
    expect(all).toEqual(['themes', 'dimensions', 'entities', 'advanced'])
  })

  it('Advanced needs google_reviews, not just outlets', () => {
    expect(availableSections({ datasetSource: 'upload', outletCount: 99, outletReportingEnabled: true })).toEqual(['themes'])
  })

  // Outlet reporting became an explicit capability on 2026-08-18. Before that a
  // google_reviews brand with ≥5 locations got the Leaderboard and Outlet
  // Deep-Dive automatically, with no way to switch them off.
  it('Advanced is HIDDEN when outlet reporting is not enabled, however good the data', () => {
    expect(availableSections({ datasetSource: 'google_reviews', outletCount: 500 }))
      .toEqual(['themes', 'dimensions'])
    expect(availableSections({ datasetSource: 'google_reviews', outletCount: 500, outletReportingEnabled: false }))
      .toEqual(['themes', 'dimensions'])
  })

  it('the enable alone is not enough — the data still has to support outlets', () => {
    expect(availableSections({ datasetSource: 'upload', outletReportingEnabled: true })).toEqual(['themes'])
    expect(availableSections({ datasetSource: 'google_reviews', outletCount: 4, outletReportingEnabled: true }))
      .toEqual(['themes', 'dimensions'])
  })

  it('taxonomySuppressed hides Dimensions on a google_reviews dataset (non-restaurant)', () => {
    expect(availableSections({ datasetSource: 'google_reviews', taxonomySuppressed: true })).toEqual(['themes'])
  })

  it('an explicit taxonomy capability still wins over suppression', () => {
    expect(availableSections({ datasetSource: 'google_reviews', taxonomyEnabled: true, taxonomySuppressed: true }))
      .toEqual(['themes', 'dimensions'])
  })
})

describe('defaultSection', () => {
  it('is the first available section (Themes today)', () => {
    expect(defaultSection({ datasetSource: 'upload' })).toBe('themes')
    expect(defaultSection({ datasetSource: 'google_reviews', outletCount: 9 })).toBe('themes')
  })
})

describe('viewLocked', () => {
  it('locks clouds/compare/comments until a theme model exists', () => {
    expect(viewLocked('themes', 'clouds', false)).toBe(true)
    expect(viewLocked('themes', 'compare', false)).toBe(true)
    expect(viewLocked('themes', 'comments', false)).toBe(true)
    expect(viewLocked('entities', 'clouds', false)).toBe(true)
  })

  it('never locks Overview, and unlocks everything once themes exist', () => {
    expect(viewLocked('themes', 'overview', false)).toBe(false)
    expect(viewLocked('entities', 'overview', false)).toBe(false)
    for (const view of VIEWS) expect(viewLocked('themes', view, true)).toBe(false)
  })

  it('never theme-locks Dimensions cells (subTab stays dimensions, except Comments)', () => {
    expect(viewLocked('dimensions', 'overview', false)).toBe(false)
    expect(viewLocked('dimensions', 'clouds', false)).toBe(false)
    expect(viewLocked('dimensions', 'compare', false)).toBe(false)
    // Dimensions Comments rides the comments subTab, so it follows the theme lock.
    expect(viewLocked('dimensions', 'comments', false)).toBe(true)
  })
})
