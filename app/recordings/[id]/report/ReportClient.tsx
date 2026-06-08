'use client'

// app/recordings/[id]/report/ReportClient.tsx
//
// Recording report tabs (§ 5.4). Server fetches the full data tree once; this
// component owns the tab navigation, card expand/collapse, and transcript
// search. Per-card regenerate, the per-topic re-extract menu, the full
// re-extract "⋯ More" menu, and the audio modal player are stubbed pending
// § 4.5 / § 4.6 / § 4.10 / § 4.11 routes — the affordances render but their
// click handlers show a "not yet wired" tooltip rather than firing.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import LottieLoader from '@/components/ui/LottieLoader'
import type {
  RecordingRow,
  RecordingFileRow,
  RecordingTranscriptRow,
  RecordingExtractionRow,
  QaPairPayload,
  ActionItemPayload,
  TranscriptSegment,
  QaSetupInputs,
  EntityMap,
  Signoff,
} from '@/lib/recordings/types'
import TranscriptComparisonTab from './TranscriptComparisonTab'
import { buildReplacements, normalizeSegments } from '@/lib/recordings/normalize'
import { displayQuestion, displayAnswer, isEdited } from '@/lib/recordings/qaDisplay'
import { computeCoverage } from '@/lib/recordings/coverage'
import { buildTranscriptRoles, traceActionItem } from '@/lib/recordings/transcriptRoles'
import { packLanes, laneTop, barHeight, LANE_H } from '@/lib/recordings/timeline'

// A request to open the audio modal at a given point. `nonce` forces a re-seek
// even when two Play buttons share the same start_sec.
export interface AudioRequest {
  startSec: number
  endSec: number | null
  label: string
  nonce: number
  extractionId: string | null   // when set, the player shows span-trim controls
}

type PlayHandler = (startSec: number | null, endSec: number | null, label: string, extractionId?: string | null) => void

export interface ReportData {
  recording: RecordingRow
  files: RecordingFileRow[]
  transcript: RecordingTranscriptRow | null
  extractions: RecordingExtractionRow[]
  agents: Array<{ id: string; name: string }>   // org's agents, for the brand/agent link (§3.5c)
  isOwner: boolean
  configDrifted: boolean   // analysis-shaping setup changed since the last analysis → drift banner
  analyticsDatasetId: string | null   // dataset mirror id when Analytics is available; null = hide cross-link
}

type Tab = 'presentation' | 'qa' | 'actions' | 'coverage' | 'transcript' | 'comparison' | 'export'

const HERMES = '#E8632A'

const TABS: readonly Tab[] = ['presentation', 'qa', 'actions', 'coverage', 'transcript', 'comparison', 'export']

export default function ReportClient({ data }: { data: ReportData }) {
  // Presentation-scope flagging + the Presentation tab are only meaningful when
  // the meeting had a presentation.
  const hasPresentation = !!(data.recording.meeting_profile?.phases?.some(p => p.kind === 'presentation')) || !!data.recording.proceedings_summary
  // The live-vs-final comparison tab only exists for live-recorded meetings.
  const hasLiveTranscript = !!data.recording.live_transcript

  // Deep-linkable tab (e.g. the list card's "needs review" pill → ?tab=coverage).
  // Defaults to coverage, the review hub. ?tab=presentation falls back to coverage
  // on a meeting with no presentation (the tab isn't shown there).
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab')
  const [tab, setTab] = useState<Tab>(() => {
    const t = tabParam ?? ''
    if (t === 'presentation' && !hasPresentation) return 'coverage'
    if (t === 'comparison' && !hasLiveTranscript) return 'coverage'
    return (TABS as readonly string[]).includes(t) ? (t as Tab) : 'coverage'
  })
  // One-shot: Coverage's "Review these" → Q&A tab pre-filtered to flagged pairs.
  // Cleared whenever the user picks a tab manually (see TabBar onChange).
  const [reviewFlagged, setReviewFlagged] = useState(false)

  // Local mutable copy of the extractions — per-card regenerate (§ 4.10)
  // replaces individual rows in place, so we keep state here and rebuild
  // ask/nonAsk + grouping off of it.
  const [extractions, setExtractions] = useState<RecordingExtractionRow[]>(data.extractions)

  const replaceExtraction = useCallback((next: RecordingExtractionRow) => {
    setExtractions(prev => prev.map(e => (e.id === next.id ? next : e)))
  }, [])

  const recordingId = data.recording.id

  // All Q&A pairs in ONE list. We deliberately no longer split "ask" into a
  // headline tab and everything else into an "Appendix" — clarifications and
  // question-bearing complaints ARE questions, so demoting them undercounted and
  // misrepresented the Q&A. Typology is shown as a per-card chip + a filter
  // instead. (action_item rows have no Q/A and live in their own tab.)
  const qaPairs = useMemo(
    () => extractions.filter(e => e.unit_type === 'qa_pair'),
    [extractions],
  )

  // Action items are a separate unit_type (no question/answer) — synthesis pulls
  // them from the discussion. Surfaced in their own tab + the deck, not the Q&A.
  const actionItems = useMemo(
    () => extractions.filter(e => e.unit_type === 'action_item'),
    [extractions],
  )

  const agenda = useMemo(() => {
    const setup = data.recording.setup_inputs as Partial<QaSetupInputs>
    return Array.isArray(setup?.agenda) ? setup.agenda : []
  }, [data.recording.setup_inputs])

  // Audio modal — a single player shared by every "▶ Play" affordance.
  const [audioReq, setAudioReq] = useState<AudioRequest | null>(null)
  const nonceRef = useRef(0)
  const playAt = useCallback((startSec: number | null, endSec: number | null, label: string, extractionId: string | null = null) => {
    nonceRef.current += 1
    setAudioReq({ startSec: startSec ?? 0, endSec, label, nonce: nonceRef.current, extractionId })
  }, [])

  const segments = useMemo(
    () => (data.transcript?.segments ?? []) as TranscriptSegment[],
    [data.transcript],
  )

  return (
    <div className="space-y-6">
      {/* Pinned so the title + tab navigation stay reachable while scrolling.
          Sits just below the fixed TopNav (h-14); below the audio modal (z-50).
          The TabBar's own border-b is the divider — content scrolls under it. */}
      <div className="sticky top-14 z-30 bg-gray-50 pt-3 space-y-4">
        <ReportHeader recording={data.recording} qaPairCount={qaPairs.length} analyticsDatasetId={data.analyticsDatasetId} />

        {data.configDrifted && <DriftBanner recordingId={recordingId} analyzedVersion={data.recording.analyzed_config_version} />}

        <TabBar
          tab={tab}
          onChange={(t) => { setReviewFlagged(false); setTab(t) }}
          hasPresentation={hasPresentation}
          hasLiveTranscript={hasLiveTranscript}
          counts={{
            qa: qaPairs.length,
            actions: actionItems.length,
            coverage: data.recording.coverage_report?.flagged_count ?? 0,
          }}
        />
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        {tab === 'presentation' && <PresentationTab recording={data.recording} />}
        {tab === 'qa' && <QATab recordingId={recordingId} extractions={qaPairs} agenda={agenda} onReplaced={replaceExtraction} onPlay={playAt} initialFlagged={reviewFlagged} hasPresentation={hasPresentation} />}
        {tab === 'actions' && <ActionItemsTab extractions={actionItems} transcript={data.transcript} />}
        {tab === 'coverage' && <CoverageTab recording={data.recording} extractions={extractions} transcript={data.transcript} onReviewFlagged={() => { setReviewFlagged(true); setTab('qa') }} />}
        {tab === 'transcript' && <TranscriptTab transcript={data.transcript} entityMap={data.recording.entity_map} extractions={extractions} onPlay={playAt} />}
        {tab === 'comparison' && <TranscriptComparisonTab liveTranscript={data.recording.live_transcript ?? null} segments={segments} />}
        {tab === 'export' && (
          <div className="space-y-6">
            <ExportTab
              recordingId={recordingId}
              recordingName={data.recording.name}
              status={data.recording.status}
              isOwner={data.isOwner}
              initialShareEnabled={data.recording.share_enabled}
              initialShareToken={data.recording.share_token}
              initialShareVerbatim={data.recording.share_verbatim}
              agents={data.agents}
              initialBrandTag={data.recording.brand_tag}
              initialAgentId={data.recording.underlying_agent_id}
            />
            <Link
              href={`/recordings/${recordingId}/setup`}
              className="block bg-white border border-gray-200 rounded-2xl p-5 hover:border-orange-300 hover:bg-orange-50/30 transition-colors"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-gray-900 text-sm">Project setup</h3>
                  <p className="text-xs text-gray-500 mt-0.5">Edit the meeting details, panel, agenda, names, objectives, and attribution. Re-run the analysis afterward to apply agenda/panel/objective changes.</p>
                </div>
                <span className="shrink-0 text-sm font-semibold text-orange-600">Edit setup →</span>
              </div>
            </Link>
            <VersionSignoffPanel
              recordingId={recordingId}
              signoff={data.recording.signoff}
              analyzedVersion={data.recording.analyzed_config_version}
            />
          </div>
        )}
      </div>

      {audioReq && (
        <AudioModal
          recordingId={recordingId}
          segments={segments}
          req={audioReq}
          onClose={() => setAudioReq(null)}
          onSpanSaved={replaceExtraction}
        />
      )}
    </div>
  )
}

// ── Header ───────────────────────────────────────────────────────────────────

const CONFIDENTIALITY_PILL: Record<string, { label: string; cls: string }> = {
  public:               { label: 'Public', cls: 'bg-green-100 text-green-700' },
  internal:             { label: 'Internal', cls: 'bg-gray-100 text-gray-600' },
  client_confidential:  { label: 'Client confidential', cls: 'bg-amber-100 text-amber-700' },
  restricted:           { label: 'Restricted', cls: 'bg-red-100 text-red-700' },
}

function ReportHeader({ recording, qaPairCount, analyticsDatasetId }: { recording: RecordingRow; qaPairCount: number; analyticsDatasetId: string | null }) {
  const analystNames = (recording.analysts ?? []).map(a => a.name).filter(Boolean).join(', ')
  const conf = CONFIDENTIALITY_PILL[recording.confidentiality_class] ?? CONFIDENTIALITY_PILL.client_confidential
  const objectives = recording.objectives
  const signoff = recording.signoff
  return (
    <div>
      <header className="flex items-baseline justify-between">
        <div>
          <Link href="/recordings" className="text-xs text-gray-500 hover:text-gray-700">← Town Hall</Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-2">{recording.name}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {recording.meeting_date ?? 'No date'}
            {recording.location ? ` · ${recording.location}` : ''}
            {' · '}
            {qaPairCount} Q&amp;A pair{qaPairCount === 1 ? '' : 's'}
            {recording.source_duration_sec ? ` · ${formatDuration(recording.source_duration_sec)} audio` : ''}
            {recording.asr_vendor_chosen ? ` · transcribed by ${recording.asr_vendor_chosen}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href={`/recordings/${recording.id}/setup`} className="text-xs text-gray-500 hover:text-orange-600 underline">
            Edit setup ⚙
          </Link>
          {analyticsDatasetId && (
            <Link href={`/analyze/${analyticsDatasetId}`} className="text-xs text-gray-500 hover:text-orange-600 underline">
              Open in Analytics ↗
            </Link>
          )}
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${conf.cls}`} title="Distribution classification">{conf.label}</span>
          <StatusBadge status={recording.status} />
        </div>
      </header>

      {/* Attribution + config-version provenance (§2.8) */}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
        <span>Prepared by <span className="text-gray-700 font-medium">{analystNames || '—'}</span> · {recording.analysis_org || 'Datanautix'}</span>
        {recording.analyzed_config_version != null && (
          <span className="text-gray-400">· Config v{recording.analyzed_config_version}{recording.completed_at ? ` · analyzed ${new Date(recording.completed_at).toLocaleDateString()}` : ''}</span>
        )}
        {signoff?.approved_by && (
          <span className="inline-flex items-center gap-1 text-green-700" title={signoff.note || undefined}>
            · ✓ Approved by {signoff.approved_by}{signoff.approved_at ? ` on ${new Date(signoff.approved_at).toLocaleDateString()}` : ''}
          </span>
        )}
      </div>

      {(objectives?.summary || (objectives?.questions?.length ?? 0) > 0) && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Objectives</div>
          {objectives?.summary && <p className="text-sm text-gray-700">{objectives.summary}</p>}
          {(objectives?.questions?.length ?? 0) > 0 && (
            <ul className="mt-1.5 list-disc list-outside pl-5 text-sm text-gray-600 space-y-0.5">
              {objectives!.questions.map((q, i) => <li key={i}>{q}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === 'complete' ? 'bg-green-100 text-green-800' :
    status === 'failed' ? 'bg-red-100 text-red-800' :
    'bg-blue-100 text-blue-800'
  return <span className={`px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>{status}</span>
}

// ── Tab bar ──────────────────────────────────────────────────────────────────

function TabBar({
  tab, onChange, counts, hasPresentation, hasLiveTranscript,
}: {
  tab: Tab
  onChange: (t: Tab) => void
  counts: { qa: number; actions: number; coverage: number }
  hasPresentation: boolean
  hasLiveTranscript: boolean
}) {
  // 'warn' tone = the badge is a count of pairs needing review (same number as the
  // card's "N pairs need review" pill) → render amber so it reads as an alert, not
  // a neutral item count.
  const tabs: Array<{ key: Tab; label: string; badge?: number; tone?: 'warn' }> = [
    // Presentation leads (the meeting's first half) — only on community meetings.
    ...(hasPresentation ? [{ key: 'presentation' as Tab, label: 'Presentation' }] : []),
    { key: 'coverage',   label: 'Coverage',     badge: counts.coverage, tone: 'warn' },
    { key: 'qa',         label: 'Q&A',          badge: counts.qa },
    { key: 'actions',    label: 'Action items', badge: counts.actions },
    { key: 'transcript', label: 'Transcript' },
    ...(hasLiveTranscript ? [{ key: 'comparison' as Tab, label: 'Live vs Final' }] : []),
    { key: 'export',     label: 'Export & Share' },
  ]
  return (
    <nav className="flex gap-1 border-b border-gray-200">
      {tabs.map(t => {
        const active = tab === t.key
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ' +
              (active ? 'border-orange-500 text-orange-700' : 'border-transparent text-gray-500 hover:text-gray-800')
            }
          >
            {t.label}
            {typeof t.badge === 'number' && t.badge > 0 && (
              t.tone === 'warn' ? (
                <span
                  className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700 align-middle"
                  title={`${t.badge} pair${t.badge === 1 ? '' : 's'} need review`}
                >
                  {t.badge} to review
                </span>
              ) : (
                <span className="ml-2 text-xs text-gray-400">{t.badge}</span>
              )
            )}
          </button>
        )
      })}
    </nav>
  )
}

// ── Drift banner ─────────────────────────────────────────────────────────────
// Shown when the analysis-shaping setup (agenda/panel/glossary/profile/objectives)
// changed since the analysis that produced this report. One-click full re-extract
// (~$1) re-stamps analyzed_config_version, which clears the banner on refresh.

function DriftBanner({ recordingId, analyzedVersion }: { recordingId: string; analyzedVersion: number | null }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const reanalyze = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/recordings/${recordingId}/reanalyze`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'all' }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.error || `Re-analyze failed (${r.status})`)
      router.refresh()   // server recomputes drift (now false) → banner disappears
    } catch (e) { setErr(e instanceof Error ? e.message : 'Re-analyze failed'); setBusy(false) }
  }

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-amber-900">Setup changed since the last analysis</h3>
          <p className="text-xs text-amber-800 mt-0.5">
            You edited the agenda, panel, names, meeting profile, or objectives after this report was generated
            {analyzedVersion != null ? ` (Config v${analyzedVersion})` : ''}. Re-analyze to apply your changes — this
            replaces every Q&amp;A pair (~$1).
          </p>
          {err && <p className="text-xs text-red-700 mt-1.5">{err}</p>}
        </div>
        {confirming ? (
          <div className="shrink-0 flex items-center gap-2">
            <button type="button" onClick={reanalyze} disabled={busy}
              className="px-3 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50" style={{ background: HERMES }}>
              {busy ? 'Re-analyzing…' : 'Yes, re-analyze (~$1)'}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy}
              className="px-3 py-2 rounded-lg text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50">Cancel</button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirming(true)}
            className="shrink-0 px-3 py-2 rounded-lg text-xs font-semibold text-white" style={{ background: HERMES }}>
            Re-analyze
          </button>
        )}
      </div>
    </div>
  )
}

// ── Presentation tab ─────────────────────────────────────────────────────────
// On-screen rendering of proceedings_summary — the same content as the deck/PDF
// "Meeting Overview" slide (lib/pptx/recordingDeck.ts), so the presentation half
// of a community meeting is as prominent in the report as the Q&A. Only mounted
// when the meeting had a presentation phase.

function PresentationTab({ recording }: { recording: RecordingRow }) {
  const proceedings = recording.proceedings_summary
  const outline = recording.presentation_outline

  if (!proceedings || (!proceedings.overview && (proceedings.items?.length ?? 0) === 0)) {
    return (
      <div className="text-center py-12">
        <div className="text-3xl mb-2">🖥️</div>
        <h3 className="font-semibold text-gray-900">No presentation summary yet</h3>
        <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
          This meeting was set up with a presentation, but a summary hasn&apos;t been generated.
          Re-run the analysis to produce the meeting overview.
        </p>
      </div>
    )
  }

  const items = proceedings.items ?? []

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-bold text-gray-900">Presentation overview</h2>
          {outline?.source_filename && (
            <span className="shrink-0 text-xs text-gray-400">
              From {outline.source_filename}{outline.page_count ? ` · ${outline.page_count} slides` : ''}
            </span>
          )}
        </div>
        {proceedings.overview && (
          <p className="text-sm text-gray-700 mt-2 leading-relaxed whitespace-pre-line">{proceedings.overview}</p>
        )}
      </div>

      {items.length > 0 && (
        <div className="space-y-4">
          {items.map((it, i) => (
            <div key={i} className="border border-gray-200 rounded-xl p-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-semibold text-gray-900">{it.title}</h3>
                {it.slide_refs?.length > 0 && (
                  <span className="shrink-0 text-xs text-gray-400">
                    {it.slide_refs.length === 1 ? 'Slide' : 'Slides'} {it.slide_refs.join(', ')}
                  </span>
                )}
              </div>
              {it.presenter && <div className="text-xs text-gray-500 mt-0.5">{it.presenter}</div>}
              {it.what_was_presented && (
                <p className="text-sm text-gray-700 mt-2 leading-relaxed whitespace-pre-line">{it.what_was_presented}</p>
              )}
              {it.key_figures?.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {it.key_figures.map((f, j) => (
                    <span key={j} className="inline-flex items-baseline gap-1.5 px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-200 text-xs">
                      <span className="text-gray-500">{f.label}</span>
                      <span className="font-semibold text-gray-900">{f.value}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-gray-400">
        Neutral AI summary of the presentation portion of the meeting{proceedings.model ? ` · ${proceedings.model}` : ''}. The Q&amp;A tab covers the discussion that followed.
      </p>
    </div>
  )
}

// ── Q&A tab ──────────────────────────────────────────────────────────────────

function QATab({ recordingId, extractions, agenda, onReplaced, onPlay, initialFlagged = false, hasPresentation = false }: {
  recordingId: string
  extractions: RecordingExtractionRow[]
  agenda: string[]
  onReplaced: (e: RecordingExtractionRow) => void
  onPlay: PlayHandler
  initialFlagged?: boolean
  hasPresentation?: boolean
}) {
  const router = useRouter()
  // Typology filter — all pairs show by default; chips narrow to one typology.
  // A 'flagged' pseudo-filter shows only pairs needing review (the Coverage tab's
  // "Review these →" deep-links here with it pre-selected).
  const TYPOLOGY_ORDER = ['ask', 'clarification', 'complaint', 'commentary'] as const
  const typeCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of extractions) {
      const t = (e.payload as QaPairPayload)?.question_typology || 'ask'
      m.set(t, (m.get(t) ?? 0) + 1)
    }
    return m
  }, [extractions])
  const flaggedCount = useMemo(() => extractions.filter(e => e.flagged_for_review).length, [extractions])
  const inScopeCount = useMemo(() => extractions.filter(e => (e.payload as QaPairPayload)?.presentation_scope === 'in_scope').length, [extractions])
  const outScopeCount = useMemo(() => extractions.filter(e => (e.payload as QaPairPayload)?.presentation_scope === 'out_of_scope').length, [extractions])
  // Asker-sentiment counts (positive/neutral/negative/mixed), in display order.
  const sentimentCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of extractions) {
      const s = (e.payload as QaPairPayload)?.sentiment
      if (s) m.set(s, (m.get(s) ?? 0) + 1)
    }
    return m
  }, [extractions])
  const [typeFilter, setTypeFilter] = useState<string>(initialFlagged && flaggedCount > 0 ? 'flagged' : 'all')
  const filtered = useMemo(
    () => typeFilter === 'all'
      ? extractions
      : typeFilter === 'in_scope'
        ? extractions.filter(e => (e.payload as QaPairPayload)?.presentation_scope === 'in_scope')
      : typeFilter === 'out_of_scope'
        ? extractions.filter(e => (e.payload as QaPairPayload)?.presentation_scope === 'out_of_scope')
      : typeFilter === 'flagged'
        ? extractions.filter(e => e.flagged_for_review)
      : typeFilter.startsWith('sent:')
        ? extractions.filter(e => (e.payload as QaPairPayload)?.sentiment === typeFilter.slice(5))
        : extractions.filter(e => ((e.payload as QaPairPayload)?.question_typology || 'ask') === typeFilter),
    [extractions, typeFilter],
  )
  const grouped = useMemo(() => groupByTopic(filtered, agenda), [filtered, agenda])
  // "In order" = every pair in the sequence it was asked (start_sec, then the
  // analyzer's sort_order as a tiebreaker for missing timestamps).
  const ordered = useMemo(
    () => [...filtered].sort((a, b) => (a.start_sec ?? Number.MAX_SAFE_INTEGER) - (b.start_sec ?? Number.MAX_SAFE_INTEGER) || a.sort_order - b.sort_order),
    [filtered],
  )
  const [sortMode, setSortMode] = useState<'topic' | 'order'>('topic')
  const [expandedAll, setExpandedAll] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [reanalyzeModal, setReanalyzeModal] = useState<{ scope: 'all' | 'topic'; topic?: string } | null>(null)

  const toggleCard = (id: string) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          {/* By topic (grouped) vs In order (chronological as asked) */}
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
            <button type="button" onClick={() => setSortMode('topic')}
              className={`px-3 py-1.5 transition-colors ${sortMode === 'topic' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>By topic</button>
            <button type="button" onClick={() => setSortMode('order')}
              className={`px-3 py-1.5 border-l border-gray-200 transition-colors ${sortMode === 'order' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>In order</button>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => { setExpandedAll(true); setExpanded(new Set()) }}
              className="text-xs px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50">Expand all</button>
            <button type="button" onClick={() => { setExpandedAll(false); setExpanded(new Set()) }}
              className="text-xs px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50">Collapse all</button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setReanalyzeModal({ scope: 'all' })}
          className="text-sm px-3 py-1.5 rounded-lg border border-orange-200 text-orange-700 font-medium hover:bg-orange-50 transition-colors"
          title="Re-extract all Q&A pairs from the transcript"
        >
          ↻ Re-extract all
        </button>
      </div>

      {(typeCounts.size > 1 || flaggedCount > 0 || sentimentCounts.size > 0 || (hasPresentation && (inScopeCount > 0 || outScopeCount > 0))) && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-gray-400 mr-0.5">Type:</span>
          {(['all', ...TYPOLOGY_ORDER.filter(t => typeCounts.has(t))] as string[]).map(t => {
            const active = typeFilter === t
            const n = t === 'all' ? extractions.length : typeCounts.get(t)
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTypeFilter(t)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
              >
                {t === 'all' ? 'All' : t} <span className={active ? 'text-gray-300' : 'text-gray-400'}>{n}</span>
              </button>
            )
          })}
          {flaggedCount > 0 && (
            <button
              type="button"
              onClick={() => setTypeFilter('flagged')}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${typeFilter === 'flagged' ? 'bg-amber-500 text-white border-amber-500' : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'}`}
              title="Pairs the curator flagged for human review"
            >
              ⚠ Needs review <span className={typeFilter === 'flagged' ? 'text-amber-100' : 'text-amber-500'}>{flaggedCount}</span>
            </button>
          )}
          {hasPresentation && (inScopeCount > 0 || outScopeCount > 0) && (
            <>
              <button type="button" onClick={() => setTypeFilter('in_scope')}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${typeFilter === 'in_scope' ? 'bg-teal-600 text-white border-teal-600' : 'bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100'}`}
                title="Questions about the presentation">
                In presentation <span className={typeFilter === 'in_scope' ? 'text-teal-100' : 'text-teal-500'}>{inScopeCount}</span>
              </button>
              <button type="button" onClick={() => setTypeFilter('out_of_scope')}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${typeFilter === 'out_of_scope' ? 'bg-purple-600 text-white border-purple-600' : 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100'}`}
                title="Questions outside the presentation's scope">
                Outside scope <span className={typeFilter === 'out_of_scope' ? 'text-purple-100' : 'text-purple-500'}>{outScopeCount}</span>
              </button>
            </>
          )}
          {sentimentCounts.size > 0 && (
            <>
              <span className="text-gray-300 mx-0.5">·</span>
              {(['positive', 'neutral', 'negative', 'mixed'] as const).filter(s => sentimentCounts.has(s)).map(s => {
                const val = `sent:${s}`
                const active = typeFilter === val
                return (
                  <button key={val} type="button" onClick={() => setTypeFilter(val)}
                    className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-colors ${active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                    title={`Asker sentiment: ${s}`}>
                    <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: SENTIMENT_DOT[s].color }} />
                    {s} <span className={active ? 'text-gray-300' : 'text-gray-400'}>{sentimentCounts.get(s)}</span>
                  </button>
                )
              })}
            </>
          )}
        </div>
      )}

      {grouped.length === 0 && (
        <EmptyState label="No Q&A pairs for this filter." />
      )}

      {sortMode === 'order' ? (
        <ul className="space-y-2">
          {ordered.map((e, i) => (
            <QACard
              key={e.id}
              recordingId={recordingId}
              extraction={e}
              expanded={expandedAll || expanded.has(e.id)}
              onToggle={() => toggleCard(e.id)}
              onReplaced={onReplaced}
              onPlay={onPlay}
              hasPresentation={hasPresentation}
              ordinal={i + 1}
            />
          ))}
        </ul>
      ) : (
        grouped.map(({ topic, items }) => (
          <section key={topic}>
            <header className="flex items-center justify-between mb-2">
              <h2 className="text-base font-bold text-gray-900">
                {topic} <span className="text-gray-400 text-sm font-normal">· {items.length}</span>
              </h2>
              <button
                type="button"
                onClick={() => setReanalyzeModal({ scope: 'topic', topic })}
                className="text-xs px-2 py-1 text-gray-500 hover:text-gray-900"
                title={`Re-extract pairs for "${topic}" (§ 4.11)`}
              >
                ⋯
              </button>
            </header>
            <ul className="space-y-2">
              {items.map(e => (
                <QACard
                  key={e.id}
                  recordingId={recordingId}
                  extraction={e}
                  expanded={expandedAll || expanded.has(e.id)}
                  onToggle={() => toggleCard(e.id)}
                  onReplaced={onReplaced}
                  onPlay={onPlay}
                  hasPresentation={hasPresentation}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      {reanalyzeModal && (
        <ReanalyzeModal
          recordingId={recordingId}
          scope={reanalyzeModal.scope}
          topic={reanalyzeModal.topic}
          onClose={() => setReanalyzeModal(null)}
          onSuccess={() => { setReanalyzeModal(null); router.refresh() }}
        />
      )}
    </div>
  )
}

// ── Reanalyze modal (§ 4.11) ────────────────────────────────────────────────

function ReanalyzeModal({ recordingId, scope, topic, onClose, onSuccess }: {
  recordingId: string
  scope: 'all' | 'topic'
  topic?: string
  onClose: () => void
  onSuccess: () => void
}) {
  const [instructions, setInstructions] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const title = scope === 'all'
    ? 'Re-extract all pairs from transcript'
    : `Re-extract pairs for "${topic}"`
  const cost = scope === 'all' ? '~$1' : '~$0.10–$0.40'
  const warning = scope === 'all'
    ? 'Deletes every existing pair and re-runs Opus + Sonnet on the full transcript.'
    : `Deletes pairs in "${topic}" only — other topics keep their pairs. Re-runs on the topic-scoped window (±60s padding).`

  const handleConfirm = async () => {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/recordings/${recordingId}/reanalyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope,
          topic: scope === 'topic' ? topic : undefined,
          instructions: instructions.trim() || undefined,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setErr(body?.error || `reanalyze ${res.status}`)
        return
      }
      onSuccess()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-900">{title}</h3>
        <p className="text-sm text-gray-600">{warning}</p>
        <label className="block">
          <span className="block text-xs font-semibold text-gray-600 mb-1">Instructions (optional)</span>
          <textarea
            value={instructions}
            onChange={e => setInstructions(e.target.value)}
            placeholder={scope === 'topic'
              ? `e.g. "You missed a question about funding for ${topic}."`
              : 'e.g. "Asker names should default to \'Audience member\' if not self-introduced."'}
            disabled={busy}
            maxLength={4000}
            rows={4}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
            style={{ fontSize: '16px' }}
          />
        </label>
        {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{err}</div>}
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>Cost: <span className="font-semibold">{cost}</span> · Opus + Sonnet</span>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-sm px-4 py-2 rounded border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            className="text-sm px-4 py-2 rounded text-white font-semibold disabled:opacity-60"
            style={{ backgroundColor: HERMES }}
          >
            {busy ? 'Re-extracting…' : 'Confirm re-extract'}
          </button>
        </div>
      </div>
    </div>
  )
}

function QACard({ recordingId, extraction, expanded, onToggle, onReplaced, onPlay, ordinal, hasPresentation = false }: {
  recordingId: string
  extraction: RecordingExtractionRow
  expanded: boolean
  onToggle: () => void
  onReplaced: (e: RecordingExtractionRow) => void
  onPlay: PlayHandler
  // Sequence number in the "In order" view; omitted in topic view.
  ordinal?: number
  hasPresentation?: boolean
}) {
  const payload = extraction.payload as QaPairPayload
  const flagged = extraction.flagged_for_review
  const scope = payload.presentation_scope ?? null
  // Quick scope flag (presentation meetings) — PATCHes presentation_scope; toggling
  // the active value clears it. Mirrors back via onReplaced.
  const setScope = async (next: 'in_scope' | 'out_of_scope') => {
    const value = scope === next ? null : next
    try {
      const res = await fetch(`/api/recordings/${recordingId}/extractions/${extraction.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ presentation_scope: value }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok) onReplaced(d.extraction as RecordingExtractionRow)
    } catch { /* non-fatal */ }
  }
  const [showComposer, setShowComposer] = useState(false)
  const [instructions, setInstructions] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  // Display-of-record = human edit → AI polish → verbatim (qaDisplay). The toggle
  // reveals the raw spoken text. "Edit" opens the 3-layer editor (modal).
  const edited = isEdited(payload)
  const hasPolished = !!(payload.polished_answer || payload.polished_question)
  const [showVerbatim, setShowVerbatim] = useState(false)
  const shownQuestion = displayQuestion(payload, { verbatim: showVerbatim })
  const shownAnswer = displayAnswer(payload, { verbatim: showVerbatim })

  const handleRegenerate = async () => {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(
        `/api/recordings/${recordingId}/extractions/${extraction.id}/regenerate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instructions: instructions.trim() || undefined }),
        },
      )
      const body = await res.json()
      if (!res.ok) {
        setErr(body?.error || `regenerate ${res.status}`)
        return
      }
      onReplaced(body.extraction as RecordingExtractionRow)
      setShowComposer(false)
      setInstructions('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={`border rounded-lg ${flagged ? 'border-yellow-300 bg-yellow-50' : 'border-gray-200 bg-white'}`}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left p-4"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-gray-900">
              {ordinal != null && <span className="text-gray-400 font-normal mr-1.5">{ordinal}.</span>}
              {shownQuestion}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {payload.asker_name ?? 'Audience member'}
              {extraction.start_sec != null ? ` · ${formatTime(extraction.start_sec)}` : ''}
              {flagged && <> · <span className="text-yellow-700">⚠ flagged{extraction.flag_reason ? `: ${extraction.flag_reason}` : ''}</span></>}
              {scope === 'in_scope' && <> · <span className="text-teal-700">in presentation</span></>}
              {scope === 'out_of_scope' && <> · <span className="text-purple-700">outside scope</span></>}
              {payload.sentiment && SENTIMENT_DOT[payload.sentiment] && (
                <> · <span className="inline-flex items-center gap-1"><span className="inline-block w-1.5 h-1.5 rounded-full align-middle" style={{ backgroundColor: SENTIMENT_DOT[payload.sentiment].color }} />{payload.sentiment}</span></>
              )}
            </div>
            {!expanded && (
              <div className="text-sm text-gray-600 mt-1 line-clamp-1">
                {firstLine(shownAnswer)}
              </div>
            )}
          </div>
          <span className="text-gray-400 text-xs shrink-0">{expanded ? '▾' : '▸'}</span>
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-4 space-y-2 text-sm">
          <div className="border-l-2 border-gray-200 pl-3">
            <div className="text-xs text-gray-500 mb-1 flex items-center gap-2 flex-wrap">
              <span>Answer{payload.panelist_name ? ` — ${payload.panelist_name}` : ''}</span>
              {(hasPolished || edited) && (
                <>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${showVerbatim ? 'bg-gray-100 text-gray-600' : edited ? 'bg-orange-50 text-orange-700' : 'bg-teal-50 text-teal-700'}`}>
                    {showVerbatim ? 'Verbatim' : edited ? 'Human-edited' : 'Polished for sharing'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowVerbatim(v => !v)}
                    className="text-[11px] text-gray-500 underline hover:text-gray-700"
                  >
                    {showVerbatim ? 'Show display version' : 'Show verbatim'}
                  </button>
                  {edited && payload.edited_by_name && (
                    <span className="text-[11px] text-gray-400" title={payload.edited_at ? `Edited ${new Date(payload.edited_at).toLocaleString()}` : undefined}>
                      edited by {payload.edited_by_name}
                      {payload.edited_at ? ` · ${new Date(payload.edited_at).toLocaleDateString()}` : ''}
                    </span>
                  )}
                </>
              )}
            </div>
            <div className="text-gray-800 whitespace-pre-wrap">{shownAnswer}</div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {extraction.topic && (
              <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700">{extraction.topic}</span>
            )}
            <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700">{payload.question_typology}</span>
            {payload.sentiment && SENTIMENT_DOT[payload.sentiment] && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100" title="Asker sentiment">
                <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: SENTIMENT_DOT[payload.sentiment].color }} />
                <span className="text-gray-700">{payload.sentiment}</span>
              </span>
            )}
            {typeof extraction.confidence === 'number' && (
              <span className="text-gray-500">confidence {(extraction.confidence * 100).toFixed(0)}%</span>
            )}
            {hasPresentation && (
              <span className="inline-flex items-center gap-1 ml-1">
                <span className="text-gray-400">Scope:</span>
                <button type="button" onClick={() => setScope('in_scope')}
                  className={`px-2 py-0.5 rounded-full border transition-colors ${scope === 'in_scope' ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-teal-700 border-teal-200 hover:bg-teal-50'}`}
                  title="This question is about the presentation">In presentation</button>
                <button type="button" onClick={() => setScope('out_of_scope')}
                  className={`px-2 py-0.5 rounded-full border transition-colors ${scope === 'out_of_scope' ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-purple-700 border-purple-200 hover:bg-purple-50'}`}
                  title="This question is outside the presentation's scope">Outside scope</button>
              </span>
            )}
          </div>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={() => onPlay(extraction.start_sec, extraction.end_sec, payload.question, extraction.id)}
              className="text-xs px-2 py-1 border border-gray-200 rounded text-gray-700 hover:bg-gray-50"
            >
              ▶ Play / adjust segment
            </button>
            {hasPolished && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-xs px-2 py-1 border border-gray-200 rounded text-gray-700 hover:bg-gray-50"
                title="Hand-edit the display text (keeps the AI + verbatim versions)"
              >
                ✎ Edit
              </button>
            )}
            {!showComposer ? (
              <button
                type="button"
                onClick={() => setShowComposer(true)}
                className="text-xs px-2 py-1 border border-gray-200 rounded text-gray-700 hover:bg-gray-50"
              >
                ↻ Regenerate
              </button>
            ) : null}
          </div>
          {showComposer && (
            <div className="border border-gray-200 rounded p-3 bg-gray-50 space-y-2">
              <label className="block text-xs font-semibold text-gray-600">What should change? (optional)</label>
              <textarea
                value={instructions}
                onChange={e => setInstructions(e.target.value)}
                placeholder="e.g. The asker was the woman in the red coat, not the moderator."
                disabled={busy}
                maxLength={2000}
                rows={2}
                className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                style={{ fontSize: '16px' }}
              />
              {err && <div className="text-xs text-red-600">{err}</div>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleRegenerate}
                  disabled={busy}
                  className="text-xs px-3 py-1 rounded text-white font-semibold disabled:opacity-60"
                  style={{ backgroundColor: HERMES }}
                >
                  {busy ? 'Regenerating…' : 'Regenerate'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowComposer(false); setInstructions(''); setErr(null) }}
                  disabled={busy}
                  className="text-xs px-3 py-1 rounded border border-gray-200 text-gray-600 hover:bg-white disabled:opacity-60"
                >
                  Cancel
                </button>
                <span className="text-xs text-gray-400 self-center ml-auto">~$0.01 · Sonnet</span>
              </div>
            </div>
          )}
        </div>
      )}
      {editing && (
        <EditPairModal
          recordingId={recordingId}
          extraction={extraction}
          onClose={() => setEditing(false)}
          onSaved={e => { onReplaced(e); setEditing(false) }}
        />
      )}
    </li>
  )
}

// One field's three layers: verbatim (collapsible reference) + AI (read-only) +
// the editable box. Module-level so it isn't re-created each keystroke (which
// would drop textarea focus).
function EditLayer({ label, verbatim, ai, value, onChange, rows }: {
  label: string; verbatim: string; ai: string; value: string; onChange: (v: string) => void; rows: number
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500">{label}</div>
      {/* Verbatim (as spoken) — the reference for catching AI errors. Read-only. */}
      <div>
        <div className="text-[11px] text-gray-400 mb-0.5">Verbatim — as spoken (reference)</div>
        <div className="text-[13px] italic text-gray-500 whitespace-pre-wrap border-l-2 border-gray-200 pl-2.5 py-0.5">{verbatim}</div>
      </div>
      <div>
        <div className="text-[11px] text-gray-400 mb-0.5">AI version</div>
        <div className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 whitespace-pre-wrap">{ai}</div>
      </div>
      <div>
        <div className="text-[11px] font-medium text-gray-700 mb-0.5">{label} — edit for display</div>
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={rows}
          className="w-full border border-orange-300 rounded-lg px-3 py-2"
          style={{ fontSize: '16px' }}
        />
      </div>
    </div>
  )
}

// ── Segment audio player ─────────────────────────────────────────────────────
// Plays just this pair's [start_sec, end_sec] slice of the stitched meeting audio
// so a reviewer can listen while correcting the text. Clamps playback to the
// segment, with replay / scrub-within-segment / speed. Signed URL via §4.12.
// Shared span-trim state for the two players (edit-pane SegmentAudioPlayer + the
// Play modal). Mark start/end from a playhead position, then PATCH the new span.
function useSpanEdit({ recordingId, extractionId, startSec, endSec, onSaved }: {
  recordingId: string
  extractionId: string | null
  startSec: number | null
  endSec: number | null
  onSaved?: (e: RecordingExtractionRow) => void
}) {
  const origStart = startSec ?? 0
  const [draftStart, setDraftStart] = useState(origStart)
  const [draftEnd, setDraftEnd] = useState<number | null>(endSec ?? null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Reset drafts when the target pair / its span changes (e.g. the Play modal is
  // reused for a different pair, or the pair re-renders after a save).
  useEffect(() => {
    setDraftStart(startSec ?? 0)
    setDraftEnd(endSec ?? null)
    setSaved(false); setErr(null)
  }, [extractionId, startSec, endSec])

  const changed = draftStart !== origStart || draftEnd !== (endSec ?? null)
  const markStart = (pos: number) => { const p = Math.round(pos); setSaved(false); setDraftStart(Math.max(0, Math.min(p, (draftEnd ?? p + 1) - 1))) }
  const markEnd = (pos: number) => { const p = Math.round(pos); setSaved(false); setDraftEnd(Math.max(draftStart + 1, p)) }
  const reset = () => { setDraftStart(origStart); setDraftEnd(endSec ?? null); setSaved(false); setErr(null) }
  const save = async () => {
    if (!extractionId) return
    setBusy(true); setErr(null); setSaved(false)
    try {
      const res = await fetch(`/api/recordings/${recordingId}/extractions/${extractionId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_sec: draftStart, end_sec: draftEnd }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d?.error || `Save failed (${res.status})`)
      setSaved(true)
      onSaved?.(d.extraction as RecordingExtractionRow)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Save failed') } finally { setBusy(false) }
  }
  return { draftStart, draftEnd, busy, err, saved, changed, markStart, markEnd, reset, save }
}

function SegmentAudioPlayer({ recordingId, extractionId, startSec, endSec, onSpanSaved }: {
  recordingId: string
  extractionId: string
  startSec: number | null
  endSec: number | null
  onSpanSaved?: (e: RecordingExtractionRow) => void
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(startSec ?? 0)
  const [audioDur, setAudioDur] = useState<number>(0)
  const [rate, setRate] = useState(1)

  // Adjustable bounds — draft until saved. Null end = "to end of file".
  const {
    draftStart, draftEnd, busy: spanBusy, err: spanErr, saved: spanSaved, changed,
    markStart, markEnd, reset: resetSpan, save: saveSpan,
  } = useSpanEdit({ recordingId, extractionId, startSec, endSec, onSaved: onSpanSaved })

  const start = draftStart
  const hasWindow = draftEnd != null && draftEnd > start
  const effEnd = hasWindow ? (draftEnd as number) : (audioDur > start ? audioDur : start + 1)
  const dur = Math.max(1, effEnd - start)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    fetch(`/api/recordings/${recordingId}/audio`)
      .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d?.error || `audio ${r.status}`); return d })
      .then(d => { if (!cancelled) { setUrl(d.url as string); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e instanceof Error ? e.message : 'audio unavailable'); setLoading(false) } })
    return () => { cancelled = true }
  }, [recordingId])

  const onLoaded = () => {
    const a = audioRef.current; if (!a) return
    setAudioDur(a.duration || 0)
    a.currentTime = start; setPos(start)
  }
  const onTime = () => {
    const a = audioRef.current; if (!a) return
    setPos(a.currentTime)
    if (a.currentTime >= effEnd) { a.pause(); setPlaying(false) }
  }
  const toggle = () => {
    const a = audioRef.current; if (!a) return
    if (a.paused) {
      if (a.currentTime < start || a.currentTime >= effEnd) a.currentTime = start
      a.playbackRate = rate; void a.play(); setPlaying(true)
    } else { a.pause(); setPlaying(false) }
  }
  const replay = () => { const a = audioRef.current; if (!a) return; a.currentTime = start; a.playbackRate = rate; void a.play(); setPlaying(true) }
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current; if (!a) return
    const rect = e.currentTarget.getBoundingClientRect()
    const f = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    a.currentTime = start + f * dur; setPos(a.currentTime)
  }
  const cycleRate = () => {
    const next = rate === 1 ? 1.25 : rate === 1.25 ? 1.5 : rate === 1.5 ? 2 : 1
    setRate(next); if (audioRef.current) audioRef.current.playbackRate = next
  }

  const frac = Math.min(1, Math.max(0, (pos - start) / dur))

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-500">
        <LottieLoader size={22} /> Loading meeting audio…
      </div>
    )
  }
  if (error || !url) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs text-gray-500">
        Audio not available for this meeting{error ? ` (${error})` : ''}.
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
      <audio ref={audioRef} src={url} preload="metadata" onLoadedMetadata={onLoaded} onTimeUpdate={onTime} onEnded={() => setPlaying(false)} className="hidden" />
      <div className="flex items-center gap-3">
        <button type="button" onClick={toggle}
          className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white shadow-sm hover:brightness-95 transition" style={{ background: HERMES }}
          title={playing ? 'Pause' : 'Play this answer'} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <rect x="2.5" y="2" width="3.6" height="12" rx="1.4" />
              <rect x="9.9" y="2" width="3.6" height="12" rx="1.4" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M4 2.6c0-.86.94-1.39 1.67-.94l8.2 5.4a1.1 1.1 0 0 1 0 1.88l-8.2 5.4A1.1 1.1 0 0 1 4 13.4V2.6z" />
            </svg>
          )}
        </button>
        <button type="button" onClick={replay}
          className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-200/60 transition" title="Replay from the start of this answer" aria-label="Replay">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2.5 8a5.5 5.5 0 1 0 1.7-3.98" />
            <path d="M2.2 2.6V5.2H4.8" />
          </svg>
        </button>
        <div className="flex-1">
          <div className="h-2 bg-gray-200 rounded-full cursor-pointer relative" onClick={seek}>
            <div className="absolute inset-y-0 left-0 rounded-l-full" style={{ width: `${frac * 100}%`, background: HERMES }} />
            <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white border-2 shadow" style={{ left: `${frac * 100}%`, borderColor: HERMES }} />
            {/* End-of-segment marker — the clip stops here (the answer's end in the transcript). */}
            {hasWindow && <div className="absolute -top-1 -bottom-1 right-0 w-[2px] bg-gray-500 rounded" title={`Segment ends at ${formatTime(effEnd)}`} />}
          </div>
          <div className="flex justify-between text-[10px] text-gray-400 font-mono mt-1">
            <span>{formatTime(pos)}</span>
            <span>{formatTime(effEnd)}{hasWindow ? ' (end)' : ''}</span>
          </div>
        </div>
        <button type="button" onClick={cycleRate} className="shrink-0 text-[11px] font-semibold text-gray-500 hover:text-gray-900 w-9 text-center" title="Playback speed">{rate}×</button>
      </div>

      {/* Trim controls — adjust the segment to match the answer in the audio. */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
        <span className="text-gray-400">Segment</span>
        <span className="font-mono text-gray-700">{formatTime(start)} – {hasWindow ? formatTime(effEnd) : 'end'}</span>
        <button type="button" onClick={() => markStart(pos)} disabled={spanBusy}
          className="px-2 py-0.5 rounded border border-gray-300 hover:bg-gray-100 disabled:opacity-40" title="Set the segment start to the current playhead">⇤ Set start</button>
        <button type="button" onClick={() => markEnd(pos)} disabled={spanBusy}
          className="px-2 py-0.5 rounded border border-gray-300 hover:bg-gray-100 disabled:opacity-40" title="Set the segment end to the current playhead">Set end ⇥</button>
        {changed && (
          <>
            <button type="button" onClick={saveSpan} disabled={spanBusy}
              className="px-2 py-0.5 rounded text-white font-semibold disabled:opacity-40" style={{ background: HERMES }}>{spanBusy ? 'Saving…' : 'Save segment'}</button>
            <button type="button" onClick={resetSpan} disabled={spanBusy} className="px-2 py-0.5 rounded border border-gray-200 hover:bg-gray-100 disabled:opacity-40">Reset</button>
          </>
        )}
        {spanSaved && !changed && <span className="text-green-700">Saved ✓</span>}
        {spanErr && <span className="text-red-600">{spanErr}</span>}
      </div>
      <p className="text-[10px] text-gray-400 mt-1">
        {hasWindow
          ? `Plays this answer's segment and stops at its end. Scrub to find the real boundaries, then “Set start/end” + Save to fix the timestamps.`
          : 'No timestamp on this pair — plays the full meeting. Scrub to the answer and “Set start/end” to give it one.'}
      </p>
    </div>
  )
}

// ── Edit modal: the 3-layer Q&A editor (§3.5d) ───────────────────────────────
// Verbatim (locked, the record of truth) and the AI polished version are shown
// read-only; the editable box is what becomes "of record for display". Saving
// writes payload.edited_*; the AI + verbatim are never destroyed, so "Revert to
// AI" always restores the machine version. Distinct from Regenerate (re-runs AI).
function EditPairModal({ recordingId, extraction, onClose, onSaved }: {
  recordingId: string
  extraction: RecordingExtractionRow
  onClose: () => void
  onSaved: (e: RecordingExtractionRow) => void
}) {
  const payload = extraction.payload as QaPairPayload
  const aiQ = payload.polished_question || payload.question
  const aiA = payload.polished_answer || payload.answer
  const [editQ, setEditQ] = useState(payload.edited_question || aiQ)
  const [editA, setEditA] = useState(payload.edited_answer || aiA)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const patch = async (bodyObj: { edited_question: string | null; edited_answer: string | null }) => {
    setBusy(true); setErr(null)
    try {
      const res = await fetch(`/api/recordings/${recordingId}/extractions/${extraction.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyObj),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d?.error || `Save failed (${res.status})`)
      onSaved(d.extraction as RecordingExtractionRow)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  // Only persist a side as "edited" when it actually differs from the AI version.
  const save = () => patch({
    edited_question: editQ.trim() && editQ.trim() !== aiQ ? editQ.trim() : null,
    edited_answer: editA.trim() && editA.trim() !== aiA ? editA.trim() : null,
  })
  const revert = () => patch({ edited_question: null, edited_answer: null })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && onClose()}>
      <div className="bg-white rounded-2xl p-5 max-w-2xl w-full max-h-[88vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-bold text-gray-900 mb-1">Edit this Q&amp;A for display</h2>
        <p className="text-xs text-gray-500 mb-4">Your edit becomes the version shown in the report, link, PDF, and deck. The verbatim and AI versions are kept — use “Revert to AI” to undo.</p>
        <div className="mb-4">
          <SegmentAudioPlayer recordingId={recordingId} extractionId={extraction.id} startSec={extraction.start_sec} endSec={extraction.end_sec} onSpanSaved={onSaved} />
        </div>
        <div className="space-y-5">
          <EditLayer label="Question" verbatim={payload.question} ai={aiQ} value={editQ} onChange={setEditQ} rows={2} />
          <EditLayer label="Response" verbatim={payload.answer} ai={aiA} value={editA} onChange={setEditA} rows={5} />
        </div>
        {err && <p className="text-sm text-red-600 mt-3 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</p>}
        <div className="flex items-center gap-3 mt-5">
          <button onClick={save} disabled={busy}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-40" style={{ background: HERMES }}>
            {busy ? 'Saving…' : 'Save edit'}
          </button>
          {isEdited(payload) && (
            <button onClick={revert} disabled={busy}
              className="px-3 py-2 rounded-xl text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40">
              Revert to AI
            </button>
          )}
          <button onClick={onClose} disabled={busy}
            className="ml-auto px-3 py-2 rounded-xl text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-40">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Action items tab ─────────────────────────────────────────────────────────

function ActionItemsTab({ extractions, transcript }: { extractions: RecordingExtractionRow[]; transcript: RecordingTranscriptRow | null }) {
  const segments = useMemo(() => (transcript?.segments ?? []) as TranscriptSegment[], [transcript])
  // action_item rows carry no timestamps — trace each back to its closest
  // transcript passage so a reviewer can verify where it came from.
  const traces = useMemo(
    () => extractions.map(e => traceActionItem(segments, (e.payload as ActionItemPayload)?.description ?? '')),
    [extractions, segments],
  )
  const [modal, setModal] = useState<{ description: string; trace: NonNullable<ReturnType<typeof traceActionItem>> } | null>(null)

  if (extractions.length === 0) return <EmptyState label="No action items extracted." />
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Follow-ups and commitments the synthesis pass pulled from the discussion. These are not Q&amp;A pairs — they also appear in the exported deck, and never on the public Q&amp;A link.
      </p>
      <ul className="space-y-2">
        {extractions.map((e, i) => {
          const p = e.payload as ActionItemPayload
          const trace = traces[i]
          return (
            <li key={e.id} className="border border-gray-200 rounded-xl p-4 bg-white">
              <p className="text-sm text-gray-900">{p.description}</p>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {p.related_agenda_item && (
                  <span className="px-2 py-0.5 rounded-full bg-gray-100 text-xs text-gray-600">{p.related_agenda_item}</span>
                )}
                {p.owner && (
                  <span className="px-2 py-0.5 rounded-full bg-gray-100 text-xs text-gray-600">Owner: {p.owner}</span>
                )}
                {p.due_date && (
                  <span className="px-2 py-0.5 rounded-full bg-gray-100 text-xs text-gray-600">Due: {p.due_date}</span>
                )}
                {trace && (
                  <button
                    type="button"
                    onClick={() => setModal({ description: p.description, trace })}
                    className="px-2 py-0.5 rounded-full text-xs font-medium text-teal-700 border border-teal-200 hover:bg-teal-50 transition-colors"
                    title="Show the transcript passage this action item came from"
                  >
                    ↪ Source · {formatTime(trace.anchorStart)}
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {modal && <ActionSourceModal description={modal.description} trace={modal.trace} segments={segments} onClose={() => setModal(null)} />}
    </div>
  )
}

// Trace modal: the transcript window an action item was derived from, anchor bold.
function ActionSourceModal({ description, trace, segments, onClose }: {
  description: string
  trace: { anchorStart: number; windowStart: number; windowEnd: number }
  segments: TranscriptSegment[]
  onClose: () => void
}) {
  const window = useMemo(
    () => segments.filter(s => s.start >= trace.windowStart - 0.5 && s.start <= trace.windowEnd + 0.5).sort((a, b) => a.start - b.start),
    [segments, trace],
  )
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-teal-700 mb-1">Action item · source</div>
            <p className="text-sm font-medium text-gray-900">{description}</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg leading-none shrink-0">✕</button>
        </div>
        <ol className="space-y-1.5">
          {window.map((s, i) => (
            <li key={i} className="text-sm flex gap-2">
              <span className="font-mono text-xs text-gray-400 shrink-0 pt-0.5">{formatTime(s.start)}</span>
              <span className={s.start === trace.anchorStart ? 'font-semibold text-gray-900' : 'text-gray-600'}>{s.text}</span>
            </li>
          ))}
        </ol>
        <p className="text-xs text-gray-400 mt-3">Closest transcript passage for this action item (bold line = best match). Synthesis paraphrases, so this is the nearest source — not a verbatim quote.</p>
      </div>
    </div>
  )
}

// ── Coverage tab ─────────────────────────────────────────────────────────────

// Sentiment → dot color for the per-topic overlay.
const SENTIMENT_DOT: Record<string, { color: string; label: string }> = {
  positive: { color: '#16A34A', label: 'positive' },
  neutral:  { color: '#9CA3AF', label: 'neutral' },
  negative: { color: '#DC2626', label: 'negative' },
  mixed:    { color: '#F59E0B', label: 'mixed' },
}

function CoverageTab({ recording, extractions, transcript, onReviewFlagged }: { recording: RecordingRow; extractions: RecordingExtractionRow[]; transcript: RecordingTranscriptRow | null; onReviewFlagged: () => void }) {
  const qaPairs = useMemo(
    () => extractions.filter(e => e.unit_type === 'qa_pair'),
    [extractions],
  )
  const segments = useMemo(() => (transcript?.segments ?? []) as TranscriptSegment[], [transcript])
  const [modal, setModal] = useState<{ pair: RecordingExtractionRow; index: number } | null>(null)
  // Recompute coverage live from the current Q&A pairs — excludes action items
  // (which would spike the histogram + inflate totals) and reflects regenerated
  // pairs without needing a re-extract. NewExtraction is a subset of the row.
  const cr = useMemo(
    () => computeCoverage({
      setup_inputs: recording.setup_inputs,
      extractions: qaPairs,
      source_duration_sec: recording.source_duration_sec,
    }),
    [recording.setup_inputs, recording.source_duration_sec, qaPairs],
  )

  if (qaPairs.length === 0) return <EmptyState label="No Q&A pairs to analyze yet." />

  const maxTopicCount = Math.max(1, ...cr.per_topic.map(t => t.count))
  // Per-topic density, ordered by frequency (most-discussed first), with the
  // synthesis pass's per-topic sentiment overlaid (matched by topic name).
  const topicSentiment = new Map<string, string>()
  for (const ts of recording.analysis_summary?.topic_summaries ?? []) {
    if (ts.topic) topicSentiment.set(ts.topic.trim().toLowerCase(), ts.sentiment)
  }
  const sortedTopics = [...cr.per_topic].sort((a, b) => b.count - a.count)
  const histMax = Math.max(1, ...cr.confidence_histogram.map(x => x.count))
  const durationSec = recording.source_duration_sec && recording.source_duration_sec > 0
    ? recording.source_duration_sec
    : Math.max(1, ...qaPairs.map(p => p.end_sec ?? 0))
  const timed = qaPairs
    .filter(p => typeof p.start_sec === 'number')
    .sort((a, b) => (a.start_sec as number) - (b.start_sec as number))
  // Stagger overlapping pairs into lanes so a block never hides another's number.
  const { lanes, laneCount } = packLanes(timed.map(p => ({ start: p.start_sec as number, end: p.end_sec ?? (p.start_sec as number) })))
  // Six evenly-spaced time ticks across the meeting for the axis.
  const axisTicks = Array.from({ length: 6 }, (_, i) => Math.round((durationSec * i) / 5))

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-base font-bold text-gray-900 mb-2">
          Meeting timeline <span className="text-gray-400 text-sm font-normal">· {timed.length} Q&amp;A across {formatDuration(durationSec)}</span>
        </h2>
        <div className="relative">
          <div className="relative bg-gray-100 rounded overflow-hidden" style={{ height: barHeight(laneCount) }}>
            {/* Long quiet stretches (≥5min, no extraction) shaded behind the blocks. */}
            {cr.per_minute_gaps.map((g, i) => {
              const left = (g.start_sec / durationSec) * 100
              const w = ((g.end_sec - g.start_sec) / durationSec) * 100
              return (
                <div
                  key={`gap-${i}`}
                  className="absolute inset-y-0"
                  style={{
                    left: `${left}%`,
                    width: `${w}%`,
                    backgroundImage: 'repeating-linear-gradient(45deg, rgba(148,163,184,0.28) 0, rgba(148,163,184,0.28) 6px, transparent 6px, transparent 12px)',
                  }}
                  title={`Quiet stretch · ${formatTime(g.start_sec)}–${formatTime(g.end_sec)} (${formatDuration(g.end_sec - g.start_sec)} with no extracted pair)`}
                />
              )
            })}
            {timed.map((p, i) => {
              const start = p.start_sec as number
              const end = p.end_sec ?? start
              const left = (start / durationSec) * 100
              const widthPct = Math.max(1.2, ((end - start) / durationSec) * 100)
              const color = p.flagged_for_review ? '#F59E0B' : '#16A34A'
              const q = (p.payload as QaPairPayload)?.question ?? ''
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setModal({ pair: p, index: i + 1 })}
                  className="absolute flex items-center justify-center gap-1 rounded-sm border border-white box-border hover:ring-2 hover:ring-offset-1 hover:ring-gray-400 transition-shadow"
                  style={{ top: laneTop(lanes[i]), height: LANE_H, left: `${left}%`, width: `${widthPct}%`, backgroundColor: color }}
                  title={`#${i + 1} · ${formatTime(start)}–${formatTime(end)} (${formatDuration(end - start)}) — ${q}`}
                >
                  <span
                    className="rounded-full bg-white flex items-center justify-center font-bold shadow-sm leading-none shrink-0"
                    style={{ width: 16, height: 16, fontSize: 9, color }}
                  >
                    {i + 1}
                  </span>
                  {widthPct >= 6 && (
                    <span className="text-white font-semibold whitespace-nowrap leading-none" style={{ fontSize: 9 }}>
                      {formatDuration(end - start)}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          {/* time axis */}
          <div className="relative h-4 mt-1">
            {axisTicks.map(t => (
              <span
                key={t}
                className="absolute -translate-x-1/2 text-[10px] text-gray-400 font-mono"
                style={{ left: `${(t / durationSec) * 100}%` }}
              >
                {formatTime(t)}
              </span>
            ))}
          </div>
        </div>
        <div className="text-xs text-gray-500 mt-1">
          Each block is a Q&amp;A pair, placed + sized by when it occurred — <span className="font-semibold" style={{ color: '#16A34A' }}>green</span> = clean, <span className="font-semibold" style={{ color: '#F59E0B' }}>amber</span> = flagged for review. Click a block to read its transcript. <span className="text-gray-400">▥</span> hatched bands = long quiet stretches (≥5 min, no extraction).
        </div>
      </section>

      <section>
        <h2 className="text-base font-bold text-gray-900 mb-2">Per-topic density</h2>
        <ul className="space-y-1">
          {sortedTopics.map(t => {
            const sentiment = topicSentiment.get(t.topic.trim().toLowerCase())
            const dot = sentiment ? SENTIMENT_DOT[sentiment] : null
            return (
              <li key={t.topic} className="flex items-center gap-3 text-sm">
                <span className={`w-48 truncate flex items-center gap-1.5 ${t.flagged ? 'text-yellow-700' : 'text-gray-700'}`}>
                  {dot && (
                    <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dot.color }} title={`Sentiment: ${dot.label}`} />
                  )}
                  <span className="truncate">{t.flagged ? '⚠ ' : ''}{t.topic}</span>
                </span>
                <div className="flex-1 h-2 bg-gray-100 rounded">
                  <div className="h-full rounded" style={{ width: `${(t.count / maxTopicCount) * 100}%`, backgroundColor: t.flagged ? '#F59E0B' : HERMES }} />
                </div>
                <span className="w-10 text-right text-gray-600">{t.count}</span>
              </li>
            )
          })}
        </ul>
        {topicSentiment.size > 0 && (
          <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-400">
            <span>Dot = topic sentiment:</span>
            {(['positive', 'neutral', 'negative', 'mixed'] as const).map(s => (
              <span key={s} className="inline-flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: SENTIMENT_DOT[s].color }} />{s}
              </span>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-base font-bold text-gray-900 mb-2">Confidence histogram</h2>
        <div className="grid grid-cols-10 gap-1 items-end">
          {cr.confidence_histogram.map(b => {
            const h = b.count === 0 ? 0 : Math.max(6, Math.round((b.count / histMax) * 80))
            return (
              <div key={b.bucket} className="flex flex-col items-center justify-end">
                <span className="text-[10px] text-gray-600 mb-0.5 h-3 leading-none">{b.count > 0 ? b.count : ''}</span>
                <div className="w-full bg-orange-300 rounded-t" style={{ height: `${h}px` }} title={`${b.bucket}: ${b.count}`} />
                <span className="text-[10px] text-gray-400 mt-1">{b.bucket.slice(0, 3)}</span>
              </div>
            )
          })}
        </div>
        <div className="text-xs text-gray-500 mt-2">Q&amp;A pairs grouped by extraction confidence; left edge = least confident.</div>
      </section>

      <section>
        <h2 className="text-base font-bold text-gray-900 mb-2">
          Flagged for review <span className="text-gray-400 text-sm font-normal">· {cr.flagged_count} / {cr.total_extractions}</span>
        </h2>
        {cr.flagged_count === 0 ? (
          <p className="text-sm text-gray-500">Nothing flagged — every extracted pair passed the curator.</p>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-gray-700">
              {cr.flagged_count} pair{cr.flagged_count === 1 ? '' : 's'} the curator flagged for review — the same {cr.flagged_count} behind the <span className="font-medium">&ldquo;{cr.flagged_count} to review&rdquo;</span> badge on the Coverage tab and the <span className="font-medium">&ldquo;{cr.flagged_count} pair{cr.flagged_count === 1 ? '' : 's'} need review&rdquo;</span> alert on the project card.
            </p>
            <button
              type="button"
              onClick={onReviewFlagged}
              className="shrink-0 px-3 py-1.5 rounded-lg text-sm font-semibold text-white whitespace-nowrap"
              style={{ backgroundColor: '#F59E0B' }}
            >
              Review {cr.flagged_count} flagged →
            </button>
          </div>
        )}
      </section>

      {cr.per_minute_gaps.length > 0 && (
        <section>
          <h2 className="text-base font-bold text-gray-900 mb-2">Long quiet stretches</h2>
          <ul className="text-sm text-gray-700 space-y-1">
            {cr.per_minute_gaps.map((g, i) => (
              <li key={i}>{formatTime(g.start_sec)} → {formatTime(g.end_sec)} ({formatDuration(g.end_sec - g.start_sec)} with no extracted pair)</li>
            ))}
          </ul>
          <div className="text-xs text-gray-500 mt-1">Stretches ≥ 5 minutes with no extraction. May indicate missed pairs or genuine quiet (panel monologue, technical breaks).</div>
        </section>
      )}

      {modal && (
        <TimelineExcerptModal
          pair={modal.pair}
          index={modal.index}
          segments={segments}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}

// Click-through from a timeline block → the verbatim transcript for that Q&A
// span, with the same question-bold / answer-bold-italic overlay.
function TimelineExcerptModal({ pair, index, segments, onClose }: {
  pair: RecordingExtractionRow
  index: number
  segments: TranscriptSegment[]
  onClose: () => void
}) {
  const start = pair.start_sec ?? 0
  const end = pair.end_sec ?? start
  const inSpan = useMemo(
    () => segments.filter(s => s.start >= start - 1 && s.start <= end + 1).sort((a, b) => a.start - b.start),
    [segments, start, end],
  )
  const roles = useMemo(() => buildTranscriptRoles(inSpan, [pair]), [inSpan, pair])
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <span
              className="rounded-full text-white flex items-center justify-center font-bold shrink-0"
              style={{ width: 20, height: 20, fontSize: 11, backgroundColor: pair.flagged_for_review ? '#F59E0B' : '#16A34A' }}
            >
              {index}
            </span>
            {formatTime(start)} → {formatTime(end)}
            {pair.flagged_for_review && <span className="text-xs font-normal text-yellow-700">⚠ flagged for review</span>}
          </h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg leading-none">✕</button>
        </div>
        {inSpan.length === 0 ? (
          <p className="text-sm text-gray-500">Transcript segments for this span aren&apos;t available.</p>
        ) : (
          <ol className="space-y-1.5">
            {inSpan.map((s, i) => {
              const role = roles.get(s.start)
              const cls = role === 'question' ? 'font-bold text-gray-900'
                : role === 'answer' ? 'font-bold italic text-gray-900'
                : 'text-gray-600'
              return (
                <li key={i} className="text-sm flex gap-2">
                  <span className="font-mono text-xs text-gray-400 shrink-0 pt-0.5">{formatTime(s.start)}</span>
                  <span className={cls}>{s.text}</span>
                </li>
              )
            })}
          </ol>
        )}
        <p className="text-xs text-gray-400 mt-3"><span className="font-bold">Bold</span> = question · <span className="font-bold italic">bold italic</span> = answer. Verbatim transcript.</p>
      </div>
    </div>
  )
}

// ── Transcript tab ───────────────────────────────────────────────────────────

function TranscriptTab({ transcript, entityMap, extractions, onPlay }: { transcript: RecordingTranscriptRow | null; entityMap: EntityMap | null; extractions: RecordingExtractionRow[]; onPlay: PlayHandler }) {
  // Hooks must run in the same order every render — keep useState + useMemo
  // above any early return. Null transcript → empty segments + empty filtered.
  const [search, setSearch] = useState('')
  const segments = useMemo(
    () => (transcript?.segments ?? []) as TranscriptSegment[],
    [transcript],
  )
  // Audit overlay: which segments became an extracted Q&A pair (question vs
  // answer), keyed by segment start. Plain segments weren't extracted.
  const roles = useMemo(() => buildTranscriptRoles(segments, extractions), [segments, extractions])
  // Corrected view = deterministic variant→canonical from the entity map. Only
  // meaningful when there's something to replace. The raw ASR is never mutated;
  // this derives the corrected view on read (the two-transcripts model).
  const replacements = useMemo(() => buildReplacements(entityMap), [entityMap])
  const canCorrect = replacements.length > 0
  const [view, setView] = useState<'corrected' | 'raw'>(canCorrect ? 'corrected' : 'raw')
  const corrected = useMemo(() => normalizeSegments(segments, entityMap), [segments, entityMap])
  const active = view === 'corrected' && canCorrect ? corrected : segments

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return active
    return active.filter(s => s.text.toLowerCase().includes(q))
  }, [active, search])

  if (!transcript) return <EmptyState label="Transcript not available yet." />

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search transcript…"
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-base"
          style={{ fontSize: '16px' }}
        />
        {canCorrect && (
          <div className="flex rounded-lg border border-gray-200 overflow-hidden shrink-0 text-xs">
            <button
              type="button"
              onClick={() => setView('corrected')}
              className={`px-3 py-2 font-medium ${view === 'corrected' ? 'bg-orange-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >Corrected</button>
            <button
              type="button"
              onClick={() => setView('raw')}
              className={`px-3 py-2 font-medium ${view === 'raw' ? 'bg-gray-700 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >Raw</button>
          </div>
        )}
        <div className="text-xs text-gray-500 shrink-0">
          {filtered.length} / {segments.length} segments
        </div>
      </div>
      <p className="text-xs text-gray-500">
        {canCorrect && view === 'corrected'
          ? <>Spelling-corrected view — names normalized to the reviewed spellings. The raw ASR (record of truth, {transcript.vendor}) is unchanged — switch to “Raw” to see it.</>
          : <>Record of truth — verbatim ASR output ({transcript.vendor}). Never edited by AI.</>}
      </p>
      {roles.size > 0 && (
        <p className="text-xs text-gray-500">
          Audit overlay: <span className="font-bold text-gray-900">bold</span> = extracted question · <span className="font-bold italic text-gray-900">bold italic</span> = answer · plain = not extracted into a Q&amp;A pair.
        </p>
      )}
      <ol className="divide-y divide-gray-100 max-h-[70vh] overflow-y-auto pr-2">
        {filtered.map((s, i) => (
          <li key={i} className="py-2 text-sm flex items-start gap-3 group">
            <button
              type="button"
              onClick={() => onPlay(s.start, s.end, s.text.slice(0, 80))}
              title="Play from here"
              className="font-mono text-xs text-gray-400 hover:text-orange-600 w-14 shrink-0 pt-0.5 text-left"
            >
              ▶ {formatTime(s.start)}
            </button>
            {s.speaker && <span className="text-xs font-semibold text-gray-500 w-10 shrink-0 pt-0.5">{s.speaker}</span>}
            {(() => {
              const role = roles.get(s.start)
              const cls = role === 'question' ? 'font-bold text-gray-900'
                : role === 'answer' ? 'font-bold italic text-gray-900'
                : 'text-gray-800'
              return <span className={cls}>{highlight(s.text, search)}</span>
            })()}
          </li>
        ))}
      </ol>
    </div>
  )
}

// ── Config versions + sign-off (§2.8) ────────────────────────────────────────

interface ConfigVersion {
  version_number: number
  source: 'manual' | 'analysis'
  change_note: string | null
  created_at: string
  created_by_name: string | null
}

function VersionSignoffPanel({ recordingId, signoff, analyzedVersion }: {
  recordingId: string
  signoff: Signoff | null
  analyzedVersion: number | null
}) {
  const router = useRouter()
  const [versions, setVersions] = useState<ConfigVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [signNote, setSignNote] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/recordings/${recordingId}/versions`)
      const d = await r.json().catch(() => ({}))
      if (r.ok) setVersions((d.versions ?? []) as ConfigVersion[])
    } finally { setLoading(false) }
  }, [recordingId])
  useEffect(() => { load() }, [load])

  const saveVersion = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/recordings/${recordingId}/versions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ change_note: note.trim() || undefined }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.error || `Save failed (${r.status})`)
      setNote('')
      await load()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Save failed') } finally { setBusy(false) }
  }

  const approve = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/recordings/${recordingId}/signoff`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: signNote.trim() || undefined }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.error || `Approve failed (${r.status})`)
      router.refresh()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Approve failed') } finally { setBusy(false) }
  }
  const revoke = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/recordings/${recordingId}/signoff`, { method: 'DELETE' })
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d?.error || `Revoke failed (${r.status})`) }
      router.refresh()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Revoke failed') } finally { setBusy(false) }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-5">
      <div>
        <h3 className="font-semibold text-gray-900 text-sm">Review sign-off</h3>
        {signoff?.approved_by ? (
          <div className="mt-2 flex items-start justify-between gap-3">
            <p className="text-sm text-green-700">
              ✓ Approved by <span className="font-medium">{signoff.approved_by}</span>
              {signoff.approved_at ? ` on ${new Date(signoff.approved_at).toLocaleString()}` : ''}
              {signoff.note ? <span className="block text-xs text-gray-500 mt-0.5">“{signoff.note}”</span> : null}
            </p>
            <button type="button" onClick={revoke} disabled={busy}
              className="shrink-0 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40">Revoke</button>
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-2">
            <input type="text" value={signNote} onChange={e => setSignNote(e.target.value)} placeholder="Optional note (e.g. reviewed against the recording)"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2" style={{ fontSize: '16px' }} disabled={busy} />
            <button type="button" onClick={approve} disabled={busy}
              className="shrink-0 px-3 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-40" style={{ background: '#0d9488' }}>
              Mark reviewed &amp; approved
            </button>
          </div>
        )}
      </div>

      <div className="border-t border-gray-100 pt-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 text-sm">Config versions</h3>
          <span className="text-xs text-gray-400">{analyzedVersion != null ? `Analysis ran on v${analyzedVersion}` : 'Not analyzed yet'}</span>
        </div>
        <p className="text-xs text-gray-500 mt-1 mb-2">A snapshot is saved automatically each time you run the analysis; save one manually to checkpoint a setup change.</p>
        <div className="flex items-center gap-2 mb-3">
          <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="What changed? (optional)"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2" style={{ fontSize: '16px' }} disabled={busy} />
          <button type="button" onClick={saveVersion} disabled={busy}
            className="shrink-0 px-3 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-40" style={{ background: HERMES }}>Save version</button>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-400"><LottieLoader size={20} /> Loading…</div>
        ) : versions.length === 0 ? (
          <p className="text-sm text-gray-400">No versions yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm">
            {versions.map(v => (
              <li key={v.version_number} className="py-2 flex items-center gap-3">
                <span className="font-mono text-xs font-semibold text-gray-700 w-10">v{v.version_number}</span>
                <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${v.source === 'analysis' ? 'bg-orange-50 text-orange-700' : 'bg-gray-100 text-gray-600'}`}>{v.source === 'analysis' ? 'analysis' : 'manual'}</span>
                {analyzedVersion === v.version_number && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-green-50 text-green-700">live</span>}
                <span className="text-gray-500 text-xs flex-1 truncate">{v.change_note || <span className="text-gray-400">—</span>}</span>
                <span className="text-gray-400 text-xs whitespace-nowrap">{v.created_by_name ? `${v.created_by_name} · ` : ''}{new Date(v.created_at).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {err && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</p>}
    </div>
  )
}

// ── Export & Share tab ───────────────────────────────────────────────────────

function ExportTab({ recordingId, recordingName, status, isOwner, initialShareEnabled, initialShareToken, initialShareVerbatim, agents, initialBrandTag, initialAgentId }: {
  recordingId: string
  recordingName: string
  status: string
  isOwner: boolean
  initialShareEnabled: boolean
  initialShareToken: string | null
  initialShareVerbatim: boolean
  agents: Array<{ id: string; name: string }>
  initialBrandTag: string | null
  initialAgentId: string | null
}) {
  const [generating, setGenerating] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [includeTranscript, setIncludeTranscript] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const ready = status === 'complete'

  // Public share link (§4.7). Owner-only; the token-gated page lives at /th/[token].
  const [shareEnabled, setShareEnabled] = useState(initialShareEnabled)
  const [shareToken, setShareToken] = useState<string | null>(initialShareToken)
  const [shareVerbatim, setShareVerbatim] = useState(initialShareVerbatim)
  const [shareBusy, setShareBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const shareUrl = shareToken && typeof window !== 'undefined' ? `${window.location.origin}/th/${shareToken}` : ''

  // Send to principals (§4.15) — owner emails the report (link and/or PDF) to a
  // typed recipient list. The sender chooses what to include.
  const [recipients, setRecipients] = useState('')
  const [sendNote, setSendNote] = useState('')
  const [sendLink, setSendLink] = useState(true)
  const [sendPdf, setSendPdf] = useState(false)
  const [sendTranscript, setSendTranscript] = useState(false)
  const [sendBusy, setSendBusy] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sendResult, setSendResult] = useState<{ sent: number; failed: number; rejected?: string[] } | null>(null)

  // Brand / linked agent (§3.5c) — settable post-upload; a re-extract then seeds
  // spelling correction from that brand's curated entity catalog (agent + brand).
  const [brandTag, setBrandTag] = useState(initialBrandTag ?? '')
  const [agentId, setAgentId] = useState(initialAgentId ?? '')
  const [linkBusy, setLinkBusy] = useState(false)
  const [linkSaved, setLinkSaved] = useState(false)
  const saveLink = async () => {
    setLinkBusy(true); setError(null); setLinkSaved(false)
    try {
      const res = await fetch(`/api/recordings/${recordingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand_tag: brandTag.trim() || null, underlying_agent_id: agentId || null }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d?.error || `Save failed (${res.status})`)
      setLinkSaved(true)
    } catch (e: any) {
      setError(e?.message || 'Save failed')
    } finally {
      setLinkBusy(false)
    }
  }

  // One call covers both fields — always send the current state of the other so
  // toggling one never clobbers the other (the route updates whatever's present).
  const postShare = async (body: { enabled: boolean; show_verbatim: boolean }) => {
    setShareBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/recordings/${recordingId}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d?.error || `Share update failed (${res.status})`)
      setShareEnabled(d.enabled)
      if (d.token) setShareToken(d.token)
      if (typeof d.show_verbatim === 'boolean') setShareVerbatim(d.show_verbatim)
    } catch (e) {
      setError((e as Error)?.message || 'Share update failed')
    } finally {
      setShareBusy(false)
    }
  }

  const toggleShare = (next: boolean) => postShare({ enabled: next, show_verbatim: shareVerbatim })
  const setVerbatim = (next: boolean) => postShare({ enabled: shareEnabled, show_verbatim: next })

  const copyLink = async () => {
    if (!shareUrl) return
    try { await navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* ignore */ }
  }

  const handleSend = async () => {
    setSendBusy(true); setSendError(null); setSendResult(null)
    try {
      const res = await fetch(`/api/recordings/${recordingId}/report/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipients,
          note: sendNote,
          includeLink: sendLink && shareEnabled,
          includePdf: sendPdf,
          includeTranscript: sendTranscript,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d?.error || `Send failed (${res.status})`)
      setSendResult({ sent: d.sent ?? 0, failed: d.failed ?? 0, rejected: d.rejected })
      if ((d.sent ?? 0) > 0) { setRecipients(''); setSendNote('') }
    } catch (e: any) {
      setSendError(e?.message || 'Send failed')
    } finally {
      setSendBusy(false)
    }
  }

  const handleExport = async () => {
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch(`/api/recordings/${recordingId}/export/pptx`, { method: 'POST' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d?.error || `Export failed (${res.status})`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${recordingName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-qa-report.pptx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError((e as Error)?.message || 'Export failed')
    } finally {
      setGenerating(false)
    }
  }

  const handlePdf = async () => {
    setPdfBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/recordings/${recordingId}/report/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeTranscript }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d?.error || `PDF failed (${res.status})`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${recordingName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-report.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError((e as Error)?.message || 'PDF failed')
    } finally {
      setPdfBusy(false)
    }
  }

  if (generating) {
    return (
      <div className="py-12 flex flex-col items-center">
        <LottieLoader size={120} message="Building your PowerPoint…" />
      </div>
    )
  }

  if (pdfBusy) {
    return (
      <div className="py-12 flex flex-col items-center">
        <LottieLoader size={120} message="Building your PDF…" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <h2 className="text-base font-bold text-gray-900">Export &amp; Share</h2>

      {isOwner && (
        <div className="rounded-xl border border-gray-200 p-4">
          <div className="text-sm font-semibold text-gray-900">Brand &amp; linked agent</div>
          <p className="text-sm text-gray-500 mt-0.5 mb-3">
            Tag this meeting with a brand and/or link an agent — a re-extract then draws on that brand&apos;s curated entity catalog to auto-correct name spellings (e.g. panel members) and feeds brand-level analysis.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-600">Brand tag</span>
              <input value={brandTag} onChange={e => { setBrandTag(e.target.value); setLinkSaved(false) }} placeholder="e.g. NOWOCATS"
                className="border border-gray-300 rounded-lg px-3 py-2" style={{ fontSize: '16px', minWidth: 200 }} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-600">Linked agent</span>
              <select value={agentId} onChange={e => { setAgentId(e.target.value); setLinkSaved(false) }}
                className="border border-gray-300 rounded-lg px-3 py-2 bg-white" style={{ fontSize: '16px', minWidth: 200 }}>
                <option value="">— none —</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <button onClick={saveLink} disabled={linkBusy}
              className="px-3 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50">
              {linkBusy ? 'Saving…' : 'Save'}
            </button>
            {linkSaved && <span className="text-xs text-emerald-600 self-center">Saved ✓ — re-extract to apply.</span>}
          </div>
          {agents.length === 0 && <p className="text-xs text-gray-400 mt-2">No agents in this org yet.</p>}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 p-4 flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-gray-900">PowerPoint deck</div>
          <p className="text-sm text-gray-500 mt-0.5">
            Datanautix-branded Q&amp;A session report — executive summary, conversation themes, sentiment, action items, and an appendix slide for every Q&amp;A pair.
          </p>
          {!ready && (
            <p className="text-xs text-amber-600 mt-1.5">Available once analysis is complete (status: {status}).</p>
          )}
        </div>
        <button
          onClick={handleExport}
          disabled={!ready}
          className="shrink-0 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-40"
          style={{ background: HERMES }}
        >
          Export to PowerPoint
        </button>
      </div>

      <div className="rounded-xl border border-gray-200 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-gray-900">PDF report</div>
            <p className="text-sm text-gray-500 mt-0.5">
              The same Datanautix-branded Q&amp;A summary as the public link, as a PDF for principal handoff — meeting overview and polished Q&amp;A by topic.
            </p>
            {!ready && <p className="text-xs text-amber-600 mt-1.5">Available once analysis is complete (status: {status}).</p>}
          </div>
          <button
            onClick={handlePdf}
            disabled={!ready}
            className="shrink-0 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-40"
            style={{ background: HERMES }}
          >
            Download PDF
          </button>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-gray-700 select-none cursor-pointer">
          <input
            type="checkbox"
            checked={includeTranscript}
            onChange={e => setIncludeTranscript(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          Include full transcript appendix (spelling-corrected)
        </label>
      </div>

      {isOwner && (
        <div className="rounded-xl border border-gray-200 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-gray-900">Public link</div>
              <p className="text-sm text-gray-500 mt-0.5">
                A read-only web report (polished Q&amp;A by topic) anyone with the link can open — no login. Share it with principals or post it publicly.
              </p>
              {!ready && <p className="text-xs text-amber-600 mt-1.5">Available once analysis is complete.</p>}
            </div>
            <button
              onClick={() => toggleShare(!shareEnabled)}
              disabled={!ready || shareBusy}
              className={`shrink-0 px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40 ${shareEnabled ? 'border border-gray-300 text-gray-700 hover:bg-gray-50' : 'text-white'}`}
              style={shareEnabled ? undefined : { background: HERMES }}
            >
              {shareBusy ? '…' : shareEnabled ? 'Disable link' : 'Enable public link'}
            </button>
          </div>
          {shareEnabled && shareUrl && (
            <>
              <div className="mt-3 flex items-center gap-2">
                <input
                  readOnly
                  value={shareUrl}
                  onFocus={e => e.currentTarget.select()}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 bg-gray-50"
                  style={{ fontSize: '16px' }}
                />
                <button
                  onClick={copyLink}
                  className="shrink-0 px-3 py-2 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              {/* What the public page shows for each answer. Polished is the default. */}
              <div className="mt-3 flex items-center gap-2 text-sm">
                <span className="text-gray-500">Show:</span>
                <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
                  <button
                    onClick={() => setVerbatim(false)}
                    disabled={shareBusy}
                    className={`px-3 py-1.5 font-medium transition-colors ${!shareVerbatim ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                  >
                    Polished
                  </button>
                  <button
                    onClick={() => setVerbatim(true)}
                    disabled={shareBusy}
                    className={`px-3 py-1.5 font-medium transition-colors border-l border-gray-300 ${shareVerbatim ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                  >
                    Verbatim
                  </button>
                </div>
              </div>
              <p className="mt-1.5 text-xs text-gray-400">
                {shareVerbatim
                  ? 'The link shows the exact words spoken (verbatim Q&A). The meeting transcript stays private.'
                  : 'The link shows the cleaned-up, publication-ready Q&A (recommended).'}
              </p>
            </>
          )}
        </div>
      )}

      {isOwner && (
        <div className="rounded-xl border border-gray-200 p-4">
          <div className="text-sm font-semibold text-gray-900">Send to principals</div>
          <p className="text-sm text-gray-500 mt-0.5">
            Email the Datanautix-branded report straight to stakeholders. Choose whether to include the live link, attach the PDF, or both. Replies go to you.
          </p>
          {!ready && <p className="text-xs text-amber-600 mt-1.5">Available once analysis is complete.</p>}

          <label className="block text-xs font-medium text-gray-600 mt-3 mb-1">Recipients</label>
          <textarea
            value={recipients}
            onChange={e => setRecipients(e.target.value)}
            placeholder="principal@example.org, chair@example.org"
            rows={2}
            disabled={!ready}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-700 disabled:bg-gray-50"
            style={{ fontSize: '16px' }}
          />
          <p className="text-xs text-gray-400 mt-1">Separate addresses with commas or new lines (up to 25).</p>

          <label className="block text-xs font-medium text-gray-600 mt-3 mb-1">Personal note (optional)</label>
          <textarea
            value={sendNote}
            onChange={e => setSendNote(e.target.value)}
            placeholder="Thanks for joining — here's the Q&A summary from today's meeting."
            rows={2}
            disabled={!ready}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-700 disabled:bg-gray-50"
            style={{ fontSize: '16px' }}
          />

          <div className="mt-3 space-y-2">
            <label className={`flex items-center gap-2 text-sm select-none ${shareEnabled ? 'text-gray-700 cursor-pointer' : 'text-gray-400'}`}>
              <input
                type="checkbox"
                checked={sendLink && shareEnabled}
                disabled={!shareEnabled}
                onChange={e => setSendLink(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              Include the report link
              {!shareEnabled && <span className="text-xs text-amber-600">(enable the public link above first)</span>}
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 select-none cursor-pointer">
              <input
                type="checkbox"
                checked={sendPdf}
                onChange={e => setSendPdf(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              Attach the PDF report
            </label>
            {sendPdf && (
              <label className="flex items-center gap-2 text-sm text-gray-700 select-none cursor-pointer pl-6">
                <input
                  type="checkbox"
                  checked={sendTranscript}
                  onChange={e => setSendTranscript(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                Include full transcript appendix in the PDF
              </label>
            )}
          </div>

          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={handleSend}
              disabled={!ready || sendBusy || !recipients.trim() || (!sendPdf && !(sendLink && shareEnabled))}
              className="shrink-0 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-40"
              style={{ background: HERMES }}
            >
              {sendBusy ? 'Sending…' : 'Send report'}
            </button>
            {sendResult && sendResult.sent > 0 && (
              <span className="text-sm text-green-700">
                Sent to {sendResult.sent} recipient{sendResult.sent === 1 ? '' : 's'}{sendResult.failed > 0 ? `, ${sendResult.failed} failed` : ''}.
              </span>
            )}
          </div>
          {sendResult && sendResult.rejected && sendResult.rejected.length > 0 && (
            <p className="text-xs text-amber-600 mt-1.5">Skipped invalid: {sendResult.rejected.join(', ')}</p>
          )}
          {sendError && <p className="text-sm text-red-600 mt-1.5">{sendError}</p>}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <p className="text-sm text-gray-500">More formats land in a follow-up:</p>
      <ul className="text-sm text-gray-700 list-disc list-outside pl-5 space-y-1">
        <li>XLSX — structured pairs only (analyst format)</li>
      </ul>
    </div>
  )
}

// ── Stubs ────────────────────────────────────────────────────────────────────

// ── Audio modal player (§ 5.4) ────────────────────────────────────────────────
// One shared player. Fetches a short-TTL signed URL for the stitched mp3 on
// open, seeks to the requested start, and keeps a synced transcript view that
// highlights + auto-scrolls the segment under the playhead (click to seek).

const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2]

function AudioModal({ recordingId, segments, req, onClose, onSpanSaved }: {
  recordingId: string
  segments: TranscriptSegment[]
  req: AudioRequest
  onClose: () => void
  onSpanSaved?: (e: RecordingExtractionRow) => void
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const activeRef = useRef<HTMLLIElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(req.startSec)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState(1)

  // Span-trim controls — only when the player was opened for a specific pair.
  const span = useSpanEdit({ recordingId, extractionId: req.extractionId, startSec: req.startSec, endSec: req.endSec, onSaved: onSpanSaved })

  // Fetch the signed URL once per mount.
  useEffect(() => {
    let cancelled = false
    setErr(null)
    fetch(`/api/recordings/${recordingId}/audio`, { cache: 'no-store' })
      .then(async res => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body?.error || `audio ${res.status}`)
        if (!cancelled) setUrl(body.url as string)
      })
      .catch(e => { if (!cancelled) setErr(e instanceof Error ? e.message : 'failed to load audio') })
    return () => { cancelled = true }
  }, [recordingId])

  // Seek to the requested start (and play) whenever a new Play request arrives.
  useEffect(() => {
    const a = audioRef.current
    if (!a || !url) return
    const seekAndPlay = () => {
      try { a.currentTime = req.startSec } catch { /* not seekable yet */ }
      a.playbackRate = rate
      a.play().catch(() => { /* autoplay may be blocked; user can hit play */ })
    }
    if (a.readyState >= 1) seekAndPlay()
    else a.addEventListener('loadedmetadata', seekAndPlay, { once: true })
    // rate intentionally omitted from deps — we don't want a rate change to re-seek.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, req.startSec, req.nonce])

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const activeIdx = useMemo(() => {
    let idx = -1
    for (let i = 0; i < segments.length; i++) {
      if (segments[i].start <= currentTime) idx = i
      else break
    }
    return idx
  }, [segments, currentTime])

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeIdx])

  const seekTo = (t: number) => {
    const a = audioRef.current
    if (!a) return
    a.currentTime = Math.max(0, Math.min(t, duration || t))
  }
  const skip = (delta: number) => seekTo(currentTime + delta)
  const togglePlay = () => {
    const a = audioRef.current
    if (!a) return
    if (a.paused) a.play().catch(() => {}); else a.pause()
  }
  const changeRate = (r: number) => {
    setRate(r)
    if (audioRef.current) audioRef.current.playbackRate = r
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-2xl w-full p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs text-gray-500">Playing from {formatTime(req.startSec)}</div>
            <div className="text-sm font-semibold text-gray-900 truncate">{req.label}</div>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none shrink-0">×</button>
        </div>

        <audio
          ref={audioRef}
          src={url ?? undefined}
          preload="auto"
          onLoadedMetadata={e => setDuration((e.target as HTMLAudioElement).duration || 0)}
          onTimeUpdate={e => setCurrentTime((e.target as HTMLAudioElement).currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />

        {err ? (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">{err}</div>
        ) : !url ? (
          <div className="text-sm text-gray-500 py-6 text-center">Loading audio…</div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={togglePlay}
                className="w-12 h-12 rounded-full text-white flex items-center justify-center text-lg shrink-0"
                style={{ backgroundColor: HERMES }}
                aria-label={playing ? 'Pause' : 'Play'}
              >
                {playing ? '❚❚' : '▶'}
              </button>
              <div className="flex-1">
                <input
                  type="range"
                  min={0}
                  max={duration || 0}
                  step={0.1}
                  value={Math.min(currentTime, duration || currentTime)}
                  onChange={e => seekTo(Number(e.target.value))}
                  className="w-full accent-orange-600"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex gap-1">
                <SkipButton label="−30s" onClick={() => skip(-30)} />
                <SkipButton label="−15s" onClick={() => skip(-15)} />
                <SkipButton label="+15s" onClick={() => skip(15)} />
                <SkipButton label="+30s" onClick={() => skip(30)} />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-gray-500 mr-1">Speed</span>
                {PLAYBACK_RATES.map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => changeRate(r)}
                    className={'text-xs px-2 py-1 rounded ' + (rate === r ? 'bg-orange-100 text-orange-700 font-semibold' : 'text-gray-500 hover:bg-gray-100')}
                  >
                    {r}×
                  </button>
                ))}
              </div>
            </div>

            {req.extractionId && (
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500 border-t border-gray-100 pt-3">
                <span className="text-gray-400">Segment</span>
                <span className="font-mono text-gray-700">{formatTime(span.draftStart)} – {span.draftEnd != null ? formatTime(span.draftEnd) : 'end'}</span>
                <button type="button" onClick={() => span.markStart(currentTime)} disabled={span.busy}
                  className="px-2 py-0.5 rounded border border-gray-300 hover:bg-gray-100 disabled:opacity-40" title="Set the segment start to the current playhead">⇤ Set start</button>
                <button type="button" onClick={() => span.markEnd(currentTime)} disabled={span.busy}
                  className="px-2 py-0.5 rounded border border-gray-300 hover:bg-gray-100 disabled:opacity-40" title="Set the segment end to the current playhead">Set end ⇥</button>
                {span.changed && !span.saved && (
                  <>
                    <button type="button" onClick={span.save} disabled={span.busy} className="px-2 py-0.5 rounded text-white font-semibold disabled:opacity-40" style={{ background: HERMES }}>{span.busy ? 'Saving…' : 'Save segment'}</button>
                    <button type="button" onClick={span.reset} disabled={span.busy} className="px-2 py-0.5 rounded border border-gray-200 hover:bg-gray-100 disabled:opacity-40">Reset</button>
                  </>
                )}
                {span.saved && <span className="text-green-700">Saved ✓</span>}
                {span.err && <span className="text-red-600">{span.err}</span>}
                <span className="basis-full text-[10px] text-gray-400">Scrub to the real boundary, then “Set start/end” + Save to fix the timestamps.</span>
              </div>
            )}

            {segments.length > 0 && (
              <ol className="border-t border-gray-100 pt-3 max-h-64 overflow-y-auto divide-y divide-gray-50">
                {segments.map((s, i) => {
                  const active = i === activeIdx
                  return (
                    <li
                      key={i}
                      ref={active ? activeRef : undefined}
                      className={'py-1.5 px-2 text-sm flex items-start gap-2 cursor-pointer rounded ' + (active ? 'bg-orange-50' : 'hover:bg-gray-50')}
                      onClick={() => seekTo(s.start)}
                    >
                      <span className="font-mono text-xs text-gray-400 w-12 shrink-0 pt-0.5">{formatTime(s.start)}</span>
                      {s.speaker && <span className="text-xs font-semibold text-gray-500 w-9 shrink-0 pt-0.5">{s.speaker}</span>}
                      <span className={active ? 'text-gray-900' : 'text-gray-700'}>{s.text}</span>
                    </li>
                  )
                })}
              </ol>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function SkipButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs px-2 py-1 border border-gray-200 rounded text-gray-700 hover:bg-gray-50"
    >
      {label}
    </button>
  )
}

function StubMenu({ label, tooltip, small }: { label: string; tooltip: string; small?: boolean }) {
  return (
    <button
      type="button"
      title={tooltip}
      disabled
      className={`${small ? 'text-xs' : 'text-sm'} px-2 py-1 text-gray-400 cursor-not-allowed`}
    >
      {label}
    </button>
  )
}

function EmptyState({ label }: { label: string }) {
  return <div className="text-sm text-gray-500 text-center py-8">{label}</div>
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface TopicGroup {
  topic: string
  items: RecordingExtractionRow[]
}

function groupByTopic(extractions: RecordingExtractionRow[], agenda: string[]): TopicGroup[] {
  const byTopic = new Map<string, RecordingExtractionRow[]>()
  for (const e of extractions) {
    const t = e.topic ?? 'Other'
    if (!byTopic.has(t)) byTopic.set(t, [])
    byTopic.get(t)!.push(e)
  }
  const out: TopicGroup[] = []
  for (const topic of agenda) {
    const items = byTopic.get(topic)
    if (items && items.length > 0) {
      out.push({ topic, items })
      byTopic.delete(topic)
    }
  }
  // Non-agenda topics ("Other" + anything model invented despite the prompt) trail.
  for (const [topic, items] of Array.from(byTopic.entries())) {
    out.push({ topic, items })
  }
  return out
}

function firstLine(s: string): string {
  const t = s.trim()
  const dot = t.indexOf('.')
  const newline = t.indexOf('\n')
  let end = -1
  if (dot > 0 && newline > 0) end = Math.min(dot, newline)
  else if (dot > 0) end = dot
  else if (newline > 0) end = newline
  if (end < 0 || end > 160) end = Math.min(t.length, 160)
  return t.slice(0, end + 1)
}

function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function highlight(text: string, query: string): React.ReactNode {
  const q = query.trim()
  if (!q) return text
  const lower = text.toLowerCase()
  const ql = q.toLowerCase()
  const parts: React.ReactNode[] = []
  let i = 0
  while (i < text.length) {
    const idx = lower.indexOf(ql, i)
    if (idx < 0) { parts.push(text.slice(i)); break }
    if (idx > i) parts.push(text.slice(i, idx))
    parts.push(<mark key={idx} className="bg-yellow-200 rounded px-0.5">{text.slice(idx, idx + q.length)}</mark>)
    i = idx + q.length
  }
  return parts
}
