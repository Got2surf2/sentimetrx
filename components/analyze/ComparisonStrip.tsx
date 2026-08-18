'use client'
// components/analyze/ComparisonStrip.tsx
// When the active period has a comparison offset, shows the primary vs comparison
// record count and the delta — with to-date alignment (§4.1) and the §4.2 delta
// rules. Headline-level comparison; per-chart two-series rendering is deferred.
// Self-gates: renders null unless a period with `compare` is active.

import { useMemo } from 'react'
import { useFilters } from './FilterContext'
import { useRows } from './RowsContext'
import { applyFilters, resolvePeriod, resolveComparison, alignToDate, periodToDateFilter, comparisonDelta } from '@/lib/filterUtils'
import { T } from '@/lib/analyzeTheme'

const fmtTs = (ts: number) => { const d = new Date(ts); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }

export default function ComparisonStrip() {
  const { filters, lockedFilters, period } = useFilters()
  const { rows, rowsLoaded } = useRows()

  const data = useMemo(function() {
    if (!period || !period.compare || !period.field || !rowsLoaded || !rows.length) return null
    // eslint-disable-next-line react-hooks/purity -- re-resolving against a fresh `now` is the POINT here (a relative period like 'current quarter' must stay current); a frozen timestamp would be the bug
    const now = Date.now()
    const pRange = resolvePeriod(period.primary, { now })
    const cRange = resolveComparison(period.primary, period.compare.offset, { now })
    const aligned = alignToDate(pRange, cRange, now)
    const base = Object.assign({}, filters, lockedFilters)

    // Earliest value on the period field → distinguishes "no prior-period data"
    // (the comparison window predates the dataset) from a genuine zero. §4.2.
    let earliest = Infinity
    for (let i = 0; i < rows.length; i++) {
      const v = rows[i][period.field]
      if (v == null) continue
      const t = new Date(String(v)).getTime()
      if (!isNaN(t) && t < earliest) earliest = t
    }
    const priorExists = aligned.comparison[1] > earliest

    const pCount = applyFilters(rows, Object.assign({}, base, { [period.field]: periodToDateFilter(aligned.primary) })).length
    const cCount = applyFilters(rows, Object.assign({}, base, { [period.field]: periodToDateFilter(aligned.comparison) })).length
    return { pCount, cCount, delta: comparisonDelta(pCount, cCount, priorExists), aligned }
  }, [filters, lockedFilters, period, rows, rowsLoaded])

  if (!data) return null
  const deltaColor = data.delta.kind === 'pct' ? (data.delta.pct! >= 0 ? T.green : T.red) : T.textMute

  return (
    <div style={{ background: T.accentBg, borderBottom: '1px solid ' + T.accentMid, padding: '6px 20px', display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0, fontSize: 12 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: T.accent, textTransform: 'uppercase', letterSpacing: '.07em' }}>Compare</span>
      <span style={{ color: T.text }}>
        <b>{data.pCount.toLocaleString()}</b> <span style={{ color: T.textMute }}>this period ({fmtTs(data.aligned.primary[0])}–{fmtTs(data.aligned.primary[1] - 1)})</span>
      </span>
      <span style={{ color: T.textMute }}>vs</span>
      <span style={{ color: T.text }}>
        <b>{data.cCount.toLocaleString()}</b> <span style={{ color: T.textMute }}>prior ({fmtTs(data.aligned.comparison[0])}–{fmtTs(data.aligned.comparison[1] - 1)})</span>
      </span>
      <span style={{ fontWeight: 800, color: deltaColor }}>{data.delta.label}</span>
    </div>
  )
}
