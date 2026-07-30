// app/th/[token]/page.tsx
//
// Public, read-only Town Hall report (docs/RECORDINGS.md §7.2). Gated PURELY by
// the share token + share_enabled + expiry — no auth, no org. So it must:
//   - look the recording up by share_token alone (service role),
//   - 404 unless share_enabled AND not expired AND status='complete'.
//
// This renders the SAME `ReportClient` as the internal report, in publicMode,
// rather than a parallel simplified page. That is deliberate: a hand-built
// public twin drifted from the internal report the moment either changed, and
// the owner wants genuine parity (every tab, the real interactions). The cost
// is that public-safety now lives inside ReportClient — see the safety notes on
// PublicShareContext there. What publicMode changes:
//   - the Reports tab (exports, share panel, sign-off) is dropped entirely,
//   - `canEdit` is forced false, so every mutation control is unrendered,
//   - the draft sign-off form becomes a read-only draft notice,
//   - audio resolves through /api/th/[token]/audio (token-authorised) and only
//     when this meeting set share_audio.
//
// The data tree is built here from the token, so no id ever comes from the
// caller. `isOwner`/`isAdmin` are hard-false and `agents` is empty — the public
// page must never receive the org's agent list.

import { notFound } from 'next/navigation'
import { createServiceRoleClient } from '@/lib/supabase/server'
import type { RecordingRow, RecordingFileRow, RecordingTranscriptRow, RecordingExtractionRow } from '@/lib/recordings/types'
import ReportClient, { type ReportData } from '@/app/recordings/[id]/report/ReportClient'

export const dynamic = 'force-dynamic'

export default async function PublicTownHallReport({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!token) notFound()

  const service = createServiceRoleClient()
  const { data: recRow } = await service
    .from('recordings')
    .select('*')
    .eq('share_token', token)
    .maybeSingle()

  // Fail closed: unknown token, sharing off, expired, or not finished → 404.
  if (!recRow) notFound()
  const rec = recRow as unknown as RecordingRow & { share_enabled?: boolean; share_expires_at?: string | null; share_audio?: boolean }
  if (!rec.share_enabled || rec.status !== 'complete') notFound()
  if (rec.share_expires_at && new Date(rec.share_expires_at).getTime() < Date.now()) notFound()

  const [filesRes, transcriptRes, extractionsRes] = await Promise.all([
    service.from('recording_files').select('*').eq('recording_id', rec.id).eq('org_id', rec.org_id).order('created_at', { ascending: true }),
    service.from('recording_transcripts').select('*').eq('recording_id', rec.id).eq('org_id', rec.org_id).maybeSingle(),
    service.from('recording_extractions').select('*').eq('recording_id', rec.id).eq('org_id', rec.org_id).order('sort_order', { ascending: true }),
  ])

  // ── Redaction ────────────────────────────────────────────────────────────
  // ReportClient is a CLIENT component, so whatever lands on `data.recording`
  // is serialized into the page's RSC payload and readable in view-source —
  // whether or not any tab renders it. Passing the `select('*')` row therefore
  // published internal metadata: the sign-off reviewer's note, the
  // `confidentiality_class`, internal objectives/analyst attribution, and the
  // share_token itself. ALLOWLIST, never a denylist: a column added to
  // `recordings` later must not silently become public.
  const publicRecording = {
    id: rec.id,
    org_id: rec.org_id,
    name: rec.name,
    status: rec.status,
    draft: rec.draft,
    meeting_date: rec.meeting_date,
    location: rec.location,
    source_duration_sec: rec.source_duration_sec,
    // Content the tabs actually render:
    analysis_summary: rec.analysis_summary,
    proceedings_summary: rec.proceedings_summary,
    presentation_outline: rec.presentation_outline,
    meeting_profile: rec.meeting_profile,
    entity_map: rec.entity_map,          // drives the corrected transcript view
    speaker_names: rec.speaker_names,
    channel_labels: rec.channel_labels,
    audio_channels: rec.audio_channels,
    setup_inputs: rec.setup_inputs,      // panel/speaker rosters for participation
    live_transcript: rec.live_transcript, // Live vs Final tab
    qa_stale: rec.qa_stale,
    // Sign-off: the fact of approval is a credibility signal worth publishing;
    // the reviewer's private note is not.
    signoff: rec.signoff ? { approved_by: rec.signoff.approved_by, approved_at: rec.signoff.approved_at } : null,
    // Deliberately NOT forwarded: share_token, share_* flags, confidentiality_class,
    // objectives, analysis_org, analysts, analyzed_config_version, asr_vendor_chosen,
    // cost/telemetry columns, created_by, brand_tag, underlying_agent_id.
  } as unknown as RecordingRow

  const data: ReportData = {
    recording: publicRecording,
    files: (filesRes.data ?? []) as unknown as RecordingFileRow[],
    // Same RSC-payload rule as the recording row: the transcript row carries
    // `raw_response` (the entire ASR vendor payload — large and internal) and
    // `cost_cents`. Only the segments are meeting content.
    transcript: transcriptRes.data
      ? ({
          id: (transcriptRes.data as { id: string }).id,
          recording_id: rec.id,
          org_id: rec.org_id,
          segments: (transcriptRes.data as { segments?: unknown[] }).segments ?? [],
          language_detected: (transcriptRes.data as { language_detected?: string | null }).language_detected ?? null,
          duration_sec: (transcriptRes.data as { duration_sec?: number | null }).duration_sec ?? null,
          word_count: (transcriptRes.data as { word_count?: number | null }).word_count ?? null,
        } as unknown as RecordingTranscriptRow)
      : null,
    extractions: (extractionsRes.data ?? []) as unknown as RecordingExtractionRow[],
    // Never expose the org's agent list publicly; only the Reports tab (dropped
    // in publicMode) consumes it.
    agents: [],
    isOwner: false,
    isAdmin: false,
    // Drift is an internal analyst signal — the banner offers a re-analyze.
    configDrifted: false,
    // Analytics is an authed surface; no cross-link from a public page.
    analyticsDatasetId: null,
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto px-5 py-10">
        <ReportClient
          data={data}
          publicMode
          shareToken={token}
          audioEnabled={!!rec.share_audio}
        />
        <footer className="mt-12 pt-6 border-t border-slate-200 text-center text-xs text-slate-400">
          Prepared by{' '}
          <span className="font-bold"><span style={{ color: '#1FA8A8' }}>data</span><span style={{ color: '#F07040' }}>nautix</span></span>
          {'  ·  '}datanautix.com
        </footer>
      </div>
    </main>
  )
}
