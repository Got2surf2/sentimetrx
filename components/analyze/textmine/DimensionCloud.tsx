'use client'
// components/analyze/textmine/DimensionCloud.tsx
// Dimensions × Clouds cell. A word-cloud of taxonomy sub-buckets, grouped by
// axis and sized by mention count — the dimension analog of the theme/entity
// clouds. Self-contained (fetches the /taxonomy rollup itself, like
// TaxonomyModule); clicking a sub drills into the Comments filter.

import { useState, useEffect } from 'react'
import { T } from '@/lib/analyzeTheme'
import LottieLoader from '@/components/ui/LottieLoader'
import { DIM_AXES, DIM_AXIS_LABEL, AXIS_COLOR, dimSubLabel, type Axis } from '@/lib/dimensionFields'

interface SubStat { axis: string; sub: string; count: number; posPct?: number; avgRating?: number | null }

export default function DimensionCloud({ datasetId, fields, onDrillDimension }: {
  datasetId: string
  fields: string[]
  onDrillDimension: (axis: string, sub: string) => void
}) {
  const [subs, setSubs] = useState<SubStat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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

  if (loading) return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><LottieLoader size={28} /></div>
  if (error) return <div style={{ padding: 24, color: T.red, fontSize: 13 }}>{error}</div>
  if (!subs.length) return <div style={{ padding: 24, color: T.textMute, fontSize: 13 }}>No dimensions tagged yet for the selected field.</div>

  const maxCount = subs.reduce(function(m, s) { return s.count > m ? s.count : m }, 0) || 1
  const minCount = subs.reduce(function(m, s) { return s.count < m ? s.count : m }, maxCount)
  const sqMin = Math.sqrt(minCount), sqRange = Math.sqrt(maxCount) - sqMin
  function fontFor(count: number): number {
    if (sqRange <= 0) return 20
    return Math.round(13 + ((Math.sqrt(count) - sqMin) / sqRange) * 21)   // 13 … 34px
  }

  const byAxis: Record<string, SubStat[]> = {}
  subs.forEach(function(s) { (byAxis[s.axis] = byAxis[s.axis] || []).push(s) })

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 24 }} className="fadein">
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: T.text, margin: 0 }}>Dimension Clouds</h2>
        <p style={{ fontSize: 12, color: T.textMid, margin: '3px 0 0' }}>Each sub-dimension sized by how often it&apos;s mentioned. Click any to read the comments behind it.</p>
      </div>
      {DIM_AXES.filter(function(a) { return (byAxis[a] || []).length > 0 }).map(function(axis) {
        const color = AXIS_COLOR[axis as Axis]
        const list = (byAxis[axis] || []).slice().sort(function(a, b) { return b.count - a.count })
        return (
          <div key={axis} style={{ marginBottom: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: color, flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: T.textMid, textTransform: 'uppercase', letterSpacing: '.06em' }}>{DIM_AXIS_LABEL[axis as Axis]}</span>
              <span style={{ fontSize: 11, color: T.textFaint }}>{list.length}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px 16px', alignItems: 'baseline' }}>
              {list.map(function(s) {
                return (
                  <button key={s.sub} onClick={function() { onDrillDimension(s.axis, s.sub) }}
                    title={dimSubLabel(s.sub) + ' — ' + s.count.toLocaleString() + ' mention' + (s.count === 1 ? '' : 's') + ' — click to read these comments'}
                    style={{ fontSize: fontFor(s.count), fontWeight: 600, lineHeight: 1.05, color: color, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>
                    {dimSubLabel(s.sub)}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
