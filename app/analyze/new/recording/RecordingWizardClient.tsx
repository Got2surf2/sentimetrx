'use client'

// app/analyze/new/recording/RecordingWizardClient.tsx
//
// Three-pane wizard (§ 5.2): file drop + per-file progress on the left,
// setup form on the right, Process button at the bottom.
//
// Drive sequence on click Process:
//   1. POST /api/recordings (§ 4.1)         — get recording_id + per-file IDs + TUS endpoint
//   2. tus-js-client uploads per file       — parallel, with the user's session JWT
//   3. POST .../files/[fileId]/uploaded     — per file ack, server verifies object exists
//   4. POST /api/recordings/[id]/process    — § 4.2 starts the WDK pipeline
//   5. router.push(/.../[id]/status)        — hand off to status surface

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import * as tus from 'tus-js-client'
import { createClient } from '@/lib/supabase/client'
import { defaultProfile, PRESET_LABELS } from '@/lib/recordings/profiles'
import type { MeetingPresetId } from '@/lib/recordings/types'
import Link from 'next/link'

const HERMES = '#E8632A'

// session_type stays 'qa' under the hood; the meeting TYPE (preset) drives the
// presentation/Q&A phasing. Other session types are deferred.
type SessionType = 'qa'
type AsrStrategy = 'auto' | 'whisper' | 'deepgram' | 'hybrid'
type Phase = 'idle' | 'creating' | 'uploading' | 'starting' | 'done'

interface PendingFile {
  localId: string                  // browser-side id while pre-upload
  file: File
  role: 'media' | 'slides'         // slides = the presentation deck (PDF)
  serverId?: string                // recording_files.id after § 4.1
  storagePath?: string             // after § 4.1
  progress: number                 // 0..1
  status: 'pending' | 'uploading' | 'uploaded' | 'failed'
  error?: string
}

interface CreateResponse {
  recording_id: string
  upload: { protocol: 'tus'; endpoint: string; bucket: string }
  files: Array<{ id: string; original_filename: string; storage_path: string; upload_url: string }>
}

const VIDEO_EXTS = new Set(['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v'])
const AUDIO_EXTS = new Set(['mp3', 'm4a', 'wav', 'flac', 'aac', 'ogg', 'opus', 'wma'])

export default function RecordingWizardClient() {
  const router = useRouter()

  // ── Files ─────────────────────────────────────────────────────────────────
  const [files, setFiles] = useState<PendingFile[]>([])
  const [dragOver, setDragOver] = useState(false)

  // ── Setup form ────────────────────────────────────────────────────────────
  const [name, setName] = useState('')
  const meetingDateDefault = new Date().toISOString().slice(0, 10)
  const [meetingDate, setMeetingDate] = useState(meetingDateDefault)
  const [location, setLocation] = useState('')
  const [language, setLanguage] = useState('en')
  const [asrStrategy, setAsrStrategy] = useState<AsrStrategy>('auto')
  const sessionType: SessionType = 'qa'
  const [preset, setPreset] = useState<MeetingPresetId>('town_hall_qa')

  // Q&A-specific
  const [panel, setPanel] = useState<Array<{ name: string; role: string }>>([{ name: '', role: '' }])
  const [agenda, setAgenda] = useState<string[]>([''])

  // ── Submit state ──────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>('idle')
  const [submitError, setSubmitError] = useState<string | null>(null)

  // ── Derived ───────────────────────────────────────────────────────────────
  const cleanedPanel = useMemo(
    () => panel.map(p => ({ name: p.name.trim(), role: p.role.trim() })).filter(p => p.name),
    [panel],
  )
  const cleanedAgenda = useMemo(() => agenda.map(a => a.trim()).filter(Boolean), [agenda])
  const mediaFiles = useMemo(() => files.filter(f => f.role === 'media'), [files])
  const slide = useMemo(() => files.find(f => f.role === 'slides') || null, [files])
  const canSubmit = phase === 'idle' && mediaFiles.length > 0 && name.trim().length > 0 && cleanedAgenda.length > 0

  // ── File handlers ─────────────────────────────────────────────────────────
  const addFiles = useCallback((incoming: FileList | File[]) => {
    const list = Array.from(incoming)
    setFiles(prev => {
      const seen = new Set(prev.map(f => f.file.name))
      const additions: PendingFile[] = []
      for (const file of list) {
        if (seen.has(file.name)) continue
        additions.push({
          localId: `${file.name}-${file.size}-${crypto.randomUUID().slice(0, 8)}`,
          file,
          role: 'media',
          progress: 0,
          status: 'pending',
        })
      }
      return [...prev, ...additions]
    })
  }, [])

  // Attach (or replace) the single presentation-slide PDF.
  const setSlide = useCallback((file: File | null) => {
    setFiles(prev => {
      const withoutSlide = prev.filter(f => f.role !== 'slides')
      if (!file) return withoutSlide
      return [...withoutSlide, {
        localId: `slide-${file.name}-${crypto.randomUUID().slice(0, 8)}`,
        file,
        role: 'slides',
        progress: 0,
        status: 'pending',
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

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setSubmitError(null)
    setPhase('creating')

    // community_meeting → a real profile (has_slides reflects whether a deck
    // was attached); town_hall_qa → null profile = legacy Q&A behavior.
    const meeting_profile = preset === 'community_meeting'
      ? { ...defaultProfile('community_meeting'), has_slides: !!slide }
      : null

    // Build the § 4.1 body.
    const body = {
      name: name.trim(),
      session_type: sessionType,
      meeting_date: meetingDate || null,
      location: location.trim() || null,
      language,
      setup_inputs: { panel: cleanedPanel, agenda: cleanedAgenda },
      asr_strategy: asrStrategy,
      meeting_profile,
      files: files.map(f => ({
        original_filename: f.file.name,
        size_bytes: f.file.size,
        mime_type: f.file.type || guessMime(f.file.name),
        is_video: f.role === 'slides' ? false : isVideoByExt(f.file.name),
        file_role: f.role,
      })),
    }

    let createRes: CreateResponse
    try {
      const r = await fetch('/api/recordings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await r.json()
      if (!r.ok) throw new Error(json.error || `create failed: ${r.status}`)
      createRes = json as CreateResponse
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Create failed')
      setPhase('idle')
      return
    }

    // Hydrate server IDs onto the local file rows so the UI can display them.
    setFiles(prev => prev.map(f => {
      const match = createRes.files.find(sf => sf.original_filename === f.file.name)
      if (!match) return f
      return { ...f, serverId: match.id, storagePath: match.storage_path }
    }))

    setPhase('uploading')

    // Get the user's session JWT for TUS auth.
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      setSubmitError('Could not read your Supabase session — try refreshing.')
      setPhase('idle')
      return
    }

    // Upload all files in parallel; resolve when every TUS onSuccess + 4.1a ack lands.
    const uploadPromises = createRes.files.map(serverFile => {
      const local = files.find(f => f.file.name === serverFile.original_filename)
      if (!local) return Promise.reject(new Error(`local file disappeared: ${serverFile.original_filename}`))
      return uploadOne({
        file: local.file,
        localId: local.localId,
        serverId: serverFile.id,
        storagePath: serverFile.storage_path,
        endpoint: createRes.upload.endpoint,
        bucket: createRes.upload.bucket,
        recordingId: createRes.recording_id,
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
      const r = await fetch(`/api/recordings/${createRes.recording_id}/process`, { method: 'POST' })
      const json = await r.json()
      if (!r.ok) throw new Error(json.error || `process failed: ${r.status}`)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Pipeline start failed')
      setPhase('idle')
      return
    }

    setPhase('done')
    router.push(`/analyze/new/recording/${createRes.recording_id}/status`)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <div>
          <Link href="/analyze/new" className="text-xs text-gray-500 hover:text-gray-700">← Source selector</Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-2">New recording</h1>
          <p className="text-sm text-gray-500 mt-1">Drop audio or video files of the meeting; we'll transcribe and pull structured Q&amp;A.</p>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Files pane */}
        <section className="bg-white border border-gray-200 rounded-2xl p-5">
          <h2 className="font-semibold text-gray-900 mb-3 text-sm">Files</h2>

          <label
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`block border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${dragOver ? 'border-orange-400 bg-orange-50' : 'border-gray-300 bg-gray-50 hover:bg-gray-100'}`}
          >
            <div className="text-3xl mb-2">📥</div>
            <div className="text-sm text-gray-700">Drop files here or click to browse</div>
            <div className="text-xs text-gray-500 mt-1">Audio or video — drop a mix and we'll stitch them in order. Up to 20 files, 20 GB each.</div>
            <input
              type="file"
              multiple
              accept="video/*,audio/*"
              className="hidden"
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
                  {f.status === 'failed' && (
                    <div className="mt-2 text-xs text-red-600">{f.error || 'Upload failed'}</div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Presentation slides (community meeting) — seeds the meeting notes. */}
          {preset === 'community_meeting' && (
            <div className="mt-5 pt-4 border-t border-gray-200">
              <h3 className="font-semibold text-gray-900 text-sm mb-1">Presentation slides <span className="font-normal text-gray-400">(optional)</span></h3>
              <p className="text-xs text-gray-500 mb-3">Upload the deck shown at the meeting (PDF). We read it to ground the meeting notes in the exact figures and names presented.</p>
              {!slide ? (
                <label className="block border-2 border-dashed border-gray-300 bg-gray-50 hover:bg-gray-100 rounded-xl p-4 text-center cursor-pointer transition-colors">
                  <div className="text-2xl mb-1">📄</div>
                  <div className="text-sm text-gray-700">Add slide deck (PDF)</div>
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    className="hidden"
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
        </section>

        {/* Setup pane */}
        <section className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
          <h2 className="font-semibold text-gray-900 text-sm">Setup</h2>

          <Field label="Name">
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="NOWOCATS PM-2"
              disabled={phase !== 'idle'}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base"
              style={{ fontSize: '16px' }}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Meeting type">
              <select
                value={preset}
                onChange={e => setPreset(e.target.value as MeetingPresetId)}
                disabled={phase !== 'idle'}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base"
                style={{ fontSize: '16px' }}
              >
                <option value="town_hall_qa">{PRESET_LABELS.town_hall_qa}</option>
                <option value="community_meeting">{PRESET_LABELS.community_meeting}</option>
              </select>
            </Field>
            <Field label="Meeting date">
              <input
                type="date"
                value={meetingDate}
                onChange={e => setMeetingDate(e.target.value)}
                disabled={phase !== 'idle'}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base"
                style={{ fontSize: '16px' }}
              />
            </Field>
          </div>

          <Field label="Location (optional)">
            <input
              type="text"
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder="Apopka City Hall"
              disabled={phase !== 'idle'}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base"
              style={{ fontSize: '16px' }}
            />
          </Field>

          <Field label="Panel members">
            <div className="space-y-2">
              {panel.map((p, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="text"
                    value={p.name}
                    onChange={e => setPanel(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                    placeholder="Name"
                    disabled={phase !== 'idle'}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-base"
                    style={{ fontSize: '16px' }}
                  />
                  <input
                    type="text"
                    value={p.role}
                    onChange={e => setPanel(prev => prev.map((x, j) => j === i ? { ...x, role: e.target.value } : x))}
                    placeholder="Role"
                    disabled={phase !== 'idle'}
                    className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-base"
                    style={{ fontSize: '16px' }}
                  />
                  <button
                    type="button"
                    disabled={phase !== 'idle' || panel.length === 1}
                    onClick={() => setPanel(prev => prev.filter((_, j) => j !== i))}
                    className="text-gray-400 hover:text-red-500 disabled:opacity-30 px-2"
                  >✕</button>
                </div>
              ))}
              <button
                type="button"
                disabled={phase !== 'idle'}
                onClick={() => setPanel(prev => [...prev, { name: '', role: '' }])}
                className="text-xs text-gray-600 hover:text-orange-600 disabled:opacity-30"
              >+ Add panelist</button>
            </div>
          </Field>

          <Field label="Agenda topics">
            <div className="space-y-2">
              {agenda.map((a, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="text"
                    value={a}
                    onChange={e => setAgenda(prev => prev.map((x, j) => j === i ? e.target.value : x))}
                    placeholder={i === 0 ? 'e.g. Project Timeline' : 'Next topic'}
                    disabled={phase !== 'idle'}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-base"
                    style={{ fontSize: '16px' }}
                  />
                  <button
                    type="button"
                    disabled={phase !== 'idle' || agenda.length === 1}
                    onClick={() => setAgenda(prev => prev.filter((_, j) => j !== i))}
                    className="text-gray-400 hover:text-red-500 disabled:opacity-30 px-2"
                  >✕</button>
                </div>
              ))}
              <button
                type="button"
                disabled={phase !== 'idle'}
                onClick={() => setAgenda(prev => [...prev, ''])}
                className="text-xs text-gray-600 hover:text-orange-600 disabled:opacity-30"
              >+ Add topic</button>
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Language">
              <select
                value={language}
                onChange={e => setLanguage(e.target.value)}
                disabled={phase !== 'idle'}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base"
                style={{ fontSize: '16px' }}
              >
                <option value="en">English</option>
                <option value="es">Spanish</option>
                <option value="en-es">English + Spanish (code-switching)</option>
              </select>
            </Field>
            <Field label="ASR strategy">
              <select
                value={asrStrategy}
                onChange={e => setAsrStrategy(e.target.value as AsrStrategy)}
                disabled={phase !== 'idle'}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base"
                style={{ fontSize: '16px' }}
              >
                <option value="auto">Let system decide</option>
                <option value="whisper">Whisper</option>
                <option value="deepgram">Deepgram</option>
                <option value="hybrid">Hybrid (high accuracy)</option>
              </select>
            </Field>
          </div>
        </section>
      </div>

      {submitError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{submitError}</div>
      )}

      <div className="flex items-center justify-end gap-3">
        <span className="text-xs text-gray-500">{phaseDescription(phase, files)}</span>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="px-6 py-3 rounded-lg text-sm font-semibold text-white disabled:bg-gray-300 disabled:cursor-not-allowed"
          style={{ backgroundColor: canSubmit ? HERMES : undefined }}
        >
          {phase === 'idle' ? 'Process' : phase === 'creating' ? 'Creating…' : phase === 'uploading' ? 'Uploading…' : phase === 'starting' ? 'Starting pipeline…' : 'Done'}
        </button>
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-gray-600 mb-1">{label}</span>
      {children}
    </label>
  )
}

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

function phaseDescription(phase: Phase, files: PendingFile[]): string {
  if (phase === 'idle') {
    if (files.length === 0) return 'Add at least one file to begin'
    return ''
  }
  if (phase === 'uploading') {
    const done = files.filter(f => f.status === 'uploaded').length
    return `${done}/${files.length} uploaded`
  }
  if (phase === 'starting') return 'Handing off to the pipeline'
  if (phase === 'done') return 'Redirecting to status…'
  return ''
}

// ── TUS upload (one file) ────────────────────────────────────────────────────

interface UploadOneArgs {
  file: File
  localId: string
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

function uploadOne(args: UploadOneArgs): Promise<void> {
  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(args.file, {
      endpoint: args.endpoint,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        Authorization: `Bearer ${args.sessionJwt}`,
        'x-upsert': 'true',
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: args.bucket,
        objectName: args.storagePath,
        contentType: args.file.type || 'application/octet-stream',
        cacheControl: '3600',
      },
      chunkSize: 6 * 1024 * 1024,    // 6MB — Supabase Storage recommends ≥6MB for multipart
      onProgress: (sent, total) => {
        if (total > 0) args.onProgress(sent / total)
      },
      onError: (err) => {
        const msg = err instanceof Error ? err.message : String(err)
        args.onError(msg)
        reject(new Error(`${args.file.name}: ${msg}`))
      },
      onSuccess: async () => {
        try {
          const r = await fetch(
            `/api/recordings/${args.recordingId}/files/${args.serverId}/uploaded`,
            { method: 'POST' },
          )
          if (!r.ok) {
            const body = await r.json().catch(() => ({}))
            const msg = body?.error || `ack ${r.status}`
            args.onError(msg)
            reject(new Error(`${args.file.name}: ${msg}`))
            return
          }
          args.onDone()
          resolve()
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'ack failed'
          args.onError(msg)
          reject(new Error(`${args.file.name}: ${msg}`))
        }
      },
    })
    upload.start()
  })
}
