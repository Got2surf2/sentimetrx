// tests/unit/recordings/meetingTool.test.ts
//
// Pure-logic coverage for the meeting-tool layer: profile resolution (the
// legacy-null coercion is the load-bearing backward-compat guarantee) and the
// phase-map clamp/slice/fallback helpers.

import { describe, it, expect } from 'vitest'
import { resolveProfile, defaultProfile, hasPresentationPhase, PRESETS } from '@/lib/recordings/profiles'
import { clampPhases, slicePhaseSegments, wholeTranscriptPhaseMap } from '@/lib/recordings/phases'
import type { PhaseMap, TranscriptSegment } from '@/lib/recordings/types'

describe('profiles — resolveProfile (backward compat)', () => {
  it('NULL meeting_profile → town_hall_qa (legacy Q&A flow)', () => {
    const p = resolveProfile({ meeting_profile: null })
    expect(p.preset_id).toBe('town_hall_qa')
    expect(p.phases).toHaveLength(1)
    expect(p.phases[0].kind).toBe('qa')
  })
  it('empty phases → town_hall_qa', () => {
    const p = resolveProfile({ meeting_profile: { preset_id: 'community_meeting', has_slides: true, phases: [] } as any })
    expect(p.preset_id).toBe('town_hall_qa')
  })
  it('unknown preset_id is coerced to town_hall_qa but keeps its phases', () => {
    const p = resolveProfile({ meeting_profile: { preset_id: 'bogus', has_slides: false, phases: [{ kind: 'qa', label: 'X', analysis: 'qa_extraction', expected: true }] } as any })
    expect(p.preset_id).toBe('town_hall_qa')
  })
  it('valid community_meeting passes through', () => {
    const p = resolveProfile({ meeting_profile: PRESETS.community_meeting })
    expect(p.preset_id).toBe('community_meeting')
    expect(hasPresentationPhase(p)).toBe(true)
  })
  it('defaultProfile deep-clones (tuning one copy does not mutate the preset)', () => {
    const a = defaultProfile('community_meeting')
    a.phases[0].label = 'CHANGED'
    expect(PRESETS.community_meeting.phases[0].label).not.toBe('CHANGED')
    expect(hasPresentationPhase(defaultProfile('town_hall_qa'))).toBe(false)
  })
})

describe('phases — clampPhases', () => {
  it('sorts, clips to [0,duration], makes contiguous', () => {
    const out = clampPhases([
      { kind: 'qa', label: 'Q', start_sec: 600, end_sec: 9999 },          // end past duration
      { kind: 'presentation', label: 'P', start_sec: 50, end_sec: 600 },  // out of order; start>0
    ], 1200)!
    expect(out.map(p => p.kind)).toEqual(['presentation', 'qa'])
    expect(out[0].start_sec).toBe(0)        // first snapped to 0
    expect(out[0].end_sec).toBe(out[1].start_sec)  // contiguous
    expect(out[1].end_sec).toBe(1200)       // last snapped to duration
  })
  it('drops zero/negative-length spans', () => {
    const out = clampPhases([
      { kind: 'presentation', label: 'P', start_sec: 0, end_sec: 0 },     // zero-length
      { kind: 'qa', label: 'Q', start_sec: 0, end_sec: 300 },
    ], 300)!
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('qa')
  })
  it('returns null when nothing usable', () => {
    expect(clampPhases([], 300)).toBeNull()
    expect(clampPhases([{ kind: 'qa', label: 'Q', start_sec: 500, end_sec: 100 }], 300)).toBeNull()
  })
})

describe('phases — slicePhaseSegments', () => {
  const segs: TranscriptSegment[] = [
    { start: 10, end: 20, text: 'pres a' },
    { start: 100, end: 110, text: 'pres b' },
    { start: 400, end: 410, text: 'qa a' },
    { start: 500, end: 510, text: 'qa b' },
  ]
  const map: PhaseMap = {
    phases: [
      { kind: 'presentation', label: 'P', start_sec: 0, end_sec: 300 },
      { kind: 'qa', label: 'Q', start_sec: 300, end_sec: 600 },
    ],
    detected_at: 'x', model: 'x', edited_by_user: false,
  }
  it('returns only the qa-phase segments', () => {
    const qa = slicePhaseSegments(segs, map, ['qa'])
    expect(qa.map(s => s.text)).toEqual(['qa a', 'qa b'])
  })
  it('returns only the presentation-phase segments', () => {
    const pres = slicePhaseSegments(segs, map, ['presentation'])
    expect(pres.map(s => s.text)).toEqual(['pres a', 'pres b'])
  })
  it('no phase map → returns everything (legacy fallback)', () => {
    expect(slicePhaseSegments(segs, null, ['qa'])).toHaveLength(4)
  })
  it('kind absent from the map → empty', () => {
    expect(slicePhaseSegments(segs, map, ['discussion'])).toHaveLength(0)
  })
})

describe('phases — wholeTranscriptPhaseMap', () => {
  it('one qa phase covering [0,duration]', () => {
    const m = wholeTranscriptPhaseMap(900)
    expect(m.phases).toHaveLength(1)
    expect(m.phases[0]).toMatchObject({ kind: 'qa', start_sec: 0, end_sec: 900 })
    expect(m.edited_by_user).toBe(false)
  })
})
