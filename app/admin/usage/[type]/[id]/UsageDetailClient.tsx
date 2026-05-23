'use client'

// Detail page for one (resource_type, resource_id).
// Reached from /admin/usage Top Resources rows.

import { useEffect, useState } from 'react'
import Link from 'next/link'

var HERMES = '#E8632A'
var TYPE_LABELS: Record<string, string> = { bot: 'Agent', townhall: 'PulseIQ', social: 'Social', dataset: 'TextMine', study: 'Study', system: 'System' }
var TYPE_COLORS: Record<string, string> = { bot: '#0891B2', townhall: '#7C3AED', social: '#E85A1A', dataset: '#059669', study: '#D97706', system: '#6b7280' }

interface Detail {
  period:   { days: number; since: string }
  resource: { type: string; id: string; name: string; href: string | null }
  org:      { id: string; name: string | null } | null
  totals:   { calls: number; input_tokens: number; output_tokens: number; cost: number }
  by_event: Record<string, { calls: number; input: number; output: number; cost: number }>
  by_model: Record<string, { calls: number; input: number; output: number; cost: number }>
  daily_trend: Array<{ date: string; calls: number; cost: number }>
}

export default function UsageDetailClient({ type, id }: { type: string; id: string }) {
  var [days, setDays] = useState(30)
  var [loading, setLoading] = useState(true)
  var [data, setData] = useState<Detail | null>(null)
  var [error, setError] = useState<string | null>(null)

  useEffect(function() {
    setLoading(true)
    setError(null)
    fetch('/api/admin/usage/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) + '?days=' + days)
      .then(function(r) {
        if (!r.ok) throw new Error('Failed to load (' + r.status + ')')
        return r.json()
      })
      .then(function(d) { setData(d) })
      .catch(function(e) { setError(e.message || 'Failed to load') })
      .finally(function() { setLoading(false) })
  }, [type, id, days])

  function fmt(n: number) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
    return String(n)
  }

  var color = TYPE_COLORS[type] || '#6b7280'
  var label = TYPE_LABELS[type] || type

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ marginBottom: 12 }}>
        <Link href="/admin/usage" style={{ fontSize: 12, color: '#6b7280', textDecoration: 'none' }}>← All usage</Link>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af', fontSize: 14 }}>Loading…</div>
      ) : error ? (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: 16, borderRadius: 8, fontSize: 13 }}>{error}</div>
      ) : data ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <span style={{ fontSize: 10, padding: '2px 10px', borderRadius: 10, background: color + '15', color: color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
                {data.org && (
                  <span style={{ fontSize: 11, color: '#6b7280' }}>org: <strong style={{ color: '#374151' }}>{data.org.name || data.org.id.slice(0, 8)}</strong></span>
                )}
              </div>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>
                {data.resource.href ? (
                  <Link href={data.resource.href} style={{ color: '#111827', textDecoration: 'none', borderBottom: '1px dotted #9ca3af' }}>{data.resource.name}</Link>
                ) : (
                  data.resource.name
                )}
              </h1>
              <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 4, fontFamily: 'monospace' }}>{data.resource.id}</p>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[7, 30, 90].map(function(d) {
                return (
                  <button key={d} onClick={function() { setDays(d) }}
                    style={{
                      padding: '6px 14px', borderRadius: 16, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      background: days === d ? HERMES : '#f3f4f6', color: days === d ? 'white' : '#374151',
                      border: 'none',
                    }}>
                    {d}d
                  </button>
                )
              })}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
            <StatCard label="Calls" value={fmt(data.totals.calls)} />
            <StatCard label="Input Tokens" value={fmt(data.totals.input_tokens)} />
            <StatCard label="Output Tokens" value={fmt(data.totals.output_tokens)} />
            <StatCard label="Est. Cost" value={'$' + data.totals.cost.toFixed(4)} accent />
          </div>

          {data.daily_trend.length > 1 && (() => {
            const trend = data.daily_trend
            const maxCost = Math.max(...trend.map(d => d.cost), 0.001)
            return (
              <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, marginBottom: 16 }}>
                <h3 style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 12 }}>Daily Cost Trend</h3>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 100 }}>
                  {trend.map(function(d, i) {
                    var h = Math.max(4, (d.cost / maxCost) * 80)
                    return (
                      <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        <div style={{ width: '100%', height: h, background: HERMES, borderRadius: 2, minWidth: 4 }}
                          title={d.date + ': $' + d.cost.toFixed(4) + ' (' + d.calls + ' calls)'} />
                        {i % Math.max(1, Math.floor(trend.length / 7)) === 0 && (
                          <span style={{ fontSize: 8, color: '#9ca3af' }}>{d.date.slice(5)}</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20 }}>
              <h3 style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 12 }}>By Event Type</h3>
              <table style={{ width: '100%', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: '#9ca3af', fontSize: 10, textTransform: 'uppercase' }}>
                    <th style={{ textAlign: 'left', padding: '4px 0' }}>Event</th>
                    <th style={{ textAlign: 'right' }}>Calls</th>
                    <th style={{ textAlign: 'right' }}>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.by_event).sort(function(a, b) { return b[1].cost - a[1].cost }).map(function(e) {
                    return (
                      <tr key={e[0]}>
                        <td style={{ padding: '4px 0', color: '#374151', fontWeight: 500 }}>{e[0]}</td>
                        <td style={{ textAlign: 'right', color: '#6b7280' }}>{fmt(e[1].calls)}</td>
                        <td style={{ textAlign: 'right', color: HERMES, fontWeight: 600 }}>${e[1].cost.toFixed(4)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20 }}>
              <h3 style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 12 }}>By Model</h3>
              <table style={{ width: '100%', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: '#9ca3af', fontSize: 10, textTransform: 'uppercase' }}>
                    <th style={{ textAlign: 'left', padding: '4px 0' }}>Model</th>
                    <th style={{ textAlign: 'right' }}>Calls</th>
                    <th style={{ textAlign: 'right' }}>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.by_model).sort(function(a, b) { return b[1].cost - a[1].cost }).map(function(e) {
                    return (
                      <tr key={e[0]}>
                        <td style={{ padding: '4px 0', color: '#374151', fontWeight: 500 }}>{e[0].replace('claude-', '').replace('-20251001', '')}</td>
                        <td style={{ textAlign: 'right', color: '#6b7280' }}>{fmt(e[1].calls)}</td>
                        <td style={{ textAlign: 'right', color: HERMES, fontWeight: 600 }}>${e[1].cost.toFixed(4)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, textAlign: 'center' }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent ? HERMES : '#111827' }}>{value}</div>
      <div style={{ fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', marginTop: 4 }}>{label}</div>
    </div>
  )
}
