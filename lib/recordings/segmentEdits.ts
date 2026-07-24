// lib/recordings/segmentEdits.ts
//
// Pure, deterministic structural edits on a transcript's segment array, used by
// the Transcript-tab review surface (components/recordings/TranscriptReview) to
// fix imperfect diarization by hand:
//   - nudgeSegmentStart — move a speaker turn's start boundary (carrying the
//     shared boundary with the previous turn) for small ASR-timing tweaks.
//   - splitSegmentAt    — split one segment into two at a text cursor position,
//     when two speakers' back-and-forth got merged into a single segment. The
//     new (second) segment is left speaker-less to be assigned.
//   - mergeSegmentUp    — combine a segment into the one before it (the inverse
//     of split; NOT the same as reassigning the speaker, which keeps two rows).
//
// Every function returns a NEW array and never mutates its input; an invalid or
// no-op request returns the original array unchanged. Kept pure (no React, no
// I/O) so it is unit-tested directly and the API can reuse the invariants.

import type { TranscriptSegment } from '@/lib/recordings/types'

// Keep every segment at least this long so start < end always holds after an edit.
export const MIN_SEG_SEC = 0.1

const round1 = (n: number) => Math.round(n * 10) / 10

/** Move segment[idx].start by deltaSec. For a non-first segment the shared
 *  boundary moves too (previous turn's end tracks it), so this adjusts WHERE one
 *  speaker's turn begins relative to the one before. Clamps so neither segment
 *  collapses. Returns the input unchanged for an out-of-range index. */
export function nudgeSegmentStart(
  segments: TranscriptSegment[],
  idx: number,
  deltaSec: number,
): TranscriptSegment[] {
  if (!Array.isArray(segments) || idx < 0 || idx >= segments.length) return segments
  const seg = { ...segments[idx] }
  const lo = idx > 0 ? segments[idx - 1].start + MIN_SEG_SEC : 0
  const hi = seg.end - MIN_SEG_SEC
  if (hi < lo) return segments
  const ns = Math.max(lo, Math.min(round1(seg.start + deltaSec), hi))
  if (ns === seg.start) return segments
  seg.start = ns
  const next = segments.slice()
  next[idx] = seg
  if (idx > 0) next[idx - 1] = { ...segments[idx - 1], end: ns }
  return next
}

/** Split segment[idx] into two at character offset `caret` in its text. The
 *  first keeps the text before the caret (end = interpolated time); the second
 *  takes the text after and is left speaker-less (the whole point — a different
 *  speaker to assign). No-op if the caret is at either text end. */
export function splitSegmentAt(
  segments: TranscriptSegment[],
  idx: number,
  caret: number,
): TranscriptSegment[] {
  if (!Array.isArray(segments) || idx < 0 || idx >= segments.length) return segments
  const seg = segments[idx]
  const text = seg.text ?? ''
  const c = Math.round(caret)
  if (c <= 0 || c >= text.length) return segments
  const before = text.slice(0, c).trimEnd()
  const after = text.slice(c).trimStart()
  if (!before || !after) return segments
  const span = seg.end - seg.start
  const t = Math.max(
    seg.start + MIN_SEG_SEC,
    Math.min(round1(seg.start + span * (c / text.length)), seg.end - MIN_SEG_SEC),
  )
  const first: TranscriptSegment = { ...seg, text: before, end: t }
  const second: TranscriptSegment = { ...seg, text: after, start: t }
  delete second.speaker
  if (typeof second.source_offset === 'number') {
    second.source_offset = Math.round((second.source_offset + (t - seg.start)) * 100) / 100
  }
  const next = segments.slice()
  next.splice(idx, 1, first, second)
  return next
}

/** Merge segment[idx] into the one before it — one continuous span + joined
 *  text. Keeps the previous speaker (inherits the merged-in one only if the
 *  previous was unassigned). No-op for the first segment or an out-of-range idx.
 *  This is NOT the same as reassigning a speaker: it collapses two rows into one. */
export function mergeSegmentUp(
  segments: TranscriptSegment[],
  idx: number,
): TranscriptSegment[] {
  if (!Array.isArray(segments) || idx <= 0 || idx >= segments.length) return segments
  const prev = segments[idx - 1]
  const cur = segments[idx]
  const merged: TranscriptSegment = {
    ...prev,
    end: Math.max(prev.end, cur.end),
    text: [prev.text, cur.text].map(t => (t ?? '').trim()).filter(Boolean).join(' '),
  }
  if (!merged.speaker && cur.speaker) merged.speaker = cur.speaker
  const next = segments.slice()
  next.splice(idx - 1, 2, merged)
  return next
}
