'use client'
import TopNav from '@/components/nav/TopNav'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

interface Props {
  studyId:    string
  studyName:  string
  botEmoji:   string
  botName:    string
  logoUrl?:   string
  isAdmin?:   boolean
  userEmail?: string
}

interface Summary {
  total: number
  promoters: number
  passives: number
  detractors: number
  avgNps: number
  avgExp: number
}

interface TrendPoint   { date: string; avg_nps: number; count: number }
interface VolumePoint  { date: string; count: number }

const fmt = (d: string) => {
  const dt = new Date(d)
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const defaultFrom = () => {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString().slice(0, 10)
}
const defaultTo = () => new Date().toISOString().slice(0, 10)

export default function AnalyticsDashboard({ studyId, studyName, botEmoji, botName, logoUrl='', isAdmin=false, userEmail='' }: Props) {
  const [from, setFrom] = useState(defaultFrom())
  const [to,   setTo]   = useState(defaultTo())

  const [summary,    setSummary]    = useState<Summary | null>(null)
  const [npsTrend,   setNpsTrend]   = useState<TrendPoint[]>([])
  const [volumeByDay, setVolumeByDay] = useState<VolumePoint[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ from, to })
      const res  = await fetch('/api/studies/' + studyId + '/analytics?' + params)
      if (!res.ok) throw new Error('Failed to load analytics')
      const json = await res.json()
      setSummary(json.summary)
      setNpsTrend(json.npsTrend || [])
      setVolumeByDay(json.volumeByDay || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [studyId, from, to])

  useEffect(() => { fetchData() }, [fetchData])

  const setLast30 = () => { setFrom(defaultFrom()); setTo(defaultTo()) }
  const setAllTime = () => { setFrom('2024-01-01'); setTo(defaultTo()) }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <TopNav logoUrl={logoUrl} isAdmin={isAdmin} userEmail={userEmail} currentPage='analytics' crumbs={[{label: 'Dashboard', href: '/dashboard'}, {label: studyName, href: '/studies/' + studyId + '/responses'}, {label: 'Analytics'}]} />

      <main className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <div>
            <h1 className="text-xl font-bold text-white">{botEmoji} {studyName}</h1>
            <p className="text-slate-400 text-sm mt-0.5">Analytics</p>
          </div>

          {/* Date range controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={setLast30}  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors">Last 30 days</button>
            <button onClick={setAllTime} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors">All time</button>
            <div className="flex items-center gap-2">
              <input type="date" value={from} onChange={e => setFrom(e.target.value)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs outline-none focus:border-cyan-500 transition-colors" />
              <span className="text-slate-500 text-xs">to</span>
              <input type="date" value={to} onChange={e => setTo(e.target.value)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs outline-none focus:border-cyan-500 transition-colors" />
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-6 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
        )}

        {loading && !summary && (
          <div className="py-20 text-center text-slate-500 text-sm">Loading analytics...</div>
        )}

        {summary && (
          <>
            {/* Summary stats */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
              <StatCard label="Responses"    value={summary.total} />
              <StatCard label="Avg NPS"      value={summary.total > 0 ? summary.avgNps : '—'} />
              <StatCard label="Avg Exp."     value={summary.total > 0 ? summary.avgExp : '—'} />
              <StatCard label="Promoters"    value={summary.total > 0 ? Math.round(summary.promoters  / summary.total * 100) + '%' : '—'} color="text-green-400" />
              <StatCard label="Passives"     value={summary.total > 0 ? Math.round(summary.passives   / summary.total * 100) + '%' : '—'} color="text-yellow-400" />
              <StatCard label="Detractors"   value={summary.total > 0 ? Math.round(summary.detractors / summary.total * 100) + '%' : '—'} color="text-red-400" />
            </div>

            {summary.total === 0 ? (
              <div className="py-20 text-center border border-dashed border-slate-700 rounded-2xl">
                <div className="text-3xl mb-3">📊</div>
                <p className="text-slate-500 text-sm">No responses in this date range.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

                {/* NPS Trend — takes 2 columns */}
                <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-5">
                  <h2 className="font-semibold text-white mb-1 text-sm">NPS Trend</h2>
                  <p className="text-slate-500 text-xs mb-4">Average NPS score per day</p>
                  {npsTrend.length < 2 ? (
                    <div className="h-40 flex items-center justify-center text-slate-500 text-xs">Not enough data points for a trend</div>
                  ) : (
                    <LineChart data={npsTrend} />
                  )}
                </div>

                {/* Sentiment Donut */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
                  <h2 className="font-semibold text-white mb-1 text-sm">Sentiment Split</h2>
                  <p className="text-slate-500 text-xs mb-4">Overall breakdown</p>
                  <SentimentDonut summary={summary} />
                </div>

                {/* Volume bar chart — full width */}
                <div className="lg:col-span-3 bg-slate-900 border border-slate-800 rounded-2xl p-5">
                  <h2 className="font-semibold text-white mb-1 text-sm">Response Volume</h2>
                  <p className="text-slate-500 text-xs mb-4">Responses per day</p>
                  {volumeByDay.length === 0 ? (
                    <div className="h-28 flex items-center justify-center text-slate-500 text-xs">No data</div>
                  ) : (
                    <BarChart data={volumeByDay} />
                  )}
                </div>

              </div>
            )}

            <div className="mt-6 flex gap-3">
              <Link
                href={'/studies/' + studyId + '/responses?from=' + from + '&to=' + to}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium transition-all"
              >
                View responses for this period
              </Link>
              <Link
                href={'/studies/' + studyId + '/responses?from=' + from + '&to=' + to + '&export=csv'}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium transition-all"
              >
                Export CSV
              </Link>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

// ── SVG Line Chart ──────────────────────────────────────────
function LineChart({ data }: { data: TrendPoint[] }) {
  const W = 500; const H = 140; const PAD = { top: 10, right: 10, bottom: 30, left: 30 }
  const iW = W - PAD.left - PAD.right
  const iH = H - PAD.top  - PAD.bottom

  const minY = Math.max(0, Math.min(...data.map(d => d.avg_nps)) - 0.5)
  const maxY = Math.min(5, Math.max(...data.map(d => d.avg_nps)) + 0.5)
  const rangeY = maxY - minY || 1

  const x = (i: number) => PAD.left + (i / (data.length - 1)) * iW
  const y = (v: number) => PAD.top  + iH - ((v - minY) / rangeY * iH)

  const path = data.map((d, i) => (i === 0 ? 'M' : 'L') + x(i).toFixed(1) + ',' + y(d.avg_nps).toFixed(1)).join(' ')
  const area = path + ' L' + x(data.length - 1).toFixed(1) + ',' + (PAD.top + iH) + ' L' + PAD.left.toFixed(1) + ',' + (PAD.top + iH) + ' Z'

  const yTicks = [1, 2, 3, 4, 5].filter(t => t >= minY && t <= maxY)
  const xStep  = Math.max(1, Math.floor(data.length / 5))

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={'0 0 ' + W + ' ' + H} className="w-full" style={{ minWidth: '280px' }}>
        {/* Grid lines */}
        {yTicks.map(t => (
          <line key={t} x1={PAD.left} y1={y(t)} x2={PAD.left + iW} y2={y(t)} stroke="#1e293b" strokeWidth="1" />
        ))}
        {/* Area fill */}
        <path d={area} fill="url(#lineGrad)" opacity="0.3" />
        {/* Line */}
        <path d={path} fill="none" stroke="#00b4d8" strokeWidth="2" strokeLinejoin="round" />
        {/* Dots */}
        {data.map((d, i) => (
          <circle key={i} cx={x(i)} cy={y(d.avg_nps)} r="3" fill="#00b4d8" />
        ))}
        {/* Y axis labels */}
        {yTicks.map(t => (
          <text key={t} x={PAD.left - 5} y={y(t) + 4} textAnchor="end" fontSize="10" fill="#64748b">{t}</text>
        ))}
        {/* X axis labels */}
        {data.filter((_, i) => i % xStep === 0).map((d, idx) => {
          const origIdx = idx * xStep
          return (
            <text key={origIdx} x={x(origIdx)} y={H - 5} textAnchor="middle" fontSize="9" fill="#64748b">{fmt(d.date)}</text>
          )
        })}
        <defs>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#00b4d8" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#00b4d8" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  )
}

// ── SVG Bar Chart ───────────────────────────────────────────
function BarChart({ data }: { data: VolumePoint[] }) {
  const W = 900; const H = 110; const PAD = { top: 10, right: 10, bottom: 25, left: 30 }
  const iW = W - PAD.left - PAD.right
  const iH = H - PAD.top  - PAD.bottom

  const maxY  = Math.max(...data.map(d => d.count), 1)
  const barW  = Math.max(2, iW / data.length - 2)
  const xStep = Math.max(1, Math.floor(data.length / 8))

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={'0 0 ' + W + ' ' + H} className="w-full" style={{ minWidth: '280px' }}>
        {data.map((d, i) => {
          const bh = (d.count / maxY) * iH
          const bx = PAD.left + (i / data.length) * iW
          const by = PAD.top + iH - bh
          return (
            <rect key={i} x={bx} y={by} width={barW} height={bh} rx="2" fill="#00b4d8" opacity="0.7" />
          )
        })}
        {data.filter((_, i) => i % xStep === 0).map((d, idx) => {
          const origIdx = idx * xStep
          const bx = PAD.left + (origIdx / data.length) * iW + barW / 2
          return (
            <text key={origIdx} x={bx} y={H - 5} textAnchor="middle" fontSize="9" fill="#64748b">{fmt(d.date)}</text>
          )
        })}
        {[0, Math.ceil(maxY / 2), maxY].map(t => (
          <text key={t} x={PAD.left - 5} y={PAD.top + iH - (t / maxY * iH) + 4} textAnchor="end" fontSize="9" fill="#64748b">{t}</text>
        ))}
      </svg>
    </div>
  )
}

// ── Sentiment Donut ─────────────────────────────────────────
function SentimentDonut({ summary }: { summary: Summary }) {
  const total = summary.total || 1
  const segments = [
    { value: summary.promoters,  color: '#22c55e', label: 'Promoters'  },
    { value: summary.passives,   color: '#eab308', label: 'Passives'   },
    { value: summary.detractors, color: '#ef4444', label: 'Detractors' },
  ]

  const R = 60; const CX = 80; const CY = 70; const STROKE = 22
  let cumAngle = -Math.PI / 2

  const arcs = segments.map(seg => {
    const frac  = seg.value / total
    const angle = frac * 2 * Math.PI
    const x1    = CX + R * Math.cos(cumAngle)
    const y1    = CY + R * Math.sin(cumAngle)
    cumAngle   += angle
    const x2    = CX + R * Math.cos(cumAngle)
    const y2    = CY + R * Math.sin(cumAngle)
    const large = angle > Math.PI ? 1 : 0
    return { ...seg, frac, d: frac > 0.005 ? 'M ' + x1 + ' ' + y1 + ' A ' + R + ' ' + R + ' 0 ' + large + ' 1 ' + x2 + ' ' + y2 : '', }
  })

  return (
    <div className="flex items-center gap-4">
      <svg width="160" height="140" viewBox="0 0 160 140">
        {arcs.map((a, i) => a.d && (
          <path key={i} d={a.d} fill="none" stroke={a.color} strokeWidth={STROKE} strokeLinecap="butt" opacity="0.85" />
        ))}
        <text x={CX} y={CY - 6}  textAnchor="middle" fontSize="20" fontWeight="bold" fill="white">{summary.total}</text>
        <text x={CX} y={CY + 10} textAnchor="middle" fontSize="9" fill="#64748b">responses</text>
      </svg>
      <div className="flex flex-col gap-2">
        {segments.map(s => (
          <div key={s.label} className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
            <div>
              <div className="text-xs text-white font-medium">{Math.round(s.value / total * 100)}%</div>
              <div className="text-xs text-slate-500">{s.label}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function StatCard({ label, value, color = 'text-white' }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <div className={'text-xl font-bold ' + color}>{value}</div>
      <div className="text-slate-400 text-xs mt-0.5">{label}</div>
    </div>
  )
}
