'use client'

// app/analyze/[datasetId]/DatasetHeader.tsx
// Ana-style header: module tabs + dataset name pill + Filters + AI controls
// Matches Ana.html's top bar pattern adapted for Sentimetrx's layout

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'

interface DatasetMeta {
  id: string
  name: string
  source: 'upload' | 'study'
  visibility: 'private' | 'public'
  status: 'active' | 'archived'
  row_count: number
  last_synced_at: string | null
  study_name: string | null
}

interface Props {
  dataset: DatasetMeta
  userName?: string
  orgName?: string
}

var HERMES = '#E8632A'
var T = {
  bg: '#f4f5f7', bgCard: '#ffffff', border: '#e5e7eb',
  text: '#111827', textMid: '#374151', textMute: '#6b7280', textFaint: '#9ca3af',
  accent: '#e8622a', accentBg: '#fff4ef', accentMid: '#fbd5c2',
  green: '#16a34a', amber: '#d97706',
}

var TABS = [
  { key: 'textmine', label: 'TextMine' },
  { key: 'charts', label: 'Charts' },
  { key: 'stats', label: 'Statistics' },
  { key: 'settings', label: 'Schema & Themes' },
]

export default function DatasetHeader({ dataset, userName, orgName }: Props) {
  var router = useRouter()
  var pathname = usePathname()
  var [syncing, setSyncing] = useState(false)
  var [syncMsg, setSyncMsg] = useState('')

  // AI state (shared across tabs via localStorage)
  var [apiKey, setApiKey] = useState('')
  var [aiEnabled, setAiEnabled] = useState(false)

  useEffect(function() {
    try {
      var k = localStorage.getItem('sentimetrx_tm_apikey')
      if (k) setApiKey(k)
      var ai = localStorage.getItem('sentimetrx_ai_enabled')
      if (ai === '1') setAiEnabled(true)
    } catch {}
  }, [])

  var activeTab = TABS.find(function(t) { return pathname.endsWith('/' + t.key) })?.key || 'textmine'

  async function handleSync() {
    setSyncing(true); setSyncMsg('')
    try {
      var res = await fetch('/api/datasets/' + dataset.id + '/sync', { method: 'POST' })
      var data = await res.json()
      setSyncMsg(data.synced === 0 ? 'Up to date' : data.synced + ' new rows')
      if (data.synced > 0) router.refresh()
    } finally {
      setSyncing(false)
      setTimeout(function() { setSyncMsg('') }, 3000)
    }
  }

  return (
    <div>
      {/* ─── Ana-style header bar ────────────────────────────────────── */}
      <div style={{ background: HERMES, padding: '0 0 0 20px', height: 48, display: 'flex', alignItems: 'stretch', flexShrink: 0 }}>

        {/* Back + Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 16, borderRight: '1px solid rgba(255,255,255,.15)', flexShrink: 0 }}>
          <Link href="/analyze" style={{ fontSize: 14, color: 'rgba(255,255,255,.7)', textDecoration: 'none', fontWeight: 600 }}>{'\u2190'}</Link>
          <div style={{ width: 24, height: 24, borderRadius: 6, background: 'rgba(255,255,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 900, color: 'white' }}>A</div>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'white', letterSpacing: '-.3px' }}>Ana</span>
        </div>

        {/* Module tabs */}
        <div style={{ display: 'flex', alignItems: 'stretch', flex: 1, paddingLeft: 4 }}>
          {TABS.map(function(tab) {
            var isActive = activeTab === tab.key
            var href = '/analyze/' + dataset.id + '/' + tab.key
            return (
              <Link key={tab.key} href={href}
                style={{
                  padding: '0 20px', height: '100%', display: 'flex', alignItems: 'center',
                  fontSize: 13, fontWeight: isActive ? 700 : 500, textDecoration: 'none',
                  color: isActive ? 'white' : 'rgba(255,255,255,.65)',
                  background: isActive ? 'rgba(255,255,255,.18)' : 'transparent',
                  borderBottom: isActive ? '3px solid white' : '3px solid transparent',
                  transition: 'all .12s',
                }}>
                {tab.label}
              </Link>
            )
          })}
        </div>

        {/* Dataset name pill */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 14px', borderLeft: '1px solid rgba(255,255,255,.15)', borderRight: '1px solid rgba(255,255,255,.15)', flexShrink: 0, minWidth: 0, maxWidth: 220 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'white', background: 'rgba(255,255,255,.2)', borderRadius: 20, padding: '3px 10px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }} title={dataset.name}>
            {dataset.name}
          </span>
        </div>

        {/* Row count + Sync */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', borderRight: '1px solid rgba(255,255,255,.15)', flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,.6)' }}>{dataset.row_count.toLocaleString()} rows</span>
          {dataset.source === 'study' && (
            <button onClick={handleSync} disabled={syncing}
              style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: 'rgba(255,255,255,.15)', color: 'white', border: '1px solid rgba(255,255,255,.25)', cursor: syncing ? 'not-allowed' : 'pointer' }}>
              {syncing ? '...' : syncMsg || 'Sync'}
            </button>
          )}
        </div>

        {/* AI toggle (Ana.html style) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 16px', flexShrink: 0 }}>
          {apiKey ? (
            <>
              <button onClick={function() {
                var next = !aiEnabled
                setAiEnabled(next)
                try { localStorage.setItem('sentimetrx_ai_enabled', next ? '1' : '0') } catch {}
              }}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 11px', fontSize: 12, fontWeight: 600, background: aiEnabled ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.2)', border: '1px solid ' + (aiEnabled ? 'rgba(255,255,255,.3)' : 'rgba(255,255,255,.15)'), borderRadius: 20, color: 'white', cursor: 'pointer' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: aiEnabled ? '#4ade80' : '#94a3b8', display: 'inline-block' }} />
                {aiEnabled ? 'AI on' : 'AI off'}
              </button>
              <button onClick={function() {
                var key = prompt('Enter your Anthropic API key:', apiKey)
                if (key !== null) {
                  setApiKey(key)
                  try { localStorage.setItem('sentimetrx_tm_apikey', key) } catch {}
                  if (key && !aiEnabled) { setAiEnabled(true); try { localStorage.setItem('sentimetrx_ai_enabled', '1') } catch {} }
                }
              }}
                style={{ padding: '4px 9px', fontSize: 11, fontWeight: 600, background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)', borderRadius: 20, color: 'rgba(255,255,255,.8)', cursor: 'pointer' }}>
                {'\u2699'}
              </button>
            </>
          ) : (
            <button onClick={function() {
              var key = prompt('Enter your Anthropic API key:')
              if (key) {
                setApiKey(key)
                setAiEnabled(true)
                try { localStorage.setItem('sentimetrx_tm_apikey', key); localStorage.setItem('sentimetrx_ai_enabled', '1') } catch {}
              }
            }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 14px', fontSize: 12, fontWeight: 700, background: 'white', border: 'none', borderRadius: 20, color: HERMES, cursor: 'pointer' }}>
              {'\uD83D\uDD11'} Connect AI
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
