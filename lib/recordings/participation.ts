// lib/recordings/participation.ts
//
// Participation dynamics for a diarized Town Hall recording — who held the
// floor, for how long, in what rhythm. Computed purely from
// recording_transcripts.segments (start/end/speaker/channel) plus the
// identity layers (recordings.speaker_names, channel_labels) and the
// setup_inputs panel roster; deterministic like lib/recordings/timeline.ts,
// no AI. Speaking share, turn-taking and floor changes are the ML-SPEAK-style
// conversation-dynamics view of the meeting.
//
// Speaker keying follows the transcript's two identity systems: true-stereo
// captures key on segment.channel + channel_labels[]; mono voice-cluster
// captures key on segment.speaker + speaker_names{}. Whisper-only transcripts
// have neither → the model reports ok:false and the panel degrades to an
// explanatory empty state.

import type { TranscriptSegment, PanelMember } from '@/lib/recordings/types'
import { isPanelMember } from '@/lib/recordings/panel'

// Consecutive same-speaker segments closer than this merge into one turn —
// ASR splits sentences, not turns.
const TURN_GAP_SEC = 2.0
// An inter-segment gap at least this long counts as quiet/dead air.
const QUIET_GAP_SEC = 3.0
// Overlap tolerance — segment boundaries jitter; require this much overlap
// between different speakers before calling it crosstalk.
const CROSSTALK_MIN_SEC = 0.2

export interface SpeakerTurn {
  start: number
  end: number
  text: string                // concatenated segment text in this turn (hover-to-read on the floor ribbon)
}

export interface SpeakerStats {
  key: string                 // grouping key: the raw label ('S1', 'ch0', …), or 'name:<name>' when clusters merge
  name: string                // resolved display name (speaker_names / channel_labels / raw key)
  isPanel: boolean            // matched against setup_inputs.panel via isPanelMember
  talkSec: number
  sharePct: number            // of total talk time (not wall clock)
  turns: SpeakerTurn[]        // merged intervals, chronological — feeds the ribbon
  turnCount: number
  avgTurnSec: number
  longestTurnSec: number
  longestTurnStart: number
  words: number
  wpm: number                 // words per spoken minute
}

export interface ParticipationModel {
  ok: boolean
  reason?: 'no_segments' | 'no_diarization'
  speakerCount: number
  durationSec: number         // last segment end
  totalTalkSec: number
  quietSec: number            // summed inter-segment gaps ≥ QUIET_GAP_SEC
  floorChanges: number        // transitions between different speakers, turn order
  crosstalkCount: number      // overlapping turns by different speakers
  topSharePct: number         // largest speaker share (dominance)
  panelSharePct: number | null      // null when no roster name matched
  audienceSharePct: number | null
  speakers: SpeakerStats[]    // sorted by talkSec desc
}

export interface ParticipationOptions {
  speakerNames?: Record<string, string> | null
  channelLabels?: string[] | null
  audioChannels?: number | null
  panel?: PanelMember[] | null
}

const EMPTY: Omit<ParticipationModel, 'ok' | 'reason'> = {
  speakerCount: 0, durationSec: 0, totalTalkSec: 0, quietSec: 0,
  floorChanges: 0, crosstalkCount: 0, topSharePct: 0,
  panelSharePct: null, audienceSharePct: null, speakers: [],
}

function countWords(text: string | undefined): number {
  if (!text) return 0
  return text.trim().split(/\s+/).filter(Boolean).length
}

export function computeParticipation(
  segments: TranscriptSegment[] | null | undefined,
  opts: ParticipationOptions = {},
): ParticipationModel {
  const segs = (segments || []).filter(s => s && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
  if (segs.length === 0) return { ok: false, reason: 'no_segments', ...EMPTY }

  // Identity keying: prefer channels on true-stereo captures, else diarized
  // speaker labels. A transcript with neither has no participation story.
  const useChannels = (opts.audioChannels ?? 0) >= 2 && segs.some(s => s.channel != null)
  const keyOf = (s: TranscriptSegment): string | null =>
    useChannels
      ? (s.channel != null ? 'ch' + s.channel : null)
      : (s.speaker ? String(s.speaker) : null)
  const nameOf = (s: TranscriptSegment): string => {
    if (useChannels && s.channel != null) {
      return opts.channelLabels?.[s.channel] || (s.channel === 0 ? 'Left mic' : s.channel === 1 ? 'Right mic' : 'Channel ' + (s.channel + 1))
    }
    const raw = s.speaker ? String(s.speaker) : ''
    return (raw && opts.speakerNames?.[raw]) || raw
  }
  // Two distinct raw labels that resolve to the SAME display name are one person
  // on the floor (a voice cluster split in two, or two channels labeled alike) —
  // group by the normalized display name so they collapse into a single row
  // instead of duplicating the speaker. Group by the RESOLVED NAME regardless of
  // whether it equals the raw label: a segment whose raw speaker label was set
  // directly to the person's name ("J.C. Viert" -> "J.C. Viert") must still merge
  // with that person's other cluster ("S8" -> "J.C. Viert"). Unnamed labels echo
  // their raw key through nameOf, so they stay distinct.
  const groupKeyOf = (s: TranscriptSegment): string | null => {
    const raw = keyOf(s)
    if (raw == null) return null
    return 'name:' + (nameOf(s) || raw).trim().toLowerCase()
  }

  const keyed = segs.filter(s => keyOf(s) !== null)
  if (keyed.length === 0) return { ok: false, reason: 'no_diarization', ...EMPTY }

  const sorted = [...keyed].sort((a, b) => a.start - b.start || a.end - b.end)
  const durationSec = Math.max(...sorted.map(s => s.end))

  // Quiet time: gaps between consecutive segments (chronological, any speaker).
  let quietSec = 0
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].start - sorted[i - 1].end
    if (gap >= QUIET_GAP_SEC) quietSec += gap
  }

  // Per-speaker accumulation + turn merging.
  interface Acc { key: string; name: string; talkSec: number; words: number; turns: SpeakerTurn[] }
  const byKey = new Map<string, Acc>()
  for (const s of sorted) {
    const key = groupKeyOf(s) as string
    let acc = byKey.get(key)
    if (!acc) {
      acc = { key, name: nameOf(s), talkSec: 0, words: 0, turns: [] }
      byKey.set(key, acc)
    }
    // A named mapping can appear on a later segment (names applied per raw
    // label, so any segment resolves the same) — keep the first resolution.
    acc.talkSec += s.end - s.start
    acc.words += countWords(s.text)
    const segText = (s.text || '').trim()
    const last = acc.turns[acc.turns.length - 1]
    if (last && s.start - last.end <= TURN_GAP_SEC) {
      last.end = Math.max(last.end, s.end)
      if (segText) last.text = last.text ? last.text + ' ' + segText : segText
    } else {
      acc.turns.push({ start: s.start, end: s.end, text: segText })
    }
  }

  const totalTalkSec = [...byKey.values()].reduce((a, x) => a + x.talkSec, 0)

  // Floor changes + crosstalk from the global turn sequence.
  const allTurns = [...byKey.values()]
    .flatMap(acc => acc.turns.map(t => ({ ...t, key: acc.key })))
    .sort((a, b) => a.start - b.start || a.end - b.end)
  let floorChanges = 0
  let crosstalkCount = 0
  for (let i = 1; i < allTurns.length; i++) {
    if (allTurns[i].key !== allTurns[i - 1].key) {
      floorChanges++
      if (allTurns[i - 1].end - allTurns[i].start >= CROSSTALK_MIN_SEC) crosstalkCount++
    }
  }

  const speakers: SpeakerStats[] = [...byKey.values()].map(acc => {
    const longest = acc.turns.reduce((best, t) => (t.end - t.start > best.end - best.start ? t : best), acc.turns[0])
    return {
      key: acc.key,
      name: acc.name,
      isPanel: isPanelMember(acc.name, opts.panel),
      talkSec: acc.talkSec,
      sharePct: totalTalkSec > 0 ? (acc.talkSec / totalTalkSec) * 100 : 0,
      turns: acc.turns,
      turnCount: acc.turns.length,
      avgTurnSec: acc.turns.length > 0 ? acc.talkSec / acc.turns.length : 0,
      longestTurnSec: longest ? longest.end - longest.start : 0,
      longestTurnStart: longest ? longest.start : 0,
      words: acc.words,
      wpm: acc.talkSec > 0 ? acc.words / (acc.talkSec / 60) : 0,
    }
  }).sort((a, b) => b.talkSec - a.talkSec)

  // Panel vs audience split only means something once a roster name matched —
  // isPanelMember is conservative and fails open (no roster → nobody is panel),
  // so an unmatched meeting reports null rather than a misleading 0% panel.
  const anyPanel = speakers.some(s => s.isPanel)
  const panelTalk = speakers.filter(s => s.isPanel).reduce((a, s) => a + s.talkSec, 0)

  return {
    ok: true,
    speakerCount: speakers.length,
    durationSec,
    totalTalkSec,
    quietSec,
    floorChanges,
    crosstalkCount,
    topSharePct: speakers[0]?.sharePct ?? 0,
    panelSharePct: anyPanel && totalTalkSec > 0 ? (panelTalk / totalTalkSec) * 100 : null,
    audienceSharePct: anyPanel && totalTalkSec > 0 ? ((totalTalkSec - panelTalk) / totalTalkSec) * 100 : null,
    speakers,
  }
}

/** m:ss / h:mm:ss for talk-time labels. */
export function fmtTalkTime(sec: number): string {
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h > 0
    ? h + ':' + String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0')
    : m + ':' + String(r).padStart(2, '0')
}
