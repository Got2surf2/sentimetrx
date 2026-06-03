// lib/recordings/profiles.ts
//
// Meeting-type presets for the recordings meeting tool (docs/RECORDINGS.md).
// A profile declares the ordered phases of a meeting and how each is analyzed.
// `resolveProfile` is the single chokepoint that coerces a legacy recording
// (meeting_profile IS NULL) into the implicit "Town hall Q&A" preset, so the
// rest of the pipeline never special-cases null.

import type { MeetingProfile, MeetingPresetId, RecordingRow } from '@/lib/recordings/types'

export const PRESETS: Record<MeetingPresetId, MeetingProfile> = {
  // Current behavior: a single Q&A phase over the whole transcript. No slides,
  // no phase detection (one trivial phase).
  town_hall_qa: {
    preset_id: 'town_hall_qa',
    has_slides: false,
    phases: [
      { kind: 'qa', label: 'Audience Q&A', analysis: 'qa_extraction', expected: true },
    ],
  },
  // The pilot: a presentation followed by audience Q&A. Slides seed the
  // presentation summary; phase detection splits the two.
  community_meeting: {
    preset_id: 'community_meeting',
    has_slides: true,
    phases: [
      { kind: 'presentation', label: 'Presentation', analysis: 'presentation_summary', expected: true },
      { kind: 'qa',           label: 'Audience Q&A', analysis: 'qa_extraction',        expected: true },
    ],
  },
}

export const PRESET_LABELS: Record<MeetingPresetId, string> = {
  town_hall_qa: 'Town hall Q&A',
  community_meeting: 'Community meeting (presentation + Q&A)',
}

/** A fresh copy of a preset's default profile (deep-cloned so callers can tune it). */
export function defaultProfile(presetId: MeetingPresetId): MeetingProfile {
  const p = PRESETS[presetId] ?? PRESETS.town_hall_qa
  return { preset_id: p.preset_id, has_slides: p.has_slides, phases: p.phases.map(ph => ({ ...ph })) }
}

/**
 * The recording's effective profile. Legacy rows (meeting_profile IS NULL) and
 * any unrecognized preset_id resolve to town_hall_qa — so "no profile" === the
 * current Q&A flow with zero branching elsewhere.
 */
export function resolveProfile(rec: Pick<RecordingRow, 'meeting_profile'>): MeetingProfile {
  const mp = rec.meeting_profile
  if (!mp || !Array.isArray(mp.phases) || mp.phases.length === 0) return defaultProfile('town_hall_qa')
  if (!(mp.preset_id in PRESETS)) return { ...mp, preset_id: 'town_hall_qa' }
  return mp
}

/** Does this profile have a presentation phase that should be summarized? */
export function hasPresentationPhase(profile: MeetingProfile): boolean {
  return profile.phases.some(p => p.kind === 'presentation' && p.analysis === 'presentation_summary')
}
