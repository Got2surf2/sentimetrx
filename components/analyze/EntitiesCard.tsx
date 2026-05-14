'use client'

// components/analyze/EntitiesCard.tsx
// The dedicated Entities card on the TextMine Themes tab. Replaces the old
// per-theme-card "Top entities" section — entities are scope-wide, not
// theme-specific (dishes co-occur with every theme), so they belong in one
// browsable place.
//
// Pills are styled like the theme keyword pills (plain grey); the category
// colour lives only in the section-header dot. Clicking a pill opens a modal
// listing the comments that actually mention that entity — via
// /rows-by-entity, which matches the open-ended review text, not structured
// columns like a location label.
//
// Backend: GET /api/datasets/[id]/entities?limit=200
//          GET /api/datasets/[id]/rows-by-entity?entity=<slug>&limit=100

import { useCallback, useEffect, useState } from 'react'
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
// User-facing section labels + display order.
const CATEGORY_ORDER: Array<{ key: string; label: string }> = [
  { key: 'food',   label: 'Dishes & Food' },
  { key: 'drink',  label: 'Drinks' },
  { key: 'person', label: 'People' },
  { key: 'brand',  label: 'Brands & Competitors' },
  { key: 'place',  label: 'Places' },
  { key: 'other',  label: 'Other' },
]

export default function EntitiesCard({ datasetId, schema }: Props) {
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState('')
  const [entities, setEntities]           = useState<EntityRow[]>([])
  const [totalDistinct, setTotalDistinct] = useState<number | null>(null)
  const [scopeType, setScopeType]         = useState<'dataset' | 'collection' | null>(null)

  // Drill-down modal state.
  const [drillEntity, setDrillEntity]   = useState<EntityRow | null>(null)
  const [drillRows, setDrillRows]       = useState<CommentRow[]>([])
  const [drillTotal, setDrillTotal]     = useState(0)
  const [drillLoading, setDrillLoading] = useState(false)
  const [drillError, setDrillError]     = useState('')

  const openEndedFields = (schema.fields || []).filter(function(f) { return f.type === 'open-ended' })
  const metaFields = (schema.fields || []).filter(function(f) {
    return f.type === 'categorical' || f.type === 'numeric' || f.type === 'date'
  })

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

  // Group entities by category, preserving the API's mentions-desc order.
  const byCategory: Record<string, EntityRow[]> = {}
  for (const e of entities) {
    if (!byCategory[e.category]) byCategory[e.category] = []
    byCategory[e.category].push(e)
  }
  const visibleCategories = CATEGORY_ORDER.filter(function(c) {
    return (byCategory[c.key] || []).length > 0
  })

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

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
          <LottieLoader size={28} />
        </div>
      )}

      {!loading && error && (
        <div style={{ fontSize: 11, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '6px 10px' }}>
          {error}
        </div>
      )}

      {!loading && !error && entities.length === 0 && (
        <div style={{ fontSize: 11, color: P.textFaint, fontStyle: 'italic' }}>
          No entities yet. Run {'“'}Discover entities{'”'} on the Schema tab to surface them.
        </div>
      )}

      {!loading && !error && entities.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {visibleCategories.map(function(c) {
            const color = CATEGORY_COLOR[c.key] || CATEGORY_COLOR.other
            const rows = byCategory[c.key]
            return (
              <div key={c.key}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 4, background: color, flexShrink: 0 }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: P.textFaint, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                    {c.label} ({rows.length})
                  </span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {rows.map(function(e) {
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
              </div>
            )
          })}
        </div>
      )}

      {/* ── Drill-down modal: comments mentioning the clicked entity ── */}
      {drillEntity && (
        <div onClick={closeDrill}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={function(ev) { ev.stopPropagation() }}
            style={{ background: P.white, borderRadius: 14, width: 'min(680px, 100%)', maxHeight: '82vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,.28)' }}>
            {/* header */}
            <div style={{ padding: '14px 18px', borderBottom: '1px solid ' + P.border }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 4, background: CATEGORY_COLOR[drillEntity.category] || CATEGORY_COLOR.other, flexShrink: 0 }} />
                  <span style={{ fontSize: 15, fontWeight: 800, color: P.text }}>{drillEntity.canonical}</span>
                  <span style={{ fontSize: 11, color: P.textFaint, flexShrink: 0 }}>
                    {drillLoading ? 'loading…' : drillTotal.toLocaleString() + ' comment' + (drillTotal !== 1 ? 's' : '')}
                  </span>
                </div>
                <button onClick={closeDrill}
                  style={{ background: 'transparent', border: 'none', fontSize: 18, color: P.textMute, cursor: 'pointer', lineHeight: 1, flexShrink: 0 }}>
                  {'×'}
                </button>
              </div>
              {drillEntity.aliases && drillEntity.aliases.length > 0 && (
                <div style={{ fontSize: 10, color: P.textFaint, marginTop: 4 }}>
                  Also matched: {drillEntity.aliases.join(', ')}
                </div>
              )}
            </div>
            {/* body */}
            <div style={{ overflowY: 'auto', padding: '12px 18px' }}>
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
                const texts = openEndedFields
                  .map(function(f) { return { label: f.label || f.field, value: String(row.data[f.field] ?? '').trim() } })
                  .filter(function(t) { return t.value.length > 0 })
                const meta = metaFields
                  .map(function(f) { return { label: f.label || f.field, value: String(row.data[f.field] ?? '').trim() } })
                  .filter(function(t) { return t.value.length > 0 })
                  .slice(0, 4)
                return (
                  <div key={row.dataset_id + ':' + row.row_index}
                    style={{ borderBottom: '1px solid ' + P.border, padding: '10px 0' }}>
                    {texts.map(function(t, i) {
                      return (
                        <div key={i} style={{ marginBottom: 4 }}>
                          {openEndedFields.length > 1 && (
                            <div style={{ fontSize: 9, fontWeight: 700, color: P.textFaint, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 2 }}>{t.label}</div>
                          )}
                          <div style={{ fontSize: 13, color: P.textMid, lineHeight: 1.5 }}>{t.value}</div>
                        </div>
                      )
                    })}
                    {texts.length === 0 && (
                      <div style={{ fontSize: 12, color: P.textFaint, fontStyle: 'italic' }}>(no text in this row)</div>
                    )}
                    {meta.length > 0 && (
                      <div style={{ fontSize: 10, color: P.textFaint, marginTop: 4 }}>
                        {meta.map(function(m) { return m.label + ': ' + m.value }).join('  ·  ')}
                      </div>
                    )}
                  </div>
                )
              })}
              {!drillLoading && !drillError && drillTotal > drillRows.length && (
                <div style={{ fontSize: 11, color: P.textFaint, textAlign: 'center', padding: '10px 0' }}>
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
