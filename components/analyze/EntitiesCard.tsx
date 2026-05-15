'use client'

// components/analyze/EntitiesCard.tsx
// The dedicated Entities card on the TextMine Themes tab. Replaces the old
// per-theme-card "Top entities" section — entities are scope-wide, not
// theme-specific (dishes co-occur with every theme), so they belong in one
// browsable place.
//
// Entity data is fetched by the parent (TextMineModule) so it survives tab
// switches without re-fetching. This component is purely display.

import { useMemo, useState } from 'react'

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
const CATEGORY_LABEL: Record<string, string> = {
  food:   'Dishes & Food',
  drink:  'Drinks',
  person: 'People',
  brand:  'Brands & Competitors',
  place:  'Places',
  other:  'Other',
}
// Tiebreak order when two categories have the same size.
const CATEGORY_ORDER = ['food', 'drink', 'person', 'brand', 'place', 'other']
const PILL_LIMIT = 30

export default function EntitiesCard({ entities, totalDistinct, scopeType, loading, error, onDrillEntity }: Props) {
  // Active category tab + per-tab "show all" toggle.
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [showAll, setShowAll]               = useState(false)

  // Group entities by category, then build the tab list (largest first).
  const categories = useMemo(function() {
    const byCat: Record<string, EntityRow[]> = {}
    for (const e of entities) {
      if (!byCat[e.category]) byCat[e.category] = []
      byCat[e.category].push(e)
    }
    return Object.keys(byCat)
      .map(function(key) {
        return {
          key,
          label: CATEGORY_LABEL[key] || key,
          color: CATEGORY_COLOR[key] || CATEGORY_COLOR.other,
          rows:  byCat[key],
        }
      })
      .sort(function(a, b) {
        if (b.rows.length !== a.rows.length) return b.rows.length - a.rows.length
        return CATEGORY_ORDER.indexOf(a.key) - CATEGORY_ORDER.indexOf(b.key)
      })
  }, [entities])

  const effectiveKey = (activeCategory && categories.some(function(c) { return c.key === activeCategory }))
    ? activeCategory
    : (categories[0] ? categories[0].key : null)
  const activeCat = categories.find(function(c) { return c.key === effectiveKey }) || null

  function selectCategory(key: string) {
    setActiveCategory(key)
    setShowAll(false)
  }

  // Hidden entirely until there's something to show — no empty card, no flash.
  if (loading || error || entities.length === 0 || !activeCat) return null

  const activeRows = activeCat.rows
  const shownRows = showAll ? activeRows : activeRows.slice(0, PILL_LIMIT)
  const hiddenCount = activeRows.length - shownRows.length

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

      {/* Category tabs — each shows its own color, active gets a heavier border */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12 }}>
        {categories.map(function(c) {
          const isActive = c.key === effectiveKey
          return (
            <button key={c.key} onClick={function() { selectCategory(c.key) }}
              style={{
                fontSize: 11, fontWeight: isActive ? 700 : 600, padding: '4px 10px',
                borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit',
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: isActive ? c.color + '18' : c.color + '0d',
                color: c.color,
                border: (isActive ? '2px' : '1px') + ' solid ' + (isActive ? c.color + '80' : c.color + '40'),
                transition: 'border-width .1s, background .1s',
              }}>
              <span style={{ width: 7, height: 7, borderRadius: 4, background: c.color, flexShrink: 0 }} />
              {c.label}
              <span style={{ fontWeight: 700 }}>{c.rows.length}</span>
            </button>
          )
        })}
      </div>

      {/* Active category's pills — subtle category color accent */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {shownRows.map(function(e) {
          const aliasHint = e.aliases && e.aliases.length > 0
            ? '\nAlso matched: ' + e.aliases.join(', ')
            : ''
          return (
            <button key={e.slug} onClick={function() { onDrillEntity(e) }}
              title={'See comments mentioning ' + e.canonical + aliasHint}
              style={{
                fontSize: 11, padding: '3px 9px',
                background: activeCat.color + '0a',
                color: P.textMid,
                borderRadius: 20,
                border: '1px solid ' + activeCat.color + '30',
                cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'inherit',
              }}>
              <span style={{ fontWeight: 600 }}>{e.canonical}</span>
              <span style={{ color: P.textFaint }}>{e.mentions.toLocaleString()}</span>
            </button>
          )
        })}
      </div>
      {(hiddenCount > 0 || showAll) && activeRows.length > PILL_LIMIT && (
        <button onClick={function() { setShowAll(function(v) { return !v }) }}
          style={{
            marginTop: 8, fontSize: 11, fontWeight: 600, color: P.accent,
            background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
          }}>
          {showAll ? 'Show fewer' : 'Show all ' + activeRows.length.toLocaleString() + ' →'}
        </button>
      )}
    </div>
  )
}
