// public/worklets/pcm16-stereo-worklet.js
//
// Like pcm16-worklet.js but keeps BOTH channels: accumulates ~43ms chunks and
// emits INTERLEAVED 16-bit little-endian PCM (L,R,L,R…) for a single Deepgram
// live socket opened with multichannel=true&channels=2. One connection returns
// per-channel results (channel_index), which is far more reliable than running
// a separate socket per channel. A mono input is duplicated to both channels.

class PCM16StereoWorklet extends AudioWorkletProcessor {
  constructor() {
    super()
    this._bufL = []
    this._bufR = []
    this._count = 0
    this._target = 2048 // samples per channel per flush (~43ms @ 48kHz)
  }

  process(inputs) {
    const input = inputs[0]
    const L = input && input[0]
    const R = input && (input.length > 1 ? input[1] : input[0])
    if (L && L.length) {
      this._bufL.push(new Float32Array(L))
      this._bufR.push(new Float32Array(R && R.length ? R : L))
      this._count += L.length
      if (this._count >= this._target) {
        const mergedL = new Float32Array(this._count)
        const mergedR = new Float32Array(this._count)
        let off = 0
        for (let i = 0; i < this._bufL.length; i++) {
          mergedL.set(this._bufL[i], off)
          mergedR.set(this._bufR[i], off)
          off += this._bufL[i].length
        }
        this._bufL = []
        this._bufR = []
        this._count = 0

        const pcm = new Int16Array(mergedL.length * 2)
        for (let i = 0; i < mergedL.length; i++) {
          const l = Math.max(-1, Math.min(1, mergedL[i]))
          const r = Math.max(-1, Math.min(1, mergedR[i]))
          pcm[i * 2] = l < 0 ? l * 0x8000 : l * 0x7fff
          pcm[i * 2 + 1] = r < 0 ? r * 0x8000 : r * 0x7fff
        }
        this.port.postMessage(pcm.buffer, [pcm.buffer])
      }
    }
    return true
  }
}

registerProcessor('pcm16-stereo-worklet', PCM16StereoWorklet)
