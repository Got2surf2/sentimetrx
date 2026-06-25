'use client'
// components/analyze/textmine/DimensionCloud.tsx
// Dimensions × Clouds cell. The dimension analog of the theme/entity clouds —
// same card + sticky-header + filter-chip + flowing-cloud chrome as EntityCloud,
// differing only in the unit (taxonomy sub-buckets, colored by axis instead of
// entities colored by category) and the data source (the server /taxonomy
// rollup rather than a client row scan). Clicking a sub drills into Comments.

import { useState, useEffect, useMemo, useTransition } from 'react'
import { T } from '@/lib/analyzeTheme'
import LottieLoader from '@/components/ui/LottieLoader'
import { DIM_AXES, DIM_AXIS_LABEL, AXIS_COLOR, dimSubLabel, type Axis } from '@/lib/dimensionFields'

interface SubStat { axis: string; sub: string; count: number; posPct?: number; avgRating?: number | null }

const MIN_MENTIONS = 10  // hide long-tail subs until "Show all", matching EntityCloud

export default function DimensionCloud({ datasetId, fields, onDrillDimension }: {
  datasetId: string
  fields: string[]
  onDrillDimension: (axis: string, sub: string) => void
}) {
  const [subs, setSubs] = useState<SubStat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [activeAxes, setActiveAxes] = useState<Set<string> | null>(null)
  const [hoveredAxis, setHoveredAxis] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(function() {
    let cancelled = false
    setLoading(true); setError('')
    const qs = (fields || []).map(function(f) { return 'fields=' + encodeURIComponent(f) }).join('&')
    fetch('/api/datasets/' + datasetId + '/taxonomy' + (qs ? '?' + qs : ''))
      .then(function(r) { return r.ok ? r.json() : Promise.reject(new Error('Failed to load dimensions')) })
      .then(function(d) { if (!cancelled) setSubs((d.subs || []) as SubStat[]) })
      .catch(function(e) { if (!cancelled) setError(e?.message || 'Failed to load dimensions') })
      .finally(function() { if (!cancelled) setLoading(false) })
    return function() { cancelled = true }
  }, [datasetId, fields])

  const maxCount = useMemo(function() {
    return subs.reduce(function(m, s) { return s.count > m ? s.count : m }, 1)
  }, [subs])

  // Centered initial loader — same size/treatment as the theme/entity clouds.
  if (loading) return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}><LottieLoader size={120} message="Loading dimension clouds…" /></div>
  if (error) return <div style={{ padding: 24, color: T.red, fontSize: 13 }}>{error}</div>
  if (!subs.length) return <div style={{ padding: 24, color: T.textMute, fontSize: 13 }}>No dimensions tagged yet for the selected field.</div>

  const minCount = subs.reduce(function(m, s) { return s.count < m ? s.count : m }, maxCount)
  const sqMin = Math.sqrt(minCount), sqRange = Math.sqrt(maxCount) - sqMin
  function fontFor(count: number): number {
    if (sqRange <= 0) return 20
    return Math.round(13 + ((Math.sqrt(count) - sqMin) / sqRange) * 21)   // 13 … 34px
  }

  // Visible subs — top by mention until "Show all". Fall back to the top 12 if
  // the threshold would hide everything (mirrors EntityCloud).
  const withFreq = subs.filter(function(s) { return s.count > 0 })
  let visible: SubStat[] = withFreq
  if (!showAll) {
    const filtered = withFreq.filter(function(s) { return s.count >= MIN_MENTIONS })
    visible = filtered.length > 0 ? filtered : withFreq.slice().sort(function(a, b) { return b.count - a.count }).slice(0, 12)
  }
  const hiddenBelowThreshold = withFreq.length - visible.length

  // Axis filter chips — color-coded, click to dim others (≡ EntityCloud).
  const presentAxes = DIM_AXES.filter(function(a) { return visible.some(function(s) { return s.axis === a }) })
  const axisActive = function(a: string): boolean { return !activeAxes || activeAxes.has(a) }
  function toggleAxis(a: string) {
    const all = new Set<string>(presentAxes)
    const cur = activeAxes || all
    const n = new Set(cur)
    if (n.has(a)) { if (n.size === 1) { setActiveAxes(null); return } n.delete(a) }
    else n.add(a)
    setActiveAxes(n.size === all.size ? null : n)
  }

  const sortedVisible = visible.slice().sort(function(a, b) { return b.count - a.count })

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 24 }} className="fadein">
      <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 12, padding: '18px 20px', position: 'relative' }}>
        {/* Sticky header — title + show-all, matching the entity/theme clouds */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 5, background: T.bgCard,
          margin: '-18px -20px 16px', padding: '14px 20px',
          borderBottom: '1px solid ' + T.borderMid,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
        }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: T.textMid }}>Dimension Clouds</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: T.textMute, cursor: 'pointer' }}>
              <input type="checkbox" checked={showAll}
                onChange={function() { startTransition(function() { setShowAll(function(v) { return !v }) }) }}
                style={{ accentColor: T.accent }} />
              Show all
            </label>
            {!showAll && hiddenBelowThreshold > 0 && (
              <span style={{ fontSize: 10, color: T.textFaint }}>({hiddenBelowThreshold} below {MIN_MENTIONS} mentions hidden)</span>
            )}
          </div>
        </div>

        {isPending && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 4, background: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12 }}>
            <LottieLoader size={64} />
          </div>
        )}

        {/* Axis filter chips — click to isolate */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
          {presentAxes.map(function(a) {
            const color = AXIS_COLOR[a as Axis]
            const isOn = axisActive(a)
            const cnt = visible.filter(function(s) { return s.axis === a }).length
            return (
              <button key={a} onClick={function() { toggleAxis(a) }}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  fontSize: 11, fontWeight: isOn ? 700 : 500, padding: '4px 10px', borderRadius: 10, cursor: 'pointer',
                  background: isOn ? color + '14' : '#f3f4f6', color: isOn ? color : '#9ca3af',
                  border: '1px solid ' + (isOn ? color + '80' : '#e5e7eb'), opacity: isOn ? 1 : 0.6, fontFamily: 'inherit',
                }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: isOn ? color : '#d1d5db', flexShrink: 0, display: 'inline-block' }} />
                {DIM_AXIS_LABEL[a as Axis]}
                <span style={{ fontSize: 10, opacity: isOn ? 0.75 : 0.5, fontWeight: 600 }}>{cnt}</span>
              </button>
            )
          })}
        </div>

        {/* The cloud */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 12px', alignItems: 'baseline', lineHeight: 1.7 }}>
          {sortedVisible.map(function(s) {
            const color = AXIS_COLOR[s.axis as Axis]
            const chipDimmed = !axisActive(s.axis)
            const hoverDimmed = hoveredAxis != null && hoveredAxis !== s.axis
            const dimmed = chipDimmed || hoverDimmed
            return (
              <button key={s.axis + '|' + s.sub} onClick={function() { onDrillDimension(s.axis, s.sub) }}
                onMouseEnter={function() { setHoveredAxis(s.axis) }}
                onMouseLeave={function() { setHoveredAxis(null) }}
                title={dimSubLabel(s.sub) + ' · ' + DIM_AXIS_LABEL[s.axis as Axis] + ' · ' + s.count.toLocaleString() + ' mention' + (s.count === 1 ? '' : 's') + ' — click to read these comments'}
                style={{
                  fontSize: fontFor(s.count), fontWeight: s.count > maxCount * 0.5 ? 700 : 600, lineHeight: 1.05,
                  color: dimmed ? '#d1d5db' : color, background: 'transparent', border: 'none', cursor: 'pointer',
                  padding: 0, fontFamily: 'inherit', opacity: dimmed ? 0.3 : 1, transition: 'all .15s',
                  display: 'inline-flex', alignItems: 'baseline', gap: 3,
                }}>
                {dimSubLabel(s.sub)}
                <span style={{ fontSize: Math.max(9, fontFor(s.count) - 6), fontWeight: 600, opacity: 0.6 }}>{s.count.toLocaleString()}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
