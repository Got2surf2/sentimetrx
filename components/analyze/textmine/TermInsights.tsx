'use client'

// components/analyze/textmine/TermInsights.tsx
//
// Insights view shown inside the word/theme modal. Lists auto-detected
// categorical fields, with the most/least-frequent value flagged for each.
// Each field row is expandable to a per-value table with outlier scores,
// matching the legacy Ana drill-down.
//
// Force-analyze: high-cardinality fields (> MAX_CARDINALITY distinct
// values) are skipped by default to keep the screen scannable. Operators
// can opt in per-field (chip click) or globally (top toggle); forced
// fields run through the same fieldInsights() math, just bypassing the
// cardinality gate. Top 100 rows shown by default with "Show all" toggle.
// Copy-as-TSV and Download-as-CSV on every per-value table.

import { useMemo, useState } from 'react'
import { computeAllInsightsDetailed, fieldInsights, type FieldInsights, type ValueRow } from '@/lib/termInsights'

// Pretty display name for a field key. Special-cases the synthetic columns
// added by the rows API (e.g. `_collection_label` is the per-member brand
// name added when unioning a collection).
function displayFieldName(field: string): string {
  if (field === '_collection_label') return 'Collection'
  return field
}

export interface InsightFilter {
  field: string
  value: string
  /** "more frequent" / "less frequent" — for chip styling */
  direction: 'more' | 'less'
}

interface Props {
  rows: Record<string, unknown>[]
  textFields: string[]
  targets: string[]
  termLabel: string
  /** When provided, clicking a value row drills into filtered comments. */
  onDrillDown?: (filter: InsightFilter) => void
}

const HERMES = '#E8632A'

function pct(v: number): string {
  return (v * 100).toFixed(1) + '%'
}

// Default cap on visible rows in the per-value table. High-cardinality
// fields (e.g. 500-store chain) can have hundreds of rows; showing all
// inline is unscannable. The Copy / Download buttons always export
// every row regardless of this cap.
const DEFAULT_ROW_CAP = 100

function rowsToDelimited(field: string, ins: FieldInsights, delim: string): string {
  const header = ['value', 'matching', 'total', 'frequency', 'overall_frequency', 'zscore', 'direction'].join(delim)
  const sorted = [...ins.values].sort((a, b) => Math.abs(b.zscore) - Math.abs(a.zscore))
  const escape = (s: string) => {
    if (delim === ',' && /[,"\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
    if (delim === '\t' && /[\t\n]/.test(s)) return s.replace(/\t/g, ' ').replace(/\n/g, ' ')
    return s
  }
  const lines = sorted.map((v) => {
    const direction = v.zscore >= 2 ? 'more' : v.zscore <= -2 ? 'less' : 'neutral'
    return [
      escape(v.value),
      String(v.matching),
      String(v.total),
      v.frequency.toFixed(4),
      ins.overallFrequency.toFixed(4),
      v.zscore.toFixed(3),
      direction,
    ].join(delim)
  })
  return [header, ...lines].join('\n')
}

function ValueTable({ field, ins, onPick }: { field: string; ins: FieldInsights; onPick?: (v: ValueRow) => void }) {
  // Sort by |z| descending so outliers float to the top
  const rows = useMemo(() => {
    return [...ins.values].sort((a, b) => Math.abs(b.zscore) - Math.abs(a.zscore))
  }, [ins])
  const [showAll, setShowAll] = useState(false)
  const [copyHint, setCopyHint] = useState<string | null>(null)
  const visible = showAll ? rows : rows.slice(0, DEFAULT_ROW_CAP)
  const truncated = rows.length > DEFAULT_ROW_CAP

  const copyTSV = async () => {
    try {
      await navigator.clipboard.writeText(rowsToDelimited(field, ins, '\t'))
      setCopyHint('Copied — paste into Sheets/Excel')
    } catch {
      setCopyHint('Copy failed — try the Download button')
    }
    setTimeout(() => setCopyHint(null), 2500)
  }

  const downloadCSV = () => {
    const csv = rowsToDelimited(field, ins, ',')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = displayFieldName(field).replace(/[^a-z0-9._-]+/gi, '_') + '_outliers.csv'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ marginTop: 8, background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
      {/* Toolbar: copy + download + (when truncated) "Show all" */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 10px', background: '#fafafa', borderBottom: '1px solid #f3f4f6' }}>
        <div style={{ fontSize: 11, color: '#6b7280' }}>
          {truncated && !showAll
            ? <>Showing top {DEFAULT_ROW_CAP} of {rows.length} values (sorted by |z|)</>
            : <>{rows.length} value{rows.length === 1 ? '' : 's'} (sorted by |z|)</>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {copyHint && <span style={{ fontSize: 10, color: '#059669', fontWeight: 600 }}>{copyHint}</span>}
          <button onClick={copyTSV}
            style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '1px solid #d1d5db', background: 'white', color: '#374151', cursor: 'pointer', fontWeight: 600 }}>
            Copy (TSV)
          </button>
          <button onClick={downloadCSV}
            style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '1px solid #d1d5db', background: 'white', color: '#374151', cursor: 'pointer', fontWeight: 600 }}>
            Download CSV
          </button>
          {truncated && (
            <button onClick={() => setShowAll(s => !s)}
              style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '1px solid #d1d5db', background: 'white', color: '#374151', cursor: 'pointer', fontWeight: 600 }}>
              {showAll ? 'Show top ' + DEFAULT_ROW_CAP : 'Show all (' + rows.length + ')'}
            </button>
          )}
        </div>
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 0.8fr 1fr 0.8fr',
        gap: 8, padding: '8px 12px',
        fontSize: 10, fontWeight: 700, color: '#9ca3af',
        textTransform: 'uppercase' as const, letterSpacing: '.06em',
        borderBottom: '1px solid #f3f4f6',
      }}>
        <div>{displayFieldName(field)} <span style={{ fontWeight: 400, color: '#d1d5db', textTransform: 'none' as const, letterSpacing: 0 }}>· {ins.uniqueValues} values</span></div>
        <div style={{ textAlign: 'right' as const }}>Matching</div>
        <div style={{ textAlign: 'right' as const }}>Total</div>
        <div style={{ textAlign: 'right' as const }}>Frequency <span style={{ fontWeight: 400, color: '#d1d5db', textTransform: 'none' as const, letterSpacing: 0 }}>({pct(ins.overallFrequency)} overall)</span></div>
        <div style={{ textAlign: 'right' as const }}>↓ Outlier z</div>
      </div>
      {visible.map((v: ValueRow, i: number) => {
        // Direction-only coloring: blue for "higher than expected", slate
        // for "lower than expected". Neutral hues — outlier direction has
        // no inherent good-or-bad meaning, so red/green would be misleading.
        const sig = Math.abs(v.zscore) >= 2
        const higher = v.zscore > 0
        const arrow = !sig ? '' : higher ? '▲ ' : '▼ '
        const accent = !sig ? '#6b7280' : higher ? '#1d4ed8' : '#475569'
        const clickable = !!onPick && v.matching > 0
        return (
          <div key={v.value + ':' + i}
            onClick={clickable ? () => onPick!(v) : undefined}
            title={clickable ? 'Click to see comments matching ' + field + '=' + v.value : undefined}
            style={{
              display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 0.8fr 1fr 0.8fr',
              gap: 8, padding: '7px 12px',
              fontSize: 12, color: '#374151',
              borderBottom: i < visible.length - 1 ? '1px solid #f9fafb' : 'none',
              cursor: clickable ? 'pointer' : 'default',
            }}>
            <div style={{ fontWeight: 600, color: accent, textDecoration: clickable ? 'underline' : 'none', textDecorationStyle: 'dotted' as const, textDecorationColor: accent + '80' }}>
              <span style={{ fontSize: 11, marginRight: 2 }}>{arrow}</span>{v.value}
            </div>
            <div style={{ textAlign: 'right' as const, fontWeight: 600 }}>{v.matching.toLocaleString()}</div>
            <div style={{ textAlign: 'right' as const, color: '#9ca3af' }}>{v.total.toLocaleString()}</div>
            <div style={{ textAlign: 'right' as const, fontWeight: 600 }}>{pct(v.frequency)}</div>
            <div style={{ textAlign: 'right' as const, fontWeight: 700, color: accent }}>{v.zscore.toFixed(2)}</div>
          </div>
        )
      })}
    </div>
  )
}

export default function TermInsights({ rows, textFields, targets, termLabel, onDrillDown }: Props) {
  const { insights, detection } = useMemo(
    () => computeAllInsightsDetailed(rows, textFields, targets),
    [rows, textFields, targets],
  )
  const [expandedField, setExpandedField] = useState<string | null>(null)
  const [showSkipped, setShowSkipped] = useState(false)
  // Per-field opt-in to force-analyze high-cardinality skipped fields.
  // Set 'ALL' as the master flag (top-of-panel toggle). Otherwise a per-
  // field set tracks individual opt-ins. Computed insights for forced
  // fields are merged into the main `insights` list and rendered with
  // a small "(forced)" badge so the operator knows they bypassed the cap.
  const [forcedFields, setForcedFields] = useState<Set<string>>(new Set())
  const [forceAll, setForceAll] = useState(false)

  const skippedHighCard = detection.skipped.filter(s => s.reason === 'too-many-values')

  // Compute insights for every field the operator explicitly forced, OR
  // every high-card field if forceAll is on. Same math as the auto path;
  // we just bypass the cardinality gate in detection.
  const forcedInsights = useMemo<FieldInsights[]>(() => {
    const targetsToForce = forceAll
      ? skippedHighCard.map(s => s.field)
      : skippedHighCard.map(s => s.field).filter(f => forcedFields.has(f))
    if (targetsToForce.length === 0) return []
    const out: FieldInsights[] = []
    for (const field of targetsToForce) {
      const ins = fieldInsights(rows, textFields, targets, field)
      if (ins) out.push(ins)
    }
    out.sort((a, b) => {
      const aMax = Math.max(Math.abs(a.moreFrequent[0]?.zscore || 0), Math.abs(a.lessFrequent[0]?.zscore || 0))
      const bMax = Math.max(Math.abs(b.moreFrequent[0]?.zscore || 0), Math.abs(b.lessFrequent[0]?.zscore || 0))
      return bMax - aMax
    })
    return out
  }, [rows, textFields, targets, forcedFields, forceAll, skippedHighCard])

  const forcedFieldSet = useMemo(() => new Set(forcedInsights.map(i => i.field)), [forcedInsights])
  const allInsights = useMemo(() => [...insights, ...forcedInsights], [insights, forcedInsights])

  const toggleForceField = (field: string) => {
    setForcedFields(prev => {
      const next = new Set(prev)
      if (next.has(field)) next.delete(field); else next.add(field)
      return next
    })
  }

  const handlePick = (field: string, v: ValueRow) => {
    if (!onDrillDown) return
    const direction: 'more' | 'less' = v.zscore >= 0 ? 'more' : 'less'
    onDrillDown({ field, value: v.value, direction })
  }

  const withOutliers = allInsights.filter(i => i.moreFrequent.length > 0 || i.lessFrequent.length > 0).length

  if (allInsights.length === 0 && skippedHighCard.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '20px 0', color: '#9ca3af' }}>
        <p style={{ fontSize: 13 }}>No metadata fields available for outlier analysis.</p>
        <p style={{ fontSize: 11, color: '#d1d5db', marginTop: 4 }}>
          Insights look at categorical fields with at most 20 distinct values. None of this dataset&apos;s columns qualify.
        </p>
      </div>
    )
  }

  return (
    <div>
      <p style={{ fontSize: 11, color: '#9ca3af', marginBottom: 12 }}>
        Where &ldquo;<span style={{ color: HERMES, fontWeight: 700 }}>{termLabel}</span>&rdquo; appears
        <em style={{ color: '#1d4ed8', fontStyle: 'normal' }}> ▲ more</em>{' '}
        and <em style={{ color: '#475569', fontStyle: 'normal' }}>▼ less</em> than expected,
        across {allInsights.length} categorical field{allInsights.length === 1 ? '' : 's'}
        {withOutliers < allInsights.length && (
          <> ({withOutliers} with significant outliers)</>
        )}.
        Click a field to see the per-value table{onDrillDown ? ' — click any value to drill into the matching comments.' : ' with outlier scores.'}
      </p>
      {skippedHighCard.length > 0 && (
        <div style={{ marginBottom: 10, padding: '8px 10px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 11, color: '#92400e' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => setShowSkipped(s => !s)}
              style={{ background: 'none', border: 'none', padding: 0, color: '#92400e', cursor: 'pointer', fontWeight: 600, textDecoration: 'underline' }}>
              {showSkipped ? '▾' : '▸'} {skippedHighCard.length} field{skippedHighCard.length === 1 ? '' : 's'} skipped — too many distinct values
            </button>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#92400e', cursor: 'pointer' }}>
              <input type="checkbox" checked={forceAll} onChange={(e) => setForceAll(e.target.checked)} />
              Analyze all high-cardinality fields
            </label>
          </div>
          {showSkipped && (
            <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {skippedHighCard.map(s => {
                const isForced = forceAll || forcedFields.has(s.field)
                return (
                  <button
                    key={s.field}
                    onClick={() => { if (!forceAll) toggleForceField(s.field) }}
                    disabled={forceAll}
                    title={forceAll ? 'Forced by "Analyze all" toggle' : (isForced ? 'Click to stop analyzing this field' : 'Click to analyze this field anyway')}
                    style={{
                      fontSize: 10, padding: '2px 6px', borderRadius: 8,
                      background: isForced ? '#1d4ed8' : '#fef3c7',
                      color: isForced ? 'white' : '#92400e',
                      border: '1px solid ' + (isForced ? '#1d4ed8' : '#fde68a'),
                      cursor: forceAll ? 'default' : 'pointer',
                      fontFamily: 'inherit',
                    }}>
                    {isForced && '✓ '}{s.field} <span style={{ opacity: 0.7 }}>{s.uniqueValues} values</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
      <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
        {allInsights.map(ins => {
          const expanded = expandedField === ins.field
          // Layout matches legacy Ana: field name on left, More/Less columns
          // centered with the value on a second line. Fields without outliers
          // show only the field name (centred columns blank). Click to expand.
          return (
            <div key={ins.field}
              style={{ borderTop: '1px solid #f3f4f6' }}>
              <button
                onClick={() => setExpandedField(expanded ? null : ins.field)}
                style={{
                  width: '100%', textAlign: 'left' as const, padding: '12px 14px',
                  display: 'grid', gridTemplateColumns: '1fr 1.6fr 1.6fr',
                  gap: 12, alignItems: 'center',
                  background: expanded ? '#f9fafb' : 'transparent',
                  border: 'none', cursor: 'pointer',
                  fontFamily: 'inherit',
                }}>
                <span style={{ fontSize: 14, fontWeight: 500, color: '#374151' }}>
                  {displayFieldName(ins.field)}
                  {forcedFieldSet.has(ins.field) && (
                    <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: '#1d4ed8', background: '#dbeafe', padding: '1px 6px', borderRadius: 8, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                      Forced · {ins.uniqueValues} values
                    </span>
                  )}
                </span>
                <div style={{ textAlign: 'center' as const }}>
                  {ins.moreFrequent.length > 0 && (
                    <>
                      <div style={{ fontSize: 10, color: '#9ca3af' }}>▲ More frequent in:</div>
                      <div style={{ fontSize: 14, fontWeight: 500, color: '#1d4ed8', marginTop: 2 }}>
                        {ins.moreFrequent.slice(0, 3).map(v => v.value).join(', ')}
                        {ins.moreFrequent.length > 3 && <span style={{ color: '#9ca3af', fontSize: 11 }}> +{ins.moreFrequent.length - 3} more</span>}
                      </div>
                    </>
                  )}
                </div>
                <div style={{ textAlign: 'center' as const }}>
                  {ins.lessFrequent.length > 0 && (
                    <>
                      <div style={{ fontSize: 10, color: '#9ca3af' }}>▼ Less frequent in:</div>
                      <div style={{ fontSize: 14, fontWeight: 500, color: '#475569', marginTop: 2 }}>
                        {ins.lessFrequent.slice(0, 3).map(v => v.value).join(', ')}
                        {ins.lessFrequent.length > 3 && <span style={{ color: '#9ca3af', fontSize: 11 }}> +{ins.lessFrequent.length - 3} more</span>}
                      </div>
                    </>
                  )}
                </div>
              </button>
              {expanded && (
                <div style={{ padding: '0 14px 14px', background: '#f9fafb' }}>
                  <ValueTable field={ins.field} ins={ins} onPick={onDrillDown ? (v) => handlePick(ins.field, v) : undefined} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
