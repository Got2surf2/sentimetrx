'use client'
// components/analyze/textmine/EntityCompareTab.tsx
//
// Multi-field entity comparison — entity equivalent of CompareTab. Pick one
// or more categorical fields ("location", "day of week", "channel"), see
// which entities over- or under-index in each compounded segment.
//
// Mirrors CompareTab's UX but with entities as the unit instead of themes.
// Reuses the same per-row alternation-regex match-set pattern that
// EntityBreakdownDist + EntityCloud already use, so counts stay consistent
// across the entity-side views.
//
// Why a fork instead of generalising CompareTab: theme matching
// (Theme.keywords + commentMatchesTheme, with negation support) and entity
// matching (canonical + aliases + plural variants) don't unify cleanly. The
// charts share layout but diverge on the load-bearing matcher.

import { useMemo, useState } from 'react'
import { T } from '@/lib/analyzeTheme'
import { sigTest, welchTTest } from '@/lib/statsUtils'
import { expandEntityTerms } from '@/lib/entityVariants'

interface EntityEntry {
  slug:      string
  canonical: string
  category:  string
  aliases?:  string[]
  mentions:  number
}

interface SchemaField {
  field: string
  type:  string
  label?: string
  values?: unknown[]
}

interface Props {
  entities:        EntityEntry[]
  parsedData:      Record<string, unknown>[]
  fields:          string[]
  schema:          SchemaField[]
  breakdownFields: string[]
  setBreakdownFields: (f: string[]) => void
  ratingField?:    string | null
  viewMode:        'group' | 'entity'
  setViewMode:     (v: 'group' | 'entity') => void
  smartAxes:       boolean
  setSmartAxes:    (v: boolean) => void
  scopeType?:      'dataset' | 'collection' | null
  onDrillEntity?:  (e: EntityEntry, group?: string) => void
}

const CATEGORY_COLOR: Record<string, { border: string; bg: string; text: string }> = {
  food:   { border: '#EA580C', bg: '#fff4ef', text: '#9a3412' },
  drink:  { border: '#7C3AED', bg: '#f5f3ff', text: '#5b21b6' },
  place:  { border: '#0F7173', bg: '#ecfeff', text: '#155e75' },
  person: { border: '#1E40AF', bg: '#eff6ff', text: '#1e3a8a' },
  brand:  { border: '#B45309', bg: '#fffbeb', text: '#92400e' },
  other:  { border: '#8FA3AE', bg: '#f3f4f6', text: '#4b5563' },
}

const MAX_VISIBLE_ENTITIES = 25

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

export default function EntityCompareTab({
  entities, parsedData, fields, schema,
  breakdownFields, setBreakdownFields,
  ratingField, viewMode, setViewMode, smartAxes, setSmartAxes,
  scopeType, onDrillEntity,
}: Props) {
  const [showAll, setShowAll] = useState(false)
  const [showSummary, setShowSummary] = useState(false)
  const [copied, setCopied] = useState(false)

  const catFields = schema.filter(function(f) { return f.type === 'categorical' }).map(function(f) { return f.field })
  const fieldLabel = function(f: string): string {
    const sf = schema.find(function(s) { return s.field === f })
    return (sf && sf.label && sf.label !== f) ? sf.label : f
  }

  function toggleField(f: string) {
    setBreakdownFields(
      breakdownFields.includes(f)
        ? breakdownFields.filter(function(x) { return x !== f })
        : breakdownFields.concat([f]),
    )
  }

  // ── Per-row entity match-set (single regex pass) ──────────────────────
  // Same pattern as EntityBreakdownDist — compute once, every (group, entity)
  // cell is then a cheap derivation.
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

  // ── Compute per-group, per-entity stats ───────────────────────────────
  const compStats = useMemo(function() {
    if (!entities.length || !breakdownFields.length || !parsedData.length || !rowMatches.length) return null
    const totalRows = parsedData.length

    function groupKey(row: Record<string, unknown>): string {
      return breakdownFields.map(function(f) { return String(row[f] ?? '(blank)') }).join(' × ')
    }

    const groupRows: Record<string, number[]> = {}  // group key → row indices
    for (let i = 0; i < parsedData.length; i++) {
      const k = groupKey(parsedData[i])
      if (!groupRows[k]) groupRows[k] = []
      groupRows[k].push(i)
    }
    const groupKeys = Object.keys(groupRows).sort()

    const groupStats = groupKeys.map(function(gk) {
      const rowIdxs = groupRows[gk]
      const groupTotal = rowIdxs.length
      const groupPct = totalRows > 0 ? Math.round(groupTotal / totalRows * 100) : 0
      const entityStats = entities.map(function(e) {
        let count = 0
        const ratingValues: number[] = []
        for (const ri of rowIdxs) {
          if (rowMatches[ri].has(e.slug)) {
            count += 1
            if (ratingField) {
              const rv = parseFloat(String(parsedData[ri][ratingField] ?? ''))
              if (!isNaN(rv)) ratingValues.push(rv)
            }
          }
        }
        const avgRating = ratingValues.length > 0
          ? Math.round(ratingValues.reduce(function(a, b) { return a + b }, 0) / ratingValues.length * 100) / 100
          : null
        return { entitySlug: e.slug, entityName: e.canonical, count, avgRating, ratingValues }
      })
      return { group: gk, groupTotal, groupPct, entityStats }
    })

    let overallRatAvg = 0
    if (ratingField) {
      let sum = 0, cnt = 0
      for (const r of parsedData) {
        const rv = parseFloat(String(r[ratingField] ?? ''))
        if (!isNaN(rv)) { sum += rv; cnt++ }
      }
      if (cnt > 0) overallRatAvg = sum / cnt
    }

    const entityStats = entities.map(function(e) {
      let totalMatches = 0
      const allGroupRatings: Record<string, number[]> = {}
      groupStats.forEach(function(g) {
        const es = g.entityStats.find(function(es) { return es.entitySlug === e.slug })
        const c = es ? es.count : 0
        totalMatches += c
        allGroupRatings[g.group] = es ? es.ratingValues : []
      })
      const perGroup = groupStats.map(function(g) {
        const es = g.entityStats.find(function(es) { return es.entitySlug === e.slug })
        const count = es ? es.count : 0
        const mentionRate = g.groupTotal > 0 ? Math.round(count / g.groupTotal * 100) : 0
        let ratingSig: { dir: 'higher' | 'lower' | 'ns'; p: number } | null = null
        if (ratingField) {
          const thisR = allGroupRatings[g.group] || []
          let restR: number[] = []
          Object.keys(allGroupRatings).forEach(function(gk) { if (gk !== g.group) restR = restR.concat(allGroupRatings[gk]) })
          if (thisR.length >= 5 && restR.length >= 5) {
            const tt = welchTTest(thisR, restR)
            if (tt && tt.p < 0.05) ratingSig = { dir: tt.ma > tt.mb ? 'higher' : 'lower', p: tt.p }
          }
        }
        return { group: g.group, count, mentionRate, groupTotal: g.groupTotal, groupPct: g.groupPct, avgRating: es ? es.avgRating : null, ratingSig }
      })
      return { entitySlug: e.slug, entityName: e.canonical, category: e.category, totalMatches, perGroup }
    })

    return { groupStats, entityStats, groupKeys, totalRows, overallRatAvg }
  }, [entities, breakdownFields, parsedData, rowMatches, ratingField])

  // ── Outlier collection for the summary text export ────────────────────
  const outliers = useMemo(function() {
    if (!compStats) return [] as Array<{ group: string; entityName: string; thisPct: number; restPct: number; dir: string; z: number; groupTotal: number; count: number }>
    const list: Array<{ group: string; entityName: string; thisPct: number; restPct: number; dir: string; z: number; groupTotal: number; count: number }> = []
    compStats.entityStats.forEach(function(es) {
      es.perGroup.forEach(function(g) {
        const sig = sigTest(g.count, g.groupTotal, es.totalMatches, compStats.totalRows)
        if (sig && sig.dir !== 'ns') {
          list.push({ group: g.group, entityName: es.entityName, thisPct: Math.round(sig.p1 * 100), restPct: Math.round(sig.p2 * 100), dir: sig.dir, z: sig.z, groupTotal: g.groupTotal, count: g.count })
        }
      })
    })
    list.sort(function(a, b) { return Math.abs(b.z) - Math.abs(a.z) })
    return list
  }, [compStats])

  const summaryText = useMemo(function() {
    if (!outliers.length) return 'No statistically significant entity outliers found (p < 0.05, min n = 30).'
    const lines = ['ENTITY SEGMENT ANALYSIS SUMMARY', 'Breakdown: ' + breakdownFields.map(fieldLabel).join(' × '), 'Generated: ' + new Date().toLocaleDateString(), '─'.repeat(50), '']
    const over = outliers.filter(function(o) { return o.dir === 'over' })
    const under = outliers.filter(function(o) { return o.dir === 'under' })
    if (over.length) {
      lines.push('OVER-INDEXED SEGMENTS (mention this entity significantly more)')
      over.forEach(function(o) { lines.push('• "' + o.group + '" → "' + o.entityName + '": ' + o.thisPct + '% vs ' + o.restPct + '% baseline (z=' + o.z.toFixed(1) + ', n=' + o.groupTotal + ')') })
      lines.push('')
    }
    if (under.length) {
      lines.push('UNDER-INDEXED SEGMENTS (mention this entity significantly less)')
      under.forEach(function(o) { lines.push('• "' + o.group + '" → "' + o.entityName + '": ' + o.thisPct + '% vs ' + o.restPct + '% baseline (z=' + o.z.toFixed(1) + ', n=' + o.groupTotal + ')') })
    }
    return lines.join('\n')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outliers, breakdownFields])

  // ── Visible entities (top-N by total matches, Show all bypasses cap) ──
  const visibleEntityStats = useMemo(function() {
    if (!compStats) return []
    const withMatches = compStats.entityStats.filter(function(es) { return es.totalMatches > 0 })
    const sorted = withMatches.slice().sort(function(a, b) {
      return smartAxes ? b.totalMatches - a.totalMatches : a.entityName.localeCompare(b.entityName)
    })
    return showAll ? sorted : sorted.slice(0, MAX_VISIBLE_ENTITIES)
  }, [compStats, smartAxes, showAll])

  // ── Empty states ──────────────────────────────────────────────────────
  if (!entities.length) {
    return (
      <div style={{ padding: 24, color: T.textMute, fontSize: 13 }}>
        No entity catalog for this scope. Discover or seed entities on the Schema tab.
      </div>
    )
  }
  if (!catFields.length) {
    return (
      <div style={{ padding: 24, color: T.textMute, fontSize: 13 }}>
        No categorical fields available for comparison.
      </div>
    )
  }

  const hiddenTailCount = compStats
    ? Math.max(0, compStats.entityStats.filter(function(es) { return es.totalMatches > 0 }).length - visibleEntityStats.length)
    : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column' as const, height: '100%', overflow: 'hidden' as const }}>
      {/* ── Top bar: field selector + view toggle ────────────────────── */}
      <div style={{ flexShrink: 0, padding: '16px 24px', borderBottom: '1px solid ' + T.border, background: T.bgCard }}>
        <div style={{ display: 'flex', alignItems: 'flex-start' as const, justifyContent: 'space-between', flexWrap: 'wrap' as const, gap: 12, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: T.textMid }}>Break down by:</span>
            {catFields.map(function(f) {
              const on = breakdownFields.includes(f)
              return (
                <button key={f}
                  onClick={function() { toggleField(f) }}
                  style={{
                    fontSize: 11, fontWeight: on ? 700 : 500, padding: '4px 11px', borderRadius: 16,
                    background: on ? T.accentBg : T.bg,
                    color: on ? T.accent : T.textMute,
                    border: '1px solid ' + (on ? T.accent + '60' : T.border),
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                  {fieldLabel(f)}
                </button>
              )
            })}
            {scopeType === 'collection' && (
              <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 20, background: T.bg, color: T.textMute, border: '1px solid ' + T.border, marginLeft: 8 }} title="Counts use the scope-wide entity match — same matching the cloud and pill list use.">
                brand-wide
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: T.textMute, cursor: 'pointer' }}>
              <input type="checkbox" checked={smartAxes} onChange={function() { setSmartAxes(!smartAxes) }} style={{ accentColor: T.accent }} />
              Sort by impact
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: T.textMute, cursor: 'pointer' }}>
              <input type="checkbox" checked={showAll} onChange={function() { setShowAll(function(v) { return !v }) }} style={{ accentColor: T.accent }} />
              Show all
            </label>
            {!showAll && hiddenTailCount > 0 && (
              <span style={{ fontSize: 10, color: T.textFaint }}>({hiddenTailCount} hidden)</span>
            )}
            <div style={{ display: 'inline-flex', background: T.bg, borderRadius: 8, padding: 2, border: '1px solid ' + T.border }}>
              {(['group', 'entity'] as const).map(function(m) {
                return (
                  <button
                    key={m}
                    onClick={function() { setViewMode(m) }}
                    style={{
                      padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6,
                      background: viewMode === m ? T.bgCard : 'transparent',
                      color: viewMode === m ? T.accent : T.textMute,
                      border: 'none', cursor: 'pointer',
                      boxShadow: viewMode === m ? '0 1px 4px rgba(0,0,0,.08)' : 'none',
                      textTransform: 'capitalize' as const, fontFamily: 'inherit',
                    }}>
                    By {m === 'group' ? 'Group' : 'Entity'}
                  </button>
                )
              })}
            </div>
            <button
              onClick={function() { setShowSummary(true) }}
              disabled={!outliers.length}
              style={{
                fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 6,
                background: outliers.length ? T.accentBg : T.bg,
                color: outliers.length ? T.accent : T.textFaint,
                border: '1px solid ' + (outliers.length ? T.accent + '40' : T.border),
                cursor: outliers.length ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit',
              }}>
              Summarize findings ({outliers.length})
            </button>
          </div>
        </div>
      </div>

      {/* ── Scrollable results ───────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto' as const, padding: '20px 24px' }}>
        {!breakdownFields.length && (
          <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 12, padding: '40px 24px', textAlign: 'center' as const, color: T.textFaint }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>{'👆'}</div>
            <p style={{ fontSize: 13, margin: 0 }}>Select one or more fields above to start comparing entities across segments.</p>
          </div>
        )}

        {/* ── By Group view ────────────────────────────────────────── */}
        {compStats && breakdownFields.length > 0 && viewMode === 'group' && (
          <div>
            {compStats.groupStats.map(function(g) {
              const localOrdered = visibleEntityStats.map(function(es) {
                const local = es.perGroup.find(function(pg) { return pg.group === g.group })
                return { es, local }
              }).filter(function(x) { return x.local && x.local.count > 0 }).sort(function(a, b) {
                return (b.local ? b.local.count : 0) - (a.local ? a.local.count : 0)
              })
              const maxShare = localOrdered.reduce(function(m, x) { return Math.max(m, x.local ? x.local.mentionRate : 0) }, 1)
              return (
                <div key={g.group} style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 10, padding: '16px 18px', marginBottom: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 14 }}>
                    <span style={{ color: T.accent }}>{g.group}</span>
                    <span style={{ fontSize: 12, fontWeight: 400, color: T.textMute, marginLeft: 6 }}>({g.groupPct}% of dataset · {g.groupTotal.toLocaleString()} responses)</span>
                  </div>
                  {localOrdered.length === 0 && (
                    <div style={{ fontSize: 11, color: T.textFaint, fontStyle: 'italic' as const }}>No entity mentions in this segment's visible-entity set.</div>
                  )}
                  {localOrdered.map(function(x) {
                    if (!x.local) return null
                    const sig = sigTest(x.local.count, x.local.groupTotal, x.es.totalMatches, compStats!.totalRows)
                    const sigColor = sig && sig.dir === 'over' ? '#16a34a' : sig && sig.dir === 'under' ? '#dc2626' : null
                    const pal = CATEGORY_COLOR[x.es.category] || CATEGORY_COLOR.other
                    const ra = ratingField ? x.local.avgRating : null
                    const delta = ra != null ? ra - compStats!.overallRatAvg : 0
                    return (
                      <div key={x.es.entitySlug}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, cursor: onDrillEntity ? 'pointer' : 'default' }}
                        onClick={onDrillEntity ? function() {
                          const ent = entities.find(function(e) { return e.slug === x.es.entitySlug })
                          if (ent) onDrillEntity(ent, g.group)
                        } : undefined}>
                        <div style={{ width: 7, height: 7, borderRadius: 3, background: pal.border, flexShrink: 0 }} />
                        <span style={{ fontSize: 11, color: T.textMid, width: 150, overflow: 'hidden' as const, textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const, flexShrink: 0 }} title={x.es.entityName}>
                          {x.es.entityName}
                        </span>
                        <div style={{ flex: 1, height: 10, background: T.bg, borderRadius: 5, overflow: 'hidden' as const }}>
                          <div style={{ height: '100%', width: Math.max(maxShare > 0 ? x.local.mentionRate / maxShare * 100 : 0, x.local.mentionRate > 0 ? 2 : 0) + '%', background: pal.border, borderRadius: 5, transition: 'width .5s' }} />
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 800, color: sigColor || 'transparent', flexShrink: 0, width: 14, textAlign: 'center' as const }}
                          title={sig && sigColor ? (sig.dir === 'over' ? '"' + g.group + '" mentions "' + x.es.entityName + '" at ' + Math.round(sig.p1 * 100) + '%, significantly higher than the ' + Math.round(sig.p2 * 100) + '% baseline (z=' + sig.z.toFixed(1) + ').' : '"' + g.group + '" mentions "' + x.es.entityName + '" at ' + Math.round(sig.p1 * 100) + '%, significantly lower than the ' + Math.round(sig.p2 * 100) + '% baseline (z=' + sig.z.toFixed(1) + ').') : ''}>
                          {sigColor ? '★' : ''}
                        </span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: T.text, width: 40, textAlign: 'right' as const, flexShrink: 0 }}>{x.local.mentionRate}%</span>
                        <span style={{ fontSize: 10, color: T.textFaint, width: 52, textAlign: 'right' as const, flexShrink: 0 }}>n={x.local.count}</span>
                        {ra != null && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: Math.abs(delta) > 0.1 ? (delta > 0 ? '#059669' : '#dc2626') : T.textMid, width: 38, textAlign: 'right' as const, flexShrink: 0 }}
                            title={'Avg ' + ra.toFixed(2) + ' (' + (delta >= 0 ? '+' : '') + delta.toFixed(2) + ' vs overall)'}>
                            {ra.toFixed(1)}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}

        {/* ── By Entity view ───────────────────────────────────────── */}
        {compStats && breakdownFields.length > 0 && viewMode === 'entity' && (
          <div>
            {visibleEntityStats.map(function(es) {
              const pal = CATEGORY_COLOR[es.category] || CATEGORY_COLOR.other
              const sortedGroups = es.perGroup.slice().sort(function(a, b) { return b.count - a.count })
              const maxShare = sortedGroups.reduce(function(m, g) { return Math.max(m, g.mentionRate) }, 1) || 1
              return (
                <div key={es.entitySlug} style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 10, padding: '16px 18px', marginBottom: 12, borderLeft: '4px solid ' + pal.border }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: T.text, flex: 1 }}>
                      {es.entityName}
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 10, background: pal.bg, color: pal.text, border: '1px solid ' + pal.border + '40', marginLeft: 8 }}>{es.category}</span>
                      <span style={{ fontSize: 12, fontWeight: 400, color: T.textMute, marginLeft: 6 }}>
                        ({compStats!.totalRows > 0 ? Math.round(es.totalMatches / compStats!.totalRows * 100) : 0}% of dataset · {es.totalMatches.toLocaleString()} mentions in shown groups)
                      </span>
                    </span>
                    {onDrillEntity && (
                      <button
                        onClick={function() {
                          const ent = entities.find(function(e) { return e.slug === es.entitySlug })
                          if (ent) onDrillEntity(ent)
                        }}
                        style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: pal.bg, color: pal.text, border: '1px solid ' + pal.border + '50', cursor: 'pointer', flexShrink: 0 }}>
                        View comments →
                      </button>
                    )}
                  </div>
                  {sortedGroups.map(function(g) {
                    const sig = sigTest(g.count, g.groupTotal, es.totalMatches, compStats!.totalRows)
                    const sigColor = sig && sig.dir === 'over' ? '#16a34a' : sig && sig.dir === 'under' ? '#dc2626' : null
                    const ra = ratingField ? g.avgRating : null
                    const delta = ra != null ? ra - compStats!.overallRatAvg : 0
                    return (
                      <div key={g.group}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, cursor: onDrillEntity ? 'pointer' : 'default' }}
                        onClick={onDrillEntity ? function() {
                          const ent = entities.find(function(e) { return e.slug === es.entitySlug })
                          if (ent) onDrillEntity(ent, g.group)
                        } : undefined}>
                        <span style={{ fontSize: 11, color: T.amber, width: 150, overflow: 'hidden' as const, textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const, flexShrink: 0 }} title={g.group}>{g.group}</span>
                        <div style={{ flex: 1, height: 10, background: T.bg, borderRadius: 5, overflow: 'hidden' as const }}>
                          <div style={{ height: '100%', width: Math.max(maxShare > 0 ? g.mentionRate / maxShare * 100 : 0, g.mentionRate > 0 ? 2 : 0) + '%', background: pal.border, borderRadius: 5, transition: 'width .5s' }} />
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 800, color: sigColor || 'transparent', flexShrink: 0, width: 14, textAlign: 'center' as const }}
                          title={sig && sigColor ? (sig.dir === 'over' ? '"' + g.group + '" mentions "' + es.entityName + '" at ' + Math.round(sig.p1 * 100) + '%, significantly higher than the ' + Math.round(sig.p2 * 100) + '% baseline (z=' + sig.z.toFixed(1) + ').' : '"' + g.group + '" mentions "' + es.entityName + '" at ' + Math.round(sig.p1 * 100) + '%, significantly lower than the ' + Math.round(sig.p2 * 100) + '% baseline (z=' + sig.z.toFixed(1) + ').') : ''}>
                          {sigColor ? '★' : ''}
                        </span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: T.text, width: 40, textAlign: 'right' as const, flexShrink: 0 }}>{g.mentionRate}%</span>
                        <span style={{ fontSize: 10, color: T.textFaint, width: 52, textAlign: 'right' as const, flexShrink: 0 }}>n={g.count}</span>
                        {ra != null && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: Math.abs(delta) > 0.1 ? (delta > 0 ? '#059669' : '#dc2626') : T.textMid, width: 38, textAlign: 'right' as const, flexShrink: 0 }}
                            title={'Avg ' + ra.toFixed(2) + ' (' + (delta >= 0 ? '+' : '') + delta.toFixed(2) + ' vs overall)'}>
                            {ra.toFixed(1)}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Summary modal ────────────────────────────────────────────── */}
      {showSummary && (
        <div style={{ position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={function() { setShowSummary(false) }}>
          <div style={{ background: T.bgCard, borderRadius: 14, boxShadow: '0 8px 40px rgba(0,0,0,.22)', width: '100%', maxWidth: 620, maxHeight: '80vh', display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' as const }}
            onClick={function(e) { e.stopPropagation() }}>
            <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid ' + T.border, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 800, color: T.text, margin: 0 }}>Entity Segment Findings</h3>
                <div style={{ fontSize: 11, color: T.textFaint, marginTop: 3 }}>{outliers.length} significant outliers · p &lt; 0.05</div>
              </div>
              <button onClick={function() { setShowSummary(false) }} style={{ fontSize: 16, padding: '4px 10px', background: 'transparent', border: 'none', color: T.textMute, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ flex: 1, padding: '14px 22px', overflowY: 'auto' as const, fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 11, color: T.text, whiteSpace: 'pre-wrap' as const, lineHeight: 1.5 }}>
              {summaryText}
            </div>
            <div style={{ padding: '12px 22px', borderTop: '1px solid ' + T.border, display: 'flex', justifyContent: 'flex-end' as const, gap: 8 }}>
              <button
                onClick={function() {
                  navigator.clipboard.writeText(summaryText)
                  setCopied(true)
                  setTimeout(function() { setCopied(false) }, 1600)
                }}
                style={{ fontSize: 11, fontWeight: 600, padding: '5px 14px', borderRadius: 6, background: copied ? '#16a34a' : T.accent, color: T.bgCard, border: 'none', cursor: 'pointer' }}>
                {copied ? '✓ Copied' : 'Copy summary'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
