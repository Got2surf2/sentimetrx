// lib/recordings/transcriptRoles.ts
//
// Maps each transcript segment to 'question' or 'answer' when it falls inside an
// extracted Q&A pair's [start_sec, end_sec] span, for the auditable transcript
// view (question in bold, answer in bold-italic, everything else plain).
//
// Each pair stores ONE span for the whole exchange — not separate Q/A spans — so
// within a pair we split monotonically: the question comes first, the answer
// after, and we pick the split point that best matches each side's verbatim text
// (word overlap). A weak text match therefore degrades to a clean time-ordered
// split rather than scattering bold across the segment. Pure + deterministic.

import type { TranscriptSegment, RecordingExtractionRow, QaPairPayload } from '@/lib/recordings/types'

export type SegmentRole = 'question' | 'answer'

type SegLite = Pick<TranscriptSegment, 'start' | 'end' | 'text'>
type PairLite = Pick<RecordingExtractionRow, 'start_sec' | 'end_sec' | 'payload' | 'unit_type'>

function wordSet(text: string): Set<string> {
  const out = new Set<string>()
  for (const w of (text || '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length >= 3) out.add(w)   // drop tiny stopwords so overlap reflects content
  }
  return out
}

function overlap(seg: Set<string>, ref: Set<string>): number {
  if (seg.size === 0) return 0
  let hit = 0
  for (const w of seg) if (ref.has(w)) hit++
  return hit / seg.size   // fraction of the segment's content words found in the reference
}

// Keyed by segment.start (unique per segment, stable across corrected/raw views).
export function buildTranscriptRoles(segments: SegLite[], pairs: PairLite[]): Map<number, SegmentRole> {
  const roles = new Map<number, SegmentRole>()
  const ordered = [...segments].sort((a, b) => a.start - b.start)

  for (const p of pairs) {
    if (p.unit_type !== 'qa_pair') continue
    const s = p.start_sec
    if (typeof s !== 'number') continue
    const end = typeof p.end_sec === 'number' ? p.end_sec : s
    // Segments whose start falls within the pair span (±1s slack at the edges).
    const inPair = ordered.filter(seg => seg.start >= s - 1 && seg.start <= end + 1)
    if (inPair.length === 0) continue

    const qa = p.payload as QaPairPayload
    const sq = inPair.map(seg => overlap(wordSet(seg.text), wordSet(qa?.question ?? '')))
    const sa = inPair.map(seg => overlap(wordSet(seg.text), wordSet(qa?.answer ?? '')))

    // Monotonic split: first k segments = question, the rest = answer. Choose k
    // that maximizes (question overlap before k) + (answer overlap from k on).
    const n = inPair.length
    let prefixQ = 0
    let suffixA = sa.reduce((x, y) => x + y, 0)
    let bestK = 0
    let best = -Infinity
    for (let k = 0; k <= n; k++) {
      const total = prefixQ + suffixA
      if (total > best) { best = total; bestK = k }
      if (k < n) { prefixQ += sq[k]; suffixA -= sa[k] }
    }
    for (let i = 0; i < n; i++) {
      roles.set(inPair[i].start, i < bestK ? 'question' : 'answer')
    }
  }
  return roles
}

// Tighten each pair's [start_sec, end_sec] to the REAL transcript timestamps of
// the segments it actually matches — Opus span estimates overlap for back-to-
// back exchanges, and tighter spans de-overlap the timeline + fix the click-to-
// transcript modal pulling a neighbour's segments. GLOBAL assignment: each
// segment goes to the single best-matching pair (by word overlap, gated to the
// pair's loose span), so two overlapping loose spans can't both claim the shared
// segments. Returns one {start_sec,end_sec} per input pair, aligned by index;
// null for non-qa_pair / no-start rows, and a fallback to the estimate for a
// pair that matched no segment. Pure + deterministic.
export function tightenSpansFromTranscript(
  segments: SegLite[],
  pairs: PairLite[],
): Array<{ start_sec: number; end_sec: number } | null> {
  const meta = pairs.map(p => {
    if (p.unit_type !== 'qa_pair' || typeof p.start_sec !== 'number') return null
    const qa = p.payload as QaPairPayload
    const words = new Set<string>()
    for (const w of wordSet(qa?.question ?? '')) words.add(w)
    for (const w of wordSet(qa?.answer ?? '')) words.add(w)
    const start = p.start_sec
    const end = typeof p.end_sec === 'number' ? p.end_sec : start
    return { start, end, words }
  })

  const acc: Array<{ min: number; max: number } | null> = pairs.map(() => null)
  for (const seg of segments) {
    const segWords = wordSet(seg.text)
    let bestIdx = -1
    let bestScore = 0
    for (let i = 0; i < meta.length; i++) {
      const m = meta[i]
      if (!m) continue
      if (seg.start < m.start - 2 || seg.start > m.end + 2) continue   // gate to the loose span
      const sc = overlap(segWords, m.words)
      if (sc > bestScore) { bestScore = sc; bestIdx = i }
    }
    if (bestIdx >= 0 && bestScore > 0) {
      const a = acc[bestIdx]
      if (!a) acc[bestIdx] = { min: seg.start, max: seg.end }
      else { a.min = Math.min(a.min, seg.start); a.max = Math.max(a.max, seg.end) }
    }
  }

  return meta.map((m, i) => {
    if (!m) return null
    const a = acc[i]
    if (!a) return { start_sec: Math.round(m.start), end_sec: Math.round(m.end) }   // fallback to estimate
    return { start_sec: Math.round(a.min), end_sec: Math.round(a.max) }
  })
}
