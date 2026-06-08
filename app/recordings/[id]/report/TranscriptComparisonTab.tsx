'use client'

// app/recordings/[id]/report/TranscriptComparisonTab.tsx
//
// Town Hall live capture (§ 15): side-by-side of the raw real-time (Deepgram
// live) transcript vs the authoritative post-processed transcript, so the
// owner can evaluate how much the batch pass changed/improved on the live
// captions. Live text = recordings.live_transcript; final = the joined
// recording_transcripts.segments. Only rendered for live-recorded meetings.

import { useMemo } from 'react'
import type { TranscriptSegment } from '@/lib/recordings/types'

export default function TranscriptComparisonTab({
  liveTranscript, segments,
}: {
  liveTranscript: string | null
  segments: TranscriptSegment[]
}) {
  const finalText = useMemo(() => segments.map(s => s.text).join(' ').trim(), [segments])
  const live = (liveTranscript ?? '').trim()

  const stats = useMemo(() => computeStats(live, finalText), [live, finalText])

  if (!live) {
    return (
      <div className="text-sm text-gray-500">
        No live transcript was captured for this meeting (it was uploaded, not recorded live), so there&apos;s nothing to compare.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-gray-900">Live vs final transcript</h3>
        <p className="text-xs text-gray-500 mt-1 max-w-2xl">
          The left column is the raw real-time transcript shown during the meeting (single-mic live captions).
          The right is the authoritative post-processed transcript the report is built from. Use it to gauge how
          much the high-quality batch pass improved on the live captions.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Live words" value={stats.liveWords.toLocaleString()} />
        <Stat label="Final words" value={stats.finalWords.toLocaleString()} />
        <Stat
          label="Word change"
          value={`${stats.wordDelta >= 0 ? '+' : ''}${stats.wordDelta.toLocaleString()} (${stats.wordDeltaPct >= 0 ? '+' : ''}${stats.wordDeltaPct}%)`}
        />
        <Stat label="Word overlap" value={`${stats.similarityPct}%`} hint="share of words unchanged between the two" />
      </div>

      {/* Side by side */}
      <div className="grid md:grid-cols-2 gap-4">
        <Panel title="Live (real-time)" tone="gray">{live}</Panel>
        <Panel title="Final (post-processed)" tone="orange">{finalText || '—'}</Panel>
      </div>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2" title={hint}>
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-sm font-semibold text-gray-900 mt-0.5 tabular-nums">{value}</div>
    </div>
  )
}

function Panel({ title, tone, children }: { title: string; tone: 'gray' | 'orange'; children: React.ReactNode }) {
  const border = tone === 'orange' ? 'border-orange-200' : 'border-gray-200'
  return (
    <div>
      <div className="text-xs font-semibold text-gray-700 mb-1">{title}</div>
      <div className={`bg-white border ${border} rounded-xl p-4 h-[28rem] overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap text-gray-800`}>
        {children}
      </div>
    </div>
  )
}

// Word-level counts + a multiset overlap ratio (order-independent, O(n)) — a
// cheap, robust signal of how much the two transcripts share. Not a positional
// diff; that can come later if a line-level highlight is wanted.
function computeStats(live: string, final: string) {
  const wa = words(live)
  const wb = words(final)
  const mapA = bag(wa)
  const mapB = bag(wb)
  let overlap = 0
  for (const [w, c] of mapA) overlap += Math.min(c, mapB.get(w) ?? 0)
  const union = wa.length + wb.length - overlap
  const similarity = union > 0 ? overlap / union : 0
  const wordDelta = wb.length - wa.length
  return {
    liveWords: wa.length,
    finalWords: wb.length,
    wordDelta,
    wordDeltaPct: wa.length > 0 ? Math.round((wordDelta / wa.length) * 100) : 0,
    similarityPct: Math.round(similarity * 100),
  }
}

function words(s: string): string[] {
  return s.toLowerCase().match(/\b[\w']+\b/g) ?? []
}

function bag(ws: string[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const w of ws) m.set(w, (m.get(w) ?? 0) + 1)
  return m
}
