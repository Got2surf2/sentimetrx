'use client'

// components/admin/GovernanceTrend.tsx
// Renders the trend of weekly governance audit scores + the latest
// category breakdown. Hand-rolled SVG to stay consistent with the
// rest of the codebase (no chart-lib dependency).

import type { WeeklyReport } from '@/lib/governanceReports'

const HERMES   = '#E8632A'
const TEAL     = '#0F7173'
const PR_LIST  = 'https://github.com/Got2surf2/sentimetrx/pulls'

const CATEGORY_COLOR: Record<string, string> = {
  Secrets:         '#0F7173',
  Security:        '#dc2626',
  Dependencies:    '#d97706',
  Structure:       '#7c3aed',
  Tests:           '#2563eb',
  Documentation:   '#059669',
  Maintainability: '#0891b2',
}

interface Props {
  reports: WeeklyReport[]
}

export default function GovernanceTrend({ reports }: Props) {
  const latest = reports[reports.length - 1] || null
  const prior  = reports.length >= 2 ? reports[reports.length - 2] : null
  const delta  = latest?.total != null && prior?.total != null ? +(latest.total - prior.total).toFixed(1) : null

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>
      <div className="flex items-start justify-between gap-4 mb-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Governance & Continuous Improvement</h1>
          <p className="text-sm text-gray-500 mt-1">Weekly codebase health audits — we monitor and improve on a continuous basis.</p>
        </div>
        <a
          href={PR_LIST}
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 rounded-lg text-sm font-medium text-white hover:opacity-90 transition-all"
          style={{ background: HERMES }}>
          View audit PRs ↗
        </a>
      </div>

      {reports.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center text-gray-500">
          No weekly reports yet. The Monday governance routine will generate one each week.
        </div>
      ) : (
        <>
          {/* Latest score callout */}
          <div className="grid gap-3 mb-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <ScoreCard
              label="Latest score"
              value={latest?.total != null ? latest.total.toFixed(0) : '—'}
              suffix="/ 100"
              sub={latest ? latest.week + (latest.dateRange ? ' · ' + latest.dateRange : '') : ''}
              color={HERMES}
            />
            <ScoreCard
              label="Week-over-week"
              value={delta == null ? '—' : (delta >= 0 ? '+' : '') + delta.toString()}
              suffix={delta == null ? '' : 'pts'}
              sub={prior ? `vs ${prior.week} (${prior.total ?? '—'})` : 'first audit week'}
              color={delta == null ? '#6b7280' : delta >= 0 ? '#059669' : '#dc2626'}
            />
            <ScoreCard
              label="Reports recorded"
              value={reports.length.toString()}
              suffix=""
              sub="weekly audit + merged PR"
              color={TEAL}
            />
          </div>

          {/* Trend chart */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-gray-800">Score trend</h2>
              <span className="text-xs text-gray-400">Total weighted score · 0–100</span>
            </div>
            <TrendChart reports={reports} />
          </div>

          {/* Category breakdown for latest */}
          {latest && latest.categories.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-gray-800">Latest breakdown ({latest.week})</h2>
                <span className="text-xs text-gray-400">Per-category score · 0–10</span>
              </div>
              <CategoryBars latest={latest} prior={prior} />
            </div>
          )}

          {/* Report list */}
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-bold text-gray-800">Weekly reports</h2>
            </div>
            <div className="divide-y divide-gray-100">
              {[...reports].reverse().map(r => (
                <a
                  key={r.week}
                  href={PR_LIST}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-4 px-6 py-3 hover:bg-gray-50 transition-colors"
                  style={{ textDecoration: 'none' }}>
                  <div>
                    <div className="font-semibold text-gray-800">{r.week}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {r.dateRange || '—'}
                      {r.generatedAt && ' · generated ' + new Date(r.generatedAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span style={{ fontSize: 22, fontWeight: 700, color: HERMES }}>{r.total != null ? r.total.toFixed(0) : '—'}</span>
                    <span className="text-xs text-gray-400">/ 100</span>
                    <span className="text-xs text-gray-400 ml-2">View PR ↗</span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function ScoreCard({ label, value, suffix, sub, color }: { label: string; value: string; suffix: string; sub: string; color: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5">
      <div className="text-xs text-gray-500 font-medium">{label}</div>
      <div className="flex items-baseline gap-2 mt-2">
        <span style={{ fontSize: 32, fontWeight: 800, color, lineHeight: 1 }}>{value}</span>
        {suffix && <span className="text-sm text-gray-400">{suffix}</span>}
      </div>
      <div className="text-xs text-gray-500 mt-2">{sub}</div>
    </div>
  )
}

function TrendChart({ reports }: { reports: WeeklyReport[] }) {
  const W = 880
  const H = 240
  const padL = 36
  const padR = 16
  const padT = 16
  const padB = 36

  const data = reports.filter(r => r.total != null) as (WeeklyReport & { total: number })[]
  if (data.length === 0) return <p className="text-sm text-gray-500">No scoreable reports yet.</p>

  const xCount = Math.max(data.length, 2)  // avoid div-by-zero on first week
  const x = (i: number) => padL + (i * (W - padL - padR)) / (xCount - 1)
  const y = (score: number) => padT + (H - padT - padB) * (1 - score / 100)

  // Gridlines at 0, 25, 50, 75, 100
  const gridY = [0, 25, 50, 75, 100]

  // Line path
  const pathD = data.map((d, i) => (i === 0 ? 'M' : 'L') + x(i) + ' ' + y(d.total)).join(' ')

  // Area below the line (gradient fill)
  const areaD = pathD + ' L ' + x(data.length - 1) + ' ' + y(0) + ' L ' + x(0) + ' ' + y(0) + ' Z'

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 240 }}>
      <defs>
        <linearGradient id="govGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor={HERMES} stopOpacity="0.18" />
          <stop offset="100%" stopColor={HERMES} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Y gridlines + labels */}
      {gridY.map(g => (
        <g key={g}>
          <line x1={padL} y1={y(g)} x2={W - padR} y2={y(g)} stroke="#f3f4f6" strokeWidth={1} />
          <text x={padL - 6} y={y(g) + 4} textAnchor="end" fontSize={10} fill="#9ca3af">{g}</text>
        </g>
      ))}
      {/* Area + line */}
      {data.length >= 2 && <path d={areaD} fill="url(#govGrad)" />}
      <path d={pathD} fill="none" stroke={HERMES} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {/* Points + labels */}
      {data.map((d, i) => (
        <g key={d.week}>
          <circle cx={x(i)} cy={y(d.total)} r={4} fill={HERMES} stroke="white" strokeWidth={2} />
          <text x={x(i)} y={y(d.total) - 10} textAnchor="middle" fontSize={11} fontWeight={700} fill="#1f2937">{d.total.toFixed(0)}</text>
          <text x={x(i)} y={H - padB + 18} textAnchor="middle" fontSize={10} fill="#6b7280">{d.week}</text>
        </g>
      ))}
      {data.length === 1 && (
        <text x={W / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="#9ca3af">
          More data points appear each Monday after the governance routine runs.
        </text>
      )}
    </svg>
  )
}

function CategoryBars({ latest, prior }: { latest: WeeklyReport; prior: WeeklyReport | null }) {
  return (
    <div className="flex flex-col gap-3">
      {latest.categories.map(c => {
        const pct = (c.score / 10) * 100
        const priorScore = prior?.categories.find(p => p.category === c.category)?.score
        const delta = priorScore != null ? +(c.score - priorScore).toFixed(1) : null
        const color = CATEGORY_COLOR[c.category] || '#6b7280'
        return (
          <div key={c.category}>
            <div className="flex items-center justify-between text-sm mb-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-700">{c.category}</span>
                <span className="text-xs text-gray-400">weight {Math.round(c.weight * 100)}%</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-gray-800">{c.score}<span className="text-xs text-gray-400 ml-0.5">/10</span></span>
                {delta != null && (
                  <span className="text-xs font-semibold" style={{ color: delta > 0 ? '#059669' : delta < 0 ? '#dc2626' : '#9ca3af' }}>
                    {delta > 0 ? '+' : ''}{delta}
                  </span>
                )}
              </div>
            </div>
            <div style={{ height: 8, background: '#f3f4f6', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: pct + '%', background: color, borderRadius: 4, transition: 'width 0.3s' }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
