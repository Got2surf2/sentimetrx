'use client'
// components/analyze/textmine/BreakdownDist.tsx
// Stacked bar chart showing theme prevalence across categorical breakdown groups.
// Two views: By Group (themes within each group) and By Theme (groups within each theme).

import { useState, useMemo } from 'react'
import { Theme, THEME_PALETTE, commentMatchesTheme } from '@/lib/themeUtils'
import { sigTest } from '@/lib/statsUtils'

const T = {
  bg: '#f4f5f7', bgCard: '#ffffff', border: '#e5e7eb', borderMid: '#d1d5db',
  text: '#111827', textMid: '#374151', textMute: '#6b7280', textFaint: '#9ca3af',
  accent: '#e8622a', accentBg: '#fff4ef',
  amber: '#d97706', amberBg: '#fffbeb',
}

interface Props {
  themes: { themes: Theme[]; fieldName: string }
  parsedData: Record<string, unknown>[]
  activeField: string
  breakdownField: string | null
  selectedValues: Set<string>
  themeColors: Record<number, typeof THEME_PALETTE[0]>
  onDrillTheme: (t: Theme) => void
}

export default function BreakdownDist({
  themes: themeModel, parsedData, activeField, breakdownField, selectedValues, themeColors, onDrillTheme,
}: Props) {
  const [distView, setDistView] = useState<'group' | 'theme'>('group')
  const field = activeField || themeModel.fieldName

  const selVals = useMemo(function() {
    return Array.from(selectedValues).sort()
  }, [selectedValues])

  const sortedThemes = useMemo(function() {
    return [...themeModel.themes].sort(function(a, b) { return b.count - a.count })
  }, [themeModel.themes])

  // Per-group, per-theme counts
  const valueCounts = useMemo(function() {
    if (!breakdownField) return {}
    const vc: Record<string, Record<string, number>> = {}
    selVals.forEach(function(v) {
      vc[v] = {}
      const rows = parsedData.filter(function(r) { return String(r[breakdownField] ?? '') === v })
      sortedThemes.forEach(function(t) {
        vc[v][t.id] = rows.filter(function(r) {
          return commentMatchesTheme(String(r[field] || ''), t)
        }).length
      })
    })
    return vc
  }, [selVals, parsedData, breakdownField, sortedThemes, field])

  // Group totals (responses with text)
  const groupTotals = useMemo(function() {
    if (!breakdownField) return {}
    const gt: Record<string, number> = {}
    selVals.forEach(function(v) {
      gt[v] = parsedData.filter(function(r) {
        return String(r[breakdownField] ?? '') === v && String(r[field] || '').trim().length > 0
      }).length
    })
    return gt
  }, [selVals, parsedData, breakdownField, field])

  // Total matches per theme + total rows for sig testing
  var totalThemeMatches = useMemo(function() {
    var ttm: Record<string, number> = {}
    sortedThemes.forEach(function(t) {
      ttm[t.id] = selVals.reduce(function(s, v) { return s + (valueCounts[v] ? valueCounts[v][t.id] || 0 : 0) }, 0)
    })
    return ttm
  }, [sortedThemes, selVals, valueCounts])

  var totalAllRows = useMemo(function() {
    return selVals.reduce(function(s, v) { return s + (groupTotals[v] || 0) }, 0)
  }, [selVals, groupTotals])

  if (!breakdownField || !selVals.length) return null

  return (
    <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 12, padding: '18px 20px', marginTop: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: T.textMid }}>
          Breakdown by {breakdownField}
        </span>
        <div style={{ display: 'inline-flex', background: T.bg, borderRadius: 8, padding: 2, border: '1px solid ' + T.border }}>
          {(['group', 'theme'] as const).map(function(mode) {
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
                {mode === 'group' ? 'By Group' : 'By Theme'}
              </button>
            )
          })}
        </div>
      </div>

      {/* By Group view */}
      {distView === 'group' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {selVals.map(function(v) {
            const groupTotal = groupTotals[v] || 0
            return (
              <div key={v}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: T.amber, background: T.amberBg, padding: '2px 10px', borderRadius: 20, border: '1px solid ' + T.amber + '40' }}>
                    {v}
                  </span>
                  <span style={{ fontSize: 11, color: T.textFaint }}>n={groupTotal}</span>
                </div>
                {/* Stacked bar */}
                <div style={{ height: 24, background: T.bg, borderRadius: 6, overflow: 'hidden', display: 'flex', marginBottom: 6 }}>
                  {sortedThemes.map(function(t) {
                    const idx = themeModel.themes.indexOf(t)
                    const pal = themeColors[idx] || THEME_PALETTE[0]
                    const cnt = valueCounts[v] ? valueCounts[v][t.id] || 0 : 0
                    const pct = groupTotal > 0 ? (cnt / groupTotal) * 100 : 0
                    if (pct <= 0) return null
                    return (
                      <div
                        key={t.id}
                        title={t.name + ': ' + cnt + ' (' + Math.round(pct) + '%)'}
                        style={{ width: pct + '%', background: pal.border, transition: 'width .5s' }}
                      />
                    )
                  })}
                </div>
                {/* Per-theme rows */}
                {sortedThemes.map(function(t) {
                  const idx = themeModel.themes.indexOf(t)
                  const pal = themeColors[idx] || THEME_PALETTE[0]
                  const cnt = valueCounts[v] ? valueCounts[v][t.id] || 0 : 0
                  const pct = groupTotal > 0 ? Math.round((cnt / groupTotal) * 100) : 0
                  if (cnt === 0) return null
                  var sig = sigTest(cnt, groupTotal, totalThemeMatches[t.id] || 0, totalAllRows)
                  var sigColor = sig && sig.dir === 'over' ? '#16a34a' : sig && sig.dir === 'under' ? '#dc2626' : null
                  return (
                    <div
                      key={t.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, cursor: 'pointer' }}
                      onClick={function() { onDrillTheme(t) }}
                    >
                      <div style={{ width: 10, height: 10, borderRadius: 3, background: pal.border, flexShrink: 0 }} />
                      <span style={{ fontSize: 11, color: T.textMid, flex: 1 }}>{t.name}</span>
                      <div style={{ width: 80, height: 7, background: T.bg, borderRadius: 4, overflow: 'hidden', flexShrink: 0 }}>
                        <div style={{ height: '100%', width: pct + '%', background: pal.border, borderRadius: 4 }} />
                      </div>
                      {sigColor && <span style={{ fontSize: 11, fontWeight: 800, color: sigColor, flexShrink: 0 }} title={sig!.dir === 'over' ? 'Significantly over-represented (z=' + sig!.z.toFixed(1) + ')' : 'Significantly under-represented (z=' + sig!.z.toFixed(1) + ')'}>★</span>}
                      <span style={{ fontSize: 11, fontWeight: 700, color: T.text, width: 36, textAlign: 'right', flexShrink: 0 }}>
                        {pct}%
                      </span>
                      <span style={{ fontSize: 10, color: T.textFaint, width: 28, textAlign: 'right', flexShrink: 0 }}>
                        {cnt}
                      </span>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      {/* By Theme view */}
      {distView === 'theme' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {sortedThemes.map(function(t) {
            const idx = themeModel.themes.indexOf(t)
            const pal = themeColors[idx] || THEME_PALETTE[0]
            const maxCnt = Math.max(...selVals.map(function(v) {
              return valueCounts[v] ? valueCounts[v][t.id] || 0 : 0
            }), 1)
            return (
              <div key={t.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 3, background: pal.border, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: pal.text }}>{t.name}</span>
                  <button
                    onClick={function() { onDrillTheme(t) }}
                    style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: pal.bg, color: pal.text, border: '1px solid ' + pal.border + '50', cursor: 'pointer', marginLeft: 'auto' }}
                  >
                    View comments &rarr;
                  </button>
                </div>
                {selVals.map(function(v) {
                  const cnt = valueCounts[v] ? valueCounts[v][t.id] || 0 : 0
                  const groupTotal = groupTotals[v] || 0
                  const pct = groupTotal > 0 ? Math.round((cnt / groupTotal) * 100) : 0
                  const barPct = maxCnt > 0 ? (cnt / maxCnt) * 100 : 0
                  var sig = sigTest(cnt, groupTotal, totalThemeMatches[t.id] || 0, totalAllRows)
                  var sigColor = sig && sig.dir === 'over' ? '#16a34a' : sig && sig.dir === 'under' ? '#dc2626' : null
                  return (
                    <div key={v} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: T.amber, width: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>{v}</span>
                      <div style={{ flex: 1, height: 7, background: T.bg, borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: barPct + '%', background: pal.border, borderRadius: 4, transition: 'width .5s' }} />
                      </div>
                      {sigColor && <span style={{ fontSize: 11, fontWeight: 800, color: sigColor, flexShrink: 0 }} title={sig!.dir === 'over' ? 'Significantly over-represented (z=' + sig!.z.toFixed(1) + ')' : 'Significantly under-represented (z=' + sig!.z.toFixed(1) + ')'}>★</span>}
                      <span style={{ fontSize: 11, fontWeight: 700, color: T.text, width: 36, textAlign: 'right', flexShrink: 0 }}>{pct}%</span>
                      <span style={{ fontSize: 10, color: T.textFaint, width: 28, textAlign: 'right', flexShrink: 0 }}>{cnt}</span>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      {/* Legend */}
      <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid ' + T.border, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {sortedThemes.map(function(t) {
          const idx = themeModel.themes.indexOf(t)
          const pal = themeColors[idx] || THEME_PALETTE[0]
          return (
            <span key={t.id} style={{ fontSize: 10, padding: '2px 7px', background: pal.bg, color: pal.text, borderRadius: 10, border: '1px solid ' + pal.border + '50', fontWeight: 600 }}>
              {t.name}
            </span>
          )
        })}
      </div>
    </div>
  )
}
