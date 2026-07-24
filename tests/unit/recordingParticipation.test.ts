import { describe, it, expect } from 'vitest'
import { computeParticipation, fmtTalkTime } from '@/lib/recordings/participation'
import type { TranscriptSegment } from '@/lib/recordings/types'

const seg = (start: number, end: number, speaker?: string, text = 'one two three', channel?: number): TranscriptSegment =>
  ({ start, end, speaker, text, channel })

describe('computeParticipation', () => {
  it('reports no_segments on empty/absent input', () => {
    expect(computeParticipation(null).reason).toBe('no_segments')
    expect(computeParticipation([]).reason).toBe('no_segments')
    expect(computeParticipation([]).ok).toBe(false)
  })

  it('reports no_diarization when no segment carries a speaker or usable channel', () => {
    const m = computeParticipation([seg(0, 5), seg(5, 9)])
    expect(m.ok).toBe(false)
    expect(m.reason).toBe('no_diarization')
  })

  it('computes share, talk time and names from mono diarization + speaker_names', () => {
    const m = computeParticipation(
      [seg(0, 6, 'S1'), seg(10, 12, 'S2'), seg(20, 22, 'S2')],
      { speakerNames: { S1: 'Dr. Hatem', S2: 'Resident' } },
    )
    expect(m.ok).toBe(true)
    expect(m.speakerCount).toBe(2)
    expect(m.totalTalkSec).toBe(10)
    expect(m.speakers[0].name).toBe('Dr. Hatem')     // 6s > 4s → sorted first
    expect(m.speakers[0].sharePct).toBeCloseTo(60)
    expect(m.speakers[1].sharePct).toBeCloseTo(40)
    expect(m.topSharePct).toBeCloseTo(60)
    expect(m.durationSec).toBe(22)
  })

  it('merges same-speaker segments within the 2s turn gap, splits beyond it', () => {
    const m = computeParticipation([
      seg(0, 4, 'S1'), seg(5, 8, 'S1'),    // 1s gap → one turn 0..8
      seg(15, 18, 'S1'),                   // 7s gap → second turn
    ])
    const s1 = m.speakers[0]
    expect(s1.turnCount).toBe(2)
    expect(s1.turns[0]).toMatchObject({ start: 0, end: 8 })
    expect(s1.turns[0].text).toBe('one two three one two three')  // merged turn concatenates segment text
    expect(s1.longestTurnSec).toBe(8)
    expect(s1.longestTurnStart).toBe(0)
    expect(s1.talkSec).toBe(10)            // talk time sums raw segments, not merged spans
  })

  it('merges labels that resolve to the same name — incl. a raw label that IS the name', () => {
    // Real prod shape (NOWOCATS): one cluster keyed 'S8' mapped to 'J.C. Viert',
    // a SECOND cluster whose raw speaker label was set directly to 'J.C. Viert'
    // (so name === raw). Both must collapse into one row on the floor.
    const m = computeParticipation(
      [seg(0, 6, 'S8', 'first stretch'), seg(30, 34, 'J.C. Viert', 'later stretch'), seg(40, 42, 'S3', 'someone else')],
      { speakerNames: { S8: 'J.C. Viert', 'J.C. Viert': 'J.C. Viert', S3: 'Kelly Butler' } },
    )
    expect(m.speakerCount).toBe(2)                       // J.C. Viert (merged) + Kelly Butler
    const jc = m.speakers.find(s => s.name === 'J.C. Viert')!
    expect(jc).toBeTruthy()
    expect(jc.talkSec).toBe(10)                          // 6 + 4 across both clusters
    expect(jc.turnCount).toBe(2)                         // two separate turns, one speaker
    expect(m.speakers.filter(s => s.name === 'J.C. Viert')).toHaveLength(1)
  })

  it('prefers channel keying + channel_labels on true-stereo captures', () => {
    const m = computeParticipation(
      [seg(0, 5, 'S1', 'left words here', 0), seg(6, 9, 'S1', 'right side', 1)],
      { audioChannels: 2, channelLabels: ['Moderator', 'Room'] },
    )
    expect(m.speakerCount).toBe(2)         // channel split wins over the shared S1 label
    expect(m.speakers.map(s => s.name).sort()).toEqual(['Moderator', 'Room'])
  })

  it('splits panel vs community share via the setup roster, null without a match', () => {
    const segs = [seg(0, 6, 'S1'), seg(8, 12, 'S2')]
    const named = { S1: 'Hatem Abou-Senna', S2: 'Jane Q Public' }
    const withRoster = computeParticipation(segs, {
      speakerNames: named,
      panel: [{ name: 'Hatem A. Abou-Senna' }],   // middle initial tolerated; leading titles ("Dr.") are not — isPanelMember is conservative by design
    })
    expect(withRoster.speakers.find(s => s.name.includes('Hatem'))?.isPanel).toBe(true)
    expect(withRoster.panelSharePct).toBeCloseTo(60)
    expect(withRoster.audienceSharePct).toBeCloseTo(40)

    const noRoster = computeParticipation(segs, { speakerNames: named })
    expect(noRoster.panelSharePct).toBeNull()
    expect(noRoster.audienceSharePct).toBeNull()
  })

  it('counts floor changes, crosstalk and quiet time', () => {
    const m = computeParticipation([
      seg(0, 5, 'S1'),
      seg(4.5, 8, 'S2'),     // starts before S1 ends → crosstalk + floor change
      seg(15, 18, 'S1'),     // 7s gap (≥3s) → quiet + floor change
    ])
    expect(m.floorChanges).toBe(2)
    expect(m.crosstalkCount).toBe(1)
    expect(m.quietSec).toBe(7)
  })

  it('computes words and pace per speaker', () => {
    const m = computeParticipation([seg(0, 30, 'S1', 'ten words of text spoken at a steady clip here')])
    expect(m.speakers[0].words).toBe(10)
    expect(m.speakers[0].wpm).toBeCloseTo(20)   // 10 words / 0.5 min
  })

  it('drops zero-length and malformed segments', () => {
    const m = computeParticipation([seg(5, 5, 'S1'), seg(0, 4, 'S2'), { start: NaN, end: 2, speaker: 'S3', text: 'x' } as TranscriptSegment])
    expect(m.ok).toBe(true)
    expect(m.speakerCount).toBe(1)
    expect(m.speakers[0].key).toBe('name:s2')   // grouping key is the normalized display name (raw echoed when unnamed)
  })
})

describe('fmtTalkTime', () => {
  it('formats m:ss and h:mm:ss', () => {
    expect(fmtTalkTime(0)).toBe('0:00')
    expect(fmtTalkTime(65)).toBe('1:05')
    expect(fmtTalkTime(3661)).toBe('1:01:01')
  })
})
