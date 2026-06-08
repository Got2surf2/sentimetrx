'use client'

// app/recordings/[id]/live/LiveClient.tsx
//
// Live in-person capture (§ 15). Records the room mic with MediaRecorder, and
// on Stop assembles one audio file, uploads it via the shared TUS path, then
// hands off to the existing pipeline (attach → ack → process). The recorded
// file is the authoritative source — the same high-quality batch transcription
// + analysis the wizard produces runs on it.
//
// Piece 2b: the same mic stream is tee'd into an AudioWorklet → Deepgram live
// WS (auth'd with a short-lived token) for on-screen captions. Captions are
// best-effort — if the token or socket fails, recording continues unaffected.
// The streamed transcript is a convenience layer only; never the deliverable.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { tusUpload } from '@/lib/recordings/tusUpload'

const HERMES = '#E8632A'

type Phase = 'idle' | 'requesting' | 'recording' | 'finalizing' | 'error'

interface AttachResponse {
  upload: { protocol: 'tus'; endpoint: string; bucket: string }
  files: Array<{ id: string; original_filename: string; storage_path: string; upload_url: string }>
}

export default function LiveClient({ recordingId, name, language }: { recordingId: string; name: string; language: string }) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsedSec, setElapsedSec] = useState(0)
  const [uploadPct, setUploadPct] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Captions (best-effort).
  const [finals, setFinals] = useState<string[]>([])
  const [interim, setInterim] = useState('')
  const [captionsError, setCaptionsError] = useState<string | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const mimeRef = useRef<string>('audio/webm')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const transcriptRef = useRef<HTMLDivElement | null>(null)

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }, [])

  // Auto-scroll the transcript to the newest line.
  useEffect(() => {
    const el = transcriptRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [finals, interim])

  const stopCaptions = useCallback(() => {
    try {
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'CloseStream' }))
      ws?.close()
    } catch { /* ignore */ }
    wsRef.current = null
    audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
  }, [])

  // Tear down everything if the user navigates away mid-recording.
  useEffect(() => {
    return () => {
      stopTimer()
      stopCaptions()
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [stopTimer, stopCaptions])

  // Open the Deepgram live WS and pipe 16-bit PCM from the mic. Best-effort:
  // any failure sets captionsError but leaves the recording running.
  const startCaptions = useCallback(async (stream: MediaStream) => {
    let token: string
    try {
      const r = await fetch(`/api/recordings/${recordingId}/live-token`, { method: 'POST' })
      const j = await r.json()
      if (!r.ok || !j.access_token) throw new Error(j.error || 'no token')
      token = j.access_token as string
    } catch {
      setCaptionsError('Live captions unavailable — recording continues normally.')
      return
    }

    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const audioCtx = new Ctx()
      audioCtxRef.current = audioCtx
      await audioCtx.audioWorklet.addModule('/worklets/pcm16-worklet.js')

      const params = new URLSearchParams({
        model: 'nova-3',
        language: language || 'en',
        encoding: 'linear16',
        sample_rate: String(Math.round(audioCtx.sampleRate)),
        channels: '1',
        interim_results: 'true',
        punctuate: 'true',
        smart_format: 'true',
      })
      const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params.toString()}`, ['bearer', token])
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string)
          const text: string = msg?.channel?.alternatives?.[0]?.transcript ?? ''
          if (!text) return
          if (msg.is_final) {
            setFinals(prev => [...prev, text])
            setInterim('')
          } else {
            setInterim(text)
          }
        } catch { /* non-JSON keepalive */ }
      }
      ws.onerror = () => setCaptionsError('Live captions dropped — recording continues normally.')

      const source = audioCtx.createMediaStreamSource(stream)
      const node = new AudioWorkletNode(audioCtx, 'pcm16-worklet')
      node.port.onmessage = (e) => { if (ws.readyState === WebSocket.OPEN) ws.send(e.data as ArrayBuffer) }
      // Route through a muted gain to keep the graph pulling without audible playback.
      const sink = audioCtx.createGain()
      sink.gain.value = 0
      source.connect(node)
      node.connect(sink)
      sink.connect(audioCtx.destination)
    } catch {
      setCaptionsError('Live captions unavailable — recording continues normally.')
      stopCaptions()
    }
  }, [recordingId, language, stopCaptions])

  // Assemble the recording and run it through the existing pipeline.
  const finalize = useCallback(async () => {
    setPhase('finalizing')
    setUploadPct(0)

    const blob = new Blob(chunksRef.current, { type: mimeRef.current })
    if (blob.size === 0) {
      setError('No audio was captured. Please record again.')
      setPhase('error')
      return
    }

    const { ext, mime } = fileMeta(mimeRef.current)
    const filename = `live-recording-${recordingId.slice(0, 8)}.${ext}`

    try {
      // 1. Attach the file (awaiting_media → uploading) and get the TUS endpoint.
      const attachRes = await postJson<AttachResponse>(`/api/recordings/${recordingId}/files`, {
        files: [{ original_filename: filename, size_bytes: blob.size, mime_type: mime, is_video: false, file_role: 'media' }],
      })
      const serverFile = attachRes.files[0]
      if (!serverFile) throw new Error('attach returned no file')

      // 2. Read the session JWT for the direct-to-Storage upload.
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Could not read your session — try refreshing.')

      // 3. Upload the recorded audio to Storage.
      await tusUpload({
        file: blob,
        storagePath: serverFile.storage_path,
        endpoint: attachRes.upload.endpoint,
        bucket: attachRes.upload.bucket,
        sessionJwt: session.access_token,
        contentType: mime,
        onProgress: (f) => setUploadPct(Math.round(f * 100)),
      })

      // 4. Ack the upload, then 5. start the pipeline.
      const ack = await fetch(`/api/recordings/${recordingId}/files/${serverFile.id}/uploaded`, { method: 'POST' })
      if (!ack.ok) throw new Error((await ack.json().catch(() => ({}))).error || `upload ack failed (${ack.status})`)

      await postJson(`/api/recordings/${recordingId}/process`, {})

      // 6. Hand off to the status page, which polls the pipeline to the report.
      router.push(`/recordings/${recordingId}/status`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save the recording.')
      setPhase('error')
    }
  }, [recordingId, router])

  const start = useCallback(async () => {
    setError(null)
    setCaptionsError(null)
    setFinals([])
    setInterim('')
    setPhase('requesting')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      setError(
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? 'Microphone access was denied. Allow the mic for this site and try again.'
          : 'Could not access a microphone on this device.',
      )
      setPhase('error')
      return
    }
    streamRef.current = stream

    const mime = pickMimeType()
    mimeRef.current = fileMeta(mime).mime
    chunksRef.current = []
    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    } catch {
      stream.getTracks().forEach(t => t.stop())
      setError('This browser cannot record audio (MediaRecorder unsupported).')
      setPhase('error')
      return
    }
    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data) }
    recorder.onstop = () => { void finalize() }
    recorderRef.current = recorder
    recorder.start(5000) // timeslice so chunks flush periodically

    setElapsedSec(0)
    setPhase('recording')
    timerRef.current = setInterval(() => setElapsedSec(s => s + 1), 1000)

    void startCaptions(stream) // best-effort; does not block recording
  }, [finalize, startCaptions])

  const stop = useCallback(() => {
    stopTimer()
    stopCaptions()
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop() // fires a final ondataavailable then onstop → finalize()
    }
    streamRef.current?.getTracks().forEach(t => t.stop())
  }, [stopTimer, stopCaptions])

  return (
    <div>
      <header className="mb-6">
        <Link href={`/recordings/${recordingId}/status`} className="text-xs text-gray-500 hover:text-gray-700">← Back to project</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">{name}</h1>
        <p className="text-sm text-gray-500 mt-1">Live recording</p>
      </header>

      <section className="bg-white border-2 border-orange-200 rounded-2xl p-8 text-center">
        {(phase === 'idle' || phase === 'requesting' || phase === 'error') && (
          <>
            <div className="text-5xl mb-4">🎙️</div>
            <h2 className="font-semibold text-gray-900">Record this meeting live</h2>
            <p className="text-sm text-gray-500 mt-2 max-w-md mx-auto">
              Keep this tab open and in the foreground while recording. You&apos;ll see live captions as people
              speak; when you stop, we save the audio and run the same transcription and analysis the upload flow uses.
            </p>
            {error && (
              <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
            )}
            <button
              type="button"
              onClick={start}
              disabled={phase === 'requesting'}
              className="mt-6 px-8 py-3 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
              style={{ backgroundColor: HERMES }}
            >
              {phase === 'requesting' ? 'Requesting microphone…' : error ? 'Try again' : 'Start recording'}
            </button>
          </>
        )}

        {phase === 'recording' && (
          <>
            <div className="flex items-center justify-center gap-2 text-red-600">
              <span className="inline-block w-3 h-3 rounded-full bg-red-600 animate-pulse" />
              <span className="text-sm font-semibold tracking-wide">RECORDING</span>
            </div>
            <div className="mt-3 text-4xl font-mono font-bold text-gray-900 tabular-nums">{formatElapsed(elapsedSec)}</div>

            <div
              ref={transcriptRef}
              className="mt-6 text-left bg-gray-50 border border-gray-200 rounded-xl p-4 h-64 overflow-y-auto text-sm leading-relaxed"
            >
              {finals.length === 0 && !interim ? (
                <p className="text-gray-400 italic">{captionsError ? captionsError : 'Listening… captions will appear here as people speak.'}</p>
              ) : (
                <>
                  {finals.map((line, i) => <span key={i} className="text-gray-800">{line} </span>)}
                  {interim && <span className="text-gray-400">{interim}</span>}
                </>
              )}
            </div>
            {captionsError && finals.length > 0 && (
              <p className="mt-2 text-xs text-amber-600">{captionsError}</p>
            )}

            <button
              type="button"
              onClick={stop}
              className="mt-6 px-8 py-3 rounded-lg text-sm font-semibold text-white bg-gray-900 hover:bg-black"
            >
              Stop &amp; process
            </button>
          </>
        )}

        {phase === 'finalizing' && (
          <>
            <div className="text-4xl mb-4">⏳</div>
            <h2 className="font-semibold text-gray-900">Saving your recording…</h2>
            <p className="text-sm text-gray-500 mt-2">Uploading audio ({uploadPct}%), then starting the pipeline.</p>
            <div className="mt-4 h-1.5 bg-gray-100 rounded overflow-hidden max-w-xs mx-auto">
              <div className="h-full bg-orange-400 transition-all" style={{ width: `${uploadPct}%` }} />
            </div>
          </>
        )}
      </section>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatElapsed(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c
  }
  return '' // let the browser pick its default
}

function fileMeta(mimeType: string): { ext: string; mime: string } {
  const base = (mimeType.split(';')[0] || 'audio/webm').trim()
  if (base === 'audio/mp4') return { ext: 'm4a', mime: 'audio/mp4' }
  if (base === 'audio/ogg') return { ext: 'ogg', mime: 'audio/ogg' }
  return { ext: 'webm', mime: 'audio/webm' }
}

async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const json = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((json as { error?: string }).error || `${url} failed (${r.status})`)
  return json as T
}
