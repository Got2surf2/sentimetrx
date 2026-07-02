'use client'

// app/recordings/[id]/AddRecordingClient.tsx
//
// "Add recording" pane (§ 5.3a) — attaches media to a project that was set up
// before the audio/video existed (status 'awaiting_media' / 'draft'). Mirrors the
// back half of the old creation wizard:
//   1. POST /api/recordings/[id]/files (§ 4.1c) → file IDs + TUS endpoint
//   2. tus-js-client uploads per file (with the user's session JWT)
//   3. POST .../files/[fileId]/uploaded (§ 4.1a) per file
//   4. POST /api/recordings/[id]/process (§ 4.2) → starts the pipeline
//   5. onStarted() → the status page re-polls and shows the ladder

import { useCallback, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { tusUpload } from '@/lib/recordings/tusUpload'

const HERMES = '#E8632A'

const VIDEO_EXTS = new Set(['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v'])
const AUDIO_EXTS = new Set(['mp3', 'm4a', 'wav', 'flac', 'aac', 'ogg', 'opus', 'wma'])

type Phase = 'idle' | 'creating' | 'uploading' | 'starting' | 'done'

interface PendingFile {
  localId: string
  file: File
  role: 'media' | 'slides'
  progress: number
  status: 'pending' | 'uploading' | 'uploaded' | 'failed'
  error?: string
}

interface AttachResponse {
  recording_id: string
  upload: { protocol: 'tus'; endpoint: string; bucket: string }
  files: Array<{ id: string; original_filename: string; storage_path: string; upload_url: string }>
}

export default function AddRecordingClient({
  recordingId, showSlides, onStarted,
}: {
  recordingId: string
  showSlides: boolean
  onStarted: () => void | Promise<void>
}) {
  const [files, setFiles] = useState<PendingFile[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [submitError, setSubmitError] = useState<string | null>(null)

  const mediaFiles = useMemo(() => files.filter(f => f.role === 'media'), [files])
  const slide = useMemo(() => files.find(f => f.role === 'slides') || null, [files])
  const canSubmit = phase === 'idle' && mediaFiles.length > 0

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const list = Array.from(incoming)
    setFiles(prev => {
      const seen = new Set(prev.map(f => f.file.name))
      const additions: PendingFile[] = []
      for (const file of list) {
        if (seen.has(file.name)) continue
        additions.push({
          localId: `${file.name}-${file.size}-${crypto.randomUUID().slice(0, 8)}`,
          file, role: 'media', progress: 0, status: 'pending',
        })
      }
      return [...prev, ...additions]
    })
  }, [])

  const setSlide = useCallback((file: File | null) => {
    setFiles(prev => {
      const withoutSlide = prev.filter(f => f.role !== 'slides')
      if (!file) return withoutSlide
      return [...withoutSlide, {
        localId: `slide-${file.name}-${crypto.randomUUID().slice(0, 8)}`,
        file, role: 'slides', progress: 0, status: 'pending',
      }]
    })
  }, [])

  const removeFile = useCallback((localId: string) => {
    setFiles(prev => prev.filter(f => f.localId !== localId))
  }, [])

  const moveFile = useCallback((localId: string, direction: -1 | 1) => {
    setFiles(prev => {
      const idx = prev.findIndex(f => f.localId === localId)
      if (idx < 0) return prev
      const j = idx + direction
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      const [item] = next.splice(idx, 1)
      next.splice(j, 0, item)
      return next
    })
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files)
  }, [addFiles])

  const handleSubmit = async () => {
    setSubmitError(null)
    setPhase('creating')

    const body = {
      files: files.map(f => ({
        original_filename: f.file.name,
        size_bytes: f.file.size,
        mime_type: f.file.type || guessMime(f.file.name),
        is_video: f.role === 'slides' ? false : isVideoByExt(f.file.name),
        file_role: f.role,
      })),
    }

    let attachRes: AttachResponse
    try {
      const r = await fetch(`/api/recordings/${recordingId}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await r.json()
      if (!r.ok) throw new Error(json.error || `attach failed: ${r.status}`)
      attachRes = json as AttachResponse
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Attach failed')
      setPhase('idle')
      return
    }

    setPhase('uploading')

    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      setSubmitError('Could not read your Supabase session — try refreshing.')
      setPhase('idle')
      return
    }

    const uploadPromises = attachRes.files.map(serverFile => {
      const local = files.find(f => f.file.name === serverFile.original_filename)
      if (!local) return Promise.reject(new Error(`local file disappeared: ${serverFile.original_filename}`))
      return uploadOne({
        file: local.file,
        serverId: serverFile.id,
        storagePath: serverFile.storage_path,
        endpoint: attachRes.upload.endpoint,
        bucket: attachRes.upload.bucket,
        recordingId,
        sessionJwt: session.access_token,
        onProgress: (p) => setFiles(prev => prev.map(f => f.localId === local.localId ? { ...f, progress: p, status: 'uploading' } : f)),
        onDone: () => setFiles(prev => prev.map(f => f.localId === local.localId ? { ...f, progress: 1, status: 'uploaded' } : f)),
        onError: (msg) => setFiles(prev => prev.map(f => f.localId === local.localId ? { ...f, status: 'failed', error: msg } : f)),
      })
    })

    try {
      await Promise.all(uploadPromises)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Upload failed')
      setPhase('idle')
      return
    }

    setPhase('starting')
    try {
      const r = await fetch(`/api/recordings/${recordingId}/process`, { method: 'POST' })
      const json = await r.json()
      if (!r.ok) throw new Error(json.error || `process failed: ${r.status}`)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Pipeline start failed')
      setPhase('idle')
      return
    }

    setPhase('done')
    await onStarted()
  }

  return (
    <section className="bg-white border-2 border-orange-200 rounded-2xl p-5">
      <h2 className="font-semibold text-gray-900 text-sm">Add recording</h2>
      <p className="text-xs text-gray-500 mt-1 mb-4">
        The project is set up — now attach the meeting audio or video. We&apos;ll transcribe and pause for
        your review before the analysis runs.
      </p>

      <label
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`block border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${dragOver ? 'border-orange-400 bg-orange-50' : 'border-gray-300 bg-gray-50 hover:bg-gray-100'}`}
      >
        <div className="text-3xl mb-2">📥</div>
        <div className="text-sm text-gray-700">Drop files here or click to browse</div>
        <div className="text-xs text-gray-500 mt-1">Audio or video — drop a mix and we&apos;ll stitch them in order. Up to 20 files, 20 GB each.</div>
        <input
          type="file" multiple accept="video/*,audio/*" className="hidden"
          disabled={phase !== 'idle'}
          onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }}
        />
      </label>

      {mediaFiles.length > 0 && (
        <ul className="mt-4 space-y-2">
          {mediaFiles.map((f, i) => (
            <li key={f.localId} className="border border-gray-200 rounded-lg p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-gray-800 truncate">{f.file.name}</div>
                  <div className="text-xs text-gray-500">
                    {(f.file.size / (1024 * 1024)).toFixed(1)} MB · {isVideoByExt(f.file.name) ? 'video' : 'audio'}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" disabled={phase !== 'idle' || i === 0} onClick={() => moveFile(f.localId, -1)} className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-30 px-1">↑</button>
                  <button type="button" disabled={phase !== 'idle' || i === mediaFiles.length - 1} onClick={() => moveFile(f.localId, 1)} className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-30 px-1">↓</button>
                  <button type="button" disabled={phase !== 'idle'} onClick={() => removeFile(f.localId)} className="text-xs text-red-400 hover:text-red-600 disabled:opacity-30 px-1">✕</button>
                </div>
              </div>
              {(f.status === 'uploading' || f.status === 'uploaded') && (
                <div className="mt-2 h-1.5 bg-gray-100 rounded overflow-hidden">
                  <div className="h-full bg-orange-400 transition-all" style={{ width: `${Math.round(f.progress * 100)}%` }} />
                </div>
              )}
              {f.status === 'failed' && <div className="mt-2 text-xs text-red-600">{f.error || 'Upload failed'}</div>}
            </li>
          ))}
        </ul>
      )}

      {showSlides && (
        <div className="mt-5 pt-4 border-t border-gray-200">
          <h3 className="font-semibold text-gray-900 text-sm mb-1">Presentation slides <span className="font-normal text-gray-400">(optional)</span></h3>
          <p className="text-xs text-gray-500 mb-3">Upload the deck shown at the meeting (PDF). We read it to ground the meeting notes in the exact figures and names presented.</p>
          {!slide ? (
            <label className="block border-2 border-dashed border-gray-300 bg-gray-50 hover:bg-gray-100 rounded-xl p-4 text-center cursor-pointer transition-colors">
              <div className="text-2xl mb-1">📄</div>
              <div className="text-sm text-gray-700">Add slide deck (PDF)</div>
              <input
                type="file" accept="application/pdf,.pdf" className="hidden"
                disabled={phase !== 'idle'}
                onChange={e => { const f = e.target.files?.[0]; if (f) setSlide(f); e.target.value = '' }}
              />
            </label>
          ) : (
            <div className="border border-gray-200 rounded-lg p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-gray-800 truncate">📄 {slide.file.name}</div>
                  <div className="text-xs text-gray-500">{(slide.file.size / (1024 * 1024)).toFixed(1)} MB · slides</div>
                </div>
                <button type="button" disabled={phase !== 'idle'} onClick={() => setSlide(null)} className="text-xs text-red-400 hover:text-red-600 disabled:opacity-30 px-1">✕</button>
              </div>
              {(slide.status === 'uploading' || slide.status === 'uploaded') && (
                <div className="mt-2 h-1.5 bg-gray-100 rounded overflow-hidden">
                  <div className="h-full bg-orange-400 transition-all" style={{ width: `${Math.round(slide.progress * 100)}%` }} />
                </div>
              )}
              {slide.status === 'failed' && <div className="mt-2 text-xs text-red-600">{slide.error || 'Upload failed'}</div>}
            </div>
          )}
        </div>
      )}

      {submitError && (
        <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{submitError}</div>
      )}

      <div className="mt-5 flex items-center justify-end gap-3">
        <span className="text-xs text-gray-500">
          {phase === 'idle'
            ? (mediaFiles.length === 0 ? 'Add at least one audio/video file' : '')
            : phase === 'uploading' ? `${files.filter(f => f.status === 'uploaded').length}/${files.length} uploaded`
            : phase === 'starting' ? 'Handing off to the pipeline'
            : phase === 'done' ? 'Processing…' : ''}
        </span>
        <button
          type="button"
          onClick={() => { void handleSubmit() }}
          disabled={!canSubmit}
          className="px-6 py-3 rounded-lg text-sm font-semibold text-white disabled:bg-gray-300 disabled:cursor-not-allowed"
          style={{ backgroundColor: canSubmit ? HERMES : undefined }}
        >
          {phase === 'idle' ? 'Upload & process' : phase === 'creating' ? 'Preparing…' : phase === 'uploading' ? 'Uploading…' : phase === 'starting' ? 'Starting…' : 'Done'}
        </button>
      </div>
    </section>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isVideoByExt(name: string): boolean {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return false
  return VIDEO_EXTS.has(name.slice(dot + 1).toLowerCase())
}

function guessMime(name: string): string {
  const dot = name.lastIndexOf('.')
  const ext = dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
  if (VIDEO_EXTS.has(ext)) return `video/${ext === 'mov' ? 'quicktime' : ext}`
  if (AUDIO_EXTS.has(ext)) return `audio/${ext}`
  return 'application/octet-stream'
}

interface UploadOneArgs {
  file: File
  serverId: string
  storagePath: string
  endpoint: string
  bucket: string
  recordingId: string
  sessionJwt: string
  onProgress: (p: number) => void
  onDone: () => void
  onError: (msg: string) => void
}

async function uploadOne(args: UploadOneArgs): Promise<void> {
  try {
    await tusUpload({
      file: args.file,
      storagePath: args.storagePath,
      endpoint: args.endpoint,
      bucket: args.bucket,
      sessionJwt: args.sessionJwt,
      contentType: args.file.type || 'application/octet-stream',
      onProgress: args.onProgress,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    args.onError(msg)
    throw new Error(`${args.file.name}: ${msg}`)
  }

  // Storage upload succeeded — ack to flip upload_status → 'uploaded'.
  try {
    const r = await fetch(`/api/recordings/${args.recordingId}/files/${args.serverId}/uploaded`, { method: 'POST' })
    if (!r.ok) {
      const b = await r.json().catch(() => ({}))
      const msg = b?.error || `ack ${r.status}`
      args.onError(msg)
      throw new Error(`${args.file.name}: ${msg}`)
    }
    args.onDone()
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'ack failed'
    args.onError(msg)
    throw err instanceof Error && err.message.startsWith(`${args.file.name}:`) ? err : new Error(`${args.file.name}: ${msg}`)
  }
}
