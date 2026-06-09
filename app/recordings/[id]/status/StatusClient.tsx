'use client'

// app/recordings/[id]/status/StatusClient.tsx
//
// Polls GET /api/recordings/[id] (§ 4.3) and renders the pipeline ladder.
// Poll cadence: 3s while active, paused (no more requests) once terminal.
// Routes to the report (/recordings/[id]/report) when status=complete
// + dataset_id is set. Renders error_message + a Retry button on failed.

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import AddRecordingClient from '../AddRecordingClient'
import type { MeetingProfile, PhaseMap, MeetingPhase, EntityMap, EntityMapEntry } from '@/lib/recordings/types'

const POLL_INTERVAL_MS = 3000

type Status =
  | 'draft' | 'awaiting_media'
  | 'uploading' | 'queued' | 'extracting' | 'transcribing' | 'transcribed'
  | 'analyzing' | 'rendering' | 'complete' | 'failed' | 'cancelled'

// Step list — vertical, Claude-Code-style. Each step renders with a
// past/current/future/failed icon + an optional sub-detail derived from
// the § 4.3 status payload.
const STEPS: Status[] = [
  'uploading', 'queued', 'extracting', 'transcribing', 'analyzing', 'complete',
]

const STEP_LABELS: Record<Status, string> = {
  draft:          'Draft',
  awaiting_media: 'Awaiting recording',
  uploading:    'Files uploaded',
  queued:       'Queued',
  extracting:   'Extracting audio',
  transcribing: 'Transcribing',
  transcribed:  'Transcribed',
  analyzing:    'Analyzing Q&A',
  rendering:    'Rendering',
  complete:     'Complete',
  failed:       'Failed',
  cancelled:    'Cancelled',
}

const HERMES = '#E8632A'

// Short labels for the compact horizontal progress pills.
const PILL_LABELS: Partial<Record<Status, string>> = {
  uploading: 'Uploaded', queued: 'Queued', extracting: 'Extract',
  transcribing: 'Transcribe', analyzing: 'Q&A', complete: 'Complete',
}

interface FileRow {
  id: string
  original_filename: string
  size_bytes: number
  duration_sec: number | null
  is_video: boolean
  upload_status: 'pending' | 'uploaded' | 'extracted' | 'failed'
}

interface TranscriptMeta {
  vendor: 'whisper' | 'deepgram' | 'hybrid'
  language_detected: string | null
  word_count: number | null
  duration_sec: number | null
  cost_cents: number
  completed_at: string
}

interface CoverageReport {
  total_extractions: number
  flagged_count: number
  per_topic: Array<{ topic: string; count: number; flagged: boolean }>
  per_minute_gaps: Array<{ start_sec: number; end_sec: number }>
}

interface QaSetupInputs {
  panel?: Array<{ name: string; role?: string }>
  agenda?: string[]
  ground_truth_url?: string
}

interface LiveSummary {
  headline: string
  summary: string
  topics: string[]
  open_questions: string[]
  decisions: string[]
}

interface StatusResponse {
  recording: {
    id: string
    name: string
    session_type: string
    setup_inputs: QaSetupInputs | Record<string, unknown> | null
    status: Status
    error_message: string | null
    asr_vendor_chosen: 'whisper' | 'deepgram' | 'hybrid' | null
    source_duration_sec: number | null
    meeting_profile: MeetingProfile | null
    phase_map: PhaseMap | null
    entity_map: EntityMap | null
    cost_cents: number
    dataset_id: string | null
    started_at: string | null
    completed_at: string | null
    live_summary: LiveSummary | null
  }
  files: FileRow[]
  transcript: TranscriptMeta | null
  extraction_count: number
}

interface Props {
  recordingId: string
  initialName: string
  initialStatus: string
}

export default function StatusClient({ recordingId, initialName, initialStatus }: Props) {
  const router = useRouter()
  const [data, setData] = useState<StatusResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)

  // The "Generate Q&A" pill scrolls to the panel that holds the review fields.
  const generatePanelRef = useRef<HTMLDivElement>(null)
  const scrollToGenerate = useCallback(() => {
    generatePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const status = (data?.recording.status ?? initialStatus) as Status
  const name = data?.recording.name ?? initialName
  const isTerminal = status === 'complete' || status === 'failed' || status === 'cancelled'
  // 'transcribed' is a stable pause awaiting the user — polling would just
  // re-fetch an unchanging row. Pause it; the gate's Generate flips the status
  // back to 'analyzing', which restarts the poll via the effect deps below.
  const isPaused = status === 'transcribed'
  // Setup-before-media: the project exists but no recording is attached. Show the
  // "Add recording" pane; nothing to poll until the user uploads + processes.
  // 'uploading' is included for recovery — if a prior attach flipped the project
  // to 'uploading' but the upload never finished, a page reload would otherwise
  // strand the user on the ladder with no way to re-add. The attach endpoint
  // clears the stale rows on re-attach, so re-adding here is safe.
  const isSetup = status === 'draft' || status === 'awaiting_media' || status === 'uploading'

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/recordings/${recordingId}`, { cache: 'no-store' })
      if (!res.ok) {
        setError(`Status fetch failed: ${res.status}`)
        return
      }
      const json = (await res.json()) as StatusResponse
      setData(json)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    }
  }, [recordingId])

  useEffect(() => {
    fetchStatus()
    if (isTerminal || isPaused || isSetup) return
    const id = setInterval(fetchStatus, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [fetchStatus, isTerminal, isPaused, isSetup])

  const handleRetry = async () => {
    setRetrying(true)
    try {
      // If transcription already succeeded, the failure was in analysis — retry
      // just that pass (cheap, no re-transcribe). Otherwise re-run the pipeline.
      const endpoint = data?.transcript
        ? `/api/recordings/${recordingId}/analyze`
        : `/api/recordings/${recordingId}/process`
      const res = await fetch(endpoint, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body?.error || `Retry failed: ${res.status}`)
      } else {
        await fetchStatus()
      }
    } finally {
      setRetrying(false)
    }
  }

  // Auto-route to the report when complete. The report is keyed by recording_id
  // (not dataset_id) now that Town Hall is its own product.
  useEffect(() => {
    if (status === 'complete') {
      const t = setTimeout(() => {
        router.push(`/recordings/${recordingId}/report`)
      }, 1200)
      return () => clearTimeout(t)
    }
  }, [status, recordingId, router])

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <Link href="/recordings" className="text-xs text-gray-500 hover:text-gray-700">← Town Hall</Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-2">{name}</h1>
          <p className="text-sm text-gray-500 mt-1">Recording {recordingId.slice(0, 8)}…</p>
        </div>
        <Link
          href={`/recordings/${recordingId}/setup`}
          className="shrink-0 mt-1 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
        >⚙ Edit setup</Link>
      </header>

      {isSetup ? (
        <div className="space-y-4">
          <Link
            href={`/recordings/${recordingId}/live`}
            className="flex items-center justify-between bg-white border-2 border-orange-200 rounded-2xl p-5 hover:border-orange-300 transition-colors"
          >
            <div>
              <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2"><span className="text-lg">🎙️</span> Record live</h2>
              <p className="text-xs text-gray-500 mt-1">In the room now? Capture the meeting live — we save the audio and process it automatically when you stop.</p>
            </div>
            <span className="shrink-0 text-orange-500 text-sm font-semibold">Start →</span>
          </Link>
          <div className="text-center text-xs text-gray-400">— or upload a recording —</div>
          <AddRecordingClient
            recordingId={recordingId}
            showSlides={data?.recording.meeting_profile?.preset_id === 'community_meeting'}
            onStarted={fetchStatus}
          />
        </div>
      ) : (
      <>
      {/* Compact horizontal status at the top; the full ladder is tucked below. */}
      <StatusPills status={status} data={data} onGenerate={scrollToGenerate} />

      {/* When the transcript is ready, the generate action is the primary thing
          the user came to do — keep it at the top. */}
      {status === 'transcribed' && data && (
        <div ref={generatePanelRef}>
          <GeneratePanel
            recordingId={recordingId}
            sessionType={data.recording.session_type}
            setupInputs={data.recording.setup_inputs}
            meetingProfile={data.recording.meeting_profile}
            phaseMap={data.recording.phase_map}
            entityMap={data.recording.entity_map}
            durationSec={data.recording.source_duration_sec}
            onStarted={fetchStatus}
          />
        </div>
      )}

      {data?.recording.live_summary && status !== 'complete' && status !== 'failed' && status !== 'cancelled' && (
        <ProvisionalRecap summary={data.recording.live_summary} />
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {status === 'failed' && data?.recording.error_message && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="font-semibold text-red-900 mb-1">Pipeline failed</h3>
          <p className="text-sm text-red-800 whitespace-pre-wrap">{data.recording.error_message}</p>
          <button
            type="button"
            onClick={handleRetry}
            disabled={retrying}
            className="mt-3 px-3 py-1.5 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-60"
          >
            {retrying ? 'Retrying…' : 'Retry from failed stage'}
          </button>
        </div>
      )}

      {status === 'complete' && data && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center justify-between">
          <div>
            <div className="font-semibold text-green-900">Complete — opening report…</div>
            <div className="text-sm text-green-800">
              {data.extraction_count} extracted pair{data.extraction_count === 1 ? '' : 's'}
              {data.transcript?.word_count ? ` from ${data.transcript.word_count.toLocaleString()} words` : ''}
            </div>
          </div>
          <Link
            href={`/recordings/${recordingId}/report`}
            className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded hover:bg-green-700"
          >
            Open report
          </Link>
        </div>
      )}

      {data && (
        <>
          <FilesPanel files={data.files} />
          {data.transcript && <TranscriptPanel transcript={data.transcript} />}
          {data.extraction_count > 0 && (
            <CoveragePanel count={data.extraction_count} cost_cents={data.recording.cost_cents} />
          )}
        </>
      )}
      </>
      )}
    </div>
  )
}

// ── Components ───────────────────────────────────────────────────────────────

// Provisional recap from the live-capture summary, shown while the batch
// pipeline runs. Superseded by the real report on completion.
function ProvisionalRecap({ summary }: { summary: LiveSummary }) {
  const hasBody = summary.summary || summary.topics.length || summary.open_questions.length || summary.decisions.length
  if (!hasBody && !summary.headline) return null
  return (
    <div className="bg-orange-50/60 border border-orange-200 rounded-xl p-4">
      <div className="flex items-center gap-2 text-xs font-semibold text-orange-700 uppercase tracking-wide">
        <span>Provisional summary</span>
        <span className="font-normal normal-case text-gray-400">— from the live session; full report is processing</span>
      </div>
      {summary.headline && <p className="mt-2 font-semibold text-gray-900">{summary.headline}</p>}
      {summary.summary && <p className="mt-1 text-sm text-gray-700">{summary.summary}</p>}
      {summary.topics.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {summary.topics.map((t, i) => (
            <span key={i} className="px-2 py-0.5 rounded-full bg-white border border-orange-200 text-xs text-gray-600">{t}</span>
          ))}
        </div>
      )}
      <div className="mt-3 grid sm:grid-cols-2 gap-3">
        {summary.open_questions.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Open questions</div>
            <ul className="list-disc list-outside pl-5 text-xs text-gray-700 space-y-0.5">
              {summary.open_questions.map((q, i) => <li key={i}>{q}</li>)}
            </ul>
          </div>
        )}
        {summary.decisions.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Decisions / actions</div>
            <ul className="list-disc list-outside pl-5 text-xs text-gray-700 space-y-0.5">
              {summary.decisions.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

type StepState = 'past' | 'current' | 'future' | 'failed'

// Compact horizontal progress bar. Completed steps fill with the brand color,
// the active step pulses, pending steps are grey, and the Q&A step becomes a
// "Generate Q&A" call-to-action when the pipeline is paused at the review gate.
function StatusPills({ status, data, onGenerate }: { status: Status; data: StatusResponse | null; onGenerate: () => void }) {
  const failedIdx = (status === 'failed' || status === 'cancelled') ? inferFailedStepIdx(data) : -1
  // Keep the active step's detail (vendor · words · cost) visible at a glance.
  const activeStep: Status | null = status === 'transcribed' ? 'transcribing' : (STEPS.includes(status) ? status : null)
  const activeDetail = activeStep ? computeStepDetail(activeStep, status === 'transcribed' ? 'past' : 'current', data) : null

  return (
    <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {STEPS.map((step, idx) => {
          const state = computeStepState(step, idx, status, failedIdx)
          if (step === 'analyzing' && status === 'transcribed') {
            return (
              <button
                key={step}
                type="button"
                onClick={onGenerate}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold text-white ring-2 ring-orange-300 hover:brightness-110 animate-pulse"
                style={{ backgroundColor: HERMES }}
                title="Generate the Q&A pairs"
              >
                ▶ Generate Q&amp;A
              </button>
            )
          }
          const base = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap '
          const cls =
            state === 'past'   ? 'text-white' :
            state === 'failed' ? 'bg-red-100 text-red-700' :
            state === 'current'? 'bg-orange-50 text-orange-700 border border-orange-300' :
                                 'bg-gray-100 text-gray-400'
          return (
            <span key={step} className={base + cls} style={state === 'past' ? { backgroundColor: HERMES } : undefined}>
              {state === 'past' && <span className="text-[10px]">✓</span>}
              {state === 'current' && <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />}
              {state === 'failed' && <span className="text-[10px]">✗</span>}
              {PILL_LABELS[step] ?? STEP_LABELS[step]}
            </span>
          )
        })}
      </div>
      {activeDetail && <div className="mt-2 text-xs text-gray-500">{activeDetail}</div>}
    </div>
  )
}

function computeStepState(step: Status, idx: number, status: Status, failedIdx: number): StepState {
  if (status === 'failed') {
    if (idx < failedIdx) return 'past'
    if (idx === failedIdx) return 'failed'
    return 'future'
  }
  if (status === 'cancelled') {
    // Treat cancelled the same as failed — paint the suspected step red and dim the rest.
    const cancelIdx = failedIdx >= 0 ? failedIdx : STEPS.indexOf(status as Status)
    if (idx < cancelIdx) return 'past'
    if (idx === cancelIdx) return 'failed'
    return 'future'
  }
  if (status === 'complete') {
    return 'past'   // every step including 'complete' shows the check
  }
  if (status === 'transcribed') {
    // Paused after ASR. Everything through 'transcribing' is done; analysis and
    // beyond are pending (no spinner — the Generate gate below is the next move).
    return idx <= STEPS.indexOf('transcribing') ? 'past' : 'future'
  }
  const currentIdx = STEPS.indexOf(status)
  if (idx < currentIdx) return 'past'
  if (idx === currentIdx) return 'current'
  return 'future'
}

// Server-side data → human sub-detail for each step.
function computeStepDetail(step: Status, state: StepState, data: StatusResponse | null): string | null {
  if (!data) return null
  const { files, transcript, extraction_count, recording } = data

  switch (step) {
    case 'uploading': {
      const total = files.length
      const totalMb = files.reduce((sum, f) => sum + f.size_bytes, 0) / (1024 * 1024)
      const audioCount = files.filter(f => !f.is_video).length
      const videoCount = total - audioCount
      const mix = videoCount > 0 && audioCount > 0
        ? `${videoCount} video + ${audioCount} audio`
        : videoCount > 0 ? `${videoCount} video file${videoCount === 1 ? '' : 's'}`
        : `${audioCount} audio file${audioCount === 1 ? '' : 's'}`
      return `${mix} · ${totalMb.toFixed(1)} MB total`
    }
    case 'queued': {
      if (state === 'current') return 'waiting for a worker'
      return null
    }
    case 'extracting': {
      const total = files.length
      const extracted = files.filter(f => f.upload_status === 'extracted').length
      if (state === 'past') {
        const stitchedNote = total > 1 ? ` + stitched` : ''
        return `${total} file${total === 1 ? '' : 's'} extracted${stitchedNote}`
      }
      if (state === 'current') {
        if (extracted < total) {
          return `${extracted} of ${total} ${extracted === 1 ? 'file' : 'files'} extracted · ffmpeg in Vercel Sandbox`
        }
        // All files extracted, stitching the canonical 16kHz mono mp3
        return total > 1 ? 'stitching files in order' : 'finalizing audio'
      }
      return null
    }
    case 'transcribing': {
      if (state === 'past' && transcript) {
        return `${transcript.vendor} · ${transcript.word_count?.toLocaleString() ?? '?'} words · ${formatCost(transcript.cost_cents)}`
      }
      if (state === 'current') {
        const vendor = recording.asr_vendor_chosen
        if (vendor === 'hybrid') return 'running Whisper + Deepgram in parallel'
        if (vendor === 'whisper') return 'running OpenAI Whisper'
        if (vendor === 'deepgram') return 'running Deepgram Nova-3 (batch)'
        return 'resolving ASR vendor + uploading stitched audio'
      }
      return null
    }
    case 'analyzing': {
      if (state === 'past') {
        return `${extraction_count} Q&A pair${extraction_count === 1 ? '' : 's'} extracted · Opus + Sonnet curator`
      }
      if (state === 'current') {
        if (extraction_count > 0) return `${extraction_count} pair${extraction_count === 1 ? '' : 's'} extracted so far · Sonnet curator running`
        return 'Opus 4.7 reading the transcript'
      }
      return null
    }
    case 'complete': {
      if (state === 'past') {
        // The complete step itself is "checked" when status is 'complete'.
        const totalCost = recording.cost_cents
        return `${extraction_count} Q&A pair${extraction_count === 1 ? '' : 's'} · ${formatCost(totalCost)} total`
      }
      return null
    }
    default:
      return null
  }
}

// When status='failed', guess which step failed by reading what made it to disk.
// Heuristic: walk forward; the first step we can't prove succeeded is the failed one.
function inferFailedStepIdx(data: StatusResponse | null): number {
  if (!data) return STEPS.indexOf('queued')
  const { files, transcript, extraction_count, recording } = data
  if (recording.status !== 'failed') return -1

  // Did extraction complete? Every file has upload_status='extracted'.
  const allExtracted = files.length > 0 && files.every(f => f.upload_status === 'extracted')
  if (!allExtracted) return STEPS.indexOf('extracting')
  if (!transcript) return STEPS.indexOf('transcribing')
  if (extraction_count === 0) return STEPS.indexOf('analyzing')
  // Files extracted, transcript written, extractions written — fail must have been
  // very late (mirror / coverage / complete). Pin to 'analyzing' since that's the
  // stage that owns mirror + coverage.
  return STEPS.indexOf('analyzing')
}

// ── Review & generate gate (Gate 1) ──────────────────────────────────────────
// Shown when the pipeline pauses at status='transcribed'. Lets the user fix the
// agenda / panel roster and add a steer before spending the ~$1 Opus + Sonnet
// pass. Editing here is intentionally lightweight: one topic per line, one
// "Name — role" per line — full structured editing lives on the report page's
// re-extract flow once pairs exist.
function GeneratePanel({
  recordingId, sessionType, setupInputs, meetingProfile, phaseMap, entityMap, durationSec, onStarted,
}: {
  recordingId: string
  sessionType: string
  setupInputs: QaSetupInputs | Record<string, unknown> | null
  meetingProfile: MeetingProfile | null
  phaseMap: PhaseMap | null
  entityMap: EntityMap | null
  durationSec: number | null
  onStarted: () => void | Promise<void>
}) {
  const isQa = sessionType === 'qa'
  const su = (setupInputs ?? {}) as QaSetupInputs

  // Presentation→Q&A split control (community meeting). The detected boundary
  // seeds it; the user can nudge it before the (paid) analysis runs.
  const hasPresentation = !!meetingProfile?.phases?.some(p => p.kind === 'presentation')
  const duration = durationSec ?? (phaseMap?.phases?.reduce((mx, p) => Math.max(mx, p.end_sec), 0) ?? 0)
  const detectedSplit = phaseMap?.phases?.find(p => p.kind === 'presentation')?.end_sec
    ?? (phaseMap?.phases?.find(p => p.kind === 'qa')?.start_sec ?? 0)
  const [splitText, setSplitText] = useState(() => formatMmss(detectedSplit || 0))

  const [agenda, setAgenda] = useState(() => (su.agenda ?? []).join('\n'))
  const [panel, setPanel] = useState(() =>
    (su.panel ?? []).map(p => (p.role ? `${p.name} — ${p.role}` : p.name)).join('\n'),
  )
  const [instructions, setInstructions] = useState('')
  // Which action is running, if any — 'qa' = full extraction, 'skip' = close out
  // with the transcript only. Drives per-button "Starting…" labels.
  const [busyAction, setBusyAction] = useState<null | 'qa' | 'skip'>(null)
  const busy = busyAction !== null
  const [err, setErr] = useState<string | null>(null)
  // Draft (default ON): the AI report is marked not-yet-human-reviewed
  // (DRAFT watermark + pending-review banner) until someone marks it reviewed.
  const [draft, setDraft] = useState(true)

  // Entity-spelling review (§3.5b). Seeded with the auto-extracted candidates;
  // the user fixes canonical spellings / drops noise / adds a missed name.
  const [entities, setEntities] = useState<EntityMapEntry[]>(() => entityMap?.entities ?? [])
  const setCanonical = (i: number, value: string) =>
    setEntities(prev => prev.map((e, j) => (j === i ? { ...e, canonical: value } : e)))
  const removeEntity = (i: number) => setEntities(prev => prev.filter((_, j) => j !== i))
  const addEntity = () =>
    setEntities(prev => [...prev, { canonical: '', variants: [], type: 'term', mentions: 1 }])

  const handleGenerate = async (skipQa = false) => {
    if (skipQa && !window.confirm(
      'Close out this town hall with the transcript only? No Q&A pairs will be extracted — '
      + 'good for an open listening session. You can still generate Q&A later.'
    )) return
    setBusyAction(skipQa ? 'skip' : 'qa')
    setErr(null)
    try {
      const body: {
        setup_inputs?: Record<string, unknown>
        instructions?: string
        phase_map?: PhaseMap
        entity_map?: { entities: EntityMapEntry[]; extracted_at: string; reviewed_at?: string | null }
        skip_qa?: boolean
        draft?: boolean
      } = {
        instructions: instructions.trim() || undefined,
        draft,
      }
      // Close-out without Q&A: skip the extraction-shaping fields (agenda/panel/
      // entity map) — only the transcript + an optional presentation summary are
      // produced. The phase split is still sent below so a deck summary scopes right.
      if (skipQa) body.skip_qa = true
      // Persist the reviewed entity map (drop blank canonicals). Always sent so an
      // emptied list clears the map; the server stamps reviewed_at.
      if (isQa && !skipQa) {
        body.entity_map = {
          entities: entities.filter(e => e.canonical.trim()),
          extracted_at: entityMap?.extracted_at ?? new Date().toISOString(),
        }
      }
      if (isQa && !skipQa) {
        body.setup_inputs = {
          ...su,
          agenda: agenda.split('\n').map(s => s.trim()).filter(Boolean),
          panel: panel.split('\n').map(parsePanelLine).filter(Boolean),
        }
      }
      // Rebuild a two-phase map from the user-confirmed split.
      if (hasPresentation && duration > 0) {
        const split = Math.min(Math.max(0, parseMmss(splitText)), duration)
        const phases: MeetingPhase[] = ([
          { kind: 'presentation' as const, label: 'Presentation', start_sec: 0, end_sec: split },
          { kind: 'qa' as const, label: 'Audience Q&A', start_sec: split, end_sec: duration },
        ] as MeetingPhase[]).filter(p => p.end_sec > p.start_sec)
        body.phase_map = {
          phases,
          detected_at: phaseMap?.detected_at ?? new Date().toISOString(),
          model: phaseMap?.model ?? 'user',
          edited_by_user: true,
        }
      }
      const res = await fetch(`/api/recordings/${recordingId}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(json?.error || `Generate failed: ${res.status}`)
        return
      }
      await onStarted()   // status flips to 'analyzing' → polling resumes
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'network error')
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <section className="bg-white border-2 border-orange-200 rounded-lg p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-900">Transcript ready</h3>
          <p className="text-sm text-gray-500 mt-1">
            Q&amp;A extraction is <span className="font-medium text-gray-700">optional</span>. Generate Q&amp;A pairs below,
            or close out with the transcript only — good for an open listening session with no question/answer structure.
          </p>
        </div>
        <div className="shrink-0 flex flex-col items-stretch gap-1.5">
          <button
            type="button"
            onClick={() => handleGenerate(false)}
            disabled={busy}
            className="px-5 py-2.5 text-sm font-semibold rounded-lg text-white disabled:opacity-60"
            style={{ backgroundColor: '#E8632A' }}
          >
            {busyAction === 'qa' ? 'Starting…' : 'Generate Q&A pairs'}
          </button>
          <button
            type="button"
            onClick={() => handleGenerate(true)}
            disabled={busy}
            className="px-5 py-1.5 text-xs font-medium rounded-lg text-gray-600 border border-gray-300 hover:bg-gray-50 disabled:opacity-60"
          >
            {busyAction === 'skip' ? 'Finishing…' : 'Finish without Q&A'}
          </button>
        </div>
      </div>

      <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
        <span className="font-semibold">⚠ Heads up:</span> generating Q&amp;A runs the full AI analysis (Opus + Sonnet),
        is billed (about <strong>$50</strong>), and takes a few minutes. It replaces any existing Q&amp;A — you can re-generate later.
        <span className="block mt-1 text-amber-700">“Finish without Q&amp;A” skips that pass and just closes out the transcript (no Q&amp;A charge).</span>
      </div>

      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={draft} onChange={e => setDraft(e.target.checked)} disabled={busy} className="mt-0.5 rounded" />
        <span>
          Mark as draft (pending human review)
          <span className="block text-xs text-gray-400">Recommended. The report shows a DRAFT watermark + a “pending human review” note until someone marks it reviewed. Uncheck only if this is already final.</span>
        </span>
      </label>

      {isQa && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 mb-1">Agenda topics (one per line)</span>
            <textarea
              value={agenda}
              onChange={e => setAgenda(e.target.value)}
              disabled={busy}
              rows={5}
              placeholder={'Project Overview\nFunding\nRight-of-Way Acquisition'}
              className="w-full border border-gray-300 rounded px-3 py-2"
              style={{ fontSize: '16px' }}
            />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 mb-1">Panel roster (Name — role, one per line)</span>
            <textarea
              value={panel}
              onChange={e => setPanel(e.target.value)}
              disabled={busy}
              rows={5}
              placeholder={'Jane Doe — Project Manager\nJohn Smith — City Engineer'}
              className="w-full border border-gray-300 rounded px-3 py-2"
              style={{ fontSize: '16px' }}
            />
          </label>
        </div>
      )}

      {isQa && (
        <div className="rounded-lg border border-gray-200 p-3">
          <span className="block text-xs font-semibold text-gray-700">Names &amp; spellings</span>
          <p className="text-xs text-gray-500 mt-0.5 mb-2">
            The transcriber often mis-hears proper names. We pulled the names it heard and grouped the
            spellings — fix the correct spelling (left), drop noise, or add a name it missed. We&apos;ll use
            these spellings in the report and offer a corrected transcript. The raw transcript is never changed.
          </p>
          {entities.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No names detected{entityMap ? '' : ' yet'}. Add any worth correcting.</p>
          ) : (
            <div className="space-y-1.5">
              {entities.map((e, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={e.canonical}
                    onChange={ev => setCanonical(i, ev.target.value)}
                    disabled={busy}
                    placeholder="Correct spelling"
                    className="w-48 shrink-0 border border-gray-300 rounded px-2 py-1.5 font-medium"
                    style={{ fontSize: '16px' }}
                  />
                  <span className="text-xs text-gray-400 min-w-0 flex-1 truncate" title={e.variants.join(', ')}>
                    heard as: {e.variants.join(', ') || '—'}
                    {e.mentions > 1 ? ` · ${e.mentions}×` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeEntity(i)}
                    disabled={busy}
                    className="text-gray-400 hover:text-red-500 disabled:opacity-30 px-1 shrink-0"
                    title="Remove"
                  >✕</button>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={addEntity}
            disabled={busy}
            className="mt-2 text-xs text-gray-600 hover:text-orange-600 disabled:opacity-30"
          >+ Add name</button>
        </div>
      )}

      {hasPresentation && duration > 0 && (
        <div className="rounded-lg bg-orange-50 border border-orange-200 p-3">
          <span className="block text-xs font-semibold text-gray-700 mb-1">Presentation → Q&amp;A split</span>
          <p className="text-xs text-gray-500 mb-2">
            We detected the presentation ending at <strong>{formatMmss(detectedSplit || 0)}</strong> of {formatMmss(duration)}.
            Adjust if needed — everything before is summarized as the meeting overview; everything after is read as audience Q&amp;A.
          </p>
          <label className="inline-flex items-center gap-2">
            <span className="text-xs text-gray-600">Presentation ends at</span>
            <input
              type="text"
              value={splitText}
              onChange={e => setSplitText(e.target.value)}
              disabled={busy}
              placeholder="mm:ss"
              className="w-24 border border-gray-300 rounded px-3 py-2 text-center"
              style={{ fontSize: '16px' }}
            />
          </label>
        </div>
      )}

      <label className="block">
        <span className="block text-xs font-semibold text-gray-600 mb-1">Extraction instructions (optional)</span>
        <textarea
          value={instructions}
          onChange={e => setInstructions(e.target.value)}
          disabled={busy}
          rows={3}
          maxLength={4000}
          placeholder='e.g. "Audience members didn&apos;t state names — default asker to &apos;Audience member&apos;." or "Treat panel-to-panel exchanges as commentary, not audience questions."'
          className="w-full border border-gray-300 rounded px-3 py-2"
          style={{ fontSize: '16px' }}
        />
      </label>

      {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{err}</div>}
    </section>
  )
}

function formatMmss(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const m = Math.floor(s / 60)
  return `${m}:${(s % 60).toString().padStart(2, '0')}`
}

function parseMmss(text: string): number {
  const t = text.trim()
  if (/^\d+:\d{1,2}$/.test(t)) {
    const [m, s] = t.split(':').map(Number)
    return m * 60 + s
  }
  const n = Number(t)               // bare number = seconds
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0
}

function parsePanelLine(line: string): { name: string; role?: string } | null {
  const t = line.trim()
  if (!t) return null
  // Accept "Name — role", "Name - role", or just "Name".
  const m = t.split(/\s+[—-]\s+/)
  const name = m[0]?.trim()
  if (!name) return null
  const role = m[1]?.trim()
  return role ? { name, role } : { name }
}

function FilesPanel({ files }: { files: FileRow[] }) {
  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4">
      <h3 className="font-semibold text-gray-900 mb-3 text-sm">Source files ({files.length})</h3>
      <ul className="divide-y divide-gray-100">
        {files.map(f => (
          <li key={f.id} className="py-2 flex items-center justify-between text-sm">
            <div>
              <div className="text-gray-800">{f.original_filename}</div>
              <div className="text-xs text-gray-500">
                {(f.size_bytes / (1024 * 1024)).toFixed(1)} MB
                {f.duration_sec ? ` · ${formatDuration(f.duration_sec)}` : ''}
                {f.is_video ? ' · video' : ' · audio'}
              </div>
            </div>
            <FileStatusBadge s={f.upload_status} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function FileStatusBadge({ s }: { s: FileRow['upload_status'] }) {
  const styles: Record<FileRow['upload_status'], string> = {
    pending:   'bg-gray-100 text-gray-600',
    uploaded:  'bg-blue-100 text-blue-700',
    extracted: 'bg-green-100 text-green-700',
    failed:    'bg-red-100 text-red-700',
  }
  return <span className={`px-2 py-0.5 rounded text-xs ${styles[s]}`}>{s}</span>
}

function TranscriptPanel({ transcript }: { transcript: TranscriptMeta }) {
  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4">
      <h3 className="font-semibold text-gray-900 mb-2 text-sm">Transcript</h3>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <dt className="text-gray-500">Vendor</dt><dd className="text-gray-800 capitalize">{transcript.vendor}</dd>
        <dt className="text-gray-500">Language</dt><dd className="text-gray-800">{transcript.language_detected ?? '—'}</dd>
        <dt className="text-gray-500">Words</dt><dd className="text-gray-800">{transcript.word_count?.toLocaleString() ?? '—'}</dd>
        <dt className="text-gray-500">Duration</dt><dd className="text-gray-800">{transcript.duration_sec ? formatDuration(transcript.duration_sec) : '—'}</dd>
        <dt className="text-gray-500">ASR cost</dt><dd className="text-gray-800">{formatCost(transcript.cost_cents)}</dd>
      </dl>
    </section>
  )
}

function CoveragePanel({ count, cost_cents }: { count: number; cost_cents: number }) {
  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4">
      <h3 className="font-semibold text-gray-900 mb-2 text-sm">Extraction</h3>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <dt className="text-gray-500">Q&A pairs</dt><dd className="text-gray-800">{count}</dd>
        <dt className="text-gray-500">Total cost</dt><dd className="text-gray-800">{formatCost(cost_cents)}</dd>
      </dl>
    </section>
  )
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${s}s`
}

// Client-facing markup applied to every AI cost shown on recording surfaces.
// Display only — the raw cost_cents stays the source of truth for internal
// accounting (usage tables, admin dashboards); this never touches those.
const COST_DISPLAY_MULTIPLIER = 50

function formatCost(rawCents: number): string {
  const cents = Math.round((rawCents || 0) * COST_DISPLAY_MULTIPLIER)
  if (cents === 0) return '$0.00'
  if (cents < 100) return `${cents}¢`
  return `$${(cents / 100).toFixed(2)}`
}
