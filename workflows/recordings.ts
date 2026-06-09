// workflows/recordings.ts
//
// Recording pipeline as a Vercel Workflow DevKit run. Spec § 3.1: stage diagram
// lives in code here. Gate 1 (on-demand analysis) splits the pipeline in two
// workflows so the expensive Opus + Sonnet pass never auto-fires:
//
//   processRecordingWorkflow:  queued → extracting → transcribing → transcribed
//                                                                       ↑ PAUSE
//   analyzeRecordingWorkflow:  transcribed → analyzing → complete
//                                   (user-triggered via POST .../analyze)
//
//   (any throw in either) → failed (with error_message)
//
// recordings.status is the durable cursor the UI watches; the WDK run is the
// operational cursor the platform uses for retry/replay. The two stay in sync
// because every transition is itself a step (DB write).
//
// Steps own the I/O; the workflow function is pure orchestration. Each step
// gets WDK's automatic retry on transient errors — throw FatalError to bail
// out of the run permanently (e.g. row not found, schema mismatch).

import { FatalError } from 'workflow'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { extractRecording } from '@/lib/recordings/extract'
import { transcribeRecording } from '@/lib/recordings/transcribe'
import { analyzeRecording } from '@/lib/recordings/analyze'
import { mirrorExtractionsToDataset } from '@/lib/recordings/mirror'
import { computeCoverage } from '@/lib/recordings/coverage'
import { resolveProfile, hasPresentationPhase } from '@/lib/recordings/profiles'
import { detectPhases, slicePhaseSegments } from '@/lib/recordings/phases'
import { ingestSlides } from '@/lib/recordings/slides'
import { summarizePresentation } from '@/lib/recordings/presentation'
import { extractEntities } from '@/lib/recordings/entities'
import { fetchBrandEntities, mergeBrandEntities } from '@/lib/recordings/brandGlossary'
import type {
  RecordingRow,
  RecordingTranscriptRow,
  RecordingStatus,
  QaSetupInputs,
  TranscriptSegment,
  PresentationOutline,
  ProceedingsSummary,
} from '@/lib/recordings/types'

// Phase 1 — ingest through transcription, then PAUSE at 'transcribed'. The
// analysis pass is deliberately NOT run here (Gate 1): the user reviews the
// transcript and adjusts setup before triggering analyzeRecordingWorkflow.
export async function processRecordingWorkflow(recording_id: string, org_id: string) {
  "use workflow"

  try {
    await setStatus(recording_id, org_id, 'extracting')
    await runExtract(recording_id, org_id)

    await setStatus(recording_id, org_id, 'transcribing')
    await runTranscribe(recording_id, org_id)

    // Meeting-tool prep: read slides (vision) + detect phases, so the phase map
    // is ready for the user to review at the 'transcribed' gate. No-op for the
    // single-phase Q&A preset (legacy behavior). Best-effort — never blocks the
    // pause, so a slide/phase failure still lets the user run analysis.
    await runSlidesAndPhases(recording_id, org_id)

    // Auto-extract entity candidates so the spelling-correction panel is ready
    // at the gate (§3.5b). Best-effort — never blocks the pause.
    await runEntityExtraction(recording_id, org_id)

    await setStatus(recording_id, org_id, 'transcribed')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await setFailed(recording_id, org_id, message)
    throw err
  }
}

// Phase 2 — user-triggered analysis. Runs the Opus + Sonnet two-pass on the
// already-stored transcript. `instructions` is the optional free-text steer the
// user supplies in the review-and-generate gate (§ 5.3).
//
// `skipQa` = the close-out-without-Q&A path: some town halls are open listening
// sessions (community venting) with no question/answer structure to extract. We
// still complete the recording (transcript stays the deliverable) and build the
// presentation summary when a deck phase exists, but skip the expensive Q&A pass.
export async function analyzeRecordingWorkflow(recording_id: string, org_id: string, instructions?: string, skipQa = false) {
  "use workflow"

  try {
    await setStatus(recording_id, org_id, 'analyzing')
    await runAnalyze(recording_id, org_id, instructions, skipQa)

    await setStatus(recording_id, org_id, 'complete')
    await setCompletedAt(recording_id, org_id)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await setFailed(recording_id, org_id, message)
    throw err
  }
}

// ── Stage steps ──────────────────────────────────────────────────────────────

async function runExtract(recording_id: string, org_id: string) {
  "use step"
  await extractRecording({ recording_id, org_id })
}

async function runTranscribe(recording_id: string, org_id: string) {
  "use step"
  const rec = await loadRecording(recording_id, org_id)
  if (!rec) throw new FatalError(`recording ${recording_id} disappeared before transcribe`)
  await transcribeRecording({ recording: rec })
}

// Slides + phase detection — runs at the end of ingestion so the phase map is
// ready at the review gate. No-op for the single-phase Q&A preset.
async function runSlidesAndPhases(recording_id: string, org_id: string) {
  "use step"
  const rec = await loadRecording(recording_id, org_id)
  if (!rec) throw new FatalError(`recording ${recording_id} disappeared before slides/phases`)

  const profile = resolveProfile(rec)
  if (profile.phases.length <= 1 && !profile.has_slides) return   // legacy Q&A: nothing to do

  const transcript = await loadTranscript(recording_id, org_id)
  if (!transcript) return
  const service = createServiceRoleClient()

  // 1. Slides → presentation_outline (best-effort).
  let outline = null
  if (profile.has_slides) {
    outline = await ingestSlides({ recording_id, org_id })
    if (outline) {
      await service.from('recordings').update({ presentation_outline: outline })
        .eq('id', recording_id).eq('org_id', org_id)
    }
  }

  // 2. Phase detection → phase_map (never throws; whole-transcript fallback).
  const dur = rec.source_duration_sec ?? lastSegmentEnd(transcript.segments)
  const phaseMap = await detectPhases({
    recording_id, org_id, profile, transcript: transcript.segments, durationSec: dur, slideOutline: outline,
  })
  await service.from('recordings').update({ phase_map: phaseMap })
    .eq('id', recording_id).eq('org_id', org_id)
}

// Entity extraction — pull proper nouns + cluster the ASR's spelling variants so
// the user can correct names at the gate (§3.5b). Best-effort: extractEntities
// swallows AI errors and a missing transcript is a no-op, so it never blocks the
// pause. Q&A session types only.
async function runEntityExtraction(recording_id: string, org_id: string) {
  "use step"
  const rec = await loadRecording(recording_id, org_id)
  if (!rec || rec.session_type !== 'qa') return
  const transcript = await loadTranscript(recording_id, org_id)
  if (!transcript || transcript.segments.length === 0) return

  const service = createServiceRoleClient()

  // §3.5c brand-entity convergence — the brand's curated entity catalog (brand
  // collection ∪ linked agent) seeds the correction: its canonicals steer the
  // extraction (so phonetic ASR variants cluster to the right spelling) and are
  // merged into the saved map (so brand names not mentioned are still seeded).
  // Best-effort — returns [] if there's no brand_tag/agent or the lookup fails.
  const brandEntities = await fetchBrandEntities(service, {
    orgId: org_id,
    brandTag: rec.brand_tag,
    agentId: rec.underlying_agent_id,
  })

  const { entityMap, cents } = await extractEntities({
    transcript: transcript.segments,
    setup: rec.setup_inputs as QaSetupInputs,
    org_id,
    recording_id,
    now: new Date().toISOString(),
    knownEntities: brandEntities.map(e => ({ canonical: e.canonical, variants: e.variants })),
  })

  // Merge the brand catalog in even when the meeting extraction is empty, so the
  // review gate is pre-filled with the brand's known names.
  const merged = mergeBrandEntities(entityMap?.entities ?? [], brandEntities)
  if (merged.length === 0) return

  await service.from('recordings')
    .update({
      entity_map: { entities: merged, extracted_at: new Date().toISOString(), reviewed_at: null },
      cost_cents: (rec.cost_cents ?? 0) + cents,
    })
    .eq('id', recording_id).eq('org_id', org_id)
}

async function runAnalyze(recording_id: string, org_id: string, instructions?: string, skipQa = false) {
  "use step"
  const rec = await loadRecording(recording_id, org_id)
  if (!rec) throw new FatalError(`recording ${recording_id} disappeared before analyze`)

  const transcript = await loadTranscript(recording_id, org_id)
  if (!transcript) throw new FatalError(`transcript for ${recording_id} not found — transcribe stage didn't write?`)

  const profile = resolveProfile(rec)

  // Close-out without Q&A (optional extraction). Skip the Opus/Sonnet Q&A pass,
  // mirror, coverage, and synthesis — the transcript is the deliverable. Still
  // build the presentation summary when a deck phase exists. Q&A pairs / coverage
  // / analysis_summary are left as-is (null on a first pass).
  if (skipQa) {
    const { proceedings, presCents } = await maybeSummarizePresentation(rec, transcript.segments, profile)
    const svc = createServiceRoleClient()
    const { error } = await svc
      .from('recordings')
      .update({
        proceedings_summary: proceedings,
        cost_cents: (rec.cost_cents ?? 0) + presCents,
      })
      .eq('id', recording_id)
      .eq('org_id', org_id)
    if (error) throw new FatalError(`recordings close-out write failed: ${error.message}`)
    return
  }

  // Scope Q&A extraction to the qa phase(s); fall back to the whole transcript
  // when there's no phase map (legacy / single-phase).
  const qaSegments = slicePhaseSegments(transcript.segments, rec.phase_map, ['qa'])
  // §3.5e — when the meeting had a presentation, build a summary of what was
  // presented (slide outline preferred, else the presentation-phase transcript)
  // so the analyzer can classify each Q&A pair in/out of the presentation's scope.
  const presentationContext = hasPresentationPhase(profile)
    ? buildPresentationContext(rec.presentation_outline, slicePhaseSegments(transcript.segments, rec.phase_map, ['presentation']))
    : undefined
  const analysis = await analyzeRecording({
    recording_id,
    org_id,
    session_type: rec.session_type,
    setup_inputs: rec.setup_inputs,
    transcript: qaSegments.length > 0 ? qaSegments : transcript.segments,
    instructions,
    entity_map: rec.entity_map,
    objectives: rec.objectives,
    presentationContext,
  })

  await mirrorExtractionsToDataset({
    recording_id,
    org_id,
    recording_name: rec.name,
    created_by: rec.created_by,
    extractions: analysis.extractions,
    brand_tag: rec.brand_tag,
  })

  const coverage = computeCoverage({
    setup_inputs: rec.setup_inputs,
    extractions: analysis.extractions,
    source_duration_sec: rec.source_duration_sec,
  })

  // Presentation summary (only when the profile has a presentation phase with content).
  const { proceedings, presCents } = await maybeSummarizePresentation(rec, transcript.segments, profile)

  const service = createServiceRoleClient()
  const { error } = await service
    .from('recordings')
    .update({
      coverage_report: coverage,
      analysis_summary: analysis.analysis_summary,
      proceedings_summary: proceedings,
      cost_cents: (rec.cost_cents ?? 0) + analysis.total_cost_cents + presCents,
    })
    .eq('id', recording_id)
    .eq('org_id', org_id)
  if (error) throw new FatalError(`recordings post-analyze write failed: ${error.message}`)
}

// Presentation summary (only when the profile has a presentation phase with
// content). Shared by the full-analysis path and the Q&A-skipped close-out.
async function maybeSummarizePresentation(
  rec: RecordingRow,
  segments: TranscriptSegment[],
  profile: ReturnType<typeof resolveProfile>,
): Promise<{ proceedings: ProceedingsSummary | null; presCents: number }> {
  if (!hasPresentationPhase(profile)) return { proceedings: null, presCents: 0 }
  const presSegments = slicePhaseSegments(segments, rec.phase_map, ['presentation'])
  if (presSegments.length === 0) return { proceedings: null, presCents: 0 }
  const r = await summarizePresentation({
    recording_id: rec.id,
    org_id: rec.org_id,
    setup: rec.setup_inputs as QaSetupInputs,
    transcript: presSegments,
    outline: rec.presentation_outline,
  })
  return { proceedings: r.summary, presCents: r.cents }
}

// §3.5e — concise summary of what was presented, for scope classification.
// Prefers the slide outline (titles + key points + figures); falls back to the
// presentation-phase transcript text. Truncated to keep the classify prompt bounded.
function buildPresentationContext(outline: PresentationOutline | null | undefined, presSegments: TranscriptSegment[]): string {
  if (outline?.slides?.length) {
    const lines: string[] = []
    for (const s of outline.slides) {
      const bits: string[] = []
      if (s.title) bits.push(s.title)
      if (s.key_points?.length) bits.push(s.key_points.join('; '))
      if (s.figures?.length) bits.push(s.figures.map(f => `${f.label}: ${f.value}`).join('; '))
      const line = bits.filter(Boolean).join(' — ')
      if (line) lines.push(`• ${line}`)
    }
    const text = lines.join('\n').trim()
    if (text) return text.slice(0, 8000)
  }
  return presSegments.map(s => s.text).join(' ').trim().slice(0, 6000)
}

function lastSegmentEnd(segments: TranscriptSegment[]): number {
  return segments.reduce((mx, s) => Math.max(mx, s.end || 0), 0)
}

// ── Status / lifecycle steps ─────────────────────────────────────────────────

async function setStatus(recording_id: string, org_id: string, status: RecordingStatus) {
  "use step"
  const service = createServiceRoleClient()
  const patch: Record<string, unknown> = { status, error_message: null }
  if (status === 'extracting') patch.started_at = new Date().toISOString()
  const { error } = await service
    .from('recordings')
    .update(patch)
    .eq('id', recording_id)
    .eq('org_id', org_id)
  if (error) throw new FatalError(`status update to ${status} failed: ${error.message}`)
}

async function setCompletedAt(recording_id: string, org_id: string) {
  "use step"
  const service = createServiceRoleClient()
  const { error } = await service
    .from('recordings')
    .update({ completed_at: new Date().toISOString() })
    .eq('id', recording_id)
    .eq('org_id', org_id)
  if (error) throw new FatalError(`completed_at write failed: ${error.message}`)
}

async function setFailed(recording_id: string, org_id: string, message: string) {
  "use step"
  const service = createServiceRoleClient()
  // Last-effort write — if this fails too there's nothing useful to do beyond
  // letting the original error propagate up to WDK.
  await service
    .from('recordings')
    .update({ status: 'failed', error_message: message.slice(0, 2000) })
    .eq('id', recording_id)
    .eq('org_id', org_id)
}

// ── Loaders (plain helpers, called from within steps) ───────────────────────

async function loadRecording(recording_id: string, org_id: string): Promise<RecordingRow | null> {
  const service = createServiceRoleClient()
  const { data, error } = await service
    .from('recordings')
    .select('*')
    .eq('id', recording_id)
    .eq('org_id', org_id)
    .single()
  if (error || !data) return null
  return data as RecordingRow
}

async function loadTranscript(recording_id: string, org_id: string): Promise<RecordingTranscriptRow | null> {
  const service = createServiceRoleClient()
  const { data, error } = await service
    .from('recording_transcripts')
    .select('*')
    .eq('recording_id', recording_id)
    .eq('org_id', org_id)
    .single()
  if (error || !data) return null
  return data as RecordingTranscriptRow
}
