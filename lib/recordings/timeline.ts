// lib/recordings/timeline.ts
//
// Shared geometry for the "meeting timeline" summary bar — one Q&A block per
// pair, positioned + sized by when it occurred across the meeting. Used by the
// internal Coverage tab, the public share page, the PDF report, and the PPTX
// deck so all four render the same bar. Pure + deterministic.
//
// Overlapping pairs (Opus span estimates can overlap for back-to-back
// exchanges) are STAGGERED into lanes via greedy interval packing, so a block
// never hides another's number. External surfaces (share / PDF / PPTX) pass a
// single colour and never show the internal "flagged for review" state.

export interface TimelineSegment {
  index: number       // 1-based, chronological
  lane: number        // 0-based row; overlapping blocks get distinct lanes
  leftPct: number     // 0..100
  widthPct: number    // 0..100
  startSec: number
  endSec: number
  startLabel: string  // m:ss
  durLabel: string    // e.g. "3m"
}
export interface TimelineTick { pct: number; label: string }
export interface TimelineModel {
  durationSec: number
  durationLabel: string
  count: number
  laneCount: number
  segments: TimelineSegment[]
  ticks: TimelineTick[]
}

type SpanPair = { start_sec: number | null; end_sec: number | null }

function fmtClock(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}
function fmtDur(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// Greedy lane packing: spans MUST be in chronological order. Each span takes the
// lowest lane whose previous span has already ended; otherwise a new lane opens.
// Sequential pairs all land on lane 0; only a genuine overlap bumps to lane 1+.
export function packLanes(spans: Array<{ start: number; end: number }>): { lanes: number[]; laneCount: number } {
  const laneEnds: number[] = []
  const lanes = spans.map(s => {
    let lane = laneEnds.findIndex(end => end <= s.start)
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(s.end) }
    else laneEnds[lane] = s.end
    return lane
  })
  return { lanes, laneCount: Math.max(1, laneEnds.length) }
}

export function buildTimelineModel(pairs: SpanPair[], durationSec: number | null): TimelineModel | null {
  const timed = pairs
    .filter(p => typeof p.start_sec === 'number')
    .sort((a, b) => (a.start_sec as number) - (b.start_sec as number))
  if (timed.length === 0) return null

  const dur = durationSec && durationSec > 0
    ? durationSec
    : Math.max(1, ...timed.map(p => p.end_sec ?? (p.start_sec as number)))

  const spans = timed.map(p => ({ start: p.start_sec as number, end: typeof p.end_sec === 'number' ? p.end_sec : (p.start_sec as number) }))
  const { lanes, laneCount } = packLanes(spans)

  const segments: TimelineSegment[] = timed.map((p, i) => {
    const start = spans[i].start
    const end = spans[i].end
    return {
      index: i + 1,
      lane: lanes[i],
      leftPct: (start / dur) * 100,
      widthPct: Math.max(1.2, ((end - start) / dur) * 100),
      startSec: start,
      endSec: end,
      startLabel: fmtClock(start),
      durLabel: fmtDur(end - start),
    }
  })

  const ticks: TimelineTick[] = Array.from({ length: 6 }, (_, i) => {
    const t = Math.round((dur * i) / 5)
    return { pct: (t / dur) * 100, label: fmtClock(t) }
  })

  return { durationSec: dur, durationLabel: fmtDur(dur), count: timed.length, laneCount, segments, ticks }
}

// Lane geometry shared by every renderer so the bar is identical everywhere.
export const LANE_H = 22
export const LANE_GAP = 4
export function laneTop(lane: number): number { return lane * (LANE_H + LANE_GAP) }
export function barHeight(laneCount: number): number { return laneCount * LANE_H + (laneCount - 1) * LANE_GAP }

// Self-contained inline-styled HTML for the timeline — used by the PDF report
// and the public share page so they render identically. Labels are clock/number
// strings (digits, colons, h/m/s) so no escaping is needed.
export function renderTimelineHtml(model: TimelineModel, color = '#16A34A'): string {
  const barH = barHeight(model.laneCount)
  const segs = model.segments.map(s =>
    `<div style="position:absolute;top:${laneTop(s.lane)}px;height:${LANE_H}px;left:${s.leftPct.toFixed(2)}%;width:${s.widthPct.toFixed(2)}%;background:${color};border:1px solid #fff;border-radius:3px;display:flex;align-items:center;justify-content:center;gap:3px;box-sizing:border-box" title="#${s.index} ${s.startLabel} (${s.durLabel})">` +
      `<span style="background:#fff;color:${color};width:15px;height:15px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;line-height:1;flex:none">${s.index}</span>` +
      (s.widthPct >= 6 ? `<span style="color:#fff;font-size:9px;font-weight:600;white-space:nowrap">${s.durLabel}</span>` : '') +
    `</div>`,
  ).join('')

  const ticks = model.ticks.map(t =>
    `<span style="position:absolute;left:${t.pct.toFixed(2)}%;transform:translateX(-50%);font-size:9px;color:#94a3b8;font-family:monospace">${t.label}</span>`,
  ).join('')

  return (
    `<section style="margin:18px 0 6px">` +
      `<div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:6px">Meeting timeline <span style="font-weight:400;color:#94a3b8">· ${model.count} Q&amp;A across ${model.durationLabel}</span></div>` +
      `<div style="position:relative;height:${barH}px;background:#f1f5f9;border-radius:5px">${segs}</div>` +
      `<div style="position:relative;height:14px;margin-top:3px">${ticks}</div>` +
      `<div style="font-size:11px;color:#94a3b8;margin-top:2px">Each block is a Q&amp;A pair, placed + sized by when it occurred; overlapping exchanges stack into rows.</div>` +
    `</section>`
  )
}
