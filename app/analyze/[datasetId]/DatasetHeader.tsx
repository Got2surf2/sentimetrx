'use client'

// app/analyze/[datasetId]/DatasetHeader.tsx
// Ana-style header with two zones:
//   LEFT (flexible):  back + brand → module tabs → Filters → Ask Ana (tabs shrink padding responsively)
//   RIGHT (fixed):    More dropdown → source pill → row count/sync → AI toggle
// Action items (Report, Share Analytics, Save) always live in the More dropdown.

import { useState, useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import ExportModal from '@/components/analyze/ExportModal'
import ShareAnalyticsModal from '@/components/analyze/ShareAnalyticsModal'
import SearchPanel from '@/components/analyze/textmine/SearchPanel'
import { useOrgAiMode } from '@/lib/hooks/useOrgAiMode'
import ReportsMenu from '@/components/analyze/ReportsMenu'
import AdHocReportModal from '@/components/analyze/AdHocReportModal'
import { availableReports, type ReportContext, type ReportType, type ReportFormat } from '@/lib/reportCatalog'

interface DatasetMeta {
  id: string; name: string; source: 'upload' | 'study' | 'google_reviews' | 'reddit' | 'townhall' | 'substack' | 'collection' | 'bot' | 'recording'; visibility: 'private' | 'public'
  status: 'active' | 'archived'; row_count: number; last_synced_at: string | null; study_id?: string | null; description?: string | null; study_name: string | null
}

interface Props {
  dataset: DatasetMeta
  userName?: string
  orgName?: string
  filterCount?: number
  filteredRowCount?: number | null
  filteredRowCountIsEstimate?: boolean
  substantivePct?: number | null   // share of answered rows with usable feedback (filter-aware)
  onFilterClick?: () => void
  onSaveSession?: () => void
  sessionSaving?: boolean
  sessionSaved?: boolean
  onAskAna?: () => void
  askAnaOpen?: boolean
  outletCount?: number
  inViewFilters?: Record<string, unknown>   // serialized active filters → ad-hoc report honors the in-view scope
}

var HERMES = '#E8632A'

var TABS: { key: string; label: string; icon: string; collapse: number; sources?: string[]; minOutlets?: number }[] = [
  { key: 'textmine', label: 'TextMine', icon: '\uD83D\uDCDD', collapse: 1 },
  { key: 'charts', label: 'Charts', icon: '\uD83D\uDCCA', collapse: 2 },
  { key: 'stats', label: 'Statistics', icon: '\u03A3', collapse: 3 },
  // Outlets (per-outlet vs. peer-group report) moved under TextMine as a sub-tab
  // link (see TextMineModule) \u2014 grouped with the review-brand deep-dives. Same
  // gate there: google_reviews + \u22655 outlets.
  { key: 'settings', label: 'Schema', icon: '\u2699', collapse: 4 },
]
// Filters collapse: 5, Ask Ana collapse: 6, actions collapse: 7/8/9

export default function DatasetHeader({ dataset, userName, orgName, filterCount = 0, filteredRowCount, filteredRowCountIsEstimate, substantivePct, onFilterClick, onSaveSession, sessionSaving, sessionSaved, onAskAna, askAnaOpen, outletCount = 0, inViewFilters }: Props) {
  var router = useRouter()
  var pathname = usePathname()

  var [apiKey,      setApiKey]      = useState('')
  var [showExport,  setShowExport]  = useState(false)
  var [reportMenuOpen, setReportMenuOpen] = useState(false)
  var [reportMenuPos, setReportMenuPos] = useState<{ top: number; left: number } | null>(null)
  var [adHocOpen, setAdHocOpen] = useState(false)
  var [showShareAnalytics, setShowShareAnalytics] = useState(false)
  var [showSearch,  setShowSearch]  = useState(false)
  var [aiToggling,  setAiToggling]  = useState(false)
  var orgAi = useOrgAiMode()
  // Org ceiling (admin-set "off" makes the user toggle unreachable).
  var aiDisabledByOrg = !orgAi.loading && orgAi.mode === 'off'
  // Personal opt-in — server-of-record on users.ai_enabled, audited
  // per flip in ai_consent_audit. Was localStorage in the old build;
  // localStorage now functions only as a fast-read cache for older
  // consumers (TextMine / Stats) that still read it directly.
  var aiEnabled = orgAi.userEnabled

  useEffect(function() {
    try {
      var k = localStorage.getItem('sentimetrx_tm_apikey')
      if (k) setApiKey(k)
    } catch {}
  }, [])

  var activeTab = TABS.find(function(t) { return pathname.endsWith('/' + t.key) })?.key || 'textmine'

  // Unified Reports (catalog-driven). In the analyze view the deck honors the
  // current filters/view (the ExportModal carries them); ad-hoc stays gated.
  var reportCtx: ReportContext = {
    isCollection: dataset.source === 'collection',
    source: dataset.source,
    aiEnabled: !aiDisabledByOrg,
    adHocEnabled: true,
  }
  var datasetReports = availableReports(reportCtx)
  // The deck (ex-StoryTime) is the common case — when it's available the Reports
  // button runs it DIRECTLY (no extra click), and a caret ▾ opens the full picker
  // for the other report types. Without a deck (collections), the button is the
  // picker toggle and the caret still appears for consistency.
  var deckReport = datasetReports.find(function(r) { return r.id === 'deck' })
  var showReportCaret = datasetReports.length > 1
  // The dropdown is rendered position:fixed (the header tab strip is overflow:hidden,
  // which would clip an absolutely-positioned menu) — anchor it to the button rect.
  var reportAnchorRef = useRef<HTMLDivElement>(null)
  function openReportMenu() {
    var el = reportAnchorRef.current
    if (el) { var r = el.getBoundingClientRect(); setReportMenuPos({ top: r.bottom + 4, left: r.left }) }
    setReportMenuOpen(true)
  }
  function toggleReportMenu() { if (reportMenuOpen) setReportMenuOpen(false); else openReportMenu() }
  function handleReportClick() {
    if (deckReport) { setShowExport(true); return }                       // primary = deck modal
    if (datasetReports.length === 1) { void handleReportLaunch(datasetReports[0], datasetReports[0].formats[0]); return }
    toggleReportMenu()
  }
  async function handleReportLaunch(type: ReportType, format: ReportFormat) {
    setReportMenuOpen(false)
    if (type.id === 'deck') { setShowExport(true); return }   // configurable → its own modal
    if (type.id === 'ad-hoc') { setAdHocOpen(true); return }
    var req = type.launch(dataset.id, format)
    if (req.method === 'GET') { window.open(req.url, '_blank', 'noopener'); return }
    // POST → fetch → blob download (collection synthesis reports, etc.)
    try {
      var res = await fetch(req.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body || {}) })
      if (!res.ok) { window.alert('Could not build the report'); return }
      var blob = await res.blob()
      var url = URL.createObjectURL(blob)
      var a = document.createElement('a')
      a.href = url
      a.download = (dataset.name || 'Report').replace(/[^\w.-]+/g, '_') + '_' + type.id + '.' + format
      a.click()
      URL.revokeObjectURL(url)
    } catch { window.alert('Network error building the report') }
  }

  var [reviewSyncing, setReviewSyncing] = useState(false)
  var [syncing, setSyncing] = useState(false)

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
      var source = (srcData.sources || []).find(function(s: { id: string; dataset_id: string }) { return s.dataset_id === dataset.id })
      if (!source) return
      var res = await fetch('/api/review-sources/' + source.id + '/sync', { method: 'POST' })
      var data = await res.json()
      if (data.synced > 0) router.refresh()
    } catch {} finally { setReviewSyncing(false) }
  }

  async function handleResync() {
    setSyncing(true)
    try {
      if (dataset.source === 'townhall' && dataset.description?.startsWith('th:')) {
        var sessionId = dataset.description.slice(3)
        var res = await fetch('/api/townhall/sessions/' + sessionId + '/analyze', { method: 'POST' })
        var data = await res.json()
        if (data.synced > 0 || data.created) router.refresh()
      } else if (dataset.source === 'study') {
        var res2 = await fetch('/api/datasets/' + dataset.id + '/sync', { method: 'POST' })
        var data2 = await res2.json()
        if (data2.error) { alert('Sync failed: ' + data2.error) }
        router.refresh()
      }
    } catch {} finally { setSyncing(false) }
  }

  // Source pill colors
  var srcBg = dataset.source === 'study' ? 'rgba(56,189,248,.25)' : dataset.source === 'bot' ? 'rgba(13,148,136,.25)' : dataset.source === 'google_reviews' ? 'rgba(96,165,250,.25)' : dataset.source === 'recording' ? 'rgba(180,83,9,.25)' : dataset.source === 'reddit' ? 'rgba(16,185,129,.25)' : dataset.source === 'townhall' ? 'rgba(139,92,246,.25)' : dataset.source === 'substack' ? 'rgba(225,29,72,.25)' : 'rgba(255,255,255,.12)'
  var srcColor = dataset.source === 'study' ? '#bae6fd' : dataset.source === 'bot' ? '#99f6e4' : dataset.source === 'google_reviews' ? '#bfdbfe' : dataset.source === 'recording' ? '#fde68a' : dataset.source === 'reddit' ? '#a7f3d0' : dataset.source === 'townhall' ? '#ddd6fe' : dataset.source === 'substack' ? '#fecdd3' : 'rgba(255,255,255,.6)'
  var srcBorder = dataset.source === 'study' ? '1px solid rgba(56,189,248,.4)' : dataset.source === 'bot' ? '1px solid rgba(13,148,136,.4)' : dataset.source === 'google_reviews' ? '1px solid rgba(96,165,250,.4)' : dataset.source === 'recording' ? '1px solid rgba(180,83,9,.4)' : dataset.source === 'reddit' ? '1px solid rgba(16,185,129,.4)' : dataset.source === 'townhall' ? '1px solid rgba(139,92,246,.4)' : dataset.source === 'substack' ? '1px solid rgba(225,29,72,.4)' : '1px solid rgba(255,255,255,.2)'
  var srcLabel = dataset.source === 'study' ? 'Survey' : dataset.source === 'bot' ? 'Agent' : dataset.source === 'google_reviews' ? 'Reviews' : dataset.source === 'recording' ? 'Town Hall' : dataset.source === 'reddit' ? 'Reddit' : dataset.source === 'townhall' ? 'PulseIQ' : dataset.source === 'substack' ? 'Substack' : 'Upload'

  return (
    <div>
      {showExport && (
        <ExportModal
          datasetId={dataset.id}
          datasetName={dataset.name}
          datasetSource={dataset.source}
          aiEnabled={aiEnabled}
          onClose={function() { setShowExport(false) }}
        />
      )}
      {adHocOpen && (
        <AdHocReportModal datasetId={dataset.id} datasetName={dataset.name} filters={inViewFilters} onClose={function() { setAdHocOpen(false) }} />
      )}
      {showShareAnalytics && (
        <ShareAnalyticsModal
          datasetId={dataset.id}
          datasetName={dataset.name}
          onClose={function() { setShowShareAnalytics(false) }}
        />
      )}
      {showSearch && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 2000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '80px 16px 24px' }}
          onClick={function() { setShowSearch(false) }}>
          <div style={{ width: '100%', maxWidth: 700, height: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
            onClick={function(e) { e.stopPropagation() }}>
            <SearchPanel datasetId={dataset.id} />
          </div>
        </div>
      )}
      <style>{'\
        .ana-tab { padding: 0 14px; transition: all .12s; }\
        .ana-tab .ana-lbl { transition: all .15s; }\
        @media (max-width: 1440px) { .ana-c9 .ana-lbl { display: none; } .ana-c9 { padding: 0 10px; } }\
        @media (max-width: 1380px) { .ana-c8 .ana-lbl { display: none; } .ana-c8 { padding: 0 10px; } }\
        @media (max-width: 1300px) { .ana-c7 .ana-lbl { display: none; } .ana-c7 { padding: 0 10px; } }\
        @media (max-width: 1200px) { .ana-c6 .ana-lbl { display: none; } .ana-c6 { padding: 0 10px; } }\
        @media (max-width: 1100px) { .ana-c5 .ana-lbl { display: none; } .ana-c5 { padding: 0 10px; } }\
        @media (max-width: 1000px) { .ana-c4 .ana-lbl { display: none; } .ana-c4 { padding: 0 10px; } }\
        @media (max-width: 920px)  { .ana-c3 .ana-lbl { display: none; } .ana-c3 { padding: 0 10px; } }\
        @media (max-width: 850px)  { .ana-c9 { display: none; } .ana-c8 { display: none; } .ana-c7 { display: none; } }\
        @media (max-width: 780px)  { .ana-c2 .ana-lbl { display: none; } .ana-c2 { padding: 0 10px; } }\
        @media (max-width: 700px)  { .ana-c1 .ana-lbl { display: none; } .ana-c1 { padding: 0 10px; } }\
        @media (max-width: 640px)  { .ana-c6 { display: none; } }\
      '}</style>
      <div style={{ background: HERMES, height: 48, display: 'flex', alignItems: 'stretch', flexShrink: 0 }}>

        {/* ═══ LEFT ZONE: flexible, tabs shrink via CSS ═══ */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'stretch', overflow: 'hidden' }}>

          {/* Back + Brand */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px 0 20px', borderRight: '1px solid rgba(255,255,255,.15)', flexShrink: 0 }}>
            <Link href="/analyze" style={{ fontSize: 14, color: 'rgba(255,255,255,.7)', textDecoration: 'none', fontWeight: 600 }}>{'\u2190'}</Link>
            <div style={{ width: 24, height: 24, borderRadius: 6, background: 'rgba(255,255,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 900, color: 'white' }}>A</div>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'white', letterSpacing: '-.3px' }}>Ana</span>
          </div>

          {/* Module tabs — progressively collapse labels right-to-left */}
          {TABS.filter(function(tab) {
            if (tab.sources && tab.sources.indexOf(dataset.source) < 0) return false
            if (tab.minOutlets && outletCount < tab.minOutlets) return false
            return true
          }).map(function(tab) {
            var isActive = activeTab === tab.key
            var href = '/analyze/' + dataset.id + '/' + tab.key
            return (
              <Link key={tab.key} href={href} className={'ana-tab ana-c' + tab.collapse} title={tab.label}
                style={{
                  height: '100%', display: 'flex', alignItems: 'center',
                  fontSize: 13, fontWeight: isActive ? 700 : 500, textDecoration: 'none',
                  color: isActive ? 'white' : 'rgba(255,255,255,.65)',
                  background: isActive ? 'rgba(255,255,255,.18)' : 'transparent',
                  borderBottom: isActive ? '3px solid white' : '3px solid transparent',
                  whiteSpace: 'nowrap', flexShrink: 0,
                }}>
                <span>{tab.icon}</span><span className="ana-lbl" style={{ marginLeft: 5 }}>{tab.label}</span>
              </Link>
            )
          })}

          {/* Filters button */}
          <button onClick={onFilterClick} className="ana-tab ana-c5" title={'Filters' + (filterCount > 0 ? ' (' + filterCount + ')' : '')}
            style={{
              height: '100%', display: 'flex', alignItems: 'center', gap: 5,
              fontSize: 13, fontWeight: filterCount > 0 ? 700 : 500,
              color: filterCount > 0 ? 'white' : 'rgba(255,255,255,.65)',
              background: filterCount > 0 ? 'rgba(255,255,255,.18)' : 'transparent',
              border: 'none', borderBottom: filterCount > 0 ? '3px solid white' : '3px solid transparent',
              cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
            }}>
            {filterCount > 0 && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#fde68a', flexShrink: 0 }} />}
            <span>{'\u25BD'}</span><span className="ana-lbl">Filters{filterCount > 0 ? ' (' + filterCount + ')' : ''}</span>
          </button>

          {/* Ask Ana — hidden when the org has disabled AI entirely. */}
          {aiEnabled && !aiDisabledByOrg && onAskAna && (
            <button onClick={onAskAna} className="ana-tab ana-c6" title="Ask Ana"
              style={{
                height: '100%', display: 'flex', alignItems: 'center', gap: 5,
                fontSize: 13, fontWeight: askAnaOpen ? 700 : 500,
                color: askAnaOpen ? 'white' : 'rgba(255,255,255,.65)',
                background: askAnaOpen ? 'rgba(255,255,255,.18)' : 'transparent',
                border: 'none', borderBottom: askAnaOpen ? '3px solid white' : '3px solid transparent',
                cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
              }}>
              <span>{'\uD83D\uDCAC'}</span><span className="ana-lbl">Ask Ana</span>
            </button>
          )}

          {/* Search */}
          <button onClick={function() { setShowSearch(true) }} className="ana-tab ana-c6" title="Search"
            style={{
              height: '100%', display: 'flex', alignItems: 'center', gap: 5,
              fontSize: 13, fontWeight: showSearch ? 700 : 500,
              color: showSearch ? 'white' : 'rgba(255,255,255,.65)',
              background: showSearch ? 'rgba(255,255,255,.18)' : 'transparent',
              border: 'none', borderBottom: showSearch ? '3px solid white' : '3px solid transparent',
              cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
            }}>
            <span>{'\uD83D\uDD0D'}</span><span className="ana-lbl">Search</span>
          </button>

          {/* Report \u2014 hidden when the org has AI off. When a deck is available the
              button runs it DIRECTLY (the common case) and a caret \u25BE opens the full
              picker (Operational Review, ad-hoc, \u2026); a collection (no deck) makes the
              button the picker toggle. Run from here, the deck honors the in-view scope. */}
          {!aiDisabledByOrg && datasetReports.length > 0 && (
            <div ref={reportAnchorRef} style={{ position: 'relative', display: 'flex' }}>
              <button onClick={handleReportClick} className="ana-tab ana-c7"
                title={deckReport ? 'Build the full report from this view' : 'Build a report from this view'}
                style={{
                  height: '100%', display: 'flex', alignItems: 'center', gap: 5,
                  fontSize: 13, fontWeight: reportMenuOpen ? 700 : 500,
                  color: reportMenuOpen ? 'white' : 'rgba(255,255,255,.65)',
                  background: reportMenuOpen ? 'rgba(255,255,255,.18)' : 'transparent',
                  border: 'none', borderBottom: reportMenuOpen ? '3px solid white' : '3px solid transparent',
                  cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                  paddingRight: showReportCaret ? 4 : undefined,
                }}>
                <span>{'\uD83D\uDCCA'}</span><span className="ana-lbl">Reports</span>
              </button>
              {showReportCaret && (
                <button type="button" onClick={toggleReportMenu}
                  title="More report options" aria-label="More report options"
                  style={{
                    height: '100%', display: 'flex', alignItems: 'center', padding: '0 8px 0 2px',
                    fontSize: 11, color: reportMenuOpen ? 'white' : 'rgba(255,255,255,.6)',
                    background: reportMenuOpen ? 'rgba(255,255,255,.18)' : 'transparent',
                    border: 'none', borderBottom: reportMenuOpen ? '3px solid white' : '3px solid transparent',
                    cursor: 'pointer', flexShrink: 0,
                  }}>{'\u25BE'}</button>
              )}
              {reportMenuOpen && reportMenuPos && (
                <>
                  <div onClick={function() { setReportMenuOpen(false) }}
                    style={{ position: 'fixed', inset: 0, zIndex: 2099 }} />
                  <div style={{
                    position: 'fixed', top: reportMenuPos.top, left: reportMenuPos.left, zIndex: 2100,
                    minWidth: 260, background: 'white', borderRadius: 10,
                    boxShadow: '0 10px 30px rgba(0,0,0,.18)', border: '1px solid #e5e7eb',
                    paddingTop: 6, paddingBottom: 6, color: '#111827',
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.06em', padding: '4px 14px 4px' }}>Reports</div>
                    <ReportsMenu ctx={reportCtx} onLaunch={(type, format) => { void handleReportLaunch(type, format) }} />
                  </div>
                </>
              )}
            </div>
          )}

          {/* Share Analytics */}
          <button onClick={function() { setShowShareAnalytics(true) }} className="ana-tab ana-c8" title="Share Analytics"
            style={{
              height: '100%', display: 'flex', alignItems: 'center', gap: 5,
              fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,.65)',
              background: 'transparent', border: 'none', borderBottom: '3px solid transparent',
              cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
            }}>
            <span>{'\uD83D\uDD17'}</span><span className="ana-lbl">Share</span>
          </button>

          {/* Save Session */}
          <button onClick={function() { if (onSaveSession) onSaveSession() }} disabled={sessionSaving} className="ana-tab ana-c9" title={sessionSaving ? 'Saving...' : sessionSaved ? 'Saved' : 'Save Session'}
            style={{
              height: '100%', display: 'flex', alignItems: 'center', gap: 5,
              fontSize: 13, fontWeight: sessionSaved ? 700 : 500,
              color: sessionSaved ? 'white' : 'rgba(255,255,255,.65)',
              background: sessionSaved ? 'rgba(255,255,255,.18)' : 'transparent',
              border: 'none', borderBottom: '3px solid transparent',
              cursor: sessionSaving ? 'wait' : 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
            }}>
            <span>{sessionSaving ? '\u23F3' : sessionSaved ? '\u2714' : '\uD83D\uDCBE'}</span><span className="ana-lbl">{sessionSaving ? 'Saving...' : sessionSaved ? 'Saved' : 'Save'}</span>
          </button>
        </div>

        {/* ═══ RIGHT ZONE: fixed, always visible ═══ */}
        <div style={{ display: 'flex', alignItems: 'stretch', flexShrink: 0, borderLeft: '1px solid rgba(255,255,255,.15)' }}>

          {/* Source pill */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', borderRight: '1px solid rgba(255,255,255,.15)', flexShrink: 0 }}>
            <span style={{
              fontSize: 10, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase',
              borderRadius: 20, padding: '2px 8px', whiteSpace: 'nowrap',
              background: srcBg, color: srcColor, border: srcBorder,
            }}>
              {srcLabel}
            </span>
          </div>

          {/* Row count + Sync + Last synced */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', borderRight: '1px solid rgba(255,255,255,.15)', flexShrink: 0 }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,.6)', whiteSpace: 'nowrap' }}
              title={filteredRowCountIsEstimate ? 'Estimated from a 50K-row sample, scaled to the full dataset' : ''}>
              {filteredRowCount != null
                ? (filteredRowCountIsEstimate ? '≈' : '') + filteredRowCount.toLocaleString() + ' of ' + dataset.row_count.toLocaleString()
                : dataset.row_count.toLocaleString()} rows
            </span>
            {substantivePct != null && (
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,.6)', whiteSpace: 'nowrap' }}
                title={'Share of answered rows (any open-ended field filled in) whose text carries usable feedback — "N/A"/"Nothing"/one-word non-answers are excluded. Updates with the active filter. This is a text-insight lens; rating averages, counts and exports still use every row.'}>
                <span style={{ color: 'rgba(255,255,255,.35)' }}>· </span>
                <strong style={{ color: 'rgba(255,255,255,.85)', fontWeight: 700 }}>{substantivePct}%</strong> substantive
              </span>
            )}
            {(dataset.source === 'study' || dataset.source === 'townhall') && (
              <button onClick={() => { void handleResync() }} disabled={syncing}
                title={dataset.last_synced_at ? 'Last synced: ' + new Date(dataset.last_synced_at).toLocaleString() : 'Sync new data from source'}
                style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: 'rgba(255,255,255,.15)', color: 'white', border: '1px solid rgba(255,255,255,.25)', cursor: syncing ? 'wait' : 'pointer', opacity: syncing ? 0.6 : 1, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
                {syncing ? 'Syncing...' : '\u21BB Sync'}
              </button>
            )}
            {dataset.source === 'google_reviews' && (
              <button onClick={() => { void handleReviewSync() }} disabled={reviewSyncing}
                title={dataset.last_synced_at ? 'Last synced: ' + new Date(dataset.last_synced_at).toLocaleString() : 'Sync new reviews'}
                style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: 'rgba(255,255,255,.15)', color: 'white', border: '1px solid rgba(255,255,255,.25)', cursor: reviewSyncing ? 'wait' : 'pointer', opacity: reviewSyncing ? 0.6 : 1, whiteSpace: 'nowrap' }}>
                {reviewSyncing ? 'Syncing...' : '\u21BB Sync Reviews'}
              </button>
            )}
            {dataset.last_synced_at && (dataset.source === 'study' || dataset.source === 'townhall' || dataset.source === 'google_reviews') && (
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,.4)', whiteSpace: 'nowrap' }}>
                {(() => {
                  var d = new Date(dataset.last_synced_at!)
                  var mins = Math.round((Date.now() - d.getTime()) / 60000)
                  return mins < 1 ? 'just now' : mins < 60 ? mins + 'm ago' : mins < 1440 ? Math.floor(mins / 60) + 'h ago' : Math.floor(mins / 1440) + 'd ago'
                })()}
              </span>
            )}
          </div>

          {/* AI toggle \u2014 customer orgs piggyback on the platform's
              Anthropic key by default; usage is logged per-org in
              usage_log. The tiny gear opens a prompt for a custom
              key that overrides the platform one for this browser
              (used when an operator wants to bring their own quota).
              When the org admin has set AI mode='off', the user-level
              toggle is replaced with a static \u201CDisabled by admin\u201D pill. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 16px', flexShrink: 0 }}>
            {aiDisabledByOrg ? (
              <span title="AI is disabled for your organization by an admin. Contact your administrator to enable AI features."
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 11px', fontSize: 12, fontWeight: 600, background: 'rgba(0,0,0,.25)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 20, color: 'rgba(255,255,255,.7)', whiteSpace: 'nowrap', cursor: 'help' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
                AI disabled by admin
              </span>
            ) : (
              <>
                <button
                  onClick={() => { void (async function() {
                    if (aiToggling || orgAi.loading) return
                    setAiToggling(true)
                    var result = await orgAi.setUserEnabled(!aiEnabled)
                    setAiToggling(false)
                    if (!result.ok && result.error) alert(result.error)
                  })() }}
                  disabled={aiToggling || orgAi.loading}
                  title={
                    orgAi.loading
                      ? 'Loading your AI preference…'
                      : aiEnabled
                        ? 'AI is enabled for your account. Click to turn off. Every change is logged for compliance.'
                        : 'AI is disabled for your account. Click to opt in. Every change is logged for compliance.'
                  }
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 11px', fontSize: 12, fontWeight: 600, background: aiEnabled ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.2)', border: '1px solid ' + (aiEnabled ? 'rgba(255,255,255,.3)' : 'rgba(255,255,255,.15)'), borderRadius: 20, color: 'white', cursor: (aiToggling || orgAi.loading) ? 'wait' : 'pointer', whiteSpace: 'nowrap', opacity: (aiToggling || orgAi.loading) ? 0.65 : 1 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: aiEnabled ? '#4ade80' : '#94a3b8', display: 'inline-block' }} />
                  {orgAi.loading ? 'AI …' : aiEnabled ? 'AI on' : 'AI off'}
                </button>
                <button onClick={function() {
                  var key = prompt(apiKey
                    ? 'Custom Anthropic key (leave blank to use platform key):'
                    : 'Optional: paste your own Anthropic key to override the platform key. Leave blank to keep using the platform key.', apiKey || '')
                  if (key === null) return
                  setApiKey(key)
                  try {
                    if (key) localStorage.setItem('sentimetrx_tm_apikey', key)
                    else localStorage.removeItem('sentimetrx_tm_apikey')
                  } catch {}
                }}
                  title={apiKey ? 'Custom key set \u2014 click to edit or clear' : 'Optional: use your own Anthropic key'}
                  style={{ padding: '4px 9px', fontSize: 11, fontWeight: 600, background: apiKey ? 'rgba(255,255,255,.2)' : 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)', borderRadius: 20, color: 'rgba(255,255,255,.8)', cursor: 'pointer' }}>
                  {apiKey ? '\uD83D\uDD11' : '\u2699'}
                </button>
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
