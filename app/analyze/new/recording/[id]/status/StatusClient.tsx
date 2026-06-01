'use client'

// app/analyze/new/recording/[id]/status/StatusClient.tsx
//
// Polls GET /api/recordings/[id] (§ 4.3) and renders the pipeline ladder.
// Poll cadence: 3s while active, paused (no more requests) once terminal.
// Routes to the report (/analyze/[dataset_id]/report) when status=complete
// + dataset_id is set. Renders error_message + a Retry button on failed.

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import LottieLoader from '@/components/ui/LottieLoader'

const POLL_INTERVAL_MS = 3000

type Status =
  | 'uploading' | 'queued' | 'extracting' | 'transcribing' | 'transcribed'
  | 'analyzing' | 'rendering' | 'complete' | 'failed' | 'cancelled'

// Step list — vertical, Claude-Code-style. Each step renders with a
// past/current/future/failed icon + an optional sub-detail derived from
// the § 4.3 status payload.
const STEPS: Status[] = [
  'uploading', 'queued', 'extracting', 'transcribing', 'analyzing', 'complete',
]

const STEP_LABELS: Record<Status, string> = {
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
    cost_cents: number
    dataset_id: string | null
    started_at: string | null
    completed_at: string | null
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

  const status = (data?.recording.status ?? initialStatus) as Status
  const name = data?.recording.name ?? initialName
  const isTerminal = status === 'complete' || status === 'failed' || status === 'cancelled'
  // 'transcribed' is a stable pause awaiting the user — polling would just
  // re-fetch an unchanging row. Pause it; the gate's Generate flips the status
  // back to 'analyzing', which restarts the poll via the effect deps below.
  const isPaused = status === 'transcribed'

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
    if (isTerminal || isPaused) return
    const id = setInterval(fetchStatus, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [fetchStatus, isTerminal, isPaused])

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

  // Auto-route to report when complete + dataset wired up.
  useEffect(() => {
    if (status === 'complete' && data?.recording.dataset_id) {
      const t = setTimeout(() => {
        router.push(`/analyze/${data.recording.dataset_id}/report`)
      }, 1200)
      return () => clearTimeout(t)
    }
  }, [status, data?.recording.dataset_id, router])

  return (
    <div className="space-y-6">
      <header>
        <Link href="/analyze" className="text-xs text-gray-500 hover:text-gray-700">← Recordings</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">{name}</h1>
        <p className="text-sm text-gray-500 mt-1">Recording {recordingId.slice(0, 8)}…</p>
      </header>

      <StepList status={status} data={data} />

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {status === 'transcribed' && data && (
        <GeneratePanel
          recordingId={recordingId}
          sessionType={data.recording.session_type}
          setupInputs={data.recording.setup_inputs}
          onStarted={fetchStatus}
        />
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

      {status === 'complete' && data?.recording.dataset_id && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center justify-between">
          <div>
            <div className="font-semibold text-green-900">Complete — opening report…</div>
            <div className="text-sm text-green-800">
              {data.extraction_count} extracted pair{data.extraction_count === 1 ? '' : 's'}
              {data.transcript?.word_count ? ` from ${data.transcript.word_count.toLocaleString()} words` : ''}
            </div>
          </div>
          <Link
            href={`/analyze/${data.recording.dataset_id}/report`}
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
    </div>
  )
}

// ── Components ───────────────────────────────────────────────────────────────

type StepState = 'past' | 'current' | 'future' | 'failed'

function StepList({ status, data }: { status: Status; data: StatusResponse | null }) {
  const failedStepIdx = status === 'failed' ? inferFailedStepIdx(data) : -1

  return (
    <ol className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
      {STEPS.map((step, i) => {
        const state = computeStepState(step, i, status, failedStepIdx)
        const detail = computeStepDetail(step, state, data)
        return (
          <li key={step} className="flex items-start gap-3 px-4 py-3">
            <StepIcon state={state} />
            <div className="flex-1 min-w-0">
              <div className={
                'text-sm font-medium ' +
                (state === 'current' ? 'text-orange-700' :
                 state === 'failed'  ? 'text-red-700' :
                 state === 'past'    ? 'text-gray-900' :
                                       'text-gray-400')
              }>
                {STEP_LABELS[step]}
              </div>
              {detail && (
                <div className={`text-xs mt-0.5 ${state === 'current' ? 'text-orange-600' : state === 'failed' ? 'text-red-600' : 'text-gray-500'}`}>
                  {detail}
                </div>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function StepIcon({ state }: { state: StepState }) {
  if (state === 'past') {
    return <span className="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-500 text-white text-[10px] font-bold shrink-0">✓</span>
  }
  if (state === 'current') {
    // Keep the 20px slot in flow (so step text stays aligned with the other
    // rows) but center a larger loader over it.
    return (
      <span className="mt-0.5 relative inline-block w-5 h-5 shrink-0">
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <LottieLoader size={40} />
        </span>
      </span>
    )
  }
  if (state === 'failed') {
    return <span className="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold shrink-0">✗</span>
  }
  return <span className="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full border-2 border-gray-200 text-gray-300 text-[10px] shrink-0">○</span>
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
  recordingId, sessionType, setupInputs, onStarted,
}: {
  recordingId: string
  sessionType: string
  setupInputs: QaSetupInputs | Record<string, unknown> | null
  onStarted: () => void | Promise<void>
}) {
  const isQa = sessionType === 'qa'
  const su = (setupInputs ?? {}) as QaSetupInputs

  const [agenda, setAgenda] = useState(() => (su.agenda ?? []).join('\n'))
  const [panel, setPanel] = useState(() =>
    (su.panel ?? []).map(p => (p.role ? `${p.name} — ${p.role}` : p.name)).join('\n'),
  )
  const [instructions, setInstructions] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handleGenerate = async () => {
    setBusy(true)
    setErr(null)
    try {
      const body: { setup_inputs?: Record<string, unknown>; instructions?: string } = {
        instructions: instructions.trim() || undefined,
      }
      if (isQa) {
        body.setup_inputs = {
          ...su,
          agenda: agenda.split('\n').map(s => s.trim()).filter(Boolean),
          panel: panel.split('\n').map(parsePanelLine).filter(Boolean),
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
      setBusy(false)
    }
  }

  return (
    <section className="bg-white border-2 border-orange-200 rounded-lg p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-gray-900">Transcript ready — review, then generate</h3>
        <p className="text-sm text-gray-500 mt-1">
          The Q&amp;A extraction (~$1, Opus + Sonnet) hasn&apos;t run yet. Check the transcript below
          and refine the agenda or panel roster — both steer extraction quality — then generate.
        </p>
      </div>

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

      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">Cost: <span className="font-semibold">~$1</span> · Opus 4.7 + Sonnet 4.6 curator</span>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={busy}
          className="px-4 py-2 text-sm font-semibold rounded-lg text-white disabled:opacity-60"
          style={{ backgroundColor: '#E8632A' }}
        >
          {busy ? 'Starting…' : 'Generate Q&A pairs'}
        </button>
      </div>
    </section>
  )
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

function formatCost(cents: number): string {
  if (cents === 0) return '$0.00'
  if (cents < 100) return `${cents}¢`
  return `$${(cents / 100).toFixed(2)}`
}
