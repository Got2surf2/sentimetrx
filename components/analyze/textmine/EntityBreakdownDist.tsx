'use client'
// components/analyze/textmine/EntityBreakdownDist.tsx
// Stacked bar chart showing entity prevalence across categorical breakdown
// groups. The entity-side mirror of BreakdownDist.tsx — two views: By Group
// (entities within each group) and By Entity (groups within each entity).
//
// Why a separate component instead of generalising BreakdownDist: themes
// match a row via Theme.keywords + commentMatchesTheme (substring/regex over
// a curated keyword list, with negation handling). Entities match via
// canonical + aliases + plural variants from lib/entityVariants.ts. The two
// matchers don't unify cleanly without losing per-side specifics, so each
// chart owns its own matching path.
//
// Matching: single alternation regex over all entity terms, longest-first
// so "Filet Mignon" wins over "Filet". One pass per row builds a
// per-row → set<slug> map; every group×entity cell then derives from that map
// in O(rows + groups × entities).

import { useState, useMemo } from 'react'
import { sigTest } from '@/lib/statsUtils'
import { expandEntityTerms } from '@/lib/entityVariants'
import { SIGNAL_TIER_ORDER_REDDIT, SIGNAL_TIER_ORDER_SUBSTACK } from '@/lib/signalTier'

import { T } from '@/lib/analyzeTheme'

interface EntityEntry {
  slug:      string
  canonical: string
  category:  string
  aliases?:  string[]
  mentions:  number
}

interface Props {
  entities:      EntityEntry[]
  parsedData:    Record<string, unknown>[]
  fields:        string[]
  breakdownField: string | null
  selectedValues: Set<string>
  onDrillEntity?: (e: EntityEntry) => void
  ratingField?:  string | null
  scopeType?:    'dataset' | 'collection' | null
}

const CATEGORY_COLOR: Record<string, { border: string; bg: string; text: string }> = {
  food:   { border: '#EA580C', bg: '#fff4ef', text: '#9a3412' },
  drink:  { border: '#7C3AED', bg: '#f5f3ff', text: '#5b21b6' },
  place:  { border: '#0F7173', bg: '#ecfeff', text: '#155e75' },
  person: { border: '#1E40AF', bg: '#eff6ff', text: '#1e3a8a' },
  brand:  { border: '#B45309', bg: '#fffbeb', text: '#92400e' },
  other:  { border: '#8FA3AE', bg: '#f3f4f6', text: '#4b5563' },
}

const MAX_VISIBLE_ENTITIES = 25 // cap so the chart stays legible
const MIN_PCT_OF_TOTAL = 1      // entities below 1% of all rows hidden by default

function escapeRE(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getRowText(row: Record<string, unknown>, fields: string[]): string {
  if (!fields.length) return ''
  const parts: string[] = []
  for (const f of fields) {
    const v = row[f]
    if (typeof v === 'string' && v.trim()) parts.push(v.trim())
  }
  return parts.join(' · ')
}

export default function EntityBreakdownDist({
  entities, parsedData, fields, breakdownField, selectedValues, onDrillEntity, ratingField, scopeType,
}: Props) {
  const [distView, setDistView] = useState<'group' | 'entity'>('entity')
  const [showAll, setShowAll] = useState(false)

  // ── selVals (group values) sorted same way BreakdownDist does ──────────
  const selVals = useMemo(function() {
    const vals = Array.from(selectedValues)
    if (!breakdownField) return vals
    if (breakdownField === 'signal_tier') {
      const isRedditTiers = vals.some(function(v) { return v === 'Mainstream' || v === 'Controversial' || v === 'Fringe' || v === 'Noise' })
      const tierList = isRedditTiers ? SIGNAL_TIER_ORDER_REDDIT : SIGNAL_TIER_ORDER_SUBSTACK
      const tierIdx: Record<string, number> = {}
      tierList.forEach(function(t, i) { tierIdx[t] = i })
      return vals.sort(function(a, b) { return (tierIdx[a] ?? 99) - (tierIdx[b] ?? 99) })
    }
    const bf = breakdownField
    const counts: Record<string, number> = {}
    vals.forEach(function(v) { counts[v] = 0 })
    parsedData.forEach(function(r) {
      const v = String(r[bf] ?? '')
      if (counts[v] !== undefined) counts[v]++
    })
    return vals.sort(function(a, b) { return (counts[b] || 0) - (counts[a] || 0) })
  }, [selectedValues, parsedData, breakdownField])

  // ── Per-row entity match set (single regex pass) ───────────────────────
  // The expensive computation: scan each row's open-ended text once, record
  // which entity slugs appear. Every group×entity stat is then a cheap
  // derivation from this map.
  const rowMatches = useMemo(function(): Set<string>[] {
    const empty: Set<string>[] = []
    if (!entities.length || !fields.length || !parsedData.length) return empty

    const termToSlugs: Record<string, string[]> = {}
    for (const e of entities) {
      const terms = expandEntityTerms([e.canonical].concat(e.aliases || []))
      for (const t of terms) {
        const key = t.toLowerCase()
        if (!termToSlugs[key]) termToSlugs[key] = []
        if (!termToSlugs[key].includes(e.slug)) termToSlugs[key].push(e.slug)
      }
    }
    const allTerms = Object.keys(termToSlugs).sort(function(a, b) { return b.length - a.length })
    if (!allTerms.length) return empty
    const re = new RegExp('\\b(' + allTerms.map(escapeRE).join('|') + ')\\b', 'gi')

    const out: Set<string>[] = []
    for (const row of parsedData) {
      const set = new Set<string>()
      const text = getRowText(row, fields).toLowerCase()
      if (text) {
        re.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = re.exec(text)) !== null) {
          const slugs = termToSlugs[m[0].toLowerCase()] || []
          for (const s of slugs) set.add(s)
        }
      }
      out.push(set)
    }
    return out
  }, [entities, parsedData, fields])

  // ── Per-group, per-entity counts (derived from rowMatches) ─────────────
  const { valueCounts, groupTotals, totalEntityMatches, totalAllRows } = useMemo(function() {
    const vc: Record<string, Record<string, number>> = {}
    const gt: Record<string, number> = {}
    if (!breakdownField || !selVals.length || !rowMatches.length) {
      return { valueCounts: vc, groupTotals: gt, totalEntityMatches: {} as Record<string, number>, totalAllRows: 0 }
    }
    selVals.forEach(function(v) { vc[v] = {}; gt[v] = 0 })
    const bf = breakdownField
    for (let i = 0; i < parsedData.length; i++) {
      const row = parsedData[i]
      const v = String(row[bf] ?? '')
      if (!(v in vc)) continue
      const text = getRowText(row, fields).trim()
      if (!text) continue
      gt[v] = (gt[v] || 0) + 1
      const set = rowMatches[i]
      if (set && set.size > 0) {
        set.forEach(function(slug) {
          vc[v][slug] = (vc[v][slug] || 0) + 1
        })
      }
    }
    const ttm: Record<string, number> = {}
    let total = 0
    for (const e of entities) {
      ttm[e.slug] = selVals.reduce(function(s, v) { return s + (vc[v]?.[e.slug] || 0) }, 0)
    }
    total = selVals.reduce(function(s, v) { return s + (gt[v] || 0) }, 0)
    return { valueCounts: vc, groupTotals: gt, totalEntityMatches: ttm, totalAllRows: total }
  }, [rowMatches, selVals, breakdownField, parsedData, fields, entities])

  // ── Rating averages (when ratingField is set) ──────────────────────────
  const ratingAvgs = useMemo(function() {
    if (!ratingField || !breakdownField) return {} as Record<string, Record<string, { avg: number; cnt: number }>>
    const bf = breakdownField
    const avgs: Record<string, Record<string, { sum: number; cnt: number; avg: number }>> = {}
    selVals.forEach(function(v) { avgs[v] = {} })
    for (let i = 0; i < parsedData.length; i++) {
      const row = parsedData[i]
      const v = String(row[bf] ?? '')
      if (!(v in avgs)) continue
      const rv = parseFloat(String(row[ratingField] ?? ''))
      if (isNaN(rv)) continue
      const set = rowMatches[i]
      if (!set || set.size === 0) continue
      set.forEach(function(slug) {
        const cur = avgs[v][slug] || { sum: 0, cnt: 0, avg: 0 }
        cur.sum += rv
        cur.cnt += 1
        avgs[v][slug] = cur
      })
    }
    const out: Record<string, Record<string, { avg: number; cnt: number }>> = {}
    Object.keys(avgs).forEach(function(v) {
      out[v] = {}
      Object.keys(avgs[v]).forEach(function(slug) {
        const r = avgs[v][slug]
        if (r.cnt > 0) out[v][slug] = { avg: Math.round(r.sum / r.cnt * 100) / 100, cnt: r.cnt }
      })
    })
    return out
  }, [ratingField, breakdownField, selVals, parsedData, rowMatches])

  const overallRatingAvg = useMemo(function() {
    if (!ratingField) return 0
    let sum = 0, cnt = 0
    for (const r of parsedData) {
      const rv = parseFloat(String(r[ratingField] ?? ''))
      if (!isNaN(rv)) { sum += rv; cnt++ }
    }
    return cnt > 0 ? sum / cnt : 0
  }, [parsedData, ratingField])

  // ── Visible entities: filter to those with non-zero matches in scope,
  //    drop the long tail, optionally cap to MAX_VISIBLE_ENTITIES ─────────
  const visibleEntities = useMemo(function() {
    const withCounts = entities
      .map(function(e) { return { entity: e, total: totalEntityMatches[e.slug] || 0 } })
      .filter(function(x) { return x.total > 0 })
      .sort(function(a, b) { return b.total - a.total })
    if (showAll) return withCounts
    const filtered = withCounts.filter(function(x) {
      return totalAllRows > 0 && (x.total / totalAllRows * 100) >= MIN_PCT_OF_TOTAL
    })
    const list = filtered.length > 0 ? filtered : withCounts
    return list.slice(0, MAX_VISIBLE_ENTITIES)
  }, [entities, totalEntityMatches, totalAllRows, showAll])

  if (!breakdownField || !selVals.length) return null
  if (!entities.length) return null
  if (!visibleEntities.length) return null

  const hiddenCount = entities.filter(function(e) { return (totalEntityMatches[e.slug] || 0) > 0 }).length - visibleEntities.length

  return (
    <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 12, padding: '18px 20px', marginTop: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap' as const, gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: T.textMid }}>
            Entity Breakdown by {breakdownField}
          </span>
          {scopeType === 'collection' && (
            <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 20, background: T.bg, color: T.textMute, border: '1px solid ' + T.border }}>
              brand-wide
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: T.textMute, cursor: 'pointer' }}>
            <input type="checkbox" checked={showAll}
              onChange={function() { setShowAll(function(v) { return !v }) }}
              style={{ accentColor: T.accent }} />
            Show all
          </label>
          {!showAll && hiddenCount > 0 && (
            <span style={{ fontSize: 10, color: T.textFaint }}>({hiddenCount} hidden)</span>
          )}
          <div style={{ display: 'inline-flex', background: T.bg, borderRadius: 8, padding: 2, border: '1px solid ' + T.border }}>
            {(['group', 'entity'] as const).map(function(mode) {
              return (
                <button
                  key={mode}
                  onClick={function() { setDistView(mode) }}
                  style={{
                    padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6,
                    background: distView === mode ? T.bgCard : 'transparent',
                    color: distView === mode ? T.accent : T.textMute,
                    border: 'none', cursor: 'pointer',
                    boxShadow: distView === mode ? '0 1px 4px rgba(0,0,0,.08)' : 'none',
                  }}
                >
                  {mode === 'group' ? 'By Group' : 'By Entity'}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* By Group view — each group's bar, segmented by its top entities */}
      {distView === 'group' && (
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 14 }}>
          {selVals.map(function(v) {
            const groupTotal = groupTotals[v] || 0
            const vc = valueCounts[v] || {}
            // Order entities for this group by local count (top-down within the visible cap)
            const localOrdered = [...visibleEntities].sort(function(a, b) {
              return (vc[b.entity.slug] || 0) - (vc[a.entity.slug] || 0)
            })
            return (
              <div key={v}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: T.amber, background: T.amberBg, padding: '2px 10px', borderRadius: 20, border: '1px solid ' + T.amber + '40' }}>
                    {v}
                  </span>
                  <span style={{ fontSize: 11, color: T.textFaint }}>n={groupTotal}</span>
                </div>
                {/* Stacked bar — colored by entity category */}
                <div style={{ height: 24, background: T.bg, borderRadius: 6, overflow: 'hidden', display: 'flex', marginBottom: 6 }}>
                  {localOrdered.map(function(x) {
                    const cnt = vc[x.entity.slug] || 0
                    const pct = groupTotal > 0 ? (cnt / groupTotal) * 100 : 0
                    if (pct <= 0) return null
                    const pal = CATEGORY_COLOR[x.entity.category] || CATEGORY_COLOR.other
                    return (
                      <div
                        key={x.entity.slug}
                        title={x.entity.canonical + ': ' + cnt + ' (' + Math.round(pct) + '%)'}
                        style={{ width: pct + '%', background: pal.border, transition: 'width .5s' }}
                      />
                    )
                  })}
                </div>
                {/* Per-entity rows */}
                {localOrdered.map(function(x) {
                  const cnt = vc[x.entity.slug] || 0
                  if (cnt === 0) return null
                  const pct = groupTotal > 0 ? Math.round((cnt / groupTotal) * 100) : 0
                  const pal = CATEGORY_COLOR[x.entity.category] || CATEGORY_COLOR.other
                  const sig = sigTest(cnt, groupTotal, totalEntityMatches[x.entity.slug] || 0, totalAllRows)
                  const sigColor = sig && sig.dir === 'over' ? '#16a34a' : sig && sig.dir === 'under' ? '#dc2626' : null
                  const ra = ratingField ? ratingAvgs[v]?.[x.entity.slug] : null
                  const delta = ra ? ra.avg - overallRatingAvg : 0
                  return (
                    <div
                      key={x.entity.slug}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, cursor: onDrillEntity ? 'pointer' : 'default' }}
                      onClick={onDrillEntity ? function() { onDrillEntity(x.entity) } : undefined}
                    >
                      <div style={{ width: 10, height: 10, borderRadius: 3, background: pal.border, flexShrink: 0 }} />
                      <span style={{ fontSize: 11, color: T.textMid, flex: 1, overflow: 'hidden' as const, textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const }} title={x.entity.canonical}>{x.entity.canonical}</span>
                      <div style={{ width: 80, height: 7, background: T.bg, borderRadius: 4, overflow: 'hidden' as const, flexShrink: 0 }}>
                        <div style={{ height: '100%', width: pct + '%', background: pal.border, borderRadius: 4 }} />
                      </div>
                      {sigColor && <span style={{ fontSize: 11, fontWeight: 800, color: sigColor, flexShrink: 0 }} title={sig!.dir === 'over' ? 'Significantly over-represented (z=' + sig!.z.toFixed(1) + ')' : 'Significantly under-represented (z=' + sig!.z.toFixed(1) + ')'}>★</span>}
                      <span style={{ fontSize: 11, fontWeight: 700, color: T.text, width: 36, textAlign: 'right' as const, flexShrink: 0 }}>{pct}%</span>
                      <span style={{ fontSize: 10, color: T.textFaint, width: 28, textAlign: 'right' as const, flexShrink: 0 }}>{cnt}</span>
                      {ra && (
                        <span style={{ fontSize: 10, fontWeight: 700, width: 40, textAlign: 'right' as const, flexShrink: 0, color: delta > 0.1 ? '#059669' : delta < -0.1 ? '#dc2626' : T.textMid }} title={'Avg rating: ' + ra.avg.toFixed(2) + ' (n=' + ra.cnt + ', ' + (delta >= 0 ? '+' : '') + delta.toFixed(2) + ' vs overall)'}>{ra.avg.toFixed(1)}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      {/* By Entity view — each entity's bar across all groups */}
      {distView === 'entity' && (
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 14 }}>
          {visibleEntities.map(function(x) {
            const pal = CATEGORY_COLOR[x.entity.category] || CATEGORY_COLOR.other
            const maxCnt = Math.max.apply(Math, selVals.map(function(v) { return valueCounts[v]?.[x.entity.slug] || 0 }).concat([1]))
            return (
              <div key={x.entity.slug}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 3, background: pal.border, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: pal.text }}>{x.entity.canonical}</span>
                  <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 10, background: pal.bg, color: pal.text, border: '1px solid ' + pal.border + '40' }}>
                    {x.entity.category}
                  </span>
                  <span style={{ fontSize: 10, color: T.textFaint, marginLeft: 'auto' as const }}>
                    {x.total.toLocaleString()} rows total
                  </span>
                  {onDrillEntity && (
                    <button
                      onClick={function() { onDrillEntity(x.entity) }}
                      style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: pal.bg, color: pal.text, border: '1px solid ' + pal.border + '50', cursor: 'pointer' }}
                    >
                      View comments &rarr;
                    </button>
                  )}
                </div>
                {selVals.map(function(v) {
                  const cnt = valueCounts[v]?.[x.entity.slug] || 0
                  const groupTotal = groupTotals[v] || 0
                  const pct = groupTotal > 0 ? Math.round((cnt / groupTotal) * 100) : 0
                  const barPct = maxCnt > 0 ? (cnt / maxCnt) * 100 : 0
                  const sig = sigTest(cnt, groupTotal, totalEntityMatches[x.entity.slug] || 0, totalAllRows)
                  const sigColor = sig && sig.dir === 'over' ? '#16a34a' : sig && sig.dir === 'under' ? '#dc2626' : null
                  const ra = ratingField ? ratingAvgs[v]?.[x.entity.slug] : null
                  const delta = ra ? ra.avg - overallRatingAvg : 0
                  return (
                    <div key={v} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: T.amber, width: 110, overflow: 'hidden' as const, textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const, flexShrink: 0 }} title={v}>{v}</span>
                      <div style={{ flex: 1, height: 7, background: T.bg, borderRadius: 4, overflow: 'hidden' as const }}>
                        <div style={{ height: '100%', width: barPct + '%', background: pal.border, borderRadius: 4, transition: 'width .5s' }} />
                      </div>
                      {sigColor && <span style={{ fontSize: 11, fontWeight: 800, color: sigColor, flexShrink: 0 }} title={sig!.dir === 'over' ? 'Significantly over-represented (z=' + sig!.z.toFixed(1) + ')' : 'Significantly under-represented (z=' + sig!.z.toFixed(1) + ')'}>★</span>}
                      <span style={{ fontSize: 11, fontWeight: 700, color: T.text, width: 36, textAlign: 'right' as const, flexShrink: 0 }}>{pct}%</span>
                      <span style={{ fontSize: 10, color: T.textFaint, width: 28, textAlign: 'right' as const, flexShrink: 0 }}>{cnt}</span>
                      {ra && (
                        <span style={{ fontSize: 10, fontWeight: 700, width: 40, textAlign: 'right' as const, flexShrink: 0, color: delta > 0.1 ? '#059669' : delta < -0.1 ? '#dc2626' : T.textMid }} title={'Avg rating: ' + ra.avg.toFixed(2) + ' (n=' + ra.cnt + ', ' + (delta >= 0 ? '+' : '') + delta.toFixed(2) + ' vs overall)'}>{ra.avg.toFixed(1)}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      {/* Legend — category badges */}
      <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid ' + T.border, display: 'flex', flexWrap: 'wrap' as const, gap: 6 }}>
        {Array.from(new Set(visibleEntities.map(function(x) { return x.entity.category }))).sort().map(function(cat) {
          const pal = CATEGORY_COLOR[cat] || CATEGORY_COLOR.other
          return (
            <span key={cat} style={{ fontSize: 10, padding: '2px 7px', background: pal.bg, color: pal.text, borderRadius: 10, border: '1px solid ' + pal.border + '50', fontWeight: 600, textTransform: 'capitalize' as const }}>
              {cat}
            </span>
          )
        })}
      </div>
    </div>
  )
}
