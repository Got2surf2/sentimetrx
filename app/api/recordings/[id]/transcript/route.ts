// app/api/recordings/[id]/transcript/route.ts
//
// GET   — return the post-processed transcript segments + speaker names for a
//         recording. The polled GET /[id] route deliberately omits segments
//         (they're big); this is the on-demand fetch used by the review gate
//         and could back any other transcript surface. Org-scoped read; an
//         admin org sees all.
// PATCH — apply per-segment corrections before Q&A extraction (the "full
//         review surface" at the transcribed gate): fix ASR word errors
//         (`text`) and reassign a mislabeled diarized segment to a different
//         speaker (`speaker`). Body: { edits: [{ index, text?, speaker? }] }.
//         Writes recording_transcripts.segments in place (raw_response keeps
//         the original ASR) and recomputes word_count. Owner or admin only.
//
// Auth: recording OWNER or an admin org for PATCH; any same-org member (or an
// admin org) for GET. Service-role reads pair id with org_id (404 cross-org).

import { NextResponse } from 'next/server'
import { serverError } from '@/lib/apiError'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import type { TranscriptSegment } from '@/lib/recordings/types'

export const dynamic = 'force-dynamic'

const MAX_EDITS = 5000
const MAX_TEXT = 8000

async function resolveCaller(recording_id: string) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) }

  const { data: userRow } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  const typedUserRow = userRow as {
    org_id?: string | null
    organizations?: { is_admin_org?: boolean } | Array<{ is_admin_org?: boolean }> | null
  } | null
  const orgId = typedUserRow?.org_id as string | undefined
  const orgRel = typedUserRow?.organizations
  const isAdminOrg = Array.isArray(orgRel) ? orgRel[0]?.is_admin_org === true : orgRel?.is_admin_org === true
  if (!orgId) return { error: NextResponse.json({ error: 'org not found' }, { status: 403 }) }

  const service = createServiceRoleClient()
  const { data: rec, error: rErr } = await service
    .from('recordings')
    .select('id, org_id, created_by, channel_labels, speaker_names, setup_inputs')
    .eq('id', recording_id)
    .single()
  if (rErr || !rec) return { error: NextResponse.json({ error: 'not found' }, { status: 404 }) }
  if (!isAdminOrg && rec.org_id !== orgId) return { error: NextResponse.json({ error: 'not found' }, { status: 404 }) }

  return { user, orgId, isAdminOrg, service, rec }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recording_id = (await ctx.params).id
  if (!recording_id) return NextResponse.json({ error: 'missing recording id' }, { status: 400 })

  const r = await resolveCaller(recording_id)
  if ('error' in r) return r.error
  const { user, isAdminOrg, service, rec } = r

  const { data: tr } = await service
    .from('recording_transcripts')
    .select('vendor, language_detected, segments, word_count, duration_sec')
    .eq('recording_id', recording_id)
    .eq('org_id', rec.org_id)
    .single()

  return NextResponse.json({
    transcript: tr
      ? {
          vendor: tr.vendor,
          language_detected: tr.language_detected,
          segments: (tr.segments ?? []) as TranscriptSegment[],
          word_count: tr.word_count,
          duration_sec: tr.duration_sec,
        }
      : null,
    speaker_names: (rec.speaker_names ?? null) as Record<string, string> | null,
    channel_labels: (rec.channel_labels ?? null) as string[] | null,
    // Panel roster (read-only here, from setup) and the editable extra-speakers
    // roster (managed in the transcript-review panel). Both feed the dropdown.
    roster_panel: names(rec.setup_inputs, 'panel'),
    roster_extra: names(rec.setup_inputs, 'speakers'),
    can_edit: isAdminOrg || rec.created_by === user.id,
  })
}

function names(setupInputs: unknown, key: 'panel' | 'speakers'): string[] {
  const arr = ((setupInputs ?? {}) as Record<string, Array<{ name?: string }>>)[key] ?? []
  const out: string[] = []
  const seen = new Set<string>()
  for (const p of arr) {
    const n = String(p?.name ?? '').trim()
    if (n && !seen.has(n)) { seen.add(n); out.push(n) }
  }
  return out
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recording_id = (await ctx.params).id
  if (!recording_id) return NextResponse.json({ error: 'missing recording id' }, { status: 400 })

  const r = await resolveCaller(recording_id)
  if ('error' in r) return r.error
  const { user, isAdminOrg, service, rec } = r

  if (!isAdminOrg && rec.created_by !== user.id) {
    return NextResponse.json({ error: 'only the recording owner or an admin can edit the transcript' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const edits = body?.edits
  if (!Array.isArray(edits)) {
    return NextResponse.json({ error: 'edits must be an array of { index, text?, speaker? }' }, { status: 400 })
  }
  if (edits.length > MAX_EDITS) {
    return NextResponse.json({ error: `too many edits (${MAX_EDITS} max)` }, { status: 400 })
  }

  const { data: tr, error: tErr } = await service
    .from('recording_transcripts')
    .select('id, segments')
    .eq('recording_id', recording_id)
    .eq('org_id', rec.org_id)
    .single()
  if (tErr || !tr) return NextResponse.json({ error: 'transcript not found' }, { status: 404 })

  const segments = (tr.segments ?? []) as TranscriptSegment[]

  // Apply edits by index. `text` corrects ASR output; `speaker` reassigns the
  // diarized label (null/'' clears it). Out-of-range indices are ignored.
  for (const e of edits) {
    const i = Number(e?.index)
    if (!Number.isInteger(i) || i < 0 || i >= segments.length) continue
    if (typeof e.text === 'string') segments[i].text = e.text.slice(0, MAX_TEXT)
    if ('speaker' in e) {
      const sp = e.speaker == null ? '' : String(e.speaker).trim().slice(0, 80)
      if (sp) segments[i].speaker = sp
      else delete segments[i].speaker
    }
  }

  const word_count = segments.reduce(
    (n, s) => n + (s.text ? (s.text.match(/\b[\w']+\b/g)?.length ?? 0) : 0),
    0,
  )

  const { error: updErr } = await service
    .from('recording_transcripts')
    .update({ segments, word_count })
    .eq('id', tr.id)
    .eq('org_id', rec.org_id)
  if (updErr) return serverError(updErr, 'recordings.transcript.edit', { orgId: rec.org_id })

  return NextResponse.json({ ok: true, segments, word_count })
}
