'use client'

// app/admin/usage/page.tsx
// Admin dashboard showing AI usage accounting, cost estimates, and per-resource breakdown

import { useState, useEffect } from 'react'
import Link from 'next/link'

var HERMES = '#E8632A'
var TYPE_COLORS: Record<string, string> = { bot: '#0891B2', townhall: '#7C3AED', social: '#E85A1A', dataset: '#059669', study: '#D97706', system: '#6b7280' }
var TYPE_LABELS: Record<string, string> = { bot: 'Agents', townhall: 'PulseIQ', social: 'Social', dataset: 'TextMine', study: 'Studies', recording: 'Town Hall', system: 'System' }

interface Totals { calls: number; input_tokens: number; output_tokens: number; cost: number }
interface TypeStat { calls: number; input: number; output: number; cache_read: number; cost: number }
interface EventStat { calls: number; input: number; output: number; cost: number }
interface DailyPoint { date: string; calls: number; cost: number }
interface ResourceRow { resource_type: string; resource_id: string; name: string; calls: number; input: number; output: number; cost: number }
interface OrgRow { org_id: string; name: string; calls: number; input: number; output: number; cost: number }

function todayIso() { return new Date().toISOString().slice(0, 10) }
function isoDaysAgo(n: number) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10) }

export default function UsageClient() {
  var [days, setDays] = useState<number | null>(30)        // null when in custom-range mode
  var [from, setFrom] = useState<string>('')
  var [to, setTo]     = useState<string>('')
  var [loading, setLoading] = useState(true)
  var [totals, setTotals] = useState<Totals>({ calls: 0, input_tokens: 0, output_tokens: 0, cost: 0 })
  var [byType, setByType] = useState<Record<string, TypeStat>>({})
  var [byEvent, setByEvent] = useState<Record<string, EventStat>>({})
  var [byModel, setByModel] = useState<Record<string, EventStat>>({})
  var [daily, setDaily] = useState<DailyPoint[]>([])
  var [topResources, setTopResources] = useState<ResourceRow[]>([])
  var [byOrg, setByOrg] = useState<OrgRow[]>([])
  var [resourcesVisible, setResourcesVisible] = useState(20)

  useEffect(function() {
    setLoading(true)
    var qs: string
    if (days != null) {
      qs = 'days=' + days
    } else if (from) {
      qs = 'from=' + from + (to ? '&to=' + to : '')
    } else {
      qs = 'days=30'
    }
    fetch('/api/admin/usage?' + qs)
      .then(function(r) { return r.json() })
      .then(function(d) {
        setTotals(d.totals || {})
        setByType(d.by_type || {})
        setByEvent(d.by_event || {})
        setByModel(d.by_model || {})
        setDaily(d.daily_trend || [])
        setTopResources(d.top_resources || [])
        setByOrg(d.by_org || [])
      })
      .catch(function() {})
      .finally(function() { setLoading(false) })
  }, [days, from, to])

  function pickQuick(n: number) {
    setDays(n)
    setFrom('')
    setTo('')
  }

  function applyCustomRange(nextFrom: string, nextTo: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextFrom)) return
    setFrom(nextFrom)
    setTo(nextTo)
    setDays(null)
  }

  var rangeLabel = days != null
    ? days + 'd'
    : (from ? from + ' → ' + (to || 'today') : '')

  function fmt(n: number) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
    return String(n)
  }

  function escapeCsv(v: string | number): string {
    var s = String(v)
    if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) {
      return '"' + s.replace(/"/g, '""') + '"'
    }
    return s
  }

  function downloadCsv(filename: string, rows: Array<Record<string, string | number>>) {
    if (rows.length === 0) return
    var header = Object.keys(rows[0])
    var lines = [header.join(',')]
    for (var row of rows) {
      lines.push(header.map(function(h) { return escapeCsv(row[h] ?? '') }).join(','))
    }
    var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    var url = URL.createObjectURL(blob)
    var a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function rangeSlug() {
    if (days != null) return days + 'd'
    if (from && to)   return from + '_to_' + to
    if (from)         return 'since_' + from
    return '30d'
  }

  function exportResourcesCsv() {
    downloadCsv('usage_resources_' + rangeSlug() + '_' + new Date().toISOString().slice(0, 10) + '.csv',
      topResources.map(function(r) {
        return {
          type:     TYPE_LABELS[r.resource_type] || r.resource_type,
          name:     r.name,
          resource_id: r.resource_id,
          calls:    r.calls,
          input:    r.input,
          output:   r.output,
          cost_usd: r.cost.toFixed(6),
        }
      })
    )
  }

  function exportOrgsCsv() {
    downloadCsv('usage_orgs_' + rangeSlug() + '_' + new Date().toISOString().slice(0, 10) + '.csv',
      byOrg.map(function(o) {
        return {
          org_id:   o.org_id,
          name:     o.name,
          calls:    o.calls,
          input:    o.input,
          output:   o.output,
          cost_usd: o.cost.toFixed(6),
        }
      })
    )
  }

  var visibleResources = topResources.slice(0, resourcesVisible)

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>AI Usage</h1>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>Token consumption and cost estimates{rangeLabel ? ' — ' + rangeLabel : ''}</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {[7, 30, 90].map(function(d) {
              return (
                <button key={d} onClick={function() { pickQuick(d) }}
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
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: '#6b7280' }}>
            <label>From</label>
            <input type="date" value={from} max={to || todayIso()}
              onChange={function(e) { applyCustomRange(e.target.value, to) }}
              style={{ fontSize: 11, padding: '4px 6px', borderRadius: 6, border: '1px solid #e5e7eb', background: 'white', color: '#374151' }} />
            <label>To</label>
            <input type="date" value={to} min={from || undefined} max={todayIso()}
              onChange={function(e) { applyCustomRange(from || isoDaysAgo(30), e.target.value) }}
              style={{ fontSize: 11, padding: '4px 6px', borderRadius: 6, border: '1px solid #e5e7eb', background: 'white', color: '#374151' }} />
            {(from || to) && (
              <button onClick={function() { pickQuick(30) }}
                style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#f9fafb', color: '#374151', cursor: 'pointer' }}>
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af', fontSize: 14 }}>Loading usage data...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <StatCard label="Total Calls" value={fmt(totals.calls)} />
            <StatCard label="Input Tokens" value={fmt(totals.input_tokens)} />
            <StatCard label="Output Tokens" value={fmt(totals.output_tokens)} />
            <StatCard label="Est. Cost" value={'$' + totals.cost.toFixed(2)} accent />
          </div>

          {/* By resource type */}
          <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20 }}>
            <h3 style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 12 }}>By Module</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
              {Object.entries(byType).sort(function(a, b) { return b[1].cost - a[1].cost }).map(function(e) {
                var type = e[0], stat = e[1]
                var color = TYPE_COLORS[type] || '#6b7280'
                return (
                  <div key={type} style={{ padding: 14, borderRadius: 10, border: '1px solid #e5e7eb', background: '#fafafa' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: color, textTransform: 'uppercase', marginBottom: 6 }}>{TYPE_LABELS[type] || type}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: '#111827' }}>{fmt(stat.calls)}</div>
                    <div style={{ fontSize: 10, color: '#9ca3af' }}>{fmt(stat.input)} in / {fmt(stat.output)} out</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: HERMES, marginTop: 4 }}>${stat.cost.toFixed(4)}</div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* By organization */}
          {byOrg.length > 0 && (
            <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>By Organization</h3>
                <button onClick={exportOrgsCsv}
                  style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#f9fafb', color: '#374151', cursor: 'pointer' }}>
                  Export CSV
                </button>
              </div>
              <table style={{ width: '100%', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: '#9ca3af', fontSize: 10, textTransform: 'uppercase' }}>
                    <th style={{ textAlign: 'left', padding: '4px 0' }}>Organization</th>
                    <th style={{ textAlign: 'right' }}>Calls</th>
                    <th style={{ textAlign: 'right' }}>Input</th>
                    <th style={{ textAlign: 'right' }}>Output</th>
                    <th style={{ textAlign: 'right' }}>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {byOrg.map(function(o, i) {
                    return (
                      <tr key={i} style={{ borderTop: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '6px 0', color: '#111827', fontWeight: 600 }}>{o.name}</td>
                        <td style={{ textAlign: 'right', color: '#6b7280' }}>{fmt(o.calls)}</td>
                        <td style={{ textAlign: 'right', color: '#6b7280' }}>{fmt(o.input)}</td>
                        <td style={{ textAlign: 'right', color: '#6b7280' }}>{fmt(o.output)}</td>
                        <td style={{ textAlign: 'right', color: HERMES, fontWeight: 700 }}>${o.cost.toFixed(4)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Daily trend */}
          {daily.length > 1 && (
            <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20 }}>
              <h3 style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 12 }}>Daily Cost Trend</h3>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 100 }}>
                {(() => {
                  var maxCost = Math.max(...daily.map(function(d) { return d.cost }), 0.001)
                  return daily.map(function(d, i) {
                    var h = Math.max(4, (d.cost / maxCost) * 80)
                    return (
                      <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        <div style={{ width: '100%', height: h, background: HERMES, borderRadius: 2, minWidth: 4 }}
                          title={d.date + ': $' + d.cost.toFixed(4) + ' (' + d.calls + ' calls)'} />
                        {i % Math.max(1, Math.floor(daily.length / 7)) === 0 && (
                          <span style={{ fontSize: 8, color: '#9ca3af' }}>{d.date.slice(5)}</span>
                        )}
                      </div>
                    )
                  })
                })()}
              </div>
            </div>
          )}

          {/* By event type */}
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
                  {Object.entries(byEvent).sort(function(a, b) { return b[1].cost - a[1].cost }).map(function(e) {
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
                  {Object.entries(byModel).sort(function(a, b) { return b[1].cost - a[1].cost }).map(function(e) {
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

          {/* Top resources */}
          {topResources.length > 0 && (
            <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>Resources by Cost ({topResources.length})</h3>
                <button onClick={exportResourcesCsv}
                  style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#f9fafb', color: '#374151', cursor: 'pointer' }}>
                  Export CSV
                </button>
              </div>
              <table style={{ width: '100%', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: '#9ca3af', fontSize: 10, textTransform: 'uppercase' }}>
                    <th style={{ textAlign: 'left', padding: '4px 0' }}>Resource</th>
                    <th style={{ textAlign: 'left' }}>Type</th>
                    <th style={{ textAlign: 'right' }}>Calls</th>
                    <th style={{ textAlign: 'right' }}>Input</th>
                    <th style={{ textAlign: 'right' }}>Output</th>
                    <th style={{ textAlign: 'right' }}>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleResources.map(function(r, i) {
                    var color = TYPE_COLORS[r.resource_type] || '#6b7280'
                    return (
                      <tr key={i} style={{ borderTop: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '6px 0', color: '#111827', fontWeight: 600 }}>
                          <Link
                            href={'/admin/usage/' + r.resource_type + '/' + r.resource_id + '?' + (days != null ? 'days=' + days : 'from=' + from + (to ? '&to=' + to : ''))}
                            style={{ color: '#111827', textDecoration: 'none', borderBottom: '1px dotted #9ca3af' }}>
                            {r.name}
                          </Link>
                        </td>
                        <td><span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: color + '15', color: color, fontWeight: 600 }}>{TYPE_LABELS[r.resource_type] || r.resource_type}</span></td>
                        <td style={{ textAlign: 'right', color: '#6b7280' }}>{fmt(r.calls)}</td>
                        <td style={{ textAlign: 'right', color: '#6b7280' }}>{fmt(r.input)}</td>
                        <td style={{ textAlign: 'right', color: '#6b7280' }}>{fmt(r.output)}</td>
                        <td style={{ textAlign: 'right', color: HERMES, fontWeight: 700 }}>${r.cost.toFixed(4)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {topResources.length > resourcesVisible && (
                <div style={{ textAlign: 'center', marginTop: 12 }}>
                  <button onClick={function() { setResourcesVisible(resourcesVisible + 20) }}
                    style={{ fontSize: 11, fontWeight: 600, padding: '6px 14px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#f9fafb', color: '#374151', cursor: 'pointer' }}>
                    Show 20 more ({topResources.length - resourcesVisible} remaining)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
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
