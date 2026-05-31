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

const POLL_INTERVAL_MS = 3000

type Status =
  | 'uploading' | 'queued' | 'extracting' | 'transcribing'
  | 'analyzing' | 'rendering' | 'complete' | 'failed' | 'cancelled'

// Display order; matches recordings.status check_constraint minus 'cancelled'
// (cancelled is a terminal off-path state rendered separately).
const STAGES: Status[] = [
  'uploading', 'queued', 'extracting', 'transcribing', 'analyzing', 'complete',
]

const STAGE_LABELS: Record<Status, string> = {
  uploading:    'Uploading',
  queued:       'Queued',
  extracting:   'Extracting audio',
  transcribing: 'Transcribing',
  analyzing:    'Analyzing',
  rendering:    'Rendering',     // present in enum but skipped today; treat as a flicker between analyzing → complete
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

interface StatusResponse {
  recording: {
    id: string
    name: string
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
    if (isTerminal) return
    const id = setInterval(fetchStatus, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [fetchStatus, isTerminal])

  const handleRetry = async () => {
    setRetrying(true)
    try {
      const res = await fetch(`/api/recordings/${recordingId}/process`, { method: 'POST' })
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

      <StageLadder current={status} />

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

function StageLadder({ current }: { current: Status }) {
  const currentIdx = STAGES.indexOf(current)
  return (
    <ol className="flex items-center gap-2 overflow-x-auto pb-1">
      {STAGES.map((s, i) => {
        const isPast = currentIdx >= 0 && i < currentIdx
        const isCurrent = i === currentIdx
        const isFailed = current === 'failed' && i === Math.max(0, STAGES.length - 1)
        return (
          <li key={s} className="flex items-center gap-2 shrink-0">
            <span className={
              `inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold ` +
              (isCurrent
                ? 'bg-orange-500 text-white animate-pulse'
                : isPast
                ? 'bg-green-500 text-white'
                : isFailed
                ? 'bg-red-500 text-white'
                : 'bg-gray-200 text-gray-500')
            }>
              {isPast ? '✓' : i + 1}
            </span>
            <span className={`text-xs ${isCurrent ? 'text-orange-700 font-semibold' : isPast ? 'text-gray-700' : 'text-gray-400'}`}>
              {STAGE_LABELS[s]}
            </span>
            {i < STAGES.length - 1 && <span className="text-gray-300">›</span>}
          </li>
        )
      })}
    </ol>
  )
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
