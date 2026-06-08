// lib/recordings/configVersion.ts
//
// Config version history (sql/118, §2.8). A point-in-time snapshot of the
// project configuration is written on every analysis run (source='analysis')
// and on a manual "Save version" (source='manual'). recordings.analyzed_config_version
// stamps which snapshot produced the live analysis_summary, so every deliverable
// traces back to the exact config that made it.

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { RecordingConfigSnapshot, Analyst, MeetingObjectives, ConfidentialityClass, SessionType } from './types'

// The recording columns that make up a config snapshot.
export const CONFIG_SELECT =
  'name, session_type, meeting_date, location, language, setup_inputs, ' +
  'meeting_profile, presentation_outline, brand_tag, underlying_agent_id, ' +
  'analysis_org, analysts, objectives, confidentiality_class'

export function buildSnapshot(rec: Record<string, unknown>): RecordingConfigSnapshot {
  return {
    name: (rec.name as string) ?? '',
    session_type: (rec.session_type as SessionType) ?? 'qa',
    meeting_date: (rec.meeting_date as string | null) ?? null,
    location: (rec.location as string | null) ?? null,
    language: (rec.language as string) ?? 'en',
    setup_inputs: (rec.setup_inputs as RecordingConfigSnapshot['setup_inputs']) ?? {},
    meeting_profile: (rec.meeting_profile as RecordingConfigSnapshot['meeting_profile']) ?? null,
    presentation_outline: (rec.presentation_outline as RecordingConfigSnapshot['presentation_outline']) ?? null,
    brand_tag: (rec.brand_tag as string | null) ?? null,
    underlying_agent_id: (rec.underlying_agent_id as string | null) ?? null,
    analysis_org: (rec.analysis_org as string) ?? 'Datanautix',
    analysts: (rec.analysts as Analyst[]) ?? [],
    objectives: (rec.objectives as MeetingObjectives | null) ?? null,
    confidentiality_class: (rec.confidentiality_class as ConfidentialityClass) ?? 'client_confidential',
  }
}

// Deterministic stringify (sorted keys) so a re-snapshot of an unchanged config
// compares equal regardless of JSONB key ordering.
function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`
}

/**
 * Snapshot the recording's current config as a new version. Deduplicates: if the
 * config is byte-for-byte identical to the latest snapshot, returns that version
 * instead of inserting a duplicate. Returns the version_number to stamp.
 */
export async function snapshotConfigVersion(
  service: SupabaseClient,
  recordingId: string,
  orgId: string,
  opts: { source: 'manual' | 'analysis'; createdBy?: string | null; changeNote?: string | null },
): Promise<{ version_number: number; created: boolean }> {
  const { data: rec, error: recErr } = await service
    .from('recordings')
    .select(CONFIG_SELECT)
    .eq('id', recordingId)
    .eq('org_id', orgId)
    .single()
  if (recErr || !rec) throw new Error(`snapshot: recording not found (${recErr?.message ?? 'no row'})`)

  const snapshot = buildSnapshot(rec as unknown as Record<string, unknown>)

  const { data: latest } = await service
    .from('recording_config_versions')
    .select('version_number, snapshot')
    .eq('recording_id', recordingId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latest && canonical(latest.snapshot) === canonical(snapshot)) {
    return { version_number: latest.version_number as number, created: false }
  }

  const nextNum = ((latest?.version_number as number | undefined) ?? 0) + 1
  const { error: insErr } = await service
    .from('recording_config_versions')
    .insert({
      recording_id: recordingId,
      org_id: orgId,
      version_number: nextNum,
      snapshot,
      source: opts.source,
      change_note: opts.changeNote ?? null,
      created_by: opts.createdBy ?? null,
    })
  if (insErr) throw new Error(`snapshot insert failed: ${insErr.message}`)
  return { version_number: nextNum, created: true }
}

// Analysis-SHAPING fields — editing these makes the live analysis stale, so the
// user should re-run to apply them. Metadata (name/date/location/attribution/
// brand/agent) is NOT drift; it prints on deliverables without re-extraction.
const SHAPING_KEYS = ['setup_inputs', 'meeting_profile', 'objectives'] as const

/**
 * True when the recording's current analysis-shaping config differs from the
 * snapshot that produced the live analysis (`analyzed_config_version`) — i.e.
 * the user edited the agenda / panel / glossary / meeting profile / objectives
 * after analyzing and should re-run to apply it. Returns false when the recording
 * was never analyzed (nothing to be stale against) or the analyzed snapshot is
 * missing. `currentRec` must carry the CONFIG_SELECT columns.
 */
export async function isAnalysisConfigDrifted(
  service: SupabaseClient,
  recordingId: string,
  orgId: string,
  currentRec: Record<string, unknown>,
  analyzedVersion: number | null,
): Promise<boolean> {
  if (analyzedVersion == null) return false
  const { data: ver } = await service
    .from('recording_config_versions')
    .select('snapshot')
    .eq('recording_id', recordingId)
    .eq('org_id', orgId)
    .eq('version_number', analyzedVersion)
    .maybeSingle()
  if (!ver?.snapshot) return false
  const current = buildSnapshot(currentRec)
  const analyzed = ver.snapshot as RecordingConfigSnapshot
  return SHAPING_KEYS.some(k => canonical(current[k]) !== canonical(analyzed[k]))
}
