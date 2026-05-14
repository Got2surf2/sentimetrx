'use client'

// components/analyze/EntitiesCard.tsx
// The dedicated Entities card on the TextMine Themes tab. Replaces the old
// per-theme-card "Top entities" section — entities are scope-wide, not
// theme-specific (dishes co-occur with every theme), so they belong in one
// browsable place.
//
// Layout: category tabs (sorted by size) keep the card compact; each tab
// shows the top N pills with a "Show all" toggle. The whole card is hidden
// when the scope has no entities. Pills are styled like the theme keyword
// pills (plain grey). Clicking a pill opens a modal listing the comments
// that actually mention that entity — via /rows-by-entity, which matches the
// open-ended review text, not structured columns — with the entity hit
// highlighted inline.
//
// Backend: GET /api/datasets/[id]/entities?limit=200
//          GET /api/datasets/[id]/rows-by-entity?entity=<slug>&limit=100

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import LottieLoader from '@/components/ui/LottieLoader'
import type { SchemaConfig } from '@/lib/analyzeTypes'

interface EntityRow {
  slug:      string
  canonical: string
  category:  string
  aliases:   string[]
  mentions:  number
}

interface CommentRow {
  id:         number
  dataset_id: string
  row_index:  number
  data:       Record<string, unknown>
}

interface Props {
  datasetId: string
  schema:    SchemaConfig
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

const MARK_STYLE: CSSProperties = {
  background: '#ffe4d6', color: '#9a3412', borderRadius: 3, padding: '0 2px', fontWeight: 600,
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Highlight every occurrence of the entity's terms (canonical + aliases)
 *  inside a comment's text, so the reader can see why the row matched. */
function highlightTerms(text: string, terms: string[]): ReactNode {
  const cleaned = Array.from(new Set(
    terms.map(function(t) { return t.trim() }).filter(function(t) { return t.length >= 2 }),
  )).sort(function(a, b) { return b.length - a.length })
  if (cleaned.length === 0 || !text) return text
  let re: RegExp
  try {
    re = new RegExp('\\b(' + cleaned.map(escapeRegExp).join('|') + ')\\b', 'gi')
  } catch {
    return text
  }
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(<mark key={m.index} style={MARK_STYLE}>{m[0]}</mark>)
    last = m.index + m[0].length
    if (m.index === re.lastIndex) re.lastIndex++
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export default function EntitiesCard({ datasetId, schema }: Props) {
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState('')
  const [entities, setEntities]           = useState<EntityRow[]>([])
  const [totalDistinct, setTotalDistinct] = useState<number | null>(null)
  const [scopeType, setScopeType]         = useState<'dataset' | 'collection' | null>(null)

  // Active category tab + per-tab "show all" toggle.
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [showAll, setShowAll]               = useState(false)

  // Drill-down modal state.
  const [drillEntity, setDrillEntity]   = useState<EntityRow | null>(null)
  const [drillRows, setDrillRows]       = useState<CommentRow[]>([])
  const [drillTotal, setDrillTotal]     = useState(0)
  const [drillLoading, setDrillLoading] = useState(false)
  const [drillError, setDrillError]     = useState('')

  const openEndedFields = useMemo(function() {
    return (schema.fields || []).filter(function(f) { return f.type === 'open-ended' })
  }, [schema])
  const metaFields = useMemo(function() {
    return (schema.fields || []).filter(function(f) {
      return f.type === 'categorical' || f.type === 'numeric' || f.type === 'date'
    })
  }, [schema])

  const loadEntities = useCallback(async function() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/datasets/' + datasetId + '/entities?limit=200')
      if (!res.ok) { setEntities([]); setTotalDistinct(null); return }
      const data = await res.json()
      setEntities(data.entities || [])
      setTotalDistinct(typeof data.total_distinct === 'number' ? data.total_distinct : null)
      setScopeType(data.scope_type || null)
    } catch (err: any) {
      setError(err?.message || 'Failed to load entities')
    } finally {
      setLoading(false)
    }
  }, [datasetId])

  useEffect(function() { loadEntities() }, [loadEntities])

  const openEntity = useCallback(async function(e: EntityRow) {
    setDrillEntity(e)
    setDrillRows([])
    setDrillTotal(0)
    setDrillError('')
    setDrillLoading(true)
    try {
      const res = await fetch('/api/datasets/' + datasetId + '/rows-by-entity?entity=' + encodeURIComponent(e.slug) + '&limit=100')
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to load comments')
      setDrillRows(data.rows || [])
      setDrillTotal(typeof data.total === 'number' ? data.total : (data.rows || []).length)
    } catch (err: any) {
      setDrillError(err?.message || 'Failed to load comments')
    } finally {
      setDrillLoading(false)
    }
  }, [datasetId])

  function closeDrill() { setDrillEntity(null) }

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

      {/* Category tabs */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12 }}>
        {categories.map(function(c) {
          const isActive = c.key === effectiveKey
          return (
            <button key={c.key} onClick={function() { selectCategory(c.key) }}
              style={{
                fontSize: 11, fontWeight: isActive ? 700 : 600, padding: '4px 10px',
                borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit',
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: isActive ? c.color + '14' : P.bg,
                color: isActive ? c.color : P.textMute,
                border: '1px solid ' + (isActive ? c.color + '55' : P.border),
              }}>
              <span style={{ width: 7, height: 7, borderRadius: 4, background: c.color, flexShrink: 0 }} />
              {c.label}
              <span style={{ color: isActive ? c.color : P.textFaint, fontWeight: 700 }}>{c.rows.length}</span>
            </button>
          )
        })}
      </div>

      {/* Active category's pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {shownRows.map(function(e) {
          const aliasHint = e.aliases && e.aliases.length > 0
            ? '\nAlso matched: ' + e.aliases.join(', ')
            : ''
          return (
            <button key={e.slug} onClick={function() { openEntity(e) }}
              title={'See comments mentioning ' + e.canonical + aliasHint}
              style={{
                fontSize: 11, padding: '3px 9px', background: P.bg, color: P.textMid,
                borderRadius: 20, border: '1px solid ' + P.border, cursor: 'pointer',
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

      {/* ── Drill-down modal: comments mentioning the clicked entity ── */}
      {drillEntity && (
        <div onClick={closeDrill}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={function(ev) { ev.stopPropagation() }}
            style={{ background: P.white, borderRadius: 14, width: 'min(700px, 100%)', maxHeight: '84vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,.28)', overflow: 'hidden' }}>
            {/* header */}
            <div style={{ padding: '14px 18px', borderBottom: '1px solid ' + P.border, background: P.bg }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 5, background: CATEGORY_COLOR[drillEntity.category] || CATEGORY_COLOR.other, flexShrink: 0 }} />
                  <span style={{ fontSize: 16, fontWeight: 800, color: P.text }}>{drillEntity.canonical}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: P.textMute, background: P.white, border: '1px solid ' + P.border, borderRadius: 20, padding: '1px 8px', flexShrink: 0 }}>
                    {drillLoading ? 'loading…' : drillTotal.toLocaleString() + ' comment' + (drillTotal !== 1 ? 's' : '')}
                  </span>
                </div>
                <button onClick={closeDrill}
                  style={{ background: 'transparent', border: 'none', fontSize: 20, color: P.textMute, cursor: 'pointer', lineHeight: 1, flexShrink: 0 }}>
                  {'×'}
                </button>
              </div>
              {drillEntity.aliases && drillEntity.aliases.length > 0 && (
                <div style={{ fontSize: 10, color: P.textFaint, marginTop: 5 }}>
                  Also matched: {drillEntity.aliases.join(', ')}
                </div>
              )}
            </div>
            {/* body */}
            <div style={{ overflowY: 'auto', padding: '14px 18px', background: P.white }}>
              {drillLoading && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
                  <LottieLoader size={32} />
                </div>
              )}
              {!drillLoading && drillError && (
                <div style={{ fontSize: 12, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '8px 12px' }}>
                  {drillError}
                </div>
              )}
              {!drillLoading && !drillError && drillRows.length === 0 && (
                <div style={{ fontSize: 12, color: P.textFaint, fontStyle: 'italic', padding: '8px 0' }}>
                  No comments found for this entity.
                </div>
              )}
              {!drillLoading && !drillError && drillRows.map(function(row) {
                const highlightTermsList = [drillEntity.canonical].concat(drillEntity.aliases || [])
                const texts = openEndedFields
                  .map(function(f) { return { label: f.label || f.field, value: String(row.data[f.field] ?? '').trim() } })
                  .filter(function(t) { return t.value.length > 0 })
                const meta = metaFields
                  .map(function(f) { return { label: f.label || f.field, value: String(row.data[f.field] ?? '').trim() } })
                  .filter(function(t) { return t.value.length > 0 })
                  .slice(0, 4)
                return (
                  <div key={row.dataset_id + ':' + row.row_index}
                    style={{ background: P.bg, border: '1px solid ' + P.border, borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
                    {texts.map(function(t, i) {
                      return (
                        <div key={i} style={{ marginBottom: i < texts.length - 1 ? 6 : 0 }}>
                          {openEndedFields.length > 1 && (
                            <div style={{ fontSize: 9, fontWeight: 700, color: P.textFaint, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 2 }}>{t.label}</div>
                          )}
                          <div style={{ fontSize: 13, color: P.textMid, lineHeight: 1.55 }}>
                            {highlightTerms(t.value, highlightTermsList)}
                          </div>
                        </div>
                      )
                    })}
                    {texts.length === 0 && (
                      <div style={{ fontSize: 12, color: P.textFaint, fontStyle: 'italic' }}>(no text in this row)</div>
                    )}
                    {meta.length > 0 && (
                      <div style={{ fontSize: 10, color: P.textFaint, marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: '2px 10px' }}>
                        {meta.map(function(m, i) {
                          return <span key={i}><span style={{ fontWeight: 700 }}>{m.label}:</span> {m.value}</span>
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
              {!drillLoading && !drillError && drillTotal > drillRows.length && (
                <div style={{ fontSize: 11, color: P.textFaint, textAlign: 'center', padding: '4px 0 2px' }}>
                  Showing the first {drillRows.length.toLocaleString()} of {drillTotal.toLocaleString()}.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
