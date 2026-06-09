// public/worklets/pcm16-worklet.js
//
// AudioWorklet processor for Town Hall live captions (§ 15, piece 2b). Receives
// the mic's Float32 audio on the audio thread, accumulates ~43ms chunks, converts
// to 16-bit little-endian PCM (linear16), and posts the raw buffer to the main
// thread, which forwards it to Deepgram's live WS.
//
// Stereo (split-mic) captures are downmixed to mono HERE so the live caption
// socket — which is mono and un-diarized, captions only — still hears BOTH mics.
// Per-channel speaker separation happens later on the authoritative MediaRecorder
// blob; the live captions are a convenience layer and don't need the split.

class PCM16Worklet extends AudioWorkletProcessor {
  constructor() {
    super()
    this._buf = []
    this._count = 0
    this._target = 2048 // samples per flush (~43ms @ 48kHz)
  }

  process(inputs) {
    const input = inputs[0]
    const ch0 = input && input[0]
    if (ch0 && ch0.length) {
      // Downmix every input channel to a single mono frame (average). For a mono
      // source this is just a copy of channel 0; for stereo it blends both mics.
      const n = ch0.length
      const frame = new Float32Array(n)
      const chCount = input.length
      for (let c = 0; c < chCount; c++) {
        const ch = input[c]
        for (let i = 0; i < n; i++) frame[i] += ch[i]
      }
      if (chCount > 1) for (let i = 0; i < n; i++) frame[i] /= chCount

      this._buf.push(frame)
      this._count += n
      if (this._count >= this._target) {
        const merged = new Float32Array(this._count)
        let off = 0
        for (const b of this._buf) { merged.set(b, off); off += b.length }
        this._buf = []
        this._count = 0

        const pcm = new Int16Array(merged.length)
        for (let i = 0; i < merged.length; i++) {
          const s = Math.max(-1, Math.min(1, merged[i]))
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
        }
        this.port.postMessage(pcm.buffer, [pcm.buffer])
      }
    }
    return true // keep the processor alive
  }
}

registerProcessor('pcm16-worklet', PCM16Worklet)
