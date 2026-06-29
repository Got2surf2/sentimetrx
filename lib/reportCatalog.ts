// lib/reportCatalog.ts
//
// Single source of truth for the unified "Reports" picker: given a card's
// context (a single dataset vs a collection, its source/purpose/capabilities),
// which report TYPES are available, in which FORMATS, and how to launch each.
// Pure + unit-tested (like lib/textmineNav.ts) so the card menu, the analyze-
// view menu, and any future surface never drift.
//
// SCOPE semantics (owner, 2026-06-29): a report launched from a CARD covers the
// full dataset (no filter context); launched from the ANALYZE VIEW it honors
// the current filters / saved-view. The caller passes the scope; the catalog
// just declares which scopes a type accepts.
//
// The `formats` arrays reflect what's actually wired TODAY — options are added
// as the renderers land (deck PDF, collection PPTX, ad-hoc Ask-Ana), so the
// picker never shows a format that would produce a broken file.

export type ReportFormat = 'pdf' | 'pptx' | 'html'
export type ReportScope = 'full' | 'in-view'

export type ReportTypeId =
  | 'deck'                // the configurable "Full report" (ex-StoryTime)
  | 'operational-review'  // restaurant ops deck
  | 'community'           // collection: community synthesis
  | 'competitive'         // collection: competitive
  | 'brand-360'           // collection: one brand, many sources
  | 'ad-hoc'              // free-text, Ask-Ana generated

export interface ReportLaunch {
  url: string
  method: 'GET' | 'POST'
  body?: Record<string, unknown>   // for POST; format/scope/purpose folded in by the caller
}

export interface ReportType {
  id:           ReportTypeId
  label:        string
  description:  string
  formats:      ReportFormat[]   // currently-wired formats (first = default)
  configurable: boolean          // opens the config modal vs one-click generate
  scopes:       ReportScope[]    // which scopes this type supports
  /** Build the request for a given target id + chosen format. */
  launch: (id: string, format: ReportFormat) => ReportLaunch
}

export interface ReportContext {
  isCollection:      boolean
  source?:           string | null   // 'google_reviews' | 'recording' | 'bot' | 'upload' | …
  collectionPurpose?: 'community' | 'competitive' | 'brand_360' | null
  taxonomyEnabled?:  boolean
  taxonomySuppressed?: boolean
  memberCount?:      number
  aiEnabled?:        boolean
  adHocEnabled?:     boolean   // ad-hoc Ask-Ana report — off until its endpoint ships
}

const dsBase   = (id: string) => `/api/datasets/${id}`
const collBase = (id: string) => `/api/collections/${id}`

// Mirrors lib/textmineNav: google_reviews is the restaurant/Dimensions proxy
// unless explicitly suppressed; an explicit taxonomy_enabled also qualifies.
function hasDimensions(ctx: ReportContext): boolean {
  return !!ctx.taxonomyEnabled || (ctx.source === 'google_reviews' && !ctx.taxonomySuppressed)
}

function deckType(): ReportType {
  return {
    id: 'deck', label: 'Full report',
    description: 'The complete consulting deck — themes, sentiment, Dimensions, charts. Configurable.',
    formats: ['pptx', 'html'],   // pdf added once the doc renderer is shared
    configurable: true,
    scopes: ['full', 'in-view'],
    launch: (id, format) => format === 'html'
      ? { url: `${dsBase(id)}/export/html`, method: 'POST' }
      : { url: `${dsBase(id)}/export/pptx`, method: 'POST' },
  }
}

function operationalReviewType(): ReportType {
  return {
    id: 'operational-review', label: 'Operational Review',
    description: 'Restaurant operations deck — brand health, leaderboard, drivers, Dimensions, benchmark.',
    formats: ['pptx'],
    configurable: false,
    scopes: ['full'],
    launch: (id) => ({ url: `${dsBase(id)}/operational-review-deck`, method: 'GET' }),
  }
}

function projectType(id: 'community' | 'competitive' | 'brand-360', label: string, description: string, purpose: string): ReportType {
  return {
    id, label, description,
    formats: ['pdf', 'html'],   // pptx for collection reports is a fast-follow
    configurable: false,
    scopes: ['full'],
    launch: (cid, format) => format === 'html'
      ? { url: `${collBase(cid)}/project-report?purpose=${purpose}`, method: 'GET' }
      : { url: `${collBase(cid)}/project-report/pdf`, method: 'POST', body: { purpose } },
  }
}

function adHocType(isCollection: boolean): ReportType {
  const base = isCollection ? collBase : dsBase
  return {
    id: 'ad-hoc', label: 'Ad-hoc report',
    description: 'Describe exactly what you want — Ask Ana writes a focused report on this data.',
    formats: ['pdf', 'html'],
    configurable: true,   // opens a prompt box
    scopes: isCollection ? ['full'] : ['full', 'in-view'],
    launch: (id) => ({ url: `${base(id)}/ad-hoc-report`, method: 'POST' }),
  }
}

/**
 * The report types available for a context, in display order. Gating mirrors the
 * card today: collections offer their purpose-matched synthesis report(s); a
 * single dataset offers the Full report (+ Operational Review for restaurants);
 * everything offers an ad-hoc report when AI is on.
 */
export function availableReports(ctx: ReportContext): ReportType[] {
  const out: ReportType[] = []

  if (ctx.isCollection) {
    const p = ctx.collectionPurpose ?? null
    const enough = (ctx.memberCount ?? 0) >= 2
    if (!p || p === 'community')   out.push(projectType('community', 'Community report', 'Synthesis across this collection’s town halls, agents, and feedback — community voices only.', 'community'))
    if ((!p || p === 'competitive') && enough) out.push(projectType('competitive', 'Competitive report', 'Head-to-head comparison across the collection’s members, with a focus brand.', 'competitive'))
    if (!p || p === 'brand_360')   out.push(projectType('brand-360', 'Brand 360 report', 'One brand triangulated across every source in the collection.', 'brand_360'))
  } else {
    if (ctx.aiEnabled !== false) out.push(deckType())
    if (hasDimensions(ctx)) out.push(operationalReviewType())
  }

  // Ad-hoc is gated on its endpoint being live (off by default) AND AI being on.
  if (ctx.adHocEnabled && ctx.aiEnabled !== false) out.push(adHocType(ctx.isCollection))
  return out
}

/** Convenience: does any report exist for this context? (gates the menu entry). */
export function hasAnyReport(ctx: ReportContext): boolean {
  return availableReports(ctx).length > 0
}
