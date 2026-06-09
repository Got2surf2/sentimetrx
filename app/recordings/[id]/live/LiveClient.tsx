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
import { appendLiveChunk, getPendingLive, clearLiveChunks, type PendingLive } from '@/lib/recordings/liveRecovery'
import MicCheck, { buildAudioConstraints, type MicSettings } from './MicCheck'

const HERMES = '#E8632A'
const SARINA_BLUE = '#00B4D8'   // waveform graph color
const PCM_QUEUE_CAP = 250       // ~10s of opening audio buffered while the WS connects

type Phase = 'idle' | 'requesting' | 'recording' | 'finalizing' | 'error'

interface AttachResponse {
  upload: { protocol: 'tus'; endpoint: string; bucket: string }
  files: Array<{ id: string; original_filename: string; storage_path: string; upload_url: string }>
}

interface LiveSummary {
  headline: string
  summary: string
  topics: string[]
  open_questions: string[]
  decisions: string[]
}

export default function LiveClient({ recordingId, name, language }: { recordingId: string; name: string; language: string }) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsedSec, setElapsedSec] = useState(0)
  const [uploadPct, setUploadPct] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Input device + mic-check settings (controlled by the MicCheck panel). ALL
  // processing off by default: AGC/echo/noise each force a 2-mic (stereo) capture
  // to mono, and that failure is silent — so we default to the stereo-safe side
  // and let the meters + software gain handle a quiet mono mic. See MicCheck.
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [micSettings, setMicSettings] = useState<MicSettings>({
    deviceId: '', agc: false, echoCancellation: false, noiseSuppression: false, gain: 1,
  })
  const patchMic = useCallback((patch: Partial<MicSettings>) => setMicSettings(s => ({ ...s, ...patch })), [])

  // Channels the device actually delivered (1=mono, 2=stereo/split-mic). Drives
  // the on-screen "speakers will be separated" confirmation; the pipeline
  // independently auto-detects the layout from the recorded audio.
  const [capturedChannels, setCapturedChannels] = useState<number | null>(null)

  // Captions (best-effort).
  const [finals, setFinals] = useState<string[]>([])
  const [interim, setInterim] = useState('')
  const [captionsError, setCaptionsError] = useState<string | null>(null)

  // Rolling summary panel (best-effort, throttled by transcript growth).
  const [liveSummary, setLiveSummary] = useState<LiveSummary | null>(null)
  const [summarizing, setSummarizing] = useState(false)

  // Crash recovery: audio from an interrupted prior session, if any.
  const [recovery, setRecovery] = useState<PendingLive | null>(null)
  const appendQueueRef = useRef<Promise<void>>(Promise.resolve())

  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const mimeRef = useRef<string>('audio/webm')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const gainCtxRef = useRef<AudioContext | null>(null)   // software gain-boost graph feeding MediaRecorder
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const drawingRef = useRef(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const finalsRef = useRef<string[]>([])           // mirror of `finals` readable inside the summary interval
  const lastSummarizedLenRef = useRef(0)
  const summarizingRef = useRef(false)
  const hasSummaryRef = useRef(false)
  const pcmQueueRef = useRef<ArrayBuffer[]>([])    // opening frames buffered until the WS opens
  const stopResolverRef = useRef<((blob: Blob) => void) | null>(null)
  const recordedStereoRef = useRef(false)          // did this capture deliver 2 channels? → tells the pipeline to trust the split

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }, [])

  // Auto-scroll the transcript to the newest line.
  useEffect(() => {
    const el = transcriptRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [finals, interim])

  // Close just the Deepgram socket — leaves the audio graph (waveform) running,
  // so a captions failure doesn't kill the meter.
  const stopCaptions = useCallback(() => {
    try {
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'CloseStream' }))
      ws?.close()
    } catch { /* ignore */ }
    wsRef.current = null
  }, [])

  // Tear down the Web Audio graph + waveform loop.
  const teardownAudio = useCallback(() => {
    drawingRef.current = false
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    try { sourceRef.current?.disconnect() } catch { /* ignore */ }
    sourceRef.current = null
    analyserRef.current = null
    audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    gainCtxRef.current?.close().catch(() => {})
    gainCtxRef.current = null
  }, [])

  // Draw the live input waveform to the canvas (real "it's listening" feedback).
  const drawWaveform = useCallback(() => {
    const analyser = analyserRef.current
    const canvas = canvasRef.current
    if (analyser && canvas) {
      const ctx = canvas.getContext('2d')
      if (ctx) {
        const w = canvas.width, h = canvas.height
        const buf = new Uint8Array(analyser.fftSize)
        analyser.getByteTimeDomainData(buf)
        ctx.clearRect(0, 0, w, h)
        ctx.lineWidth = 2
        ctx.strokeStyle = SARINA_BLUE
        ctx.beginPath()
        const slice = w / buf.length
        let x = 0
        for (let i = 0; i < buf.length; i++) {
          const y = (buf[i] / 255) * h
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
          x += slice
        }
        ctx.stroke()
      }
    }
    if (drawingRef.current) rafRef.current = requestAnimationFrame(drawWaveform)
  }, [])

  // Build the Web Audio graph: the waveform analyser + the captions worklet.
  // The worklet is created HERE (not in startCaptions) so it starts capturing PCM
  // the instant recording begins — frames are buffered until the Deepgram socket
  // opens, so the opening of the meeting isn't lost to WS-connect latency.
  // Non-essential — a failure here must not stop recording.
  const startAudioGraph = useCallback(async (stream: MediaStream) => {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const audioCtx = new Ctx()
      audioCtxRef.current = audioCtx
      void audioCtx.resume()
      const source = audioCtx.createMediaStreamSource(stream)
      sourceRef.current = source
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 2048
      source.connect(analyser)
      analyserRef.current = analyser
      drawingRef.current = true
      rafRef.current = requestAnimationFrame(drawWaveform)

      try {
        await audioCtx.audioWorklet.addModule('/worklets/pcm16-worklet.js')
        const node = new AudioWorkletNode(audioCtx, 'pcm16-worklet')
        node.port.onmessage = (e) => {
          const buf = e.data as ArrayBuffer
          const ws = wsRef.current
          if (ws && ws.readyState === WebSocket.OPEN) { try { ws.send(buf) } catch { /* ignore */ } }
          else { const q = pcmQueueRef.current; q.push(buf); if (q.length > PCM_QUEUE_CAP) q.shift() }
        }
        // Route through a muted gain to keep the graph pulling without playback.
        const sink = audioCtx.createGain()
        sink.gain.value = 0
        source.connect(node)
        node.connect(sink)
        sink.connect(audioCtx.destination)
      } catch { /* worklet failed — captions won't stream; waveform still works */ }
    } catch { /* waveform is non-essential */ }
  }, [drawWaveform])

  // Stop the Deepgram socket the RIGHT way: ask it to finalize (CloseStream),
  // keep onmessage alive so the trailing is_final results are appended to the
  // transcript, then close. Resolves when the socket closes or after a cap.
  const flushAndStopCaptions = useCallback(() => new Promise<void>((resolve) => {
    const ws = wsRef.current
    wsRef.current = null
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) { resolve(); return }
    let done = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const finish = () => { if (done) return; done = true; if (timer) clearTimeout(timer); try { ws.close() } catch { /* ignore */ } resolve() }
    ws.onclose = finish
    timer = setTimeout(finish, 2500)   // cap the flush wait
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'CloseStream' }))
    } catch { finish() }
  }), [])

  // Stop the recorder and resolve with the assembled audio blob (after the final
  // ondataavailable + onstop fire).
  const stopRecorder = useCallback(() => new Promise<Blob>((resolve) => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') {
      resolve(new Blob(chunksRef.current, { type: mimeRef.current }))
      return
    }
    stopResolverRef.current = resolve
    recorder.stop()
  }), [])

  // Tear down everything if the user navigates away mid-recording.
  useEffect(() => {
    return () => {
      stopTimer()
      stopCaptions()
      teardownAudio()
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [stopTimer, stopCaptions, teardownAudio])

  // Ask the server for a rolling summary — throttled: only when the transcript
  // has grown meaningfully since the last one (or we have none yet). Best-effort.
  const runSummary = useCallback(async () => {
    if (summarizingRef.current) return
    const text = finalsRef.current.join(' ').trim()
    if (text.length < 200) return
    const grew = text.length - lastSummarizedLenRef.current
    if (hasSummaryRef.current && grew < 500) return

    summarizingRef.current = true
    setSummarizing(true)
    try {
      const r = await fetch(`/api/recordings/${recordingId}/live-summary`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript: text }),
      })
      const j = await r.json().catch(() => ({}))
      if (r.ok && j.summary) {
        setLiveSummary(j.summary as LiveSummary)
        hasSummaryRef.current = true
        lastSummarizedLenRef.current = text.length
      }
    } catch { /* best-effort */ } finally {
      summarizingRef.current = false
      setSummarizing(false)
    }
  }, [recordingId])

  // While recording, poll for a fresh summary on a cadence; runSummary self-gates
  // on transcript growth so most ticks are cheap no-ops.
  useEffect(() => {
    if (phase !== 'recording') return
    const id = setInterval(() => { void runSummary() }, 45000)
    return () => clearInterval(id)
  }, [phase, runSummary])

  // Open the Deepgram live WS and pipe 16-bit PCM from the mic. Best-effort:
  // any failure sets captionsError but leaves the recording running.
  const startCaptions = useCallback(async () => {
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

    const audioCtx = audioCtxRef.current
    if (!audioCtx) { setCaptionsError('Live captions unavailable — recording continues normally.'); return }
    try {
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

      // Flush the opening frames buffered by the worklet while we were connecting.
      ws.onopen = () => {
        const q = pcmQueueRef.current
        pcmQueueRef.current = []
        for (const buf of q) { try { ws.send(buf) } catch { /* ignore */ } }
      }
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string)
          const text: string = msg?.channel?.alternatives?.[0]?.transcript ?? ''
          if (!text) return
          if (msg.is_final) {
            finalsRef.current = [...finalsRef.current, text]
            setFinals(finalsRef.current)
            setInterim('')
          } else {
            setInterim(text)
          }
        } catch { /* non-JSON keepalive */ }
      }
      ws.onerror = () => setCaptionsError('Live captions dropped — recording continues normally.')
    } catch {
      setCaptionsError('Live captions unavailable — recording continues normally.')
    }
  }, [recordingId, language])

  // Upload an assembled audio blob and run it through the existing pipeline.
  // Shared by a normal Stop and by crash recovery.
  const uploadAndProcess = useCallback(async (blob: Blob, blobMime: string) => {
    setPhase('finalizing')
    setUploadPct(0)

    if (blob.size === 0) {
      setError('No audio was captured. Please record again.')
      setPhase('error')
      return
    }

    const { ext, mime } = fileMeta(blobMime)
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

      await postJson(`/api/recordings/${recordingId}/process`, { stereo_capture: recordedStereoRef.current })

      // Audio is safely in the pipeline — drop the local crash-recovery copy.
      await clearLiveChunks(recordingId)

      // 6. Hand off to the status page, which polls the pipeline to the report.
      router.push(`/recordings/${recordingId}/status`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save the recording.')
      setPhase('error')
    }
  }, [recordingId, router])

  // Recover audio persisted by an interrupted prior session.
  const recoverPending = useCallback(async () => {
    if (!recovery) return
    const blob = new Blob(recovery.chunks, { type: recovery.mime })
    await uploadAndProcess(blob, recovery.mime)
  }, [recovery, uploadAndProcess])

  const discardPending = useCallback(async () => {
    await clearLiveChunks(recordingId)
    setRecovery(null)
  }, [recordingId])

  // On load, surface any audio left by an interrupted session for this recording.
  useEffect(() => {
    let cancelled = false
    getPendingLive(recordingId).then(p => { if (!cancelled && p) setRecovery(p) }).catch(() => {})
    return () => { cancelled = true }
  }, [recordingId])

  // Warm the worklet script into the HTTP cache on mount so `addModule` is fast
  // when recording starts — shrinks the brief window before the captions worklet
  // produces its first frame (the residual opening loss). Best-effort.
  useEffect(() => {
    fetch('/worklets/pcm16-worklet.js', { cache: 'force-cache' }).catch(() => {})
  }, [])

  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      setDevices(all.filter(d => d.kind === 'audioinput'))
    } catch { /* ignore */ }
  }, [])

  // Device labels are only exposed after mic permission is granted; this primes
  // it (brief getUserMedia, immediately stopped) so the dropdown shows real names.
  const enableDeviceNames = useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      s.getTracks().forEach(t => t.stop())
      await refreshDevices()
    } catch { /* denial is handled when the user hits Start */ }
  }, [refreshDevices])

  // List input devices on load and whenever one is plugged in/out (e.g. a RØDE).
  useEffect(() => {
    void refreshDevices()
    const onChange = () => { void refreshDevices() }
    navigator.mediaDevices?.addEventListener?.('devicechange', onChange)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', onChange)
  }, [refreshDevices])

  const start = useCallback(async () => {
    // Starting fresh abandons any unrecovered prior chunks.
    void clearLiveChunks(recordingId)
    setRecovery(null)
    setError(null)
    setCaptionsError(null)
    setFinals([])
    setInterim('')
    setLiveSummary(null)
    finalsRef.current = []
    pcmQueueRef.current = []
    lastSummarizedLenRef.current = 0
    hasSummaryRef.current = false
    setPhase('requesting')
    let stream: MediaStream
    try {
      // Constraints come from the Mic check panel (device, AGC, echo-cancel,
      // noise-suppress). buildAudioConstraints requests channelCount {ideal:2} so
      // a split-mic receiver (RØDE Split: mic 1 = Left, mic 2 = Right) delivers 2
      // channels for per-mic separation; a mono mic returns 1 and the pipeline
      // auto-detects that.
      stream = await navigator.mediaDevices.getUserMedia({ audio: buildAudioConstraints(micSettings) })
    } catch (e) {
      const name = e instanceof DOMException ? e.name : ''
      setError(
        name === 'NotAllowedError'
          ? 'Microphone access was denied. Allow the mic for this site and try again.'
          : name === 'OverconstrainedError' || name === 'NotFoundError'
          ? 'The selected microphone is unavailable — pick another and try again.'
          : 'Could not access a microphone on this device.',
      )
      setPhase('error')
      return
    }
    streamRef.current = stream
    const gotChannels = stream.getAudioTracks()[0]?.getSettings().channelCount
    setCapturedChannels(typeof gotChannels === 'number' ? gotChannels : null)
    void refreshDevices() // labels are available now permission is granted

    // Record the output of a WebAudio graph (not the raw track) whenever the
    // source is stereo OR a gain boost is set. Why for stereo: MediaRecorder only
    // *inconsistently* preserves a 2-channel track — routing through an explicit
    // 2-channel MediaStreamAudioDestinationNode GUARANTEES the recorded blob keeps
    // both mics on separate channels. Unity-gain mono still records the raw stream.
    const trackStereo = (gotChannels ?? 1) >= 2
    recordedStereoRef.current = trackStereo
    let recordStream = stream
    if (trackStereo || micSettings.gain !== 1) {
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        const gctx = new Ctx()
        gainCtxRef.current = gctx
        const src = gctx.createMediaStreamSource(stream)
        const dest = gctx.createMediaStreamDestination()
        dest.channelCount = trackStereo ? 2 : 1     // force a true 2-channel (or mono) output
        dest.channelCountMode = 'explicit'
        if (micSettings.gain !== 1) {
          const g = gctx.createGain(); g.gain.value = micSettings.gain
          src.connect(g); g.connect(dest)
        } else {
          src.connect(dest)
        }
        recordStream = dest.stream
      } catch { /* graph failed — record the raw stream */ }
    }

    const mime = pickMimeType()
    mimeRef.current = fileMeta(mime).mime
    chunksRef.current = []
    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(recordStream, mime ? { mimeType: mime } : undefined)
    } catch {
      stream.getTracks().forEach(t => t.stop())
      gainCtxRef.current?.close().catch(() => {}); gainCtxRef.current = null
      setError('This browser cannot record audio (MediaRecorder unsupported).')
      setPhase('error')
      return
    }
    recorder.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0) return
      chunksRef.current.push(e.data)
      // Mirror to IndexedDB for crash recovery; serialize to preserve order.
      const chunk = e.data
      appendQueueRef.current = appendQueueRef.current.then(() => appendLiveChunk(recordingId, chunk, mimeRef.current))
    }
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeRef.current })
      const resolve = stopResolverRef.current
      stopResolverRef.current = null
      resolve?.(blob)
    }
    recorderRef.current = recorder
    recorder.start(5000) // timeslice so chunks flush periodically

    setElapsedSec(0)
    setPhase('recording')
    timerRef.current = setInterval(() => setElapsedSec(s => s + 1), 1000)

    void startAudioGraph(recordStream)  // waveform + the buffering captions worklet (hears the gain boost too)
    void startCaptions()                // best-effort; does not block recording
  }, [startCaptions, startAudioGraph, micSettings, refreshDevices])

  const stop = useCallback(async () => {
    stopTimer()
    setPhase('finalizing')
    teardownAudio()   // stop feeding the worklet + the waveform loop

    // Flush captions (capture the closing words Deepgram returns on CloseStream)
    // and finalize the recording file — in parallel.
    const [, blob] = await Promise.all([flushAndStopCaptions(), stopRecorder()])
    streamRef.current?.getTracks().forEach(t => t.stop())

    // finalsRef now includes the trailing finals from the flush. Persist the FULL
    // live transcript (untruncated) before processing, so it can be compared to
    // the post-processed transcript. Best-effort.
    const liveText = finalsRef.current.join(' ').trim()
    if (liveText) {
      try {
        await fetch(`/api/recordings/${recordingId}/live-transcript`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript: liveText }),
        })
      } catch { /* best-effort */ }
    }

    await uploadAndProcess(blob, mimeRef.current)
  }, [stopTimer, teardownAudio, flushAndStopCaptions, stopRecorder, recordingId, uploadAndProcess])

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

            <div className="mt-5 max-w-md mx-auto">
              <MicCheck
                recordingId={recordingId}
                language={language}
                devices={devices}
                settings={micSettings}
                onChange={patchMic}
                onShowNames={enableDeviceNames}
                disabled={phase === 'requesting'}
              />
            </div>

            {error && (
              <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
            )}
            {recovery && (
              <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-4 text-left">
                <div className="text-sm font-semibold text-amber-900">Unsaved recording found</div>
                <p className="text-xs text-amber-800 mt-1">
                  A previous session was interrupted with about {(recovery.bytes / (1024 * 1024)).toFixed(1)} MB of audio captured.
                  You can upload and process it, or discard it and start fresh.
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <button type="button" onClick={recoverPending} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white" style={{ backgroundColor: HERMES }}>Upload &amp; process</button>
                  <button type="button" onClick={discardPending} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 border border-gray-300 hover:bg-gray-50">Discard</button>
                </div>
              </div>
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

            {capturedChannels === 2 && (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs font-medium text-emerald-700">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Stereo — 2 mics detected. Speakers will be separated by channel.
              </div>
            )}

            {/* Live input waveform — real signal feedback (check placement/level). */}
            <div className="mt-5 rounded-xl bg-gray-900 px-3 py-2">
              <canvas ref={canvasRef} width={1200} height={72} className="w-full h-16 block" />
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-3 text-left">
              {/* Live transcript */}
              <div className="md:col-span-2">
                <div className="text-xs font-semibold text-gray-700 mb-1">Live transcript</div>
                <div
                  ref={transcriptRef}
                  className="bg-gray-50 border border-gray-200 rounded-xl p-4 h-72 overflow-y-auto text-sm leading-relaxed"
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
                {captionsError && finals.length > 0 && <p className="mt-2 text-xs text-amber-600">{captionsError}</p>}
              </div>

              {/* Rolling summary */}
              <div className="md:col-span-1">
                <div className="text-xs font-semibold text-gray-700 mb-1 flex items-center justify-between">
                  <span>Live summary</span>
                  {summarizing && <span className="text-gray-400 font-normal">updating…</span>}
                </div>
                <div className="bg-orange-50/50 border border-orange-200 rounded-xl p-4 h-72 overflow-y-auto text-sm">
                  {liveSummary ? (
                    <div className="space-y-3">
                      {liveSummary.headline && <p className="font-semibold text-gray-900">{liveSummary.headline}</p>}
                      {liveSummary.summary && <p className="text-gray-700">{liveSummary.summary}</p>}
                      {liveSummary.topics.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {liveSummary.topics.map((t, i) => (
                            <span key={i} className="px-2 py-0.5 rounded-full bg-white border border-orange-200 text-xs text-gray-600">{t}</span>
                          ))}
                        </div>
                      )}
                      {liveSummary.open_questions.length > 0 && (
                        <div>
                          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Open questions</div>
                          <ul className="list-disc list-outside pl-5 text-gray-700 text-xs space-y-0.5">
                            {liveSummary.open_questions.map((q, i) => <li key={i}>{q}</li>)}
                          </ul>
                        </div>
                      )}
                      {liveSummary.decisions.length > 0 && (
                        <div>
                          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Decisions / actions</div>
                          <ul className="list-disc list-outside pl-5 text-gray-700 text-xs space-y-0.5">
                            {liveSummary.decisions.map((d, i) => <li key={i}>{d}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-gray-400 italic">A running summary appears here a minute or two in.</p>
                  )}
                </div>
              </div>
            </div>

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
