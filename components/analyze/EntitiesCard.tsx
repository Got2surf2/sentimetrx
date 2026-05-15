'use client'

// components/analyze/EntitiesCard.tsx
// The dedicated Entities card on the TextMine Themes tab. Replaces the old
// per-theme-card "Top entities" section — entities are scope-wide, not
// theme-specific (dishes co-occur with every theme), so they belong in one
// browsable place.
//
// Entity data is fetched by the parent (TextMineModule) so it survives tab
// switches without re-fetching. This component is purely display.

import { useState } from 'react'

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
}

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

// Categories from lib/entityDiscovery.ts: food | drink | place | person | brand | other
const CATEGORY_COLOR: Record<string, string> = {
  food:   '#EA580C',
  drink:  '#7C3AED',
  place:  '#0F7173',
  person: '#1E40AF',
  brand:  '#B45309',
  other:  '#8FA3AE',
}
const MIN_MENTIONS = 10

export default function EntitiesCard({ entities, totalDistinct, scopeType, loading, error, onDrillEntity }: Props) {
  const [showAll, setShowAll] = useState(false)

  if (loading || error || entities.length === 0) return null

  const aboveThreshold = entities.filter(function(e) { return e.mentions >= MIN_MENTIONS })
  const shownRows = showAll ? entities : aboveThreshold
  const hiddenCount = entities.length - aboveThreshold.length

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
        The named things reviewers talk about {'—'} dishes, drinks, people, competitor brands. Click any entity to read the comments that mention it. Discover or re-run entities on the Schema tab.
      </div>

      {/* Flat pill list — each pill tinted by its own category color */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {shownRows.map(function(e) {
          const color = CATEGORY_COLOR[e.category] || CATEGORY_COLOR.other
          const aliasHint = e.aliases && e.aliases.length > 0
            ? '\nAlso matched: ' + e.aliases.join(', ')
            : ''
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
            </button>
          )
        })}
      </div>
      {(hiddenCount > 0 || showAll) && (
        <button onClick={function() { setShowAll(function(v) { return !v }) }}
          style={{
            marginTop: 8, fontSize: 11, fontWeight: 600, color: P.accent,
            background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
          }}>
          {showAll ? 'Show fewer' : 'Show all ' + entities.length.toLocaleString() + ' (includes low-frequency) →'}
        </button>
      )}
    </div>
  )
}
