'use client'

// components/analyze/EntitiesCard.tsx
// The dedicated Entities card on the TextMine Themes tab. Replaces the old
// per-theme-card "Top entities" section — entities are scope-wide, not
// theme-specific (dishes co-occur with every theme), so they belong in one
// browsable place.
//
// Entity data is fetched by the parent (TextMineModule) so it survives tab
// switches without re-fetching. This component is purely display.

import { useState, useEffect, useRef } from 'react'

export interface EntityRow {
  slug:      string
  canonical: string
  category:  string
  aliases:   string[]
  mentions:  number
}

interface Props {
  entities:      EntityRow[]
  totalDistinct: number | null
  scopeType:     'dataset' | 'collection' | null
  loading:       boolean
  error:         string
  onDrillEntity: (entity: EntityRow) => void
  // Per-entity avg rating, computed client-side by the parent from the loaded
  // rows (keyed by slug). Absent when the dataset has no rating field selected.
  ratings?:      Record<string, { avg: number; n: number }>
  overallRating?: number | null
}

// Star badges only show once an entity has enough rated mentions to be
// meaningful — a single 5★ row mentioning "ribeye" isn't a signal.
const MIN_RATED = 3

const P = {
  bg:        '#f7f7f8',
  white:     '#ffffff',
  border:    '#e8e8ec',
  text:      '#111827',
  textMid:   '#374151',
  textMute:  '#6b7280',
  textFaint: '#9ca3af',
  accent:    '#e8622a',
  accentBg:  '#fff4ef',
}

// High-confidence categories get a distinct color; ambiguous ones share a neutral.
const NEUTRAL = '#8FA3AE'
const CATEGORY_COLOR: Record<string, string> = {
  food:   '#EA580C',   // dishes / menu items — high confidence
  person: '#1E40AF',   // named people — high confidence
  drink:  NEUTRAL,
  place:  NEUTRAL,
  brand:  NEUTRAL,
  other:  NEUTRAL,
}
const MIN_MENTIONS  = 10
const ROW_CAP_PX    = 112  // ~4 rows of pills at current type metrics

export default function EntitiesCard({ entities, totalDistinct, scopeType, loading, error, onDrillEntity, ratings, overallRating }: Props) {
  // Two independent toggles:
  //   rowsExpanded — visual row cap (4 rows when collapsed)
  //   showAll       — include low-frequency entities (<10 mentions)
  const [rowsExpanded, setRowsExpanded] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const pillsRef = useRef<HTMLDivElement>(null)

  const aboveThreshold = entities.filter(function(e) { return e.mentions >= MIN_MENTIONS })
  // When no entity clears the noise-reduction threshold (small datasets where
  // every mention count is single-digit), fall back to showing all entities —
  // otherwise the card renders the "35 found" badge but zero pills, with no
  // path to reveal them (the "Include low-frequency" toggle is gated behind
  // the "More" expand, which itself only shows when pills overflow).
  const noneAboveThreshold = aboveThreshold.length === 0
  const lowCount       = noneAboveThreshold ? 0 : entities.length - aboveThreshold.length
  const displayed      = showAll || noneAboveThreshold ? entities : aboveThreshold

  // Detect whether the 4-row cap is actually hiding anything (so we only show
  // "More" when there's something to expand to). Must be declared before any
  // conditional early return — React requires the hook call order to be stable.
  useEffect(function() {
    var el = pillsRef.current
    if (!el) return
    setIsOverflowing(el.scrollHeight > el.clientHeight + 2)
  }, [displayed.length, rowsExpanded])

  if (loading || error || entities.length === 0) return null

  return (
    <div style={{ background: P.white, border: '1px solid ' + P.border, borderRadius: 10, padding: '16px 20px', marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <h3 style={{ fontSize: 14, fontWeight: 800, color: P.text, margin: 0 }}>Entities</h3>
        {totalDistinct != null && totalDistinct > 0 && (
          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 20, background: P.accentBg, color: P.accent, border: '1px solid ' + P.accent + '40' }}>
            {totalDistinct.toLocaleString()} found
          </span>
        )}
        {scopeType === 'collection' && (
          <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 20, background: P.bg, color: P.textMute, border: '1px solid ' + P.border }}>
            brand-wide
          </span>
        )}
      </div>
      <div style={{ fontSize: 11, color: P.textMute, lineHeight: 1.5, marginBottom: 10 }}>
        The named things reviewers talk about {'—'} dishes, drinks, people, competitor brands. Click any entity to read the comments that mention it.{ratings && Object.keys(ratings).length > 0 ? ' The ★ badge is the average rating of the rows mentioning that entity.' : ''} Discover or re-run entities on the Schema tab.
      </div>

      {/* Flat pill list — each pill tinted by its own category color.
          Collapsed to ~4 rows by default; "More" expands. */}
      <div ref={pillsRef}
        style={Object.assign(
          { display: 'flex', flexWrap: 'wrap' as const, gap: 4 },
          rowsExpanded ? {} : { maxHeight: ROW_CAP_PX, overflow: 'hidden' as const },
        )}>
        {displayed.map(function(e) {
          const color = CATEGORY_COLOR[e.category] || CATEGORY_COLOR.other
          const aliasHint = e.aliases && e.aliases.length > 0
            ? '\nAlso matched: ' + e.aliases.join(', ')
            : ''
          const rating = ratings ? ratings[e.slug] : undefined
          const showRating = rating != null && rating.n >= MIN_RATED
          const delta = showRating && overallRating != null ? rating.avg - overallRating : null
          return (
            <button key={e.slug} onClick={function() { onDrillEntity(e) }}
              title={'See comments mentioning ' + e.canonical + aliasHint}
              style={{
                fontSize: 11, padding: '3px 9px',
                background: color + '0d',
                color: P.textMid,
                borderRadius: 20,
                border: '1px solid ' + color + '30',
                cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'inherit',
              }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: color, flexShrink: 0 }} />
              <span style={{ fontWeight: 600 }}>{e.canonical}</span>
              <span style={{ color: P.textFaint }}>{e.mentions.toLocaleString()}</span>
              {showRating && (
                <span title={'Average rating when ' + e.canonical + ' is mentioned: ' + rating!.avg.toFixed(2) + ' (n=' + rating!.n.toLocaleString() + (delta != null ? ', ' + (delta >= 0 ? '+' : '') + delta.toFixed(2) + ' vs overall' : '') + ')'}
                  style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10, background: '#fffbeb', border: '1px solid #fde68a', color: delta != null && delta > 0.1 ? '#059669' : delta != null && delta < -0.1 ? '#dc2626' : '#92400e' }}>
                  {'★'} {rating!.avg.toFixed(1)}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Action row: More / Show fewer + low-frequency toggle */}
      <div style={{ marginTop: 8, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        {!rowsExpanded && isOverflowing && (
          <button onClick={function() { setRowsExpanded(true) }}
            style={{ fontSize: 11, fontWeight: 600, color: P.accent, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}>
            More →
          </button>
        )}
        {rowsExpanded && (
          <button onClick={function() { setRowsExpanded(false); setShowAll(false) }}
            style={{ fontSize: 11, fontWeight: 600, color: P.accent, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}>
            Show fewer ↑
          </button>
        )}
        {rowsExpanded && lowCount > 0 && (
          <button onClick={function() { setShowAll(function(v) { return !v }) }}
            style={{ fontSize: 11, fontWeight: 600, color: P.textMute, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}>
            {showAll ? 'Hide low-frequency' : 'Include low-frequency (' + lowCount.toLocaleString() + ' more) →'}
          </button>
        )}
      </div>
    </div>
  )
}
