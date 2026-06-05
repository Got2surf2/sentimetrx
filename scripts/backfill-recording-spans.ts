// scripts/backfill-recording-spans.ts
//
// Deterministically tighten stored Q&A-pair spans to the transcript timestamps
// (docs/RECORDINGS.md §3.6 issue 2). Opus' start/end estimates overlap for
// back-to-back exchanges; analyze now anchors spans to the matched transcript
// segments, but recordings extracted before that fix keep the loose spans. This
// backfill re-derives + UPDATEs them — NO AI, ~$0, no re-analysis.
//
// Usage:
//   node --conditions=react-server --import tsx --env-file=.env.local \
//     scripts/backfill-recording-spans.ts <recordingId>     # one recording
//   ... scripts/backfill-recording-spans.ts --all           # every complete recording
//
// Idempotent: re-running tightens to the same values (no-op on already-tight rows).
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { tightenSpansFromTranscript } from '@/lib/recordings/transcriptRoles'

async function backfillOne(s: SupabaseClient, recordingId: string): Promise<void> {
  const { data: rec } = await s.from('recordings').select('id, org_id, name').eq('id', recordingId).single()
  if (!rec) { console.log(`  ${recordingId}: not found`); return }
  const [{ data: tx }, { data: ex }] = await Promise.all([
    s.from('recording_transcripts').select('segments').eq('recording_id', rec.id).eq('org_id', rec.org_id).maybeSingle(),
    s.from('recording_extractions').select('id, unit_type, start_sec, end_sec, payload').eq('recording_id', rec.id).eq('org_id', rec.org_id).order('sort_order'),
  ])
  const segments = ((tx as { segments?: unknown[] } | null)?.segments ?? []) as Array<{ start: number; end: number; text: string }>
  const pairs = ((ex ?? []) as Array<{ id: string; unit_type: string; start_sec: number | null; end_sec: number | null; payload: unknown }>)
    .filter(e => e.unit_type === 'qa_pair')
  if (segments.length === 0 || pairs.length === 0) { console.log(`  ${rec.name}: no transcript/pairs — skip`); return }

  const tight = tightenSpansFromTranscript(segments, pairs as never)
  let changed = 0
  for (let i = 0; i < pairs.length; i++) {
    const t = tight[i]
    const p = pairs[i]
    if (!t) continue
    if (t.start_sec !== p.start_sec || t.end_sec !== p.end_sec) {
      const { error } = await s.from('recording_extractions')
        .update({ start_sec: t.start_sec, end_sec: t.end_sec })
        .eq('id', p.id).eq('org_id', rec.org_id)      // id + org_id (multi-tenancy invariant)
      if (error) { console.error(`  ${rec.name}: update failed for ${p.id}: ${error.message}`); continue }
      changed++
    }
  }
  console.log(`  ${rec.name}: tightened ${changed}/${pairs.length} pairs`)
}

async function main(): Promise<void> {
  const arg = process.argv[2]
  const s = createServiceRoleClient()
  if (arg === '--all') {
    const { data } = await s.from('recordings').select('id, name').eq('status', 'complete').order('created_at')
    const rows = (data ?? []) as Array<{ id: string; name: string }>
    console.log(`Backfilling ${rows.length} complete recording(s)…`)
    for (const r of rows) await backfillOne(s, r.id)
  } else if (arg) {
    await backfillOne(s, arg)
  } else {
    console.error('usage: backfill-recording-spans.ts <recordingId> | --all')
    process.exit(1)
  }
  console.log('done.')
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
