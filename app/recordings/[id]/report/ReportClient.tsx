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
import { useRouter } from 'next/navigation'
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
} from '@/lib/recordings/types'
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
}

type PlayHandler = (startSec: number | null, endSec: number | null, label: string) => void

export interface ReportData {
  recording: RecordingRow
  files: RecordingFileRow[]
  transcript: RecordingTranscriptRow | null
  extractions: RecordingExtractionRow[]
  agents: Array<{ id: string; name: string }>   // org's agents, for the brand/agent link (§3.5c)
  isOwner: boolean
  analyticsDatasetId: string | null   // dataset mirror id when Analytics is available; null = hide cross-link
}

type Tab = 'qa' | 'actions' | 'coverage' | 'transcript' | 'export'

const HERMES = '#E8632A'

export default function ReportClient({ data }: { data: ReportData }) {
  const [tab, setTab] = useState<Tab>('coverage')

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
  const playAt = useCallback((startSec: number | null, endSec: number | null, label: string) => {
    nonceRef.current += 1
    setAudioReq({ startSec: startSec ?? 0, endSec, label, nonce: nonceRef.current })
  }, [])

  const segments = useMemo(
    () => (data.transcript?.segments ?? []) as TranscriptSegment[],
    [data.transcript],
  )

  return (
    <div className="space-y-6">
      <ReportHeader recording={data.recording} qaPairCount={qaPairs.length} analyticsDatasetId={data.analyticsDatasetId} />

      <TabBar
        tab={tab}
        onChange={setTab}
        counts={{
          qa: qaPairs.length,
          actions: actionItems.length,
          coverage: data.recording.coverage_report?.flagged_count ?? 0,
        }}
      />

      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        {tab === 'qa' && <QATab recordingId={recordingId} extractions={qaPairs} agenda={agenda} onReplaced={replaceExtraction} onPlay={playAt} />}
        {tab === 'actions' && <ActionItemsTab extractions={actionItems} transcript={data.transcript} />}
        {tab === 'coverage' && <CoverageTab recording={data.recording} extractions={extractions} transcript={data.transcript} />}
        {tab === 'transcript' && <TranscriptTab transcript={data.transcript} entityMap={data.recording.entity_map} extractions={extractions} onPlay={playAt} />}
        {tab === 'export' && (
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
        )}
      </div>

      {audioReq && (
        <AudioModal
          recordingId={recordingId}
          segments={segments}
          req={audioReq}
          onClose={() => setAudioReq(null)}
        />
      )}
    </div>
  )
}

// ── Header ───────────────────────────────────────────────────────────────────

function ReportHeader({ recording, qaPairCount, analyticsDatasetId }: { recording: RecordingRow; qaPairCount: number; analyticsDatasetId: string | null }) {
  return (
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
        {analyticsDatasetId && (
          <Link href={`/analyze/${analyticsDatasetId}`} className="text-xs text-gray-500 hover:text-orange-600 underline">
            Open in Analytics ↗
          </Link>
        )}
        <StatusBadge status={recording.status} />
      </div>
    </header>
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
  tab, onChange, counts,
}: {
  tab: Tab
  onChange: (t: Tab) => void
  counts: { qa: number; actions: number; coverage: number }
}) {
  const tabs: Array<{ key: Tab; label: string; badge?: number }> = [
    { key: 'coverage',   label: 'Coverage',     badge: counts.coverage },
    { key: 'qa',         label: 'Q&A',          badge: counts.qa },
    { key: 'actions',    label: 'Action items', badge: counts.actions },
    { key: 'transcript', label: 'Transcript' },
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
              <span className="ml-2 text-xs text-gray-400">{t.badge}</span>
            )}
          </button>
        )
      })}
    </nav>
  )
}

// ── Q&A tab ──────────────────────────────────────────────────────────────────

function QATab({ recordingId, extractions, agenda, onReplaced, onPlay }: {
  recordingId: string
  extractions: RecordingExtractionRow[]
  agenda: string[]
  onReplaced: (e: RecordingExtractionRow) => void
  onPlay: PlayHandler
}) {
  const router = useRouter()
  // Typology filter — all pairs show by default; chips narrow to one typology.
  const TYPOLOGY_ORDER = ['ask', 'clarification', 'complaint', 'commentary'] as const
  const typeCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of extractions) {
      const t = (e.payload as QaPairPayload)?.question_typology || 'ask'
      m.set(t, (m.get(t) ?? 0) + 1)
    }
    return m
  }, [extractions])
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const filtered = useMemo(
    () => typeFilter === 'all'
      ? extractions
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

      {typeCounts.size > 1 && (
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

function QACard({ recordingId, extraction, expanded, onToggle, onReplaced, onPlay, ordinal }: {
  recordingId: string
  extraction: RecordingExtractionRow
  expanded: boolean
  onToggle: () => void
  onReplaced: (e: RecordingExtractionRow) => void
  onPlay: PlayHandler
  // Sequence number in the "In order" view; omitted in topic view.
  ordinal?: number
}) {
  const payload = extraction.payload as QaPairPayload
  const flagged = extraction.flagged_for_review
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
            {typeof extraction.confidence === 'number' && (
              <span className="text-gray-500">confidence {(extraction.confidence * 100).toFixed(0)}%</span>
            )}
          </div>
          <div className="flex gap-2 pt-2">
            {extraction.start_sec != null && (
              <button
                type="button"
                onClick={() => onPlay(extraction.start_sec, extraction.end_sec, payload.question)}
                className="text-xs px-2 py-1 border border-gray-200 rounded text-gray-700 hover:bg-gray-50"
              >
                ▶ Play this segment
              </button>
            )}
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

function CoverageTab({ recording, extractions, transcript }: { recording: RecordingRow; extractions: RecordingExtractionRow[]; transcript: RecordingTranscriptRow | null }) {
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
          <div className="relative bg-gray-100 rounded" style={{ height: barHeight(laneCount) }}>
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
          Each block is a Q&amp;A pair, placed + sized by when it occurred — <span className="font-semibold" style={{ color: '#16A34A' }}>green</span> = clean, <span className="font-semibold" style={{ color: '#F59E0B' }}>amber</span> = flagged for review. Click a block to read its transcript; blank gaps = no extraction.
        </div>
      </section>

      <section>
        <h2 className="text-base font-bold text-gray-900 mb-2">Per-topic density</h2>
        <ul className="space-y-1">
          {cr.per_topic.map(t => (
            <li key={t.topic} className="flex items-center gap-3 text-sm">
              <span className={`w-48 truncate ${t.flagged ? 'text-yellow-700' : 'text-gray-700'}`}>
                {t.flagged ? '⚠ ' : ''}{t.topic}
              </span>
              <div className="flex-1 h-2 bg-gray-100 rounded">
                <div className="h-full rounded" style={{ width: `${(t.count / maxTopicCount) * 100}%`, backgroundColor: t.flagged ? '#F59E0B' : HERMES }} />
              </div>
              <span className="w-10 text-right text-gray-600">{t.count}</span>
            </li>
          ))}
        </ul>
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
          <p className="text-sm text-gray-700">
            {cr.flagged_count} pair{cr.flagged_count === 1 ? '' : 's'} flagged for review — shown with a yellow background and a flag reason on the Q&amp;A tab (filter by typology to find them).
          </p>
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

      {error && <p className="text-sm text-red-600">{error}</p>}

      <p className="text-sm text-gray-500">More formats land in a follow-up:</p>
      <ul className="text-sm text-gray-700 list-disc list-inside space-y-1">
        <li>XLSX — structured pairs only (analyst format)</li>
        <li>Send to principals — Resend email with the share link</li>
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

function AudioModal({ recordingId, segments, req, onClose }: {
  recordingId: string
  segments: TranscriptSegment[]
  req: AudioRequest
  onClose: () => void
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const activeRef = useRef<HTMLLIElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(req.startSec)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState(1)

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
