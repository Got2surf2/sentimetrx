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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { pickReadingPassage } from '@/lib/recordings/readingPassages'

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
  if (channels === 2) {
    if (s.agc || s.echoCancellation || s.noiseSuppression) {
      suggested.agc = false; suggested.echoCancellation = false; suggested.noiseSuppression = false
      messages.push('Turn OFF all audio processing (AGC / echo / noise) — it merges your two mics into mono.')
    }
    messages.push('Stereo split detected — the two mics will be separated as Speaker 1 / Speaker 2.')
  } else {
    if (s.echoCancellation) { suggested.echoCancellation = false; messages.push('Turn OFF echo cancellation — it can swallow other voices around a table.') }
    if (s.noiseSuppression) { suggested.noiseSuppression = false; messages.push('Turn OFF noise suppression — it can clip quiet speakers (use it only for steady background hum).') }
    if (maxLevel < 0.2 && !s.agc) { suggested.agc = true; messages.push('Single mono mic with a low level — Automatic gain control can even it out.') }
  }

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
// Per-combo capture is paced so the whole sweep lasts about as long as it takes
// to read the passage aloud (~150 wpm) — long enough to finish the factoid and
// to feel thorough, and more audio = a better measurement. Clamped 24–48s total.
function sweepTiming(passage: string): { perComboMs: number; totalMs: number } {
  const words = passage ? passage.trim().split(/\s+/).filter(Boolean).length : 70
  const totalMs = Math.min(48000, Math.max(24000, (words / 150) * 60000))
  return { perComboMs: Math.round(totalMs / SWEEP.length), totalMs }
}

// Open a stream under `audio`, measure for `ms`, return signal stats. SNR is
// estimated from the spread between quiet (10th pct) and loud (90th pct) frames.
async function measureCombo(
  audio: MediaTrackConstraints,
  ms: number,
  cancelled: () => boolean,
  onStream?: (ctx: AudioContext, source: MediaStreamAudioSourceNode) => Promise<void>,
): Promise<ComboMetrics> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio })
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new Ctx()
  try {
    await ctx.resume()
    const an = ctx.createAnalyser(); an.fftSize = 2048
    const src = ctx.createMediaStreamSource(stream)
    src.connect(an)
    if (onStream) { try { await onStream(ctx, src) } catch { /* captions best-effort */ } }
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
  channelNames, onChannelName,
}: {
  recordingId: string
  language: string
  devices: MediaDeviceInfo[]
  settings: MicSettings
  onChange: (patch: Partial<MicSettings>) => void
  onShowNames: () => void
  disabled?: boolean
  channelNames: [string, string]
  onChannelName: (index: 0 | 1, value: string) => void
}) {
  const [testing, setTesting] = useState(false)
  const [channels, setChannels] = useState(1)
  const [levels, setLevels] = useState<{ l: number; r: number }>({ l: 0, r: 0 })
  const [peakSeen, setPeakSeen] = useState(0)     // max level observed this test (drives the low-signal hint)
  const [chIdentical, setChIdentical] = useState(false)  // 2 channels but carrying the same audio (dual-mono)
  const [stereoDevice, setStereoDevice] = useState(false) // a test confirmed this device delivers 2 channels (persists after the test)
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
  const [passage, setPassage] = useState('')   // interesting-facts paragraph to read aloud during the sweep
  const cancelAutoRef = useRef(false)
  // Live reading progress during the sweep: words spoken so far (karaoke highlight
  // + progress bar). Counts words from a single best-effort Deepgram socket.
  const [readCount, setReadCount] = useState(0)
  const readCountRef = useRef(0)
  const autoWsRef = useRef<WebSocket | null>(null)
  const autoQueueRef = useRef<ArrayBuffer[]>([])

  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const monitorGainRef = useRef<GainNode | null>(null)                   // speaker monitor (0 = muted)
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null)   // gain-applied stream for the test clip
  const analysersRef = useRef<{ l: AnalyserNode | null; r: AnalyserNode | null }>({ l: null, r: null })
  const rafRef = useRef<number | null>(null)
  const smoothRef = useRef<{ l: number; r: number }>({ l: 0, r: 0 })
  const frameRef = useRef(0)
  const tdRef = useRef<{ l: Float32Array<ArrayBuffer>; r: Float32Array<ArrayBuffer> } | null>(null)  // reusable time-domain buffers
  const diffSmoothRef = useRef(1)        // smoothed L−R difference ratio (~0 = identical channels)
  // Per-caption-stream WS + opening-PCM queue + accumulated finals, keyed like `caps`.
  // ONE Deepgram socket. For stereo we send interleaved 2-ch PCM with
  // multichannel=true and route results by channel_index → far more reliable
  // than a socket per channel. finals keyed by lane ('mono' | 'L' | 'R').
  const capWsRef = useRef<WebSocket | null>(null)
  const capQueueRef = useRef<ArrayBuffer[]>([])
  const capFinalsRef = useRef<Record<string, string[]>>({})
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
    try {
      const ws = capWsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'CloseStream' }))
      ws?.close()
    } catch { /* ignore */ }
    capWsRef.current = null
    capQueueRef.current = []
    capFinalsRef.current = {}
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
    setChIdentical(false)
    setCaps({})
    setCapErr(null)
    setClipRecording(false)
    setTesting(false)
  }, [stopCaptions, stopClip])

  const draw = useCallback(() => {
    const aL = analysersRef.current.l, aR = analysersRef.current.r
    const n = aL?.fftSize ?? aR?.fftSize ?? 0
    if (n && (!tdRef.current || tdRef.current.l.length !== n)) tdRef.current = { l: new Float32Array(n), r: new Float32Array(n) }
    const td = tdRef.current
    // One pass per channel: peak (for the meter) + signal/diff energy (for the
    // identical-channels check). ~0 difference with real signal = dual-mono.
    let l = 0, r = 0, sig = 0, diff = 0
    if (aL && td) { aL.getFloatTimeDomainData(td.l); for (let i = 0; i < n; i++) { const v = td.l[i]; const a = Math.abs(v); if (a > l) l = a; sig += v * v } }
    if (aR && td) { aR.getFloatTimeDomainData(td.r); for (let i = 0; i < n; i++) { const a = Math.abs(td.r[i]); if (a > r) r = a } }
    if (aL && aR && td) { for (let i = 0; i < n; i++) { const d = td.l[i] - td.r[i]; diff += d * d } }

    // Fast attack, slow decay so the meter reads naturally and brief peaks show.
    const sm = smoothRef.current
    sm.l = l > sm.l ? l : sm.l * 0.85 + l * 0.15
    sm.r = r > sm.r ? r : sm.r * 0.85 + r * 0.15

    const m = Math.max(sm.l, sm.r)
    if (m > maxLevelRef.current) maxLevelRef.current = m
    if (m >= 0.96) clipRef.current = true
    if (aL && aR && sig > 1e-5) diffSmoothRef.current = diffSmoothRef.current * 0.9 + Math.sqrt(diff / sig) * 0.1

    frameRef.current = (frameRef.current + 1) % 3   // ~20fps state updates
    if (frameRef.current === 0) {
      setLevels({ l: sm.l, r: sm.r })
      setPeakSeen(prev => Math.max(prev, sm.l, sm.r))
      // Two channels but the same audio on both → dual-mono. Only judge once
      // there's real signal to compare.
      setChIdentical(channelsRef.current === 2 && maxLevelRef.current > 0.1 && diffSmoothRef.current < 0.06)
    }
    rafRef.current = requestAnimationFrame(draw)
  }, [])

  // Open ONE live-caption socket from `sourceNode`. For stereo we use the
  // interleaving worklet + Deepgram multichannel and route each result to its
  // lane ('L'/'R') by channel_index; mono uses the downmix worklet (lane 'mono').
  // Best-effort — any failure shows a notice but never blocks the mic test.
  const openCaptions = useCallback(async (ctx: AudioContext, sourceNode: AudioNode, stereo: boolean) => {
    capFinalsRef.current = stereo ? { L: [], R: [] } : { mono: [] }
    setCaps(stereo ? { L: { finals: [], interim: '' }, R: { finals: [], interim: '' } } : { mono: { finals: [], interim: '' } })
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
      const moduleUrl = stereo ? '/worklets/pcm16-stereo-worklet.js' : '/worklets/pcm16-worklet.js'
      await ctx.audioWorklet.addModule(moduleUrl)
      const node = new AudioWorkletNode(ctx, stereo ? 'pcm16-stereo-worklet' : 'pcm16-worklet')
      node.port.onmessage = (e) => {
        const buf = e.data as ArrayBuffer
        const ws = capWsRef.current
        if (ws && ws.readyState === WebSocket.OPEN) { try { ws.send(buf) } catch { /* ignore */ } }
        else { capQueueRef.current.push(buf); if (capQueueRef.current.length > PCM_QUEUE_CAP) capQueueRef.current.shift() }
      }
      const sink = ctx.createGain(); sink.gain.value = 0
      sourceNode.connect(node); node.connect(sink); sink.connect(ctx.destination)

      const params = new URLSearchParams({
        model: 'nova-3', language: language || 'en', encoding: 'linear16',
        sample_rate: String(Math.round(ctx.sampleRate)),
        channels: stereo ? '2' : '1',
        interim_results: 'true', punctuate: 'true', smart_format: 'true',
      })
      if (stereo) params.set('multichannel', 'true')
      const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params.toString()}`, ['bearer', token])
      ws.binaryType = 'arraybuffer'
      capWsRef.current = ws
      ws.onopen = () => {
        const q = capQueueRef.current; capQueueRef.current = []
        for (const buf of q) { try { ws.send(buf) } catch { /* ignore */ } }
      }
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string)
          const text: string = msg?.channel?.alternatives?.[0]?.transcript ?? ''
          if (!text) return
          // multichannel results carry channel_index: [thisChannel, total].
          const idx = Array.isArray(msg.channel_index) ? msg.channel_index[0] : 0
          const key = stereo ? (idx === 1 ? 'R' : 'L') : 'mono'
          const prevFinals = capFinalsRef.current[key] ?? []
          if (msg.is_final) {
            const next = [...prevFinals, text].slice(-30)
            capFinalsRef.current[key] = next
            setCaps(prev => ({ ...prev, [key]: { finals: next, interim: '' } }))
          } else {
            setCaps(prev => ({ ...prev, [key]: { finals: prevFinals, interim: text } }))
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
    setChIdentical(false)
    maxLevelRef.current = 0
    clipRef.current = false
    diffSmoothRef.current = 1
    revokeClip()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: buildAudioConstraints(settingsRef.current) })
      streamRef.current = stream
      const ch = stream.getAudioTracks()[0]?.getSettings().channelCount ?? 1
      channelsRef.current = ch >= 2 ? 2 : 1
      setChannels(ch >= 2 ? 2 : 1)
      if (ch >= 2) setStereoDevice(true)   // remember (drives the always-on processing warning)

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
      // Captions: one socket. Stereo → interleaved 2-ch PCM + multichannel,
      // routed to L/R lanes; mono → downmix. Fed from `gain` (the worklet reads
      // both channels for stereo). Best-effort.
      void openCaptions(ctx, gain, ch >= 2)
    } catch {
      setErr('Could not open the microphone to test. Check the OS mic permission and that the device is connected.')
      stopTest()
    }
  }, [draw, stopTest, openCaptions, revokeClip])

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

  // Close the sweep's reading-progress caption socket.
  const stopAutoCaptions = useCallback(() => {
    try {
      const ws = autoWsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'CloseStream' }))
      ws?.close()
    } catch { /* ignore */ }
    autoWsRef.current = null
    autoQueueRef.current = []
  }, [])

  // Run the sweep: measure each combo, score, recommend the winner. A single
  // best-effort Deepgram socket runs across all combos to drive the live reading
  // progress (karaoke highlight) — words spoken vs the passage length.
  const runAutotune = useCallback(async () => {
    stopTest()
    revokeClip()
    setReco(null)
    cancelAutoRef.current = false
    readCountRef.current = 0
    setReadCount(0)
    const base = settingsRef.current
    const { perComboMs } = sweepTiming(passage)

    // Mint one token up front for the reading-progress captions (best-effort).
    let capToken: string | null = null
    try {
      const r = await fetch(`/api/recordings/${recordingId}/live-token`, { method: 'POST' })
      const j = await r.json()
      if (r.ok && j.access_token) capToken = j.access_token as string
    } catch { /* no captions — sweep still works */ }

    // Attached to each combo's stream: opens the WS on first call (needs a ctx
    // for sample_rate), then streams mono PCM; results bump the word count.
    const onStream = async (ctx: AudioContext, source: MediaStreamAudioSourceNode) => {
      if (!capToken) return
      if (!autoWsRef.current) {
        const params = new URLSearchParams({
          model: 'nova-3', language: language || 'en', encoding: 'linear16',
          sample_rate: String(Math.round(ctx.sampleRate)), channels: '1', punctuate: 'true', smart_format: 'true',
        })
        const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params.toString()}`, ['bearer', capToken])
        ws.binaryType = 'arraybuffer'
        autoWsRef.current = ws
        ws.onopen = () => { const q = autoQueueRef.current; autoQueueRef.current = []; for (const b of q) { try { ws.send(b) } catch { /* ignore */ } } }
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data as string)
            const text: string = msg?.channel?.alternatives?.[0]?.transcript ?? ''
            if (!text || !msg.is_final) return
            readCountRef.current += text.trim().split(/\s+/).filter(Boolean).length
            setReadCount(readCountRef.current)
          } catch { /* keepalive */ }
        }
      }
      await ctx.audioWorklet.addModule('/worklets/pcm16-worklet.js')
      const node = new AudioWorkletNode(ctx, 'pcm16-worklet')
      node.port.onmessage = (e) => {
        const buf = e.data as ArrayBuffer
        const ws = autoWsRef.current
        if (ws && ws.readyState === WebSocket.OPEN) { try { ws.send(buf) } catch { /* ignore */ } }
        else { autoQueueRef.current.push(buf); if (autoQueueRef.current.length > PCM_QUEUE_CAP) autoQueueRef.current.shift() }
      }
      const sink = ctx.createGain(); sink.gain.value = 0
      source.connect(node); node.connect(sink); sink.connect(ctx.destination)
    }

    const results: { combo: typeof SWEEP[number]; m: ComboMetrics }[] = []
    for (let i = 0; i < SWEEP.length; i++) {
      if (cancelAutoRef.current) { setAutotune({ phase: 'idle', idx: 0, label: '' }); stopAutoCaptions(); return }
      const combo = SWEEP[i]
      setAutotune({ phase: 'running', idx: i, label: combo.label })
      try {
        const m = await measureCombo(
          buildAudioConstraints({ ...base, agc: combo.agc, echoCancellation: false, noiseSuppression: combo.noiseSuppression, gain: 1 }),
          perComboMs, () => cancelAutoRef.current, onStream,
        )
        results.push({ combo, m })
      } catch { /* skip a combo that won't open */ }
    }
    stopAutoCaptions()
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
  }, [stopTest, revokeClip, passage, recordingId, language, stopAutoCaptions])

  // Apply gain changes live (no re-open needed).
  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = settings.gain
  }, [settings.gain])

  // Apply the monitor toggle live (no re-open needed).
  useEffect(() => {
    if (monitorGainRef.current) monitorGainRef.current.gain.value = monitor ? 1 : 0
  }, [monitor])

  // A different device may not be stereo — clear the remembered flag until re-tested.
  useEffect(() => { setStereoDevice(false) }, [settings.deviceId])

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
  useEffect(() => () => { cancelAutoRef.current = true; stopTest(); revokeClip(); stopAutoCaptions() }, [stopTest, revokeClip, stopAutoCaptions])

  const sweepWords = useMemo(() => (passage ? passage.trim().split(/\s+/) : []), [passage])
  const readProgress = sweepWords.length ? Math.min(1, readCount / sweepWords.length) : 0
  const hasNames = devices.some(d => d.label)
  const lowSignal = testing && peakSeen > 0 && peakSeen < 0.12
  // Which mic is being spoken into right now (the clearly-louder channel) →
  // highlights the matching name box so the user knows which is which.
  const activeMic: 0 | 1 | null = testing && channels === 2
    && Math.max(levels.l, levels.r) > 0.1 && Math.abs(levels.l - levels.r) > 0.04
    ? (levels.l > levels.r ? 0 : 1)
    : null
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
              onClick={() => { setPassage(p => pickReadingPassage(p)); setAutotune({ phase: 'intro', idx: 0, label: '' }) }}
              disabled={disabled}
              className="text-xs font-semibold rounded-md px-3 py-1 border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              Auto-tune
            </button>
          )}
          <button
            type="button"
            onClick={() => { if (testing) stopTest(true); else void startTest() }}
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
            We’ll try {SWEEP.length} settings while you read the whole paragraph aloud — about {Math.round(sweepTiming(passage).totalMs / 1000)}s total — and pick the clearest by signal quality.
          </p>
          <p className="text-[11px] text-gray-700">
            <strong>What you do:</strong> when you press Start, <strong>read this aloud at your normal volume and distance</strong> until it says done — don’t go quiet between settings. For a 2-mic setup, have the main speaker read it.
          </p>
          {passage && (
            <p className="text-xs text-gray-800 leading-relaxed bg-white border border-indigo-200 rounded-md p-2.5 italic">{passage}</p>
          )}
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
          {passage && (
            <div className="bg-white border border-indigo-200 rounded-md p-2.5">
              <div className="h-1 bg-indigo-100 rounded mb-2 overflow-hidden">
                <div className="h-full bg-indigo-500 transition-all" style={{ width: `${readProgress * 100}%` }} />
              </div>
              <p className="text-xs leading-relaxed">
                {sweepWords.map((w, i) => (
                  <span key={i} className={i < readCount ? 'text-gray-900 font-medium' : 'text-gray-400'}>{w} </span>
                ))}
              </p>
              <p className="text-[10px] text-gray-400 mt-1">{Math.min(readCount, sweepWords.length)} / {sweepWords.length} words read</p>
            </div>
          )}
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

      {/* Name the two mics — shown once a 2-channel device is confirmed. These
          names appear in the report transcript instead of "Mic 1·L / Mic 2·R". */}
      {stereoDevice && (
        <div className="rounded-lg border border-gray-200 p-3">
          <span className="block text-xs font-semibold text-gray-700">Name the two mics (optional)</span>
          <p className="text-[11px] text-gray-500 mt-0.5 mb-2">
            Labels each speaker in the report — e.g. “Facilitator” and “Audience”.
            {testing ? ' Speak into a mic and its box will light up, so you know which is which.' : ' Press “Test microphone”, then speak into each mic to see which box lights up.'}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="block">
              <span className={`block text-[11px] mb-0.5 ${activeMic === 0 ? 'text-emerald-600 font-semibold' : 'text-gray-500'}`}>
                Left · Mic 1{activeMic === 0 && ' 🔊 speaking'}
              </span>
              <input type="text" value={channelNames[0]} disabled={disabled} onChange={e => onChannelName(0, e.target.value)}
                placeholder="e.g. Facilitator"
                className={`w-full rounded px-2 py-1.5 border transition-all ${activeMic === 0 ? 'border-emerald-400 ring-2 ring-emerald-300 animate-pulse' : 'border-gray-300'}`}
                style={{ fontSize: '16px' }} />
            </label>
            <label className="block">
              <span className={`block text-[11px] mb-0.5 ${activeMic === 1 ? 'text-emerald-600 font-semibold' : 'text-indigo-600'}`}>
                Right · Mic 2{activeMic === 1 && ' 🔊 speaking'}
              </span>
              <input type="text" value={channelNames[1]} disabled={disabled} onChange={e => onChannelName(1, e.target.value)}
                placeholder="e.g. Audience"
                className={`w-full rounded px-2 py-1.5 border transition-all ${activeMic === 1 ? 'border-emerald-400 ring-2 ring-emerald-300 animate-pulse' : 'border-gray-300'}`}
                style={{ fontSize: '16px' }} />
            </label>
          </div>
        </div>
      )}

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
          {channels === 2 && !chIdentical && (
            <p className="text-[11px] text-emerald-700">
              Stereo detected — speak into one mic at a time: only its channel (L or R) should move. That confirms the split.
            </p>
          )}
          {chIdentical && (
            <div className="rounded-md bg-amber-50 border border-amber-200 p-2 space-y-1.5">
              <p className="text-[11px] text-amber-800">
                Both channels carry the <strong>same</strong> audio — not a real split.{' '}
                {(settings.agc || settings.echoCancellation || settings.noiseSuppression)
                  ? 'Browser audio processing forces mono — turn it off for true stereo.'
                  : 'The device is sending one mix to both channels — check the RØDE is set to Split in RØDE Central.'}
              </p>
              {(settings.agc || settings.echoCancellation || settings.noiseSuppression) && (
                <button
                  type="button"
                  onClick={() => onChange({ agc: false, echoCancellation: false, noiseSuppression: false })}
                  className="text-[11px] font-semibold rounded-md px-2.5 py-1 text-white"
                  style={{ backgroundColor: '#E8632A' }}
                >Turn off processing for true stereo</button>
              )}
            </div>
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
      <div className="space-y-2">
        {stereoDevice && (
          (settings.agc || settings.echoCancellation || settings.noiseSuppression) ? (
            <div className="rounded-md bg-red-50 border border-red-300 p-2.5">
              <p className="text-[11px] text-red-800 font-semibold">⚠ Audio processing is ON — and you have 2 microphones.</p>
              <p className="text-[11px] text-red-700 mt-0.5">
                The browser runs AGC / echo-cancellation / noise-suppression in <strong>mono</strong> — leaving any of them on <strong>merges your two mics into a single channel</strong>, so you lose per-speaker separation. Turn them all off for stereo.
              </p>
              <button type="button" onClick={() => onChange({ agc: false, echoCancellation: false, noiseSuppression: false })}
                className="mt-1.5 text-[11px] font-semibold rounded-md px-2.5 py-1 text-white" style={{ backgroundColor: '#E8632A' }}>Turn all off for stereo</button>
            </div>
          ) : (
            <p className="text-[11px] text-emerald-700">✓ 2 mics detected — audio processing is off, so both mics stay on separate channels. Keep these off for stereo.</p>
          )
        )}
        <div className="grid grid-cols-1 gap-1.5">
          <Toggle label="Automatic gain control" hint={stereoDevice ? 'Keep OFF — it forces your 2 mics to mono. For a single mono mic it can even out a quiet/uneven level.' : 'Off by default. For a quiet built-in/laptop mic it evens out the level — but it forces stereo (2 mics) to mono, so leave it off for split mics.'}
            checked={settings.agc} disabled={disabled} onChange={v => onChange({ agc: v })} />
          <Toggle label="Echo cancellation" hint="Off for room/table capture — on can swallow other voices (and forces stereo to mono)."
            checked={settings.echoCancellation} disabled={disabled} onChange={v => onChange({ echoCancellation: v })} />
          <Toggle label="Noise suppression" hint="Off preserves quiet speakers; on cleans steady background noise (and forces stereo to mono)."
            checked={settings.noiseSuppression} disabled={disabled} onChange={v => onChange({ noiseSuppression: v })} />
        </div>
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
