'use client'

// Presentational menu for the unified Reports picker. Renders the catalog's
// available report types for a context, each with its format pills. All launch
// logic (focus pickers, blob downloads, opening HTML) stays with the caller via
// onLaunch — this component only decides WHAT to show, from lib/reportCatalog.

import { availableReports, type ReportContext, type ReportType, type ReportFormat } from '@/lib/reportCatalog'

const FORMAT_LABEL: Record<ReportFormat, string> = { pdf: 'PDF', pptx: 'PPT', html: 'HTML' }

export default function ReportsMenu({ ctx, busy = false, onLaunch }: {
  ctx: ReportContext
  busy?: boolean
  onLaunch: (type: ReportType, format: ReportFormat) => void
}) {
  const reports = availableReports(ctx)
  if (reports.length === 0) return null

  return (
    <div>
      {reports.map(r => r.configurable ? (
        // Configurable report (deck / ad-hoc) — picks its format inside its own
        // modal, so the menu shows one clickable row, no pills.
        <button
          key={r.id}
          disabled={busy}
          onClick={function() { onLaunch(r, r.formats[0]) }}
          title={r.description}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            width: '100%', textAlign: 'left', padding: '8px 14px', fontSize: 12, fontWeight: 600,
            color: '#0f766e', background: 'transparent', border: 'none',
            cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1, fontFamily: 'inherit',
          }}>
          <span style={{ whiteSpace: 'nowrap' }}>📊 {r.label}</span>
          <span style={{ color: '#9ca3af' }}>→</span>
        </button>
      ) : (
        // One-click report — choose the format right here via pills.
        <div key={r.id} style={{ padding: '7px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span title={r.description} style={{ fontSize: 12, fontWeight: 600, color: '#0f766e', whiteSpace: 'nowrap' }}>
              📊 {r.label}
            </span>
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              {r.formats.map(f => (
                <button
                  key={f}
                  disabled={busy}
                  onClick={function() { onLaunch(r, f) }}
                  title={`${r.label} — ${FORMAT_LABEL[f]}`}
                  style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                    border: '1px solid #d1fae5', background: '#ecfdf5', color: '#0f766e',
                    cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1, fontFamily: 'inherit',
                  }}>
                  {FORMAT_LABEL[f]}
                </button>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
