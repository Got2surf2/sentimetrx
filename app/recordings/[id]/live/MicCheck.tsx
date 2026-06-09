'use client'

// app/recordings/[id]/live/MicCheck.tsx
//
// Pre-flight "Mic check" panel for live Town Hall capture. Lets the user pick a
// microphone and TEST it before recording: a live preview stream drives per-
// channel level meters (Left/Right for a split-mic / RØDE stereo source, single
// for mono), with too-quiet / clipping guidance, plus the input adjustments the
// browser actually exposes — AGC, echo-cancellation, noise-suppression, and a
// software gain boost. It can also stream live captions (the same Deepgram path
// the real recording uses) and record a short test clip to play back — a full
// dress rehearsal of the capture chain. The chosen settings are lifted to the
// parent (controlled) so the real recording uses exactly what was tested.
//
// The browser CANNOT set a mic's hardware gain (that lives on the device / RØDE
// Central). The gain slider here is a software boost applied in the audio graph.

import { useCallback, useEffect, useRef, useState } from 'react'

export interface MicSettings {
  deviceId: string              // '' = system default
  agc: boolean                  // autoGainControl
  echoCancellation: boolean
  noiseSuppression: boolean
  gain: number                  // software gain multiplier; 1 = unity (0 dB)
}

/** Build the getUserMedia audio constraints for a settings object. Shared with
 *  the recorder so the test and the real capture request identical input. */
export function buildAudioConstraints(s: MicSettings): MediaTrackConstraints {
  const audio: MediaTrackConstraints = {
    echoCancellation: s.echoCancellation,
    noiseSuppression: s.noiseSuppression,
    autoGainControl: s.agc,
    channelCount: { ideal: 2 },   // capture stereo when the device offers it (split mics)
  }
  if (s.deviceId) audio.deviceId = { exact: s.deviceId }
  return audio
}

const GAIN_MIN = 1
const GAIN_MAX = 4               // +12 dB ceiling
const CLIP_MAX_MS = 30_000       // auto-stop a test clip after 30s
const PCM_QUEUE_CAP = 250        // ~10s of opening audio buffered while the WS connects

function gainToDb(g: number): string {
  const db = 20 * Math.log10(g)
  return `${db >= 0 ? '+' : ''}${db.toFixed(0)} dB`
}

type Zone = 'quiet' | 'good' | 'clip'
function zoneOf(level: number): Zone {
  if (level >= 0.96) return 'clip'
  if (level < 0.12) return 'quiet'
  return 'good'
}

interface Reco { messages: string[]; suggested: MicSettings; hasChanges: boolean }

// Turn what the test observed (peak level, whether it clipped, channel count)
// + the current settings into a concrete recommendation the user can one-click
// apply. Heuristics, deliberately conservative for room/multi-speaker capture.
function computeReco(maxLevel: number, clipped: boolean, channels: number, s: MicSettings): Reco {
  if (maxLevel < 0.02) {
    return { messages: ['We didn’t pick up much sound — run the test again and speak normally first.'], suggested: s, hasChanges: false }
  }
  const messages: string[] = []
  const suggested: MicSettings = { ...s }

  // Level → gain.
  if (clipped || maxLevel >= 0.96) {
    if (s.gain > 1) { suggested.gain = Math.max(1, Math.round(s.gain * 0.7 * 10) / 10); messages.push(`Peaks were clipping — lower software gain to ${gainToDb(suggested.gain)}.`) }
    else messages.push('Peaks were clipping — lower the mic’s hardware gain (device / RØDE Central) or move back a little.')
  } else if (maxLevel < 0.2) {
    const factor = 0.5 / maxLevel
    suggested.gain = Math.min(4, Math.max(s.gain, Math.round(s.gain * factor * 10) / 10))
    if (suggested.gain > s.gain) messages.push(`Signal was low — raise software gain to about ${gainToDb(suggested.gain)} (or move closer / raise the mic’s own gain).`)
    else messages.push('Signal was a little low — move closer or raise the mic’s own gain.')
  } else {
    messages.push('Input level looked good.')
  }

  // Processing — defaults that preserve every voice in a room.
  if (s.echoCancellation) { suggested.echoCancellation = false; messages.push('Turn OFF echo cancellation — it can swallow other voices around a table.') }
  if (s.noiseSuppression) { suggested.noiseSuppression = false; messages.push('Turn OFF noise suppression — it can clip quiet speakers (use it only for steady background hum).') }
  if (channels === 2 && s.agc) { suggested.agc = false; messages.push('With split mics, turn OFF automatic gain control — it fights the per-mic levels; use software gain instead.') }
  if (channels === 2) messages.push('Stereo split detected — the two mics will be separated as Speaker 1 / Speaker 2.')

  const hasChanges = suggested.gain !== s.gain || suggested.agc !== s.agc
    || suggested.echoCancellation !== s.echoCancellation || suggested.noiseSuppression !== s.noiseSuppression
  return { messages, suggested, hasChanges }
}

// Encode an AudioBuffer's first channel as a 16-bit PCM WAV blob (for mono
// playback of a stereo test clip).
function encodeWavMono(buffer: AudioBuffer): Blob {
  const sr = buffer.sampleRate
  const samples = buffer.getChannelData(0)
  const dataLen = samples.length * 2
  const ab = new ArrayBuffer(44 + dataLen)
  const dv = new DataView(ab)
  const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)) }
  writeStr(0, 'RIFF'); dv.setUint32(4, 36 + dataLen, true); writeStr(8, 'WAVE')
  writeStr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true)
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true)
  writeStr(36, 'data'); dv.setUint32(40, dataLen, true)
  let off = 44
  for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true); off += 2 }
  return new Blob([ab], { type: 'audio/wav' })
}

// Downmix a recorded (stereo) clip to a centered-mono WAV object URL.
async function deriveMonoUrl(blob: Blob): Promise<string> {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const tmp = new Ctx()
  const decoded = await tmp.decodeAudioData(await blob.arrayBuffer())
  tmp.close().catch(() => {})
  const offline = new OfflineAudioContext(1, decoded.length, decoded.sampleRate)
  const src = offline.createBufferSource()
  src.buffer = decoded
  src.connect(offline.destination)   // stereo → 1-ch destination downmixes to mono
  src.start()
  const rendered = await offline.startRendering()
  return URL.createObjectURL(encodeWavMono(rendered))
}

// ── Auto-tune sweep ──────────────────────────────────────────────────────────
// Records a few seconds under each meaningful processing combination, measures
// objective signal stats, and picks the clearest. Echo-cancellation is held OFF
// (it hurts room/multi-speaker capture); we sweep AGC × noise-suppression.

interface ComboMetrics { peak: number; clipFrac: number; snrDb: number; level: number }
const SWEEP: { agc: boolean; noiseSuppression: boolean; label: string }[] = [
  { agc: false, noiseSuppression: false, label: 'No processing' },
  { agc: true, noiseSuppression: false, label: 'Auto gain' },
  { agc: false, noiseSuppression: true, label: 'Noise suppression' },
  { agc: true, noiseSuppression: true, label: 'Auto gain + noise suppression' },
]
const SWEEP_MS = 3000

// Open a stream under `audio`, measure for `ms`, return signal stats. SNR is
// estimated from the spread between quiet (10th pct) and loud (90th pct) frames.
async function measureCombo(audio: MediaTrackConstraints, ms: number, cancelled: () => boolean): Promise<ComboMetrics> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio })
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new Ctx()
  try {
    await ctx.resume()
    const an = ctx.createAnalyser(); an.fftSize = 2048
    ctx.createMediaStreamSource(stream).connect(an)
    const buf = new Float32Array(an.fftSize)
    const frames: number[] = []
    let peak = 0, clip = 0, total = 0
    const start = performance.now()
    await new Promise<void>((resolve) => {
      const tick = () => {
        if (cancelled()) { resolve(); return }
        an.getFloatTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) { const v = buf[i]; const a = Math.abs(v); sum += v * v; if (a > peak) peak = a; if (a >= 0.98) clip++; total++ }
        frames.push(Math.sqrt(sum / buf.length))
        if (performance.now() - start >= ms) resolve()
        else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    frames.sort((a, b) => a - b)
    const noise = frames[Math.floor(frames.length * 0.1)] ?? 1e-6
    const speech = frames[Math.floor(frames.length * 0.9)] ?? noise
    const snrDb = 20 * Math.log10((speech + 1e-9) / (noise + 1e-9))
    return { peak, clipFrac: clip / Math.max(1, total), snrDb, level: speech }
  } finally {
    stream.getTracks().forEach(t => t.stop())
    ctx.close().catch(() => {})
  }
}

function scoreCombo(m: ComboMetrics): number {
  let s = m.snrDb                 // clarity, higher better
  if (m.peak >= 0.98) s -= 25     // clipping is near-disqualifying
  if (m.level < 0.08) s -= 12     // too quiet
  else if (m.level > 0.92) s -= 6 // too hot
  return s
}

export default function MicCheck({
  recordingId, language, devices, settings, onChange, onShowNames, disabled,
}: {
  recordingId: string
  language: string
  devices: MediaDeviceInfo[]
  settings: MicSettings
  onChange: (patch: Partial<MicSettings>) => void
  onShowNames: () => void
  disabled?: boolean
}) {
  const [testing, setTesting] = useState(false)
  const [channels, setChannels] = useState(1)
  const [levels, setLevels] = useState<{ l: number; r: number }>({ l: 0, r: 0 })
  const [peakSeen, setPeakSeen] = useState(0)     // max level observed this test (drives the low-signal hint)
  const [err, setErr] = useState<string | null>(null)

  // Live captions during the test (best-effort, mirrors the real recorder path).
  // Keyed by source: 'mono' for a single mic, or 'L'/'R' for a stereo split so
  // each mic's words stream in its own color — a live 2-mic test.
  const [caps, setCaps] = useState<Record<string, { finals: string[]; interim: string }>>({})
  const [capErr, setCapErr] = useState<string | null>(null)

  // Test clip record + playback (local only — never uploaded).
  const [clipRecording, setClipRecording] = useState(false)
  const [clipUrl, setClipUrl] = useState<string | null>(null)        // stereo (as recorded)
  const [clipMono, setClipMono] = useState(false)                    // play the mono downmix instead
  const [clipMonoUrl, setClipMonoUrl] = useState<string | null>(null)
  const clipBlobRef = useRef<Blob | null>(null)
  const clipMonoUrlRef = useRef<string | null>(null)

  // Live monitoring — route the processed mic to the speakers so the user can
  // HEAR the effect of each toggle/gain change and pick what sounds best. Off by
  // default: monitoring through speakers with an open mic feeds back (headphones).
  const [monitor, setMonitor] = useState(false)

  // Post-test recommendation (settings the test suggests, one-click apply).
  const [reco, setReco] = useState<Reco | null>(null)
  const maxLevelRef = useRef(0)        // peak level observed this test
  const clipRef = useRef(false)        // did it ever clip?
  const channelsRef = useRef(1)        // captured channel count (stable read for stopTest)

  // Auto-tune sweep state.
  const [autotune, setAutotune] = useState<{ phase: 'idle' | 'intro' | 'running'; idx: number; label: string }>({ phase: 'idle', idx: 0, label: '' })
  const cancelAutoRef = useRef(false)

  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const monitorGainRef = useRef<GainNode | null>(null)                   // speaker monitor (0 = muted)
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null)   // gain-applied stream for the test clip
  const analysersRef = useRef<{ l: AnalyserNode | null; r: AnalyserNode | null }>({ l: null, r: null })
  const rafRef = useRef<number | null>(null)
  const smoothRef = useRef<{ l: number; r: number }>({ l: 0, r: 0 })
  const frameRef = useRef(0)
  // Per-caption-stream WS + opening-PCM queue + accumulated finals, keyed like `caps`.
  const capRef = useRef<Record<string, { ws: WebSocket | null; queue: ArrayBuffer[]; finals: string[] }>>({})
  const clipRecorderRef = useRef<MediaRecorder | null>(null)
  const clipChunksRef = useRef<Blob[]>([])
  const clipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clipUrlRef = useRef<string | null>(null)
  // Latest settings/monitor, read inside the (stable) start routine without
  // re-creating it (so a constraint-change re-open preserves the monitor state).
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const monitorRef = useRef(monitor)
  monitorRef.current = monitor

  const revokeClip = useCallback(() => {
    if (clipUrlRef.current) { URL.revokeObjectURL(clipUrlRef.current); clipUrlRef.current = null }
    if (clipMonoUrlRef.current) { URL.revokeObjectURL(clipMonoUrlRef.current); clipMonoUrlRef.current = null }
    clipBlobRef.current = null
    setClipUrl(null)
    setClipMonoUrl(null)
    setClipMono(false)
  }, [])

  const stopCaptions = useCallback(() => {
    for (const k of Object.keys(capRef.current)) {
      try {
        const ws = capRef.current[k].ws
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'CloseStream' }))
        ws?.close()
      } catch { /* ignore */ }
    }
    capRef.current = {}
  }, [])

  const stopClip = useCallback(() => {
    if (clipTimerRef.current) { clearTimeout(clipTimerRef.current); clipTimerRef.current = null }
    const rec = clipRecorderRef.current
    if (rec && rec.state !== 'inactive') { try { rec.stop() } catch { /* ignore */ } }
  }, [])

  const stopTest = useCallback((recommend = false) => {
    // Snapshot the recommendation from what the test heard, BEFORE resetting —
    // only on an explicit "Stop test" (not on a constraint-change re-open/unmount).
    if (recommend) setReco(computeReco(maxLevelRef.current, clipRef.current, channelsRef.current, settingsRef.current))
    maxLevelRef.current = 0
    clipRef.current = false
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    stopClip()
    clipRecorderRef.current = null
    stopCaptions()
    ctxRef.current?.close().catch(() => {})
    ctxRef.current = null
    gainRef.current = null
    monitorGainRef.current = null
    destRef.current = null
    analysersRef.current = { l: null, r: null }
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    smoothRef.current = { l: 0, r: 0 }
    setLevels({ l: 0, r: 0 })
    setPeakSeen(0)
    setCaps({})
    setCapErr(null)
    setClipRecording(false)
    setTesting(false)
  }, [stopCaptions, stopClip])

  const draw = useCallback(() => {
    const peak = (a: AnalyserNode | null): number => {
      if (!a) return 0
      const buf = new Float32Array(a.fftSize)
      a.getFloatTimeDomainData(buf)
      let p = 0
      for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > p) p = v }
      return p
    }
    // Fast attack, slow decay so the meter reads naturally and brief peaks show.
    const sm = smoothRef.current
    const l = peak(analysersRef.current.l)
    const r = peak(analysersRef.current.r)
    sm.l = l > sm.l ? l : sm.l * 0.85 + l * 0.15
    sm.r = r > sm.r ? r : sm.r * 0.85 + r * 0.15

    const m = Math.max(sm.l, sm.r)
    if (m > maxLevelRef.current) maxLevelRef.current = m
    if (m >= 0.96) clipRef.current = true

    frameRef.current = (frameRef.current + 1) % 3   // ~20fps state updates
    if (frameRef.current === 0) {
      setLevels({ l: sm.l, r: sm.r })
      setPeakSeen(prev => Math.max(prev, sm.l, sm.r))
    }
    rafRef.current = requestAnimationFrame(draw)
  }, [])

  // Open ONE live-caption stream from a node (a single channel) to Deepgram —
  // same path as the real recorder (token → WS → PCM worklet). `outputIndex` is
  // the splitter output for a stereo channel; undefined for a mono source.
  // Entirely best-effort. `key` keys both the WS state and the rendered line.
  const openCap = useCallback(async (ctx: AudioContext, sourceNode: AudioNode, outputIndex: number | undefined, key: string) => {
    capRef.current[key] = { ws: null, queue: [], finals: [] }
    setCaps(prev => ({ ...prev, [key]: { finals: [], interim: '' } }))
    let token: string
    try {
      const r = await fetch(`/api/recordings/${recordingId}/live-token`, { method: 'POST' })
      const j = await r.json()
      if (!r.ok || !j.access_token) throw new Error(j.error || 'no token')
      token = j.access_token as string
    } catch {
      setCapErr('Live captions unavailable for the test — the mic still works.')
      return
    }
    try {
      await ctx.audioWorklet.addModule('/worklets/pcm16-worklet.js')
      const node = new AudioWorkletNode(ctx, 'pcm16-worklet')
      node.port.onmessage = (e) => {
        const buf = e.data as ArrayBuffer
        const st = capRef.current[key]; if (!st) return
        if (st.ws && st.ws.readyState === WebSocket.OPEN) { try { st.ws.send(buf) } catch { /* ignore */ } }
        else { st.queue.push(buf); if (st.queue.length > PCM_QUEUE_CAP) st.queue.shift() }
      }
      const sink = ctx.createGain(); sink.gain.value = 0
      if (outputIndex === undefined) sourceNode.connect(node); else sourceNode.connect(node, outputIndex)
      node.connect(sink); sink.connect(ctx.destination)

      const params = new URLSearchParams({
        model: 'nova-3', language: language || 'en', encoding: 'linear16',
        sample_rate: String(Math.round(ctx.sampleRate)), channels: '1',
        interim_results: 'true', punctuate: 'true', smart_format: 'true',
      })
      const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params.toString()}`, ['bearer', token])
      ws.binaryType = 'arraybuffer'
      const st0 = capRef.current[key]; if (st0) st0.ws = ws
      ws.onopen = () => {
        const st = capRef.current[key]; if (!st) return
        const q = st.queue; st.queue = []
        for (const buf of q) { try { ws.send(buf) } catch { /* ignore */ } }
      }
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string)
          const text: string = msg?.channel?.alternatives?.[0]?.transcript ?? ''
          if (!text) return
          const st = capRef.current[key]; if (!st) return
          if (msg.is_final) {
            st.finals = [...st.finals, text].slice(-30)
            setCaps(prev => ({ ...prev, [key]: { finals: st.finals, interim: '' } }))
          } else {
            setCaps(prev => ({ ...prev, [key]: { finals: st.finals, interim: text } }))
          }
        } catch { /* keepalive */ }
      }
      ws.onerror = () => setCapErr('Live captions dropped — the mic still works.')
    } catch {
      setCapErr('Live captions unavailable for the test — the mic still works.')
    }
  }, [recordingId, language])

  const startTest = useCallback(async () => {
    setErr(null)
    setCapErr(null)
    setReco(null)
    maxLevelRef.current = 0
    clipRef.current = false
    revokeClip()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: buildAudioConstraints(settingsRef.current) })
      streamRef.current = stream
      const ch = stream.getAudioTracks()[0]?.getSettings().channelCount ?? 1
      channelsRef.current = ch >= 2 ? 2 : 1
      setChannels(ch >= 2 ? 2 : 1)

      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctx()
      ctxRef.current = ctx
      void ctx.resume()
      const src = ctx.createMediaStreamSource(stream)
      const gain = ctx.createGain()
      gain.gain.value = settingsRef.current.gain
      gainRef.current = gain
      src.connect(gain)

      // Meters off the gain stage (so the boost is reflected).
      const splitter = ctx.createChannelSplitter(2)
      gain.connect(splitter)
      const aL = ctx.createAnalyser(); aL.fftSize = 1024; splitter.connect(aL, 0)
      const aR = ctx.createAnalyser(); aR.fftSize = 1024; splitter.connect(aR, 1)
      analysersRef.current = { l: aL, r: aR }

      // Gain-applied stream for the optional test-clip recorder.
      const dest = ctx.createMediaStreamDestination()
      gain.connect(dest)
      destRef.current = dest

      // Speaker monitor (muted unless the user opted in) — lets them hear toggle
      // changes live. Re-open preserves the choice via monitorRef.
      const monitorGain = ctx.createGain()
      monitorGain.gain.value = monitorRef.current ? 1 : 0
      gain.connect(monitorGain)
      monitorGain.connect(ctx.destination)
      monitorGainRef.current = monitorGain

      setTesting(true)
      rafRef.current = requestAnimationFrame(draw)
      // Captions: per-channel for a stereo split (L/R off the meters splitter,
      // each its own color), else a single mono stream. Best-effort.
      if (ch >= 2) {
        void openCap(ctx, splitter, 0, 'L')
        void openCap(ctx, splitter, 1, 'R')
      } else {
        void openCap(ctx, gain, undefined, 'mono')
      }
    } catch {
      setErr('Could not open the microphone to test. Check the OS mic permission and that the device is connected.')
      stopTest()
    }
  }, [draw, stopTest, openCap, revokeClip])

  const recordClip = useCallback(() => {
    const dest = destRef.current
    if (!dest) return
    revokeClip()
    clipChunksRef.current = []
    let rec: MediaRecorder
    try { rec = new MediaRecorder(dest.stream) } catch { setCapErr('This browser can’t record a test clip.'); return }
    rec.ondataavailable = (e) => { if (e.data && e.data.size) clipChunksRef.current.push(e.data) }
    rec.onstop = () => {
      const blob = new Blob(clipChunksRef.current, { type: rec.mimeType || 'audio/webm' })
      clipBlobRef.current = blob
      const url = URL.createObjectURL(blob)
      clipUrlRef.current = url
      setClipUrl(url)
      setClipRecording(false)
    }
    clipRecorderRef.current = rec
    rec.start()
    setClipRecording(true)
    clipTimerRef.current = setTimeout(() => stopClip(), CLIP_MAX_MS)
  }, [revokeClip, stopClip])

  // Toggle test-clip playback between stereo (as recorded) and a centered-mono
  // downmix (derived lazily on first switch to mono).
  const toggleClipMono = useCallback(async () => {
    const next = !clipMono
    setClipMono(next)
    if (next && !clipMonoUrlRef.current && clipBlobRef.current) {
      try {
        const url = await deriveMonoUrl(clipBlobRef.current)
        clipMonoUrlRef.current = url
        setClipMonoUrl(url)
      } catch { setClipMono(false) }
    }
  }, [clipMono])

  // Run the sweep: measure each combo, score, recommend the winner.
  const runAutotune = useCallback(async () => {
    stopTest()
    revokeClip()
    setReco(null)
    cancelAutoRef.current = false
    const base = settingsRef.current
    const results: { combo: typeof SWEEP[number]; m: ComboMetrics }[] = []
    for (let i = 0; i < SWEEP.length; i++) {
      if (cancelAutoRef.current) { setAutotune({ phase: 'idle', idx: 0, label: '' }); return }
      const combo = SWEEP[i]
      setAutotune({ phase: 'running', idx: i, label: combo.label })
      try {
        const m = await measureCombo(
          buildAudioConstraints({ ...base, agc: combo.agc, echoCancellation: false, noiseSuppression: combo.noiseSuppression, gain: 1 }),
          SWEEP_MS, () => cancelAutoRef.current,
        )
        results.push({ combo, m })
      } catch { /* skip a combo that won't open */ }
    }
    setAutotune({ phase: 'idle', idx: 0, label: '' })
    if (cancelAutoRef.current || results.length === 0) return

    results.sort((a, b) => scoreCombo(b.m) - scoreCombo(a.m))
    const win = results[0]
    const suggested: MicSettings = { ...base, agc: win.combo.agc, echoCancellation: false, noiseSuppression: win.combo.noiseSuppression }
    const messages: string[] = [`Clearest: ${win.combo.label.toLowerCase()} — SNR ${win.m.snrDb.toFixed(0)} dB${win.m.peak >= 0.98 ? ', but it clipped' : ''}.`]
    if (win.m.peak >= 0.98) messages.push('It clipped — move back or lower the mic’s hardware gain, then re-run.')
    else if (win.m.level < 0.2) {
      suggested.gain = Math.min(4, Math.max(base.gain, Math.round((0.5 / Math.max(0.05, win.m.level)) * base.gain * 10) / 10))
      if (suggested.gain > base.gain) messages.push(`Raise software gain to about ${gainToDb(suggested.gain)} — the level was low.`)
    }
    messages.push('Scored on objective signal (SNR, clipping, level) — confirm with the live monitor too.')
    const hasChanges = suggested.gain !== base.gain || suggested.agc !== base.agc
      || suggested.noiseSuppression !== base.noiseSuppression || suggested.echoCancellation !== base.echoCancellation
    setReco({ messages, suggested, hasChanges })
  }, [stopTest, revokeClip])

  // Apply gain changes live (no re-open needed).
  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = settings.gain
  }, [settings.gain])

  // Apply the monitor toggle live (no re-open needed).
  useEffect(() => {
    if (monitorGainRef.current) monitorGainRef.current.gain.value = monitor ? 1 : 0
  }, [monitor])

  // Re-open the preview when an input-shaping constraint changes mid-test
  // (device / AGC / echo / noise need a fresh getUserMedia to take effect).
  const constraintKey = `${settings.deviceId}|${settings.agc}|${settings.echoCancellation}|${settings.noiseSuppression}`
  const wasTestingRef = useRef(false)
  useEffect(() => {
    if (!testing) { wasTestingRef.current = false; return }
    if (!wasTestingRef.current) { wasTestingRef.current = true; return }  // initial start already opened
    stopTest()
    const id = setTimeout(() => { void startTest() }, 0)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [constraintKey])

  // Stop the test when the parent disables the panel (recording started) or unmounts.
  useEffect(() => {
    if (disabled && testing) stopTest()
  }, [disabled, testing, stopTest])
  useEffect(() => () => { cancelAutoRef.current = true; stopTest(); revokeClip() }, [stopTest, revokeClip])

  const hasNames = devices.some(d => d.label)
  const lowSignal = testing && peakSeen > 0 && peakSeen < 0.12
  const capKeys = channels === 2 ? ['L', 'R'] : ['mono']
  const anyCaption = capKeys.some(k => caps[k]?.finals.length || caps[k]?.interim)

  return (
    <div className="rounded-lg border border-gray-200 p-3 space-y-3 text-left">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-gray-700">Microphone &amp; mic check</span>
        <div className="flex items-center gap-2">
          {autotune.phase === 'idle' && !testing && (
            <button
              type="button"
              onClick={() => setAutotune({ phase: 'intro', idx: 0, label: '' })}
              disabled={disabled}
              className="text-xs font-semibold rounded-md px-3 py-1 border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              Auto-tune
            </button>
          )}
          <button
            type="button"
            onClick={() => (testing ? stopTest(true) : startTest())}
            disabled={disabled || autotune.phase !== 'idle'}
            className={`text-xs font-semibold rounded-md px-3 py-1 disabled:opacity-40 ${
              testing ? 'bg-gray-900 text-white hover:bg-black' : 'border border-orange-300 text-orange-700 hover:bg-orange-50'
            }`}
          >
            {testing ? 'Stop test' : 'Test microphone'}
          </button>
        </div>
      </div>

      {/* Auto-tune: instructions + run + progress */}
      {autotune.phase === 'intro' && (
        <div className="rounded-lg bg-indigo-50 border border-indigo-200 p-3 space-y-2">
          <div className="text-xs font-semibold text-gray-800">Auto-tune — find the clearest settings</div>
          <p className="text-[11px] text-gray-700">
            We’ll try {SWEEP.length} settings, about {SWEEP_MS / 1000}s each (~{Math.round(SWEEP.length * SWEEP_MS / 1000)}s total), and pick the clearest by signal quality.
          </p>
          <p className="text-[11px] text-gray-700">
            <strong>What you do:</strong> when you press Start, <strong>keep talking at your normal volume and distance the whole time</strong> — read something aloud, recite, or count slowly. Don’t go quiet until it says done. For a 2-mic setup, have the main speaker talk.
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void runAutotune()} className="text-xs font-semibold rounded-md px-3 py-1.5 text-white" style={{ backgroundColor: '#E8632A' }}>Start auto-tune</button>
            <button type="button" onClick={() => setAutotune({ phase: 'idle', idx: 0, label: '' })} className="text-xs font-medium rounded-md px-3 py-1.5 text-gray-600 border border-gray-300 hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      )}
      {autotune.phase === 'running' && (
        <div className="rounded-lg bg-indigo-50 border border-indigo-200 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-800">Auto-tuning… keep talking!</span>
            <span className="text-[11px] text-gray-500">{autotune.idx + 1} / {SWEEP.length}</span>
          </div>
          <div className="h-1.5 bg-indigo-100 rounded overflow-hidden">
            <div className="h-full bg-indigo-500 transition-all" style={{ width: `${((autotune.idx + 1) / SWEEP.length) * 100}%` }} />
          </div>
          <p className="text-[11px] text-gray-600">Testing: {autotune.label}</p>
          <button type="button" onClick={() => { cancelAutoRef.current = true }} className="text-xs font-medium rounded-md px-3 py-1.5 text-gray-600 border border-gray-300 hover:bg-gray-50">Cancel</button>
        </div>
      )}

      {/* Device picker */}
      <div>
        <label htmlFor="mic-select" className="block text-xs font-medium text-gray-600 mb-1">Input device</label>
        <select
          id="mic-select"
          value={settings.deviceId}
          onChange={e => onChange({ deviceId: e.target.value })}
          disabled={disabled}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
          style={{ fontSize: '16px' }}
        >
          <option value="">System default microphone</option>
          {devices.map((d, i) => (
            <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>
          ))}
        </select>
        {!hasNames && (
          <button type="button" onClick={onShowNames} className="mt-1 text-xs text-orange-600 hover:underline">
            Show device names
          </button>
        )}
      </div>

      {/* Post-test recommendation */}
      {reco && !testing && (
        <div className="rounded-lg bg-orange-50 border border-orange-200 p-3 space-y-2">
          <div className="text-xs font-semibold text-gray-800">Recommended after the test</div>
          <ul className="text-[11px] text-gray-700 list-disc pl-4 space-y-0.5">
            {reco.messages.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
          <div className="flex items-center gap-2">
            {reco.hasChanges && (
              <button
                type="button"
                onClick={() => { onChange(reco.suggested); setReco(null) }}
                className="text-xs font-semibold rounded-md px-3 py-1.5 text-white"
                style={{ backgroundColor: '#E8632A' }}
              >Apply recommended</button>
            )}
            <button
              type="button"
              onClick={() => setReco(null)}
              className="text-xs font-medium rounded-md px-3 py-1.5 text-gray-600 border border-gray-300 hover:bg-gray-50"
            >Dismiss</button>
          </div>
        </div>
      )}

      {/* Live meters */}
      {testing && (
        <div className="space-y-2">
          {(channels === 2 ? ['L', 'R'] : ['Mono']).map((label, i) => {
            const level = channels === 2 ? (i === 0 ? levels.l : levels.r) : Math.max(levels.l, levels.r)
            const zone = zoneOf(level)
            const color = zone === 'clip' ? 'bg-red-500' : zone === 'quiet' ? 'bg-amber-400' : 'bg-emerald-500'
            return (
              <div key={label} className="flex items-center gap-2">
                <span className="w-10 shrink-0 text-[11px] font-mono text-gray-500">{label}</span>
                <div className="relative flex-1 h-3 rounded bg-gray-100 overflow-hidden">
                  <div className={`absolute inset-y-0 left-0 ${color} transition-[width] duration-75`} style={{ width: `${Math.min(100, level * 100)}%` }} />
                  <div className="absolute inset-y-0" style={{ left: '96%', width: '1px', background: '#9ca3af' }} />
                </div>
              </div>
            )
          })}
          {channels === 2 && (
            <p className="text-[11px] text-emerald-700">
              Stereo detected — speak into one mic at a time: only its channel (L or R) should move. That confirms the split.
            </p>
          )}
          {lowSignal && (
            <p className="text-[11px] text-amber-700">Signal is low — move closer, speak up, raise the mic&apos;s own gain, or add software gain below.</p>
          )}
          {(levels.l >= 0.96 || levels.r >= 0.96) && (
            <p className="text-[11px] text-red-600">Clipping — back off the mic, lower its gain, or reduce software gain.</p>
          )}
        </div>
      )}

      {/* Live captions during the test — one colored lane per mic for a stereo
          split (matches the report: Mic 1·L plain, Mic 2·R italic/indigo). */}
      {testing && (
        <div>
          <div className="text-[11px] font-semibold text-gray-600 mb-1">Live transcription (test){channels === 2 ? ' — per mic' : ''}</div>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-2 h-24 overflow-y-auto text-xs leading-relaxed space-y-1">
            {!anyCaption ? (
              <span className="text-gray-400 italic">{capErr || 'Say something — captions will appear here.'}</span>
            ) : capKeys.map(k => {
              const c = caps[k]
              if (!c || (!c.finals.length && !c.interim)) return null
              const isR = k === 'R'
              const tone = isR ? 'text-indigo-700 italic' : 'text-gray-800'
              const tag = k === 'L' ? 'Mic 1·L' : k === 'R' ? 'Mic 2·R' : ''
              return (
                <p key={k} className={tone}>
                  {tag && <span className="font-mono text-[10px] not-italic mr-1 opacity-70">{tag}</span>}
                  {c.finals.join(' ')} {c.interim && <span className="opacity-50">{c.interim}</span>}
                </p>
              )
            })}
          </div>
          {capErr && anyCaption && <p className="mt-1 text-[11px] text-amber-600">{capErr}</p>}
        </div>
      )}

      {/* Live monitor + test clip — hear the settings, then capture & play back */}
      {testing && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => setMonitor(m => !m)}
              className={`text-xs font-semibold rounded-md px-3 py-1.5 ${
                monitor ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {monitor ? '🎧 Listening (on)' : '🎧 Listen'}
            </button>
            <button
              type="button"
              onClick={() => (clipRecording ? stopClip() : recordClip())}
              className={`text-xs font-semibold rounded-md px-3 py-1.5 ${
                clipRecording ? 'bg-red-600 text-white hover:bg-red-700' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {clipRecording ? '■ Stop test clip' : '● Record a test clip'}
            </button>
            {clipUrl && !clipRecording && (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <audio src={clipMono && clipMonoUrl ? clipMonoUrl : clipUrl} controls className="h-8 max-w-[200px]" />
            )}
            {clipUrl && !clipRecording && channels === 2 && (
              <div className="flex rounded-md border border-gray-300 overflow-hidden text-[11px]">
                <button type="button" onClick={() => clipMono && void toggleClipMono()}
                  className={`px-2 py-1 font-medium ${!clipMono ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>Stereo</button>
                <button type="button" onClick={() => !clipMono && void toggleClipMono()}
                  className={`px-2 py-1 font-medium ${clipMono ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>Mono</button>
              </div>
            )}
          </div>
          {monitor
            ? <p className="text-[11px] text-amber-700">Monitoring live — <strong>use headphones</strong>, or the speakers will feed back into the mic. Toggle the options below to hear the difference.</p>
            : <p className="text-[11px] text-gray-400">“Listen” monitors the live mic so you can hear each toggle’s effect (headphones).{channels === 2 ? ' Test-clip playback is stereo (Mic 1 = left ear, Mic 2 = right ear) — switch to Mono for a centered mix.' : ' The test clip plays back with your current device & gain.'} Not saved.</p>}
        </div>
      )}

      {err && <p className="text-xs text-red-600">{err}</p>}

      {/* Software gain boost */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label htmlFor="mic-gain" className="text-xs font-medium text-gray-600">Software gain boost</label>
          <span className="text-[11px] font-mono text-gray-500">{gainToDb(settings.gain)}{settings.gain === 1 ? ' (off)' : ''}</span>
        </div>
        <input
          id="mic-gain"
          type="range"
          min={GAIN_MIN}
          max={GAIN_MAX}
          step={0.1}
          value={settings.gain}
          onChange={e => onChange({ gain: parseFloat(e.target.value) })}
          disabled={disabled}
          className="w-full"
        />
        <p className="text-[11px] text-gray-400 mt-0.5">Lifts a quiet signal in software. Can&apos;t change the mic&apos;s hardware gain — set that on the device / RØDE Central.</p>
      </div>

      {/* Processing toggles */}
      <div className="grid grid-cols-1 gap-1.5">
        <Toggle label="Automatic gain control" hint="Recommended for built-in/laptop mics. Off suits a pro mic (e.g. RØDE) that sets its own levels."
          checked={settings.agc} disabled={disabled} onChange={v => onChange({ agc: v })} />
        <Toggle label="Echo cancellation" hint="Off for room/table capture — on can swallow other voices."
          checked={settings.echoCancellation} disabled={disabled} onChange={v => onChange({ echoCancellation: v })} />
        <Toggle label="Noise suppression" hint="Off preserves quiet speakers; on cleans steady background noise."
          checked={settings.noiseSuppression} disabled={disabled} onChange={v => onChange({ noiseSuppression: v })} />
      </div>
    </div>
  )
}

function Toggle({ label, hint, checked, disabled, onChange }: {
  label: string; hint: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-start gap-2 text-sm text-gray-700">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} className="mt-0.5 rounded" />
      <span>
        {label}
        <span className="block text-xs text-gray-400">{hint}</span>
      </span>
    </label>
  )
}
