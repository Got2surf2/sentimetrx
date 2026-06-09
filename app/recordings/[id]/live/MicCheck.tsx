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
  const [capFinals, setCapFinals] = useState<string[]>([])
  const [capInterim, setCapInterim] = useState('')
  const [capErr, setCapErr] = useState<string | null>(null)

  // Test clip record + playback (local only — never uploaded).
  const [clipRecording, setClipRecording] = useState(false)
  const [clipUrl, setClipUrl] = useState<string | null>(null)

  // Live monitoring — route the processed mic to the speakers so the user can
  // HEAR the effect of each toggle/gain change and pick what sounds best. Off by
  // default: monitoring through speakers with an open mic feeds back (headphones).
  const [monitor, setMonitor] = useState(false)

  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const monitorGainRef = useRef<GainNode | null>(null)                   // speaker monitor (0 = muted)
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null)   // gain-applied stream for the test clip
  const analysersRef = useRef<{ l: AnalyserNode | null; r: AnalyserNode | null }>({ l: null, r: null })
  const rafRef = useRef<number | null>(null)
  const smoothRef = useRef<{ l: number; r: number }>({ l: 0, r: 0 })
  const frameRef = useRef(0)
  const wsRef = useRef<WebSocket | null>(null)
  const pcmQueueRef = useRef<ArrayBuffer[]>([])
  const capFinalsRef = useRef<string[]>([])
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
    setClipUrl(null)
  }, [])

  const stopCaptions = useCallback(() => {
    try {
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'CloseStream' }))
      ws?.close()
    } catch { /* ignore */ }
    wsRef.current = null
    pcmQueueRef.current = []
  }, [])

  const stopClip = useCallback(() => {
    if (clipTimerRef.current) { clearTimeout(clipTimerRef.current); clipTimerRef.current = null }
    const rec = clipRecorderRef.current
    if (rec && rec.state !== 'inactive') { try { rec.stop() } catch { /* ignore */ } }
  }, [])

  const stopTest = useCallback(() => {
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
    capFinalsRef.current = []
    setLevels({ l: 0, r: 0 })
    setPeakSeen(0)
    setCapFinals([])
    setCapInterim('')
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

    frameRef.current = (frameRef.current + 1) % 3   // ~20fps state updates
    if (frameRef.current === 0) {
      setLevels({ l: sm.l, r: sm.r })
      setPeakSeen(prev => Math.max(prev, sm.l, sm.r))
    }
    rafRef.current = requestAnimationFrame(draw)
  }, [])

  // Stream the preview audio to Deepgram for live captions — same path as the
  // real recorder (token mint → WS → PCM worklet). Entirely best-effort.
  const startCaptions = useCallback(async (ctx: AudioContext, source: AudioNode) => {
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
        const ws = wsRef.current
        if (ws && ws.readyState === WebSocket.OPEN) { try { ws.send(buf) } catch { /* ignore */ } }
        else { const q = pcmQueueRef.current; q.push(buf); if (q.length > PCM_QUEUE_CAP) q.shift() }
      }
      const sink = ctx.createGain(); sink.gain.value = 0
      source.connect(node); node.connect(sink); sink.connect(ctx.destination)

      const params = new URLSearchParams({
        model: 'nova-3', language: language || 'en', encoding: 'linear16',
        sample_rate: String(Math.round(ctx.sampleRate)), channels: '1',
        interim_results: 'true', punctuate: 'true', smart_format: 'true',
      })
      const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params.toString()}`, ['bearer', token])
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws
      ws.onopen = () => {
        const q = pcmQueueRef.current; pcmQueueRef.current = []
        for (const buf of q) { try { ws.send(buf) } catch { /* ignore */ } }
      }
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string)
          const text: string = msg?.channel?.alternatives?.[0]?.transcript ?? ''
          if (!text) return
          if (msg.is_final) {
            capFinalsRef.current = [...capFinalsRef.current, text].slice(-30)
            setCapFinals(capFinalsRef.current)
            setCapInterim('')
          } else setCapInterim(text)
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
    revokeClip()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: buildAudioConstraints(settingsRef.current) })
      streamRef.current = stream
      const ch = stream.getAudioTracks()[0]?.getSettings().channelCount ?? 1
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
      void startCaptions(ctx, gain)   // best-effort live transcription
    } catch {
      setErr('Could not open the microphone to test. Check the OS mic permission and that the device is connected.')
      stopTest()
    }
  }, [draw, stopTest, startCaptions, revokeClip])

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
  useEffect(() => () => { stopTest(); revokeClip() }, [stopTest, revokeClip])

  const hasNames = devices.some(d => d.label)
  const lowSignal = testing && peakSeen > 0 && peakSeen < 0.12
  const captionText = capFinals.join(' ')

  return (
    <div className="rounded-lg border border-gray-200 p-3 space-y-3 text-left">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-700">Microphone &amp; mic check</span>
        <button
          type="button"
          onClick={() => (testing ? stopTest() : startTest())}
          disabled={disabled}
          className={`text-xs font-semibold rounded-md px-3 py-1 disabled:opacity-40 ${
            testing ? 'bg-gray-900 text-white hover:bg-black' : 'border border-orange-300 text-orange-700 hover:bg-orange-50'
          }`}
        >
          {testing ? 'Stop test' : 'Test microphone'}
        </button>
      </div>

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

      {/* Live captions during the test */}
      {testing && (
        <div>
          <div className="text-[11px] font-semibold text-gray-600 mb-1">Live transcription (test)</div>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-2 h-20 overflow-y-auto text-xs leading-relaxed">
            {captionText || capInterim ? (
              <>
                <span className="text-gray-800">{captionText} </span>
                {capInterim && <span className="text-gray-400">{capInterim}</span>}
              </>
            ) : (
              <span className="text-gray-400 italic">{capErr || 'Say something — captions will appear here.'}</span>
            )}
          </div>
          {capErr && captionText && <p className="mt-1 text-[11px] text-amber-600">{capErr}</p>}
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
              <audio src={clipUrl} controls className="h-8 max-w-[200px]" />
            )}
          </div>
          {monitor
            ? <p className="text-[11px] text-amber-700">Monitoring live — <strong>use headphones</strong>, or the speakers will feed back into the mic. Toggle the options below to hear the difference.</p>
            : <p className="text-[11px] text-gray-400">“Listen” monitors the live mic so you can hear each toggle’s effect (headphones). The test clip plays back with your current device &amp; gain. Not saved.</p>}
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
