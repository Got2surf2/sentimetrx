'use client'

// app/analyze/[datasetId]/report/ReportClient.tsx
//
// Recording report tabs (§ 5.4). Server fetches the full data tree once; this
// component owns the tab navigation, card expand/collapse, and transcript
// search. Per-card regenerate, the per-topic re-extract menu, the full
// re-extract "⋯ More" menu, and the audio modal player are stubbed pending
// § 4.5 / § 4.6 / § 4.10 / § 4.11 routes — the affordances render but their
// click handlers show a "not yet wired" tooltip rather than firing.

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type {
  RecordingRow,
  RecordingFileRow,
  RecordingTranscriptRow,
  RecordingExtractionRow,
  QaPairPayload,
  TranscriptSegment,
  QaSetupInputs,
} from '@/lib/recordings/types'

export interface ReportData {
  recording: RecordingRow
  files: RecordingFileRow[]
  transcript: RecordingTranscriptRow | null
  extractions: RecordingExtractionRow[]
  isOwner: boolean
}

type Tab = 'qa' | 'appendix' | 'coverage' | 'transcript' | 'export'

const HERMES = '#E8632A'

export default function ReportClient({ data }: { data: ReportData }) {
  const [tab, setTab] = useState<Tab>('qa')

  // Local mutable copy of the extractions — per-card regenerate (§ 4.10)
  // replaces individual rows in place, so we keep state here and rebuild
  // ask/nonAsk + grouping off of it.
  const [extractions, setExtractions] = useState<RecordingExtractionRow[]>(data.extractions)

  const replaceExtraction = useCallback((next: RecordingExtractionRow) => {
    setExtractions(prev => prev.map(e => (e.id === next.id ? next : e)))
  }, [])

  const recordingId = data.recording.id

  const { askExtractions, nonAskExtractions } = useMemo(() => {
    const ask: RecordingExtractionRow[] = []
    const nonAsk: RecordingExtractionRow[] = []
    for (const e of extractions) {
      const payload = e.payload as QaPairPayload
      if (payload?.question_typology === 'ask') ask.push(e)
      else nonAsk.push(e)
    }
    return { askExtractions: ask, nonAskExtractions: nonAsk }
  }, [extractions])

  const agenda = useMemo(() => {
    const setup = data.recording.setup_inputs as Partial<QaSetupInputs>
    return Array.isArray(setup?.agenda) ? setup.agenda : []
  }, [data.recording.setup_inputs])

  return (
    <div className="space-y-6">
      <ReportHeader recording={data.recording} extractionCount={extractions.length} />

      <TabBar
        tab={tab}
        onChange={setTab}
        counts={{
          qa: askExtractions.length,
          appendix: nonAskExtractions.length,
          coverage: data.recording.coverage_report?.flagged_count ?? 0,
        }}
      />

      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        {tab === 'qa' && <QATab recordingId={recordingId} extractions={askExtractions} agenda={agenda} onReplaced={replaceExtraction} />}
        {tab === 'appendix' && <AppendixTab recordingId={recordingId} extractions={nonAskExtractions} agenda={agenda} onReplaced={replaceExtraction} />}
        {tab === 'coverage' && <CoverageTab recording={data.recording} />}
        {tab === 'transcript' && <TranscriptTab transcript={data.transcript} />}
        {tab === 'export' && <ExportTab />}
      </div>
    </div>
  )
}

// ── Header ───────────────────────────────────────────────────────────────────

function ReportHeader({ recording, extractionCount }: { recording: RecordingRow; extractionCount: number }) {
  return (
    <header className="flex items-baseline justify-between">
      <div>
        <Link href="/analyze" className="text-xs text-gray-500 hover:text-gray-700">← Recordings</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">{recording.name}</h1>
        <p className="text-sm text-gray-500 mt-1">
          {recording.meeting_date ?? 'No date'}
          {recording.location ? ` · ${recording.location}` : ''}
          {' · '}
          {extractionCount} Q&amp;A pair{extractionCount === 1 ? '' : 's'}
          {recording.source_duration_sec ? ` · ${formatDuration(recording.source_duration_sec)} audio` : ''}
          {recording.asr_vendor_chosen ? ` · transcribed by ${recording.asr_vendor_chosen}` : ''}
        </p>
      </div>
      <StatusBadge status={recording.status} />
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
  counts: { qa: number; appendix: number; coverage: number }
}) {
  const tabs: Array<{ key: Tab; label: string; badge?: number }> = [
    { key: 'qa',         label: 'Q&A summary', badge: counts.qa },
    { key: 'appendix',   label: 'Appendix',    badge: counts.appendix },
    { key: 'coverage',   label: 'Coverage',    badge: counts.coverage },
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

function QATab({ recordingId, extractions, agenda, onReplaced }: {
  recordingId: string
  extractions: RecordingExtractionRow[]
  agenda: string[]
  onReplaced: (e: RecordingExtractionRow) => void
}) {
  const router = useRouter()
  const grouped = useMemo(() => groupByTopic(extractions, agenda), [extractions, agenda])
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
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <button type="button" onClick={() => { setExpandedAll(true); setExpanded(new Set()) }}
            className="text-xs px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50">Expand all</button>
          <button type="button" onClick={() => { setExpandedAll(false); setExpanded(new Set()) }}
            className="text-xs px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50">Collapse all</button>
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

      {grouped.length === 0 && (
        <EmptyState label="No 'ask' pairs extracted. Check the Appendix tab for clarifications and commentary." />
      )}

      {grouped.map(({ topic, items }) => (
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
              />
            ))}
          </ul>
        </section>
      ))}

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

function QACard({ recordingId, extraction, expanded, onToggle, onReplaced }: {
  recordingId: string
  extraction: RecordingExtractionRow
  expanded: boolean
  onToggle: () => void
  onReplaced: (e: RecordingExtractionRow) => void
}) {
  const payload = extraction.payload as QaPairPayload
  const flagged = extraction.flagged_for_review
  const [showComposer, setShowComposer] = useState(false)
  const [instructions, setInstructions] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

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
            <div className="text-sm font-semibold text-gray-900">{payload.question}</div>
            <div className="text-xs text-gray-500 mt-1">
              {payload.asker_name ?? 'Audience member'}
              {extraction.start_sec != null ? ` · ${formatTime(extraction.start_sec)}` : ''}
              {flagged && <> · <span className="text-yellow-700">⚠ flagged{extraction.flag_reason ? `: ${extraction.flag_reason}` : ''}</span></>}
            </div>
            {!expanded && (
              <div className="text-sm text-gray-600 mt-1 line-clamp-1">
                {firstLine(payload.answer)}
              </div>
            )}
          </div>
          <span className="text-gray-400 text-xs shrink-0">{expanded ? '▾' : '▸'}</span>
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-4 space-y-2 text-sm">
          <div className="border-l-2 border-gray-200 pl-3">
            <div className="text-xs text-gray-500 mb-1">Answer{payload.panelist_name ? ` — ${payload.panelist_name}` : ''}</div>
            <div className="text-gray-800 whitespace-pre-wrap">{payload.answer}</div>
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
            <StubButton label="▶ Play this segment" tooltip="Audio modal player — wiring pending (needs signed-URL route + tus-uploaded stitched.mp3 available)" />
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
    </li>
  )
}

// ── Appendix tab ─────────────────────────────────────────────────────────────

function AppendixTab({ recordingId, extractions, agenda, onReplaced }: {
  recordingId: string
  extractions: RecordingExtractionRow[]
  agenda: string[]
  onReplaced: (e: RecordingExtractionRow) => void
}) {
  const grouped = useMemo(() => groupByTopic(extractions, agenda), [extractions, agenda])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-500">
        Pairs the model classified as <em>complaint</em>, <em>commentary</em>, or <em>clarification</em> — kept for completeness but not surfaced in the main Q&amp;A summary. Use Regenerate with an instruction like "this is actually an ask" to move a card back into the main summary.
      </p>
      {grouped.length === 0 && <EmptyState label="No appendix pairs." />}
      {grouped.map(({ topic, items }) => (
        <section key={topic}>
          <h2 className="text-base font-bold text-gray-900 mb-2">
            {topic} <span className="text-gray-400 text-sm font-normal">· {items.length}</span>
          </h2>
          <ul className="space-y-2">
            {items.map(e => (
              <QACard
                key={e.id}
                recordingId={recordingId}
                extraction={e}
                expanded={expanded.has(e.id)}
                onToggle={() => setExpanded(prev => {
                  const next = new Set(prev)
                  if (next.has(e.id)) next.delete(e.id); else next.add(e.id)
                  return next
                })}
                onReplaced={onReplaced}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

// ── Coverage tab ─────────────────────────────────────────────────────────────

function CoverageTab({ recording }: { recording: RecordingRow }) {
  const cr = recording.coverage_report
  if (!cr) {
    return <EmptyState label="No coverage report computed yet." />
  }
  const maxTopicCount = Math.max(1, ...cr.per_topic.map(t => t.count))
  return (
    <div className="space-y-6">
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
        <div className="grid grid-cols-10 gap-1 items-end h-24">
          {cr.confidence_histogram.map(b => {
            const max = Math.max(1, ...cr.confidence_histogram.map(x => x.count))
            const h = Math.round((b.count / max) * 100)
            return (
              <div key={b.bucket} className="flex flex-col items-center">
                <div className="w-full bg-orange-300" style={{ height: `${h}%` }} title={`${b.bucket}: ${b.count}`} />
                <span className="text-[10px] text-gray-400 mt-1">{b.bucket.slice(0, 3)}</span>
              </div>
            )
          })}
        </div>
        <div className="text-xs text-gray-500 mt-2">Pairs grouped by confidence; left edge = least confident.</div>
      </section>

      <section>
        <h2 className="text-base font-bold text-gray-900 mb-2">
          Flagged for review <span className="text-gray-400 text-sm font-normal">· {cr.flagged_count} / {cr.total_extractions}</span>
        </h2>
        {cr.flagged_count === 0 ? (
          <p className="text-sm text-gray-500">Nothing flagged — every extracted pair passed the curator.</p>
        ) : (
          <p className="text-sm text-gray-700">
            {cr.flagged_count} pair{cr.flagged_count === 1 ? '' : 's'} flagged — shown with a yellow background and a flag reason in whichever tab holds them ({'Q&A'} for asks, Appendix for clarifications / commentary / complaints).
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
    </div>
  )
}

// ── Transcript tab ───────────────────────────────────────────────────────────

function TranscriptTab({ transcript }: { transcript: RecordingTranscriptRow | null }) {
  // Hooks must run in the same order every render — keep useState + useMemo
  // above any early return. Null transcript → empty segments + empty filtered.
  const [search, setSearch] = useState('')
  const segments = useMemo(
    () => (transcript?.segments ?? []) as TranscriptSegment[],
    [transcript],
  )
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return segments
    return segments.filter(s => s.text.toLowerCase().includes(q))
  }, [segments, search])

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
        <div className="text-xs text-gray-500 shrink-0">
          {filtered.length} / {segments.length} segments
        </div>
      </div>
      <p className="text-xs text-gray-500">
        Record of truth — verbatim ASR output ({transcript.vendor}). Never edited by AI.
      </p>
      <ol className="divide-y divide-gray-100 max-h-[70vh] overflow-y-auto pr-2">
        {filtered.map((s, i) => (
          <li key={i} className="py-2 text-sm flex items-start gap-3">
            <span className="font-mono text-xs text-gray-400 w-14 shrink-0 pt-0.5">{formatTime(s.start)}</span>
            {s.speaker && <span className="text-xs font-semibold text-gray-500 w-10 shrink-0 pt-0.5">{s.speaker}</span>}
            <span className="text-gray-800">{highlight(s.text, search)}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

// ── Export & Share tab (stub) ────────────────────────────────────────────────

function ExportTab() {
  return (
    <div className="space-y-4">
      <h2 className="text-base font-bold text-gray-900">Export &amp; Share</h2>
      <p className="text-sm text-gray-500">
        PDF export (Playwright), XLSX export of structured pairs, and the public-link toggle land in a follow-up commit — they need § 4.5 (exports) and § 4.7 (share) routes which aren't built yet.
      </p>
      <ul className="text-sm text-gray-700 list-disc list-inside space-y-1">
        <li>PDF — Q&A summary + transcript appendix (default for principal handoff)</li>
        <li>XLSX — structured pairs only (analyst format)</li>
        <li>Public share link — short-TTL token-gated read-only report</li>
        <li>Send to principals — Resend email with the share link</li>
      </ul>
    </div>
  )
}

// ── Stubs ────────────────────────────────────────────────────────────────────

function StubButton({ label, tooltip }: { label: string; tooltip: string }) {
  return (
    <button
      type="button"
      title={tooltip}
      disabled
      className="text-xs px-2 py-1 border border-gray-200 rounded text-gray-400 cursor-not-allowed"
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
