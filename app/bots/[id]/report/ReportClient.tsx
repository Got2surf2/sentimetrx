'use client'

// app/bots/[id]/report/ReportClient.tsx
// Interactive Agent Study report. Renders the analysis object from
// /api/bots/[id]/study with expand/collapse drill-down into real conversation
// snippets, plus a PPTX export of the same object. Replaces the old
// conversations-page "Deck" + "Mine Conversations" buttons.

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import type { AgentStudy } from '@/lib/agentStudy'
import { renderAgentStudyHtml } from '@/lib/agentStudyHtml'
import LottieLoader from '@/components/ui/LottieLoader'

const TEAL = '#0F7173'
const INK = '#111827'
const MUTE = '#6b7280'
const DOT_COLOR: Record<string, string> = { green: '#059669', amber: '#D97706', red: '#DC2626', idle: '#9CA3AF' }

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtRel(iso: string | null): string {
  if (!iso) return 'never'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return days + 'd ago'
  return fmtDate(iso)
}

// Conversation-depth chip styling for open questions — deeper (more engaged)
// conversations get a stronger teal so the high-value gaps stand out.
function depthChip(pairs: number): { bg: string; fg: string; label: string } {
  const label = '💬 ' + pairs + ' exchange' + (pairs === 1 ? '' : 's')
  if (pairs >= 7) return { bg: '#0F7173', fg: '#ffffff', label }
  if (pairs >= 4) return { bg: '#99E2DD', fg: '#0B5450', label }
  if (pairs >= 2) return { bg: '#CCFBF1', fg: '#0F766E', label }
  return { bg: '#F3F4F6', fg: '#9CA3AF', label }
}

const card: React.CSSProperties = { background: 'white', border: '1px solid #e5e7eb', borderRadius: 14, padding: '18px 20px', marginBottom: 16 }
const h2: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: INK, marginBottom: 12 }

function Bar({ value, max, color = TEAL }: { value: number; max: number; color?: string }) {
  return (
    <div style={{ height: 8, background: '#F1F3F5', borderRadius: 6, overflow: 'hidden', flex: 1 }}>
      <div style={{ width: (max > 0 ? Math.round((value / max) * 100) : 0) + '%', height: '100%', background: color, borderRadius: 6 }} />
    </div>
  )
}

export default function ReportClient() {
  const params = useParams()
  const router = useRouter()
  const botId = params.id as string
  const [study, setStudy] = useState<AgentStudy | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [shareState, setShareState] = useState<'idle' | 'sharing' | 'copied' | 'error'>('idle')
  const [pdfState, setPdfState] = useState<'idle' | 'working'>('idle')

  async function load(force = false) {
    if (force) setRefreshing(true); else setLoading(true)
    setError('')
    try {
      const r = await fetch('/api/bots/' + botId + '/study' + (force ? '?force=1' : ''))
      if (!r.ok) { const d = await r.json().catch(() => ({})); setError(d.error || 'Failed to load study'); return }
      const d = await r.json()
      setStudy(d.study)
    } catch { setError('Failed to load study') }
    finally { setLoading(false); setRefreshing(false) }
  }
  useEffect(() => { load() }, [botId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function exportPptx() {
    setExporting(true)
    try {
      const r = await fetch('/api/bots/' + botId + '/study/pptx', { method: 'POST' })
      if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Export failed'); return }
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = (study?.bot.name || 'Agent') + '_Agent_Study.pptx'; a.click(); URL.revokeObjectURL(url)
    } catch { alert('Export failed') }
    finally { setExporting(false) }
  }

  // Share = bake the current study into a self-contained HTML snapshot and POST
  // it to /api/share as an agent_study link. The recipient sees a frozen copy
  // of this report (drill-downs and all) at /shared/agent-study/[token] — no
  // login, no live recompute. URL is copied to the clipboard.
  async function shareReport() {
    if (!study) return
    setShareState('sharing')
    try {
      const html = renderAgentStudyHtml(study)
      const r = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'agent_study', target_id: botId, html, expires_in: '30d' }),
      })
      const d = await r.json().catch(() => ({}))
      if (d.url) {
        try { await navigator.clipboard.writeText(d.url) } catch { /* clipboard may be blocked; link still created */ }
        setShareState('copied')
        setTimeout(() => setShareState('idle'), 3000)
      } else {
        setShareState('error')
        setTimeout(() => setShareState('idle'), 3000)
      }
    } catch {
      setShareState('error')
      setTimeout(() => setShareState('idle'), 3000)
    }
  }

  // Download PDF = server-rendered, pixel-faithful PDF of the report (headless
  // Chrome page.pdf() on the baked HTML), delivered as a real file download — no
  // browser print dialog. The baked HTML's print rule strips every drill-down,
  // so the PDF is a flat summary with NO conversation snippets.
  async function downloadPdf() {
    setPdfState('working')
    try {
      const r = await fetch('/api/bots/' + botId + '/study/pdf', { method: 'POST' })
      if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'PDF generation failed'); return }
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = (study?.bot.name || 'Agent') + '_Agent_Study.pdf'; a.click(); URL.revokeObjectURL(url)
    } catch { alert('PDF generation failed') }
    finally { setPdfState('idle') }
  }

  if (loading) {
    return <div style={{ maxWidth: 1100, margin: '0 auto', padding: '64px 24px', textAlign: 'center' }}>
      <LottieLoader message="Building the agent study…" />
    </div>
  }
  if (error || !study) {
    return <div style={{ maxWidth: 1100, margin: '0 auto', padding: '48px 24px' }}>
      <button onClick={() => router.push('/bots')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: MUTE, marginBottom: 16 }}>&larr; Agents</button>
      <div style={{ ...card, textAlign: 'center', color: MUTE }}>{error || 'No data'}</div>
    </div>
  }

  const s = study
  const t = s.totals
  const depthMax = Math.max(...s.depth.map(d => d.sessions), t.abandonedNoInput, t.openedNotEngaged || 0, 1)
  const focusMax = Math.max(...s.focuses.map(f => f.exchanges), 1)
  const langMax = Math.max(...s.languages.map(l => l.sessions), 1)
  const intentMax = Math.max(...s.intents.map(i => i.detections), 1)
  const entMax = Math.max(...s.entities.map(e => e.mentions), 1)
  const dailyActive = s.health.dailyActivity.filter(d => d.conversations > 0 || d.opens > 0).slice(-21)
  const dailyMax = Math.max(...dailyActive.map(d => Math.max(d.conversations, d.opens)), 1)
  // Bar width scales to the number of days: fat bars when there are only a few,
  // capped so a 3-week span stays readable. (Was a fixed thin 7px.)
  const barW = Math.max(12, Math.min(40, Math.round(560 / dailyActive.length)))
  // The widget-open beacon starts logging at deploy, so until it has recorded
  // at least as many opens as we have conversations, its data is incomplete —
  // hide Widget Opens + Response Rate (and the opens overlay) rather than show a
  // misleading "1 open / 3600%". They reappear automatically once real opens accrue.
  const showOpens = t.impressions != null && t.impressions >= t.totalSessions

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 24px 64px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <button onClick={() => router.push('/bots')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: MUTE }}>&larr; Agents</button>
        <div style={{ flex: 1, minWidth: 200, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: DOT_COLOR[s.health.dot], display: 'inline-block', flexShrink: 0 }} title={'Health: ' + s.health.dot} />
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: INK }}>{s.bot.name} — Agent Study</h1>
            <p style={{ fontSize: 12, color: MUTE, marginTop: 2 }}>{fmtDate(s.range.first)} – {fmtDate(s.range.last)} · {s.range.activeDays} active days · last active {fmtRel(s.health.lastActiveAt)}</p>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <span style={{ fontWeight: 800, fontSize: 17, letterSpacing: '-0.3px', whiteSpace: 'nowrap' }}><span style={{ color: '#0F7173' }}>data</span><span style={{ color: '#E8632A' }}>nautix</span></span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button onClick={() => router.push('/bots/' + botId + '/conversations')} style={{ padding: '8px 16px', borderRadius: 20, border: '1px solid #d1d5db', background: 'white', color: '#374151', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Transcripts</button>
          <button onClick={() => load(true)} disabled={refreshing} style={{ padding: '8px 16px', borderRadius: 20, border: '1px solid #d1d5db', background: 'white', color: '#374151', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: refreshing ? 0.6 : 1 }}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>
          <button onClick={shareReport} disabled={shareState === 'sharing'} title="Create a read-only snapshot link of this report" style={{ padding: '8px 16px', borderRadius: 20, border: '1px solid #d1d5db', background: shareState === 'copied' ? '#ECFDF5' : 'white', color: shareState === 'copied' ? '#059669' : '#374151', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: shareState === 'sharing' ? 0.6 : 1 }}>{shareState === 'sharing' ? 'Sharing…' : shareState === 'copied' ? '✓ Link copied' : shareState === 'error' ? 'Failed — retry' : 'Share'}</button>
          <button onClick={downloadPdf} disabled={pdfState === 'working'} title="Download a flat PDF (summary only — no conversation drill-downs)" style={{ padding: '8px 16px', borderRadius: 20, border: '1px solid #d1d5db', background: 'white', color: '#374151', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: pdfState === 'working' ? 0.6 : 1 }}>{pdfState === 'working' ? 'Generating…' : 'PDF'}</button>
          <button onClick={exportPptx} disabled={exporting} style={{ padding: '8px 16px', borderRadius: 20, border: 'none', background: TEAL, color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: exporting ? 0.6 : 1 }}>{exporting ? 'Exporting…' : 'Export PPTX'}</button>
          </div>
        </div>
      </div>

      {/* ── Act 1: Status ── */}
      <div style={card}>
        <div style={h2}>Overview</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          {[
            { v: t.totalSessions, l: 'Conversations', sub: 'all sessions' },
            { v: t.conversations, l: 'Useful Conversations', sub: 'of ' + t.totalSessions + ' total' },
            ...(t.answerRatePct != null ? [{ v: t.answerRatePct + '%', l: 'Answer Rate', sub: t.answeredPairs + ' of ' + t.totalPairs + ' answered', color: '#059669' }] : []),
            { v: t.totalPairs, l: 'Q&A Pairs' },
            { v: s.health.medianPairs, l: 'Median Depth', sub: 'pairs' },
            { v: s.openQuestions.total, l: 'Open Questions', sub: 'unanswered', color: s.openQuestions.total > 0 ? '#DC2626' : INK },
            ...(showOpens ? [
              { v: s.health.responseRatePct != null ? s.health.responseRatePct + '%' : '—', l: 'Response Rate', sub: s.health.responseRatePct != null ? 'engaged of opens (7d)' : 'gathering open data' },
              { v: t.impressions as number, l: 'Widget Opens' },
            ] : []),
          ].map((k, i) => (
            <div key={i} style={{ background: '#F9FAFB', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: (k as any).color || INK }}>{k.v}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginTop: 2 }}>{k.l}</div>
              {(k as any).sub && <div style={{ fontSize: 10, color: MUTE }}>{(k as any).sub}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Engagement & Depth */}
      <div style={card}>
        <div style={h2}>Engagement & Depth</div>
        <p style={{ fontSize: 12, color: MUTE, marginBottom: 12 }}>Useful conversations by Q&A-pair count (greeting preamble + one-word taps excluded).</p>
        {s.depth.map(d => (
          <div key={d.bucket} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <span style={{ width: 80, fontSize: 12, color: '#374151', textAlign: 'right' }}>{d.bucket} pair{d.bucket === '1' ? '' : 's'}</span>
            <Bar value={d.sessions} max={depthMax} />
            <span style={{ width: 36, fontSize: 12, fontWeight: 600, color: INK }}>{d.sessions}</span>
          </div>
        ))}
        {(t.initiatedNotEntered > 0 || t.abandonedNoInput > 0 || t.flaggedExcluded > 0 || (t.openedNotEngaged ?? 0) > 0) && (
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed #e5e7eb', fontSize: 11, color: MUTE, lineHeight: 1.5 }}>
            <strong>{t.conversations + t.initiatedNotEntered + t.abandonedNoInput + t.flaggedExcluded}</strong> sessions recorded: <strong>{t.conversations}</strong> useful
            {t.initiatedNotEntered > 0 && <> · <strong>{t.initiatedNotEntered}</strong> initiated but one-word only (tapped a suggestion / replied "yes")</>}
            {t.abandonedNoInput > 0 && <> · <strong>{t.abandonedNoInput}</strong> with no real message (e.g. opened, switched language, never typed)</>}
            {t.flaggedExcluded > 0 && <> · <strong>{t.flaggedExcluded}</strong> flagged for review (troll / bot / off-topic) — kept in the database, out of the report</>}
            . The non-useful groups are excluded from analysis.
            {t.openedNotEngaged != null && t.openedNotEngaged > 0 && <> Separately, <strong>{t.openedNotEngaged}</strong> widget open{t.openedNotEngaged !== 1 ? 's' : ''} never became a conversation at all.</>}
          </div>
        )}
      </div>

      {/* Activity over time */}
      {dailyActive.length > 1 && (
        <div style={card}>
          <div style={h2}>Activity Over Time</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 120, padding: '8px 0' }}>
            {dailyActive.map(d => (
              <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }} title={d.date + ': ' + d.conversations + ' conversations' + (showOpens ? ', ' + d.opens + ' opens' : '')}>
                <div style={{ width: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 3, height: 90 }}>
                  {showOpens && <div style={{ width: Math.max(6, Math.round(barW * 0.5)), height: Math.round((d.opens / dailyMax) * 90) + 'px', background: '#D7E3E3', borderRadius: 3 }} />}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end' }}>
                    {d.conversations > 0 && <span style={{ fontSize: 9, fontWeight: 700, color: INK, lineHeight: 1, marginBottom: 2 }}>{d.conversations}</span>}
                    <div style={{ width: barW, height: Math.max(2, Math.round((d.conversations / dailyMax) * 90)) + 'px', background: TEAL, borderRadius: 3 }} />
                  </div>
                </div>
                <span style={{ fontSize: 9, color: MUTE }}>{d.date.slice(5)}</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10, color: MUTE }}>{showOpens ? 'Teal = conversations · light = widget opens' : 'Conversations started per day'}</div>
        </div>
      )}

      {/* ── Act 2: Topics ── */}
      {s.focuses.length > 0 && (
        <div style={card}>
          <div style={h2}>Areas of Focus</div>
          <p style={{ fontSize: 12, color: MUTE, marginBottom: 12 }}>Each question is tagged to one focus; its paired answer carries the same focus. Expand to read real exchanges.</p>
          {s.focuses.map(f => (
            <details key={f.slug} style={{ borderBottom: '1px solid #f3f4f6', padding: '8px 0' }}>
              <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, listStyle: 'none' }}>
                <span style={{ width: 200, fontSize: 13, fontWeight: 600, color: INK }}>{f.label}</span>
                <Bar value={f.exchanges} max={focusMax} />
                <span style={{ width: 80, fontSize: 11, color: MUTE, textAlign: 'right' }}>{f.exchanges} · {f.sessions} conv</span>
                <span style={{ fontSize: 10, display: 'flex', gap: 4 }}>
                  <span style={{ color: '#059669' }}>+{f.sentiment.positive}</span>
                  <span style={{ color: MUTE }}>{f.sentiment.neutral}</span>
                  <span style={{ color: '#DC2626' }}>−{f.sentiment.negative}</span>
                </span>
              </summary>
              <div style={{ paddingLeft: 12, marginTop: 8 }}>
                {f.entities.length > 0 && (
                  <div style={{ fontSize: 11, color: MUTE, marginBottom: 8 }}>Entities here: {f.entities.map(e => e.name + ' (' + e.mentions + ')').join(', ')}</div>
                )}
                {f.samples.map((sm, i) => (
                  <div key={i} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, color: '#0369A1', background: '#E0F2FE', padding: '1px 6px', borderRadius: 6, height: 'fit-content', flexShrink: 0 }}>USER{sm.language !== 'en' ? ' · ' + sm.language : ''}</span>
                      <span style={{ fontSize: 12, color: INK }}>{sm.question}</span>
                    </div>
                    {sm.answer && <div style={{ display: 'flex', gap: 6, marginTop: 3 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, color: '#374151', background: '#F3F4F6', padding: '1px 6px', borderRadius: 6, height: 'fit-content', flexShrink: 0 }}>{s.bot.name.toUpperCase().slice(0, 8)}</span>
                      <span style={{ fontSize: 12, color: '#374151' }}>{sm.answer}</span>
                    </div>}
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}

      {/* Entities */}
      {s.entities.length > 0 && (
        <div style={card}>
          <div style={h2}>Entity Analysis</div>
          <p style={{ fontSize: 12, color: MUTE, marginBottom: 12 }}>Specific things users named — by mention count, with the focus areas they came up under.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
            {s.entities.slice(0, 24).map(e => (
              <div key={e.name} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#F9FAFB', borderRadius: 8, padding: '6px 10px' }}>
                <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.focuses.join(', ')}>{e.name}</span>
                <Bar value={e.mentions} max={entMax} />
                <span style={{ width: 24, fontSize: 12, fontWeight: 700, color: TEAL, textAlign: 'right' }}>{e.mentions}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Intents + Languages side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        {s.intents.some(i => i.detections > 0) && (
          <div style={card}>
            <div style={h2}>Intents Detected</div>
            {s.intents.filter(i => i.detections > 0).map(i => (
              <div key={i.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ width: 120, fontSize: 12, color: '#374151' }}>{i.label}</span>
                <Bar value={i.detections} max={intentMax} color="#1D4ED8" />
                <span style={{ width: 70, fontSize: 11, color: MUTE, textAlign: 'right' }}>{i.detections} · {i.sessions} conv</span>
              </div>
            ))}
          </div>
        )}
        {s.languages.length > 1 && (
          <div style={card}>
            <div style={h2}>Conversations by Language</div>
            <p style={{ fontSize: 11, color: MUTE, marginBottom: 10 }}>Non-English analyzed on translated text.</p>
            {s.languages.map(l => (
              <div key={l.language} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ width: 50, fontSize: 12, fontWeight: 600, color: '#374151' }}>{l.language.toUpperCase()}</span>
                <Bar value={l.sessions} max={langMax} color="#E8B84B" />
                <span style={{ width: 70, fontSize: 11, color: MUTE, textAlign: 'right' }}>{l.sessions} · {l.pct}%</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Act 3: Gaps ── */}
      {s.openQuestions.total > 0 && (
        <div style={card}>
          <div style={h2}>Open Questions <span style={{ fontSize: 12, fontWeight: 400, color: MUTE }}>({s.openQuestions.total})</span></div>
          <p style={{ fontSize: 12, color: MUTE, marginBottom: 12 }}>Questions the agent couldn&rsquo;t answer, with the conversation context. Curate them on the Questions page — mark each Answered, Referred, or N/A to clear it from this count. Expand each for the full exchange.</p>
          {s.openQuestions.open.map((q, i) => (
            <details key={i} style={{ borderBottom: '1px solid #f3f4f6', padding: '8px 0' }}>
              <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, listStyle: 'none' }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: '#92400E', background: '#FEF3C7', padding: '1px 6px', borderRadius: 6, flexShrink: 0 }}>{q.classification.replace(/_/g, ' ')}</span>
                {(() => { const d = depthChip(q.sessionPairs); return <span title="How deep the conversation was — deeper chats that still hit a wall are higher-value gaps" style={{ fontSize: 9, fontWeight: 700, color: d.fg, background: d.bg, padding: '1px 6px', borderRadius: 6, flexShrink: 0, whiteSpace: 'nowrap' }}>{d.label}</span> })()}
                <span style={{ fontSize: 13, color: INK }}>{q.question}</span>
              </summary>
              <div style={{ paddingLeft: 12, marginTop: 6, fontSize: 12, color: MUTE, lineHeight: 1.5 }}>
                {q.context && <div style={{ marginBottom: 4 }}><span style={{ fontSize: 9, fontWeight: 700, color: '#374151', background: '#F3F4F6', padding: '1px 6px', borderRadius: 6 }}>{s.bot.name.toUpperCase().slice(0, 8)} BEFORE</span> <span style={{ color: '#374151' }}>{q.context.slice(0, 240)}</span></div>}
                <div style={{ marginBottom: 4 }}><span style={{ fontSize: 9, fontWeight: 700, color: '#0369A1', background: '#E0F2FE', padding: '1px 6px', borderRadius: 6 }}>USER{q.language && q.language !== 'en' ? ' · ' + q.language : ''}</span> <span style={{ color: '#374151' }}>{q.question}</span></div>
                {q.after && <div style={{ marginBottom: 4 }}><span style={{ fontSize: 9, fontWeight: 700, color: '#374151', background: '#F3F4F6', padding: '1px 6px', borderRadius: 6 }}>{s.bot.name.toUpperCase().slice(0, 8)} AFTER</span> <span style={{ color: '#374151' }}>{q.after.slice(0, 280)}</span></div>}
                Logged {fmtDate(q.createdAt)}
                {q.suggestedKb && <div style={{ marginTop: 4, color: '#374151' }}><strong>Suggested KB addition:</strong> {q.suggestedKb}</div>}
              </div>
            </details>
          ))}
          {s.openQuestions.total > s.openQuestions.open.length && (
            <div style={{ marginTop: 10, fontSize: 11, color: MUTE }}>
              Showing the {s.openQuestions.open.length} most recent of <strong>{s.openQuestions.total}</strong> open questions. Triage the full queue on the Questions page.
            </div>
          )}
        </div>
      )}

      {/* Insights */}
      {(s.insights.commonQuestions.length > 0 || s.insights.knowledgeGaps.length > 0 || s.insights.recommendations.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
          {[
            { title: 'Most Common Topics', items: s.insights.commonQuestions },
            { title: 'Knowledge Gaps', items: s.insights.knowledgeGaps },
            { title: 'Recommendations', items: s.insights.recommendations },
          ].filter(b => b.items.length > 0).map(b => (
            <div key={b.title} style={card}>
              <div style={h2}>{b.title}</div>
              <div>
                {b.items.map((it, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 0', borderTop: i > 0 ? '1px solid #f3f4f6' : 'none' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: TEAL, marginTop: 6, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: '#374151', lineHeight: 1.5 }}>{it}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Quotes */}
      {s.insights.topQuotes.length > 0 && (
        <div style={card}>
          <div style={h2}>In Their Words</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 10 }}>
            {s.insights.topQuotes.map((q, i) => (
              <div key={i} style={{ borderLeft: '3px solid ' + TEAL, paddingLeft: 12, fontSize: 12, color: '#374151', fontStyle: 'italic', lineHeight: 1.5 }}>&ldquo;{q}&rdquo;</div>
            ))}
          </div>
        </div>
      )}

      {/* ── Act 4: Methodology ── */}
      <div style={{ ...card, background: '#F9FAFB' }}>
        <div style={h2}>Methodology & Provenance</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: MUTE }}>
          <li style={{ marginBottom: 4 }}>{s.meta.classifiedExchanges} Q&A pairs classified; {s.meta.excludedZeroPair} input-less session(s) excluded.</li>
          <li style={{ marginBottom: 4 }}>{s.meta.method}</li>
          <li style={{ marginBottom: 4 }}>{showOpens ? 'Widget opens tracked via on-mount beacon → true invocation + response rate.' : 'Widget-open beacon active going forward; response rate populates as opens accrue.'}</li>
          <li>Generated {fmtRel(s.generatedAt)}. Refresh recomputes against the latest conversations.</li>
        </ul>
      </div>
    </div>
  )
}
