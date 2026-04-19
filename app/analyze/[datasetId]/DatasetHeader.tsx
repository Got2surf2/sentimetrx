'use client'

// app/analyze/[datasetId]/DatasetHeader.tsx
// Ana-style header: back + brand → module tabs + Filters + Save Session → dataset pill → row count → AI toggle
// Responsive: overflows into a "More" dropdown on narrow screens

import { useState, useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import ExportModal from '@/components/analyze/ExportModal'
import ShareAnalyticsModal from '@/components/analyze/ShareAnalyticsModal'

interface DatasetMeta {
  id: string; name: string; source: 'upload' | 'study' | 'google_reviews' | 'reddit' | 'townhall'; visibility: 'private' | 'public'
  status: 'active' | 'archived'; row_count: number; last_synced_at: string | null; study_name: string | null
}

interface Props {
  dataset: DatasetMeta
  userName?: string
  orgName?: string
  filterCount?: number
  onFilterClick?: () => void
  onSaveSession?: () => void
  sessionSaving?: boolean
  sessionSaved?: boolean
  onAskAna?: () => void
  askAnaOpen?: boolean
}

var HERMES = '#E8632A'

var TABS = [
  { key: 'textmine', label: 'TextMine', icon: '\uD83D\uDCDD' },
  { key: 'charts', label: 'Charts', icon: '\uD83D\uDCCA' },
  { key: 'stats', label: 'Statistics', icon: '\u03A3' },
  { key: 'settings', label: 'Schema', icon: '\u2699' },
]

export default function DatasetHeader({ dataset, userName, orgName, filterCount = 0, onFilterClick, onSaveSession, sessionSaving, sessionSaved, onAskAna, askAnaOpen }: Props) {
  var router = useRouter()
  var pathname = usePathname()

  var [apiKey,      setApiKey]      = useState('')
  var [aiEnabled,   setAiEnabled]   = useState(false)
  var [showExport,  setShowExport]  = useState(false)
  var [showShareAnalytics, setShowShareAnalytics] = useState(false)
  var [showMore,    setShowMore]    = useState(false)

  // Responsive overflow detection
  var headerRef = useRef<HTMLDivElement>(null)
  var [overflowing, setOverflowing] = useState(false)

  useEffect(function() {
    function checkOverflow() {
      var el = headerRef.current
      if (!el) return
      setOverflowing(el.scrollWidth > el.clientWidth + 2)
    }
    checkOverflow()
    window.addEventListener('resize', checkOverflow)
    return function() { window.removeEventListener('resize', checkOverflow) }
  }, [])

  useEffect(function() {
    try {
      var k = localStorage.getItem('sentimetrx_tm_apikey')
      if (k) setApiKey(k)
      var ai = localStorage.getItem('sentimetrx_ai_enabled')
      if (ai === '1') setAiEnabled(true)
    } catch {}
  }, [])

  var activeTab = TABS.find(function(t) { return pathname.endsWith('/' + t.key) })?.key || 'textmine'

  var [reviewSyncing, setReviewSyncing] = useState(false)

  async function handleSync() {
    try {
      var res = await fetch('/api/datasets/' + dataset.id + '/sync', { method: 'POST' })
      var data = await res.json()
      if (data.synced > 0) router.refresh()
    } catch {}
  }

  async function handleReviewSync() {
    setReviewSyncing(true)
    try {
      var srcRes = await fetch('/api/review-sources')
      var srcData = await srcRes.json()
      var source = (srcData.sources || []).find(function(s: any) { return s.dataset_id === dataset.id })
      if (!source) return
      var res = await fetch('/api/review-sources/' + source.id + '/sync', { method: 'POST' })
      var data = await res.json()
      if (data.synced > 0) router.refresh()
    } catch {} finally { setReviewSyncing(false) }
  }

  // Items that go into "More" dropdown when overflowing
  var moreItems = [
    { label: '\uD83C\uDFAC StoryTime', action: function() { setShowExport(true); setShowMore(false) } },
    { label: '\uD83D\uDCCA Share Analytics', action: function() { setShowShareAnalytics(true); setShowMore(false) } },
    { label: (sessionSaving ? '\u23F3 Saving...' : sessionSaved ? '\u2714 Saved' : '\uD83D\uDCBE Save Session'), action: function() { if (onSaveSession) onSaveSession(); setShowMore(false) }, disabled: sessionSaving },
  ]

  return (
    <div>
      {showExport && (
        <ExportModal
          datasetId={dataset.id}
          datasetName={dataset.name}
          onClose={function() { setShowExport(false) }}
        />
      )}
      {showShareAnalytics && (
        <ShareAnalyticsModal
          datasetId={dataset.id}
          datasetName={dataset.name}
          onClose={function() { setShowShareAnalytics(false) }}
        />
      )}
      <div ref={headerRef} style={{ background: HERMES, padding: '0 0 0 20px', height: 48, display: 'flex', alignItems: 'stretch', flexShrink: 0, overflow: 'hidden', position: 'relative' }}>

        {/* Back + Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 16, borderRight: '1px solid rgba(255,255,255,.15)', flexShrink: 0 }}>
          <Link href="/analyze" style={{ fontSize: 14, color: 'rgba(255,255,255,.7)', textDecoration: 'none', fontWeight: 600 }}>{'\u2190'}</Link>
          <div style={{ width: 24, height: 24, borderRadius: 6, background: 'rgba(255,255,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 900, color: 'white' }}>A</div>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'white', letterSpacing: '-.3px' }}>Ana</span>
        </div>

        {/* Module tabs */}
        <div style={{ display: 'flex', alignItems: 'stretch', paddingLeft: 4, flexShrink: 0 }}>
          {TABS.map(function(tab) {
            var isActive = activeTab === tab.key
            var href = '/analyze/' + dataset.id + '/' + tab.key
            return (
              <Link key={tab.key} href={href}
                style={{
                  padding: '0 16px', height: '100%', display: 'flex', alignItems: 'center',
                  fontSize: 13, fontWeight: isActive ? 700 : 500, textDecoration: 'none',
                  color: isActive ? 'white' : 'rgba(255,255,255,.65)',
                  background: isActive ? 'rgba(255,255,255,.18)' : 'transparent',
                  borderBottom: isActive ? '3px solid white' : '3px solid transparent',
                  transition: 'all .12s', whiteSpace: 'nowrap',
                }}>
                <span style={{ marginRight: 5 }}>{tab.icon}</span>{tab.label}
              </Link>
            )
          })}

          {/* Filters button — always visible */}
          <button onClick={onFilterClick}
            style={{
              padding: '0 14px', height: '100%', display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 13, fontWeight: filterCount > 0 ? 700 : 500,
              color: filterCount > 0 ? 'white' : 'rgba(255,255,255,.65)',
              background: filterCount > 0 ? 'rgba(255,255,255,.18)' : 'transparent',
              border: 'none', borderBottom: filterCount > 0 ? '3px solid white' : '3px solid transparent',
              cursor: 'pointer', flexShrink: 0, transition: 'all .15s', whiteSpace: 'nowrap',
            }}>
            {filterCount > 0 && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#fde68a', flexShrink: 0 }} />}
            Filters{filterCount > 0 ? ' (' + filterCount + ')' : ''}
          </button>

          {/* Ask Ana — visible for reddit datasets when AI is enabled */}
          {(dataset.source === 'reddit' || dataset.source === 'townhall') && aiEnabled && onAskAna && (
            <button onClick={onAskAna}
              style={{
                padding: '0 14px', height: '100%', display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 13, fontWeight: askAnaOpen ? 700 : 500,
                color: askAnaOpen ? 'white' : 'rgba(255,255,255,.65)',
                background: askAnaOpen ? 'rgba(255,255,255,.18)' : 'transparent',
                border: 'none', borderBottom: askAnaOpen ? '3px solid white' : '3px solid transparent',
                cursor: 'pointer', flexShrink: 0, transition: 'all .15s', whiteSpace: 'nowrap',
              }}>
              {'\uD83D\uDCAC'} Ask Ana
            </button>
          )}
        </div>

        {/* Action buttons — hidden when overflowing, replaced by More */}
        {!overflowing && (
          <div style={{ display: 'flex', alignItems: 'stretch', flexShrink: 1, minWidth: 0 }}>
            {/* Export button */}
            <button onClick={function() { setShowExport(true) }}
              style={{
                padding: '0 14px', height: '100%', display: 'flex', alignItems: 'center', gap: 5,
                fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.6)',
                background: 'transparent', border: 'none', borderBottom: '3px solid transparent',
                cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
              }}>
              {'\uD83C\uDFAC'} StoryTime
            </button>

            {/* Share Analytics button */}
            <button onClick={function() { setShowShareAnalytics(true) }}
              style={{
                padding: '0 14px', height: '100%', display: 'flex', alignItems: 'center', gap: 5,
                fontSize: 12, fontWeight: 600, color: filterCount > 0 ? 'rgba(255,255,255,.9)' : 'rgba(255,255,255,.6)',
                background: 'transparent', border: 'none', borderBottom: '3px solid transparent',
                cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
              }}>
              {'\uD83D\uDCCA'} Share Analytics
            </button>

            {/* Save Session button */}
            {onSaveSession && (
              <button onClick={onSaveSession} disabled={sessionSaving}
                style={{
                  padding: '0 14px', height: '100%', display: 'flex', alignItems: 'center', gap: 5,
                  fontSize: 12, fontWeight: 600,
                  color: sessionSaved ? '#4ade80' : 'rgba(255,255,255,.6)',
                  background: 'transparent',
                  border: 'none', borderBottom: '3px solid transparent',
                  cursor: sessionSaving ? 'wait' : 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
                }}>
                {sessionSaving ? '\u23F3' : sessionSaved ? '\u2714' : '\uD83D\uDCBE'} {sessionSaving ? 'Saving...' : sessionSaved ? 'Saved' : 'Save Session'}
              </button>
            )}
          </div>
        )}

        {/* More dropdown — visible when overflowing */}
        {overflowing && (
          <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, position: 'relative' }}>
            <button onClick={function() { setShowMore(!showMore) }}
              style={{
                padding: '0 14px', height: '100%', display: 'flex', alignItems: 'center', gap: 4,
                fontSize: 12, fontWeight: 700, color: 'white',
                background: showMore ? 'rgba(255,255,255,.18)' : 'transparent',
                border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
              }}>
              {'\u2026'} More
            </button>
            {showMore && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={function() { setShowMore(false) }} />
                <div style={{
                  position: 'absolute', top: 48, right: 0, zIndex: 100,
                  background: 'white', borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,.2)',
                  border: '1px solid #e5e7eb', minWidth: 180, overflow: 'hidden',
                }}>
                  {moreItems.map(function(item, i) {
                    return (
                      <button key={i} onClick={item.action} disabled={item.disabled}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          padding: '10px 16px', fontSize: 13, fontWeight: 600,
                          color: '#374151', background: 'transparent', border: 'none',
                          cursor: item.disabled ? 'wait' : 'pointer',
                          borderBottom: i < moreItems.length - 1 ? '1px solid #f3f4f6' : 'none',
                        }}
                        onMouseEnter={function(e) { (e.currentTarget as HTMLButtonElement).style.background = '#f9fafb' }}
                        onMouseLeave={function(e) { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}>
                        {item.label}
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Source pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', borderLeft: '1px solid rgba(255,255,255,.15)', borderRight: '1px solid rgba(255,255,255,.15)', flexShrink: 0 }}>
          <span style={{
            fontSize: 10, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase',
            borderRadius: 20, padding: '2px 8px', whiteSpace: 'nowrap', flexShrink: 0,
            background: dataset.source === 'study' ? 'rgba(56,189,248,.25)' : dataset.source === 'google_reviews' ? 'rgba(96,165,250,.25)' : dataset.source === 'reddit' ? 'rgba(16,185,129,.25)' : dataset.source === 'townhall' ? 'rgba(139,92,246,.25)' : 'rgba(255,255,255,.12)',
            color: dataset.source === 'study' ? '#bae6fd' : dataset.source === 'google_reviews' ? '#bfdbfe' : dataset.source === 'reddit' ? '#a7f3d0' : dataset.source === 'townhall' ? '#ddd6fe' : 'rgba(255,255,255,.6)',
            border: dataset.source === 'study' ? '1px solid rgba(56,189,248,.4)' : dataset.source === 'google_reviews' ? '1px solid rgba(96,165,250,.4)' : dataset.source === 'reddit' ? '1px solid rgba(16,185,129,.4)' : dataset.source === 'townhall' ? '1px solid rgba(139,92,246,.4)' : '1px solid rgba(255,255,255,.2)',
          }}>
            {dataset.source === 'study' ? 'Sarina' : dataset.source === 'google_reviews' ? 'Google Reviews' : dataset.source === 'reddit' ? 'Reddit' : dataset.source === 'townhall' ? 'Town Hall' : 'Upload'}
          </span>
        </div>

        {/* Row count + Sync */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', borderRight: '1px solid rgba(255,255,255,.15)', flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,.6)' }}>{dataset.row_count.toLocaleString()} rows</span>
          {dataset.source === 'study' && (
            <button onClick={handleSync}
              style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: 'rgba(255,255,255,.15)', color: 'white', border: '1px solid rgba(255,255,255,.25)', cursor: 'pointer' }}>
              Sync
            </button>
          )}
          {dataset.source === 'google_reviews' && (
            <button onClick={handleReviewSync} disabled={reviewSyncing}
              style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: 'rgba(255,255,255,.15)', color: 'white', border: '1px solid rgba(255,255,255,.25)', cursor: reviewSyncing ? 'wait' : 'pointer', opacity: reviewSyncing ? 0.6 : 1 }}>
              {reviewSyncing ? 'Syncing...' : 'Sync Reviews'}
            </button>
          )}
        </div>

        {/* AI toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 16px', flexShrink: 0 }}>
          {apiKey ? (
            <>
              <button onClick={function() {
                var next = !aiEnabled; setAiEnabled(next)
                try { localStorage.setItem('sentimetrx_ai_enabled', next ? '1' : '0') } catch {}
              }}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 11px', fontSize: 12, fontWeight: 600, background: aiEnabled ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.2)', border: '1px solid ' + (aiEnabled ? 'rgba(255,255,255,.3)' : 'rgba(255,255,255,.15)'), borderRadius: 20, color: 'white', cursor: 'pointer' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: aiEnabled ? '#4ade80' : '#94a3b8', display: 'inline-block' }} />
                {aiEnabled ? 'AI on' : 'AI off'}
              </button>
              <button onClick={function() {
                var key = prompt('Enter your Anthropic API key:', apiKey)
                if (key !== null) {
                  setApiKey(key); try { localStorage.setItem('sentimetrx_tm_apikey', key) } catch {}
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
              if (key) { setApiKey(key); setAiEnabled(true); try { localStorage.setItem('sentimetrx_tm_apikey', key); localStorage.setItem('sentimetrx_ai_enabled', '1') } catch {} }
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
