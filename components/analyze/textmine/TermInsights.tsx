'use client'

// components/analyze/textmine/TermInsights.tsx
//
// Insights view shown inside the word/theme modal. Lists auto-detected
// categorical fields, with the most/least-frequent value flagged for each.
// Each field row is expandable to a per-value table with outlier scores,
// matching the legacy Ana drill-down.

import { useMemo, useState } from 'react'
import { computeAllInsightsDetailed, type FieldInsights, type ValueRow } from '@/lib/termInsights'

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

function ValueTable({ field, ins, onPick }: { field: string; ins: FieldInsights; onPick?: (v: ValueRow) => void }) {
  // Sort by |z| descending so outliers float to the top
  const rows = useMemo(() => {
    return [...ins.values].sort((a, b) => Math.abs(b.zscore) - Math.abs(a.zscore))
  }, [ins])
  return (
    <div style={{ marginTop: 8, background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
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
      {rows.map((v: ValueRow, i: number) => {
        const pos = v.zscore >= 2 ? '#059669' : v.zscore <= -2 ? '#dc2626' : '#6b7280'
        const clickable = !!onPick && v.matching > 0
        return (
          <div key={v.value + ':' + i}
            onClick={clickable ? () => onPick!(v) : undefined}
            title={clickable ? 'Click to see comments matching ' + field + '=' + v.value : undefined}
            style={{
              display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 0.8fr 1fr 0.8fr',
              gap: 8, padding: '7px 12px',
              fontSize: 12, color: '#374151',
              borderBottom: i < rows.length - 1 ? '1px solid #f9fafb' : 'none',
              background: Math.abs(v.zscore) >= 2 ? (v.zscore > 0 ? '#ecfdf520' : '#fef2f220') : 'transparent',
              cursor: clickable ? 'pointer' : 'default',
            }}>
            <div style={{ fontWeight: 600, color: pos, textDecoration: clickable ? 'underline' : 'none', textDecorationStyle: 'dotted' as const, textDecorationColor: pos + '80' }}>
              {clickable && '▾ '}{v.value}
            </div>
            <div style={{ textAlign: 'right' as const, fontWeight: 600 }}>{v.matching.toLocaleString()}</div>
            <div style={{ textAlign: 'right' as const, color: '#9ca3af' }}>{v.total.toLocaleString()}</div>
            <div style={{ textAlign: 'right' as const, fontWeight: 600 }}>{pct(v.frequency)}</div>
            <div style={{ textAlign: 'right' as const, fontWeight: 700, color: pos }}>{v.zscore.toFixed(2)}</div>
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

  const handlePick = (field: string, v: ValueRow) => {
    if (!onDrillDown) return
    const direction: 'more' | 'less' = v.zscore >= 0 ? 'more' : 'less'
    onDrillDown({ field, value: v.value, direction })
  }

  const withOutliers = insights.filter(i => i.moreFrequent || i.lessFrequent).length
  const skippedHighCard = detection.skipped.filter(s => s.reason === 'too-many-values')

  if (insights.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '20px 0', color: '#9ca3af' }}>
        <p style={{ fontSize: 13 }}>No metadata fields available for outlier analysis.</p>
        <p style={{ fontSize: 11, color: '#d1d5db', marginTop: 4 }}>
          Insights look at categorical fields with at most 20 distinct values. None of this dataset&apos;s columns qualify.
          {skippedHighCard.length > 0 && (
            <> {skippedHighCard.length} field(s) had too many distinct values: {skippedHighCard.slice(0, 5).map(s => s.field + ' (' + s.uniqueValues + ')').join(', ')}{skippedHighCard.length > 5 ? '…' : ''}</>
          )}
        </p>
      </div>
    )
  }

  return (
    <div>
      <p style={{ fontSize: 11, color: '#9ca3af', marginBottom: 12 }}>
        Where &ldquo;<span style={{ color: HERMES, fontWeight: 700 }}>{termLabel}</span>&rdquo; appears
        <em style={{ color: '#059669', fontStyle: 'normal' }}> more</em>{' '}
        and <em style={{ color: '#dc2626', fontStyle: 'normal' }}>less</em> than expected,
        across {insights.length} categorical field{insights.length === 1 ? '' : 's'}
        {withOutliers < insights.length && (
          <> ({withOutliers} with significant outliers)</>
        )}.
        Click a field to see the per-value table{onDrillDown ? ' — click any value to drill into the matching comments.' : ' with outlier scores.'}
      </p>
      {skippedHighCard.length > 0 && (
        <div style={{ marginBottom: 10, padding: '8px 10px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 11, color: '#92400e' }}>
          <button onClick={() => setShowSkipped(s => !s)}
            style={{ background: 'none', border: 'none', padding: 0, color: '#92400e', cursor: 'pointer', fontWeight: 600, textDecoration: 'underline' }}>
            {showSkipped ? '▾' : '▸'} {skippedHighCard.length} field{skippedHighCard.length === 1 ? '' : 's'} skipped — too many distinct values
          </button>
          {showSkipped && (
            <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {skippedHighCard.map(s => (
                <span key={s.field} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 8, background: '#fef3c7', color: '#92400e' }}>
                  {s.field} <span style={{ opacity: 0.6 }}>{s.uniqueValues} values</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {insights.map(ins => {
          const expanded = expandedField === ins.field
          return (
            <div key={ins.field}
              style={{ background: '#f9fafb', borderRadius: 10, border: '1px solid ' + (expanded ? '#d1d5db' : '#e5e7eb'), overflow: 'hidden' }}>
              <button
                onClick={() => setExpandedField(expanded ? null : ins.field)}
                style={{
                  width: '100%', textAlign: 'left' as const, padding: '10px 14px',
                  display: 'grid', gridTemplateColumns: '1fr 1.4fr 1.4fr auto',
                  gap: 12, alignItems: 'center',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  fontFamily: 'inherit',
                }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{displayFieldName(ins.field)}</span>
                <span style={{ fontSize: 11 }}>
                  {ins.moreFrequent ? (
                    <>
                      <span style={{ color: '#9ca3af' }}>More frequent in: </span>
                      <span style={{ color: '#059669', fontWeight: 700 }}>
                        {ins.moreFrequent.value} ({pct(ins.moreFrequent.frequency)})
                      </span>
                    </>
                  ) : (
                    <span style={{ color: '#d1d5db' }}>—</span>
                  )}
                </span>
                <span style={{ fontSize: 11 }}>
                  {ins.lessFrequent ? (
                    <>
                      <span style={{ color: '#9ca3af' }}>Less frequent in: </span>
                      <span style={{ color: '#dc2626', fontWeight: 700 }}>
                        {ins.lessFrequent.value} ({pct(ins.lessFrequent.frequency)})
                      </span>
                    </>
                  ) : (
                    <span style={{ color: '#d1d5db' }}>—</span>
                  )}
                </span>
                <span style={{ fontSize: 11, color: '#9ca3af' }}>{expanded ? '▾' : '▸'}</span>
              </button>
              {expanded && (
                <div style={{ padding: '0 14px 14px' }}>
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
