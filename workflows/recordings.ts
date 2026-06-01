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
import type {
  RecordingRow,
  RecordingTranscriptRow,
  RecordingStatus,
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
export async function analyzeRecordingWorkflow(recording_id: string, org_id: string, instructions?: string) {
  "use workflow"

  try {
    await setStatus(recording_id, org_id, 'analyzing')
    await runAnalyze(recording_id, org_id, instructions)

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

async function runAnalyze(recording_id: string, org_id: string, instructions?: string) {
  "use step"
  const rec = await loadRecording(recording_id, org_id)
  if (!rec) throw new FatalError(`recording ${recording_id} disappeared before analyze`)

  const transcript = await loadTranscript(recording_id, org_id)
  if (!transcript) throw new FatalError(`transcript for ${recording_id} not found — transcribe stage didn't write?`)

  const analysis = await analyzeRecording({
    recording_id,
    org_id,
    session_type: rec.session_type,
    setup_inputs: rec.setup_inputs,
    transcript: transcript.segments,
    instructions,
  })

  await mirrorExtractionsToDataset({
    recording_id,
    org_id,
    recording_name: rec.name,
    created_by: rec.created_by,
    extractions: analysis.extractions,
  })

  const coverage = computeCoverage({
    setup_inputs: rec.setup_inputs,
    extractions: analysis.extractions,
    source_duration_sec: rec.source_duration_sec,
  })

  const service = createServiceRoleClient()
  const { error } = await service
    .from('recordings')
    .update({
      coverage_report: coverage,
      cost_cents: (rec.cost_cents ?? 0) + analysis.total_cost_cents,
    })
    .eq('id', recording_id)
    .eq('org_id', org_id)
  if (error) throw new FatalError(`recordings post-analyze write failed: ${error.message}`)
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
