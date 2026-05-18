'use client'

// components/admin/SpecDriftTrend.tsx
// Mirrors GovernanceTrend: weekly spec-drift snapshot + trend over time.
// "Healthier" direction is lower drift count.

import type { WeeklyDriftReport } from '@/lib/specDriftReports'

const HERMES   = '#E8632A'
const TEAL     = '#0F7173'
const RED      = '#dc2626'
const GREEN    = '#059669'
const PR_LIST  = 'https://github.com/Got2surf2/sentimetrx/pulls'

interface Props {
  reports: WeeklyDriftReport[]
}

export default function SpecDriftTrend({ reports }: Props) {
  const latest = reports[reports.length - 1] || null
  const prior  = reports.length >= 2 ? reports[reports.length - 2] : null
  const delta  = latest?.drifted != null && prior?.drifted != null ? latest.drifted - prior.drifted : null

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>
      <div className="flex items-start justify-between gap-4 mb-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Spec Drift</h1>
          <p className="text-sm text-gray-500 mt-1">Weekly check that documentation kept pace with code — module specs flagged when code paths changed without the spec being updated.</p>
        </div>
        <a
          href={PR_LIST}
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 rounded-lg text-sm font-medium text-white hover:opacity-90 transition-all"
          style={{ background: HERMES }}>
          View drift PRs ↗
        </a>
      </div>

      {reports.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center text-gray-500">
          No drift reports yet. The Monday spec-drift routine will write one each week.
        </div>
      ) : (
        <>
          {/* Latest snapshot */}
          <div className="grid gap-3 mb-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <ScoreCard
              label="Specs drifted"
              value={latest?.drifted != null ? latest.drifted.toString() : '—'}
              suffix={latest?.specsTracked != null ? `/ ${latest.specsTracked}` : ''}
              sub={latest ? latest.week + (latest.dateRange ? ' · ' + latest.dateRange : '') : ''}
              color={latest?.drifted != null && latest.drifted > 0 ? RED : GREEN}
            />
            <ScoreCard
              label="Week-over-week"
              value={delta == null ? '—' : (delta >= 0 ? '+' : '') + delta.toString()}
              suffix={delta == null ? '' : delta === 1 || delta === -1 ? 'spec' : 'specs'}
              sub={prior ? `vs ${prior.week} (${prior.drifted ?? '—'})` : 'first drift week'}
              color={delta == null ? '#6b7280' : delta <= 0 ? GREEN : RED}
            />
            <ScoreCard
              label="Drift rate"
              value={latest?.driftRate != null ? latest.driftRate.toFixed(0) : '—'}
              suffix="%"
              sub="drifted ÷ specs with code changes"
              color={TEAL}
            />
            <ScoreCard
              label="Reports recorded"
              value={reports.length.toString()}
              suffix=""
              sub="weekly drift + merged PR"
              color={TEAL}
            />
          </div>

          {/* Trend chart */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-gray-800">Drift trend</h2>
              <span className="text-xs text-gray-400">Drifted specs per week · lower is better</span>
            </div>
            <DriftChart reports={reports} />
          </div>

          {/* Latest drifted specs */}
          {latest && latest.driftedSpecs.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-gray-800">Latest drift ({latest.week})</h2>
                <span className="text-xs text-gray-400">Specs needing a sweep</span>
              </div>
              <ul className="divide-y divide-gray-100">
                {latest.driftedSpecs.map(d => (
                  <li key={d.spec} className="py-2 flex items-center justify-between">
                    <span className="font-mono text-sm text-gray-800">{d.spec}</span>
                    <span className="text-xs text-gray-500">{d.codeCommits} code commit{d.codeCommits === 1 ? '' : 's'}, spec not updated</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Report list */}
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-bold text-gray-800">Weekly drift reports</h2>
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
                    <span style={{ fontSize: 22, fontWeight: 700, color: r.drifted != null && r.drifted > 0 ? RED : GREEN }}>
                      {r.drifted != null ? r.drifted : '—'}
                    </span>
                    <span className="text-xs text-gray-400">drifted</span>
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

function DriftChart({ reports }: { reports: WeeklyDriftReport[] }) {
  const W = 880
  const H = 240
  const padL = 36
  const padR = 16
  const padT = 16
  const padB = 36

  const data = reports.filter(r => r.drifted != null) as (WeeklyDriftReport & { drifted: number })[]
  if (data.length === 0) return <p className="text-sm text-gray-500">No drift data yet.</p>

  const xCount = Math.max(data.length, 2)
  const x = (i: number) => padL + (i * (W - padL - padR)) / (xCount - 1)

  const maxDrift = Math.max(4, ...data.map(d => d.drifted))
  const y = (drift: number) => padT + (H - padT - padB) * (1 - drift / maxDrift)

  const gridSteps = 4
  const gridY = Array.from({ length: gridSteps + 1 }, (_, i) => Math.round((maxDrift / gridSteps) * i))

  const pathD = data.map((d, i) => (i === 0 ? 'M' : 'L') + x(i) + ' ' + y(d.drifted)).join(' ')
  const areaD = pathD + ' L ' + x(data.length - 1) + ' ' + y(0) + ' L ' + x(0) + ' ' + y(0) + ' Z'

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 240 }}>
      <defs>
        <linearGradient id="driftGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor={HERMES} stopOpacity="0.18" />
          <stop offset="100%" stopColor={HERMES} stopOpacity="0" />
        </linearGradient>
      </defs>
      {gridY.map(g => (
        <g key={g}>
          <line x1={padL} y1={y(g)} x2={W - padR} y2={y(g)} stroke="#f3f4f6" strokeWidth={1} />
          <text x={padL - 6} y={y(g) + 4} textAnchor="end" fontSize={10} fill="#9ca3af">{g}</text>
        </g>
      ))}
      {data.length >= 2 && <path d={areaD} fill="url(#driftGrad)" />}
      <path d={pathD} fill="none" stroke={HERMES} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => (
        <g key={d.week}>
          <circle cx={x(i)} cy={y(d.drifted)} r={4} fill={HERMES} stroke="white" strokeWidth={2} />
          <text x={x(i)} y={y(d.drifted) - 10} textAnchor="middle" fontSize={11} fontWeight={700} fill="#1f2937">{d.drifted}</text>
          <text x={x(i)} y={H - padB + 18} textAnchor="middle" fontSize={10} fill="#6b7280">{d.week}</text>
        </g>
      ))}
      {data.length === 1 && (
        <text x={W / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="#9ca3af">
          More data points appear each Monday after the spec-drift routine runs.
        </text>
      )}
    </svg>
  )
}
