// lib/recordings/phases.ts
//
// Meeting phase detection (docs/RECORDINGS.md). One Sonnet pass segments the
// transcript into ordered phases (presentation / Q&A / …), seeded by the
// meeting profile's expected phases and the slide outline. The model only
// proposes boundaries; code clamps/snaps them and guarantees a valid map.
//
// Hard contract: this never throws and never produces an invalid map. On any
// failure it returns a single whole-transcript phase (= legacy behavior), so a
// bad segmentation can only under-segment, never break the pipeline.

import 'server-only'
import { callAI } from '@/lib/ai'
import type {
  MeetingProfile,
  PhaseKind,
  PhaseMap,
  MeetingPhase,
  PresentationOutline,
  TranscriptSegment,
} from '@/lib/recordings/types'

const SONNET_MODEL = 'claude-sonnet-4-6'

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────

/** A trivial single-phase map covering the whole transcript — the fallback. */
export function wholeTranscriptPhaseMap(durationSec: number, kind: PhaseKind = 'qa', label = 'Audience Q&A'): PhaseMap {
  return {
    phases: [{ kind, label, start_sec: 0, end_sec: Math.max(0, Math.round(durationSec)) }],
    detected_at: new Date().toISOString(),
    model: 'fallback',
    edited_by_user: false,
  }
}

/**
 * Sort, clip to [0, duration], drop zero/negative-length spans, and fill gaps so
 * the phases are contiguous (each phase's end snaps to the next phase's start).
 * Returns null if nothing usable survives (caller falls back).
 */
export function clampPhases(raw: Array<Partial<MeetingPhase>>, durationSec: number): MeetingPhase[] | null {
  const dur = Math.max(0, Math.round(durationSec))
  const cleaned = raw
    .map(p => ({
      kind: (p.kind ?? 'qa') as PhaseKind,
      label: String(p.label ?? '').trim() || defaultLabel((p.kind ?? 'qa') as PhaseKind),
      start_sec: clampSec(p.start_sec, dur),
      end_sec: clampSec(p.end_sec, dur),
      confidence: typeof p.confidence === 'number' ? p.confidence : undefined,
    }))
    .filter(p => p.end_sec > p.start_sec)
    .sort((a, b) => a.start_sec - b.start_sec)

  if (cleaned.length === 0) return null

  // Make contiguous: first starts at 0, each end snaps to next start, last ends at dur.
  cleaned[0].start_sec = 0
  for (let i = 0; i < cleaned.length - 1; i++) cleaned[i].end_sec = cleaned[i + 1].start_sec
  cleaned[cleaned.length - 1].end_sec = dur
  // Drop any span that collapsed to zero after snapping.
  const out = cleaned.filter(p => p.end_sec > p.start_sec)
  return out.length ? out : null
}

/** Union of segments whose start falls within any phase of the given kinds. */
export function slicePhaseSegments(
  segments: TranscriptSegment[],
  phaseMap: PhaseMap | null | undefined,
  kinds: PhaseKind[],
): TranscriptSegment[] {
  if (!phaseMap || !phaseMap.phases?.length) return segments   // no map → everything
  const spans = phaseMap.phases.filter(p => kinds.includes(p.kind)).map(p => [p.start_sec, p.end_sec] as const)
  if (spans.length === 0) return []
  return segments.filter(s => spans.some(([lo, hi]) => s.start >= lo && s.start < hi))
}

function clampSec(v: unknown, dur: number): number {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(Math.round(n), dur)
}

function defaultLabel(kind: PhaseKind): string {
  switch (kind) {
    case 'presentation': return 'Presentation'
    case 'qa': return 'Audience Q&A'
    case 'discussion': return 'Discussion'
    case 'public_comment': return 'Public Comment'
    case 'decision': return 'Decisions'
  }
}

// ── Prompt ───────────────────────────────────────────────────────────────────

export function buildPhaseDetectionPrompt(opts: {
  profile: MeetingProfile
  transcript: TranscriptSegment[]
  slideOutline?: PresentationOutline | null
}): { system: string; userPrompt: string } {
  const expected = opts.profile.phases
    .map((p, i) => `  ${i + 1}. ${p.kind} ("${p.label}")`)
    .join('\n')
  const slideTitles = (opts.slideOutline?.slides ?? [])
    .map(s => s.title).filter(Boolean).slice(0, 40).map(t => `  - ${t}`).join('\n')

  const system = `You segment a recorded meeting transcript into ordered, contiguous phases.

EXPECTED PHASES for this meeting type (in order):
${expected}
${slideTitles ? `\nThe presenter's slides cover (use these to locate where the PRESENTATION ends):\n${slideTitles}` : ''}

RULES
- Return the phases in order, each with start_sec and end_sec (integer seconds).
- Phases must be contiguous and non-overlapping; together they cover the whole meeting.
- The transition from a presentation to Q&A is typically a host inviting questions ("we'll now take questions", "the floor is open") or the first audience question.
- Use the EXACT kind strings from the expected list. If an expected phase clearly didn't happen, omit it.

OUTPUT FORMAT — a single JSON object, no prose, no markdown fences:
{ "phases": [ { "kind": "presentation|qa|discussion|public_comment|decision", "label": "<short>", "start_sec": <int>, "end_sec": <int>, "confidence": <0.0-1.0> } ] }`

  const userPrompt = `TRANSCRIPT (timestamps are [mm:ss])\n${formatTranscript(opts.transcript)}`
  return { system, userPrompt }
}

function formatTranscript(segments: TranscriptSegment[]): string {
  return segments.map(s => {
    const m = Math.floor(s.start / 60), sec = Math.floor(s.start % 60)
    const sp = s.speaker ? `${s.speaker}: ` : ''
    return `[${m}:${sec.toString().padStart(2, '0')}] ${sp}${s.text}`
  }).join('\n')
}

// ── Detection (calls the model; never throws) ────────────────────────────────

export interface DetectPhasesInput {
  recording_id: string
  org_id: string
  profile: MeetingProfile
  transcript: TranscriptSegment[]
  durationSec: number
  slideOutline?: PresentationOutline | null
}

export async function detectPhases(input: DetectPhasesInput): Promise<PhaseMap> {
  // Single-phase profiles need no detection.
  if (input.profile.phases.length <= 1) {
    const only = input.profile.phases[0]
    return wholeTranscriptPhaseMap(input.durationSec, only?.kind ?? 'qa', only?.label)
  }
  try {
    const { system, userPrompt } = buildPhaseDetectionPrompt({
      profile: input.profile, transcript: input.transcript, slideOutline: input.slideOutline,
    })
    const resp = await callAI({
      tier: 'advanced', modelOverride: SONNET_MODEL, maxTokens: 1500, timeoutMs: 180000,
      system: [{ type: 'text', text: system, cache: true }],
      messages: [{ role: 'user', content: userPrompt }],
      usage: { org_id: input.org_id, resource_type: 'recording', resource_id: input.recording_id, event_type: 'recording_phase_detect' },
    })
    const obj = parseJsonObject(resp.text)
    const rawPhases = Array.isArray(obj?.phases) ? (obj!.phases as Array<Partial<MeetingPhase>>) : []
    const clamped = clampPhases(rawPhases, input.durationSec)
    if (!clamped) return wholeTranscriptPhaseMap(input.durationSec)
    return { phases: clamped, detected_at: new Date().toISOString(), model: SONNET_MODEL, edited_by_user: false }
  } catch (e) {
    console.error({ at: 'recordings.phases', msg: 'phase detection failed', err: (e as Error)?.message })
    return wholeTranscriptPhaseMap(input.durationSec)
  }
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  let t = text.trim()
  if (t.startsWith('```')) t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a < 0 || b < a) return null
  try { return JSON.parse(t.slice(a, b + 1)) } catch { return null }
}
