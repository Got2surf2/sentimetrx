// app/api/recordings/[id]/speaker-names/route.ts
//
// POST — set human names for diarized speaker labels on a recording's
// transcript. Body: { names: { "<label>": "<name>", ... } }. Applied across
// the transcript view + Q&A (display only; the raw segment labels are kept).
//
// Auth: recording OWNER or an admin org. Service-role read pairs id with the
// caller's org for non-admins (404 cross-org).

import { NextResponse } from 'next/server'
import { serverError } from '@/lib/apiError'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const MAX_LABELS = 50

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recording_id = (await ctx.params).id
  if (!recording_id) return NextResponse.json({ error: 'missing recording id' }, { status: 400 })

  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: userRow } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  type OrgRel = { is_admin_org?: boolean | null }
  const typedUserRow = userRow as { org_id?: string | null; organizations?: OrgRel | OrgRel[] | null } | null
  const orgId = typedUserRow?.org_id ?? undefined
  const orgRel = typedUserRow?.organizations
  const isAdminOrg = Array.isArray(orgRel) ? orgRel[0]?.is_admin_org === true : orgRel?.is_admin_org === true
  if (!orgId) return NextResponse.json({ error: 'org not found' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const raw = body?.names
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return NextResponse.json({ error: 'names must be an object of { label: name }' }, { status: 400 })
  }

  // Sanitize: trim, cap count + lengths, drop blank names (a blank clears that
  // label back to its raw diarized value).
  const names: Record<string, string> = {}
  for (const [label, val] of Object.entries(raw).slice(0, MAX_LABELS)) {
    const k = String(label).slice(0, 80)
    const v = String(val ?? '').trim().slice(0, 80)
    if (k && v) names[k] = v
  }

  // Extra speakers (moderator/audience/anyone untagged) — managed in the same
  // transcript-review panel, persisted to setup_inputs.speakers so they survive
  // reloads and seed the reassignment dropdown. Optional: absent → leave as-is.
  const hasExtra = Array.isArray(body?.extra_speakers)
  const extraSpeakers: Array<{ name: string }> = hasExtra
    ? (body.extra_speakers as unknown[])
        .map(s => String((s as { name?: unknown })?.name ?? s ?? '').trim().slice(0, 80))
        .filter((n, i, a) => n && a.indexOf(n) === i)
        .slice(0, MAX_LABELS)
        .map(name => ({ name }))
    : []

  const service = createServiceRoleClient()
  const { data: rec, error: rErr } = await service
    .from('recordings')
    .select('id, org_id, created_by, setup_inputs')
    .eq('id', recording_id)
    .single()
  if (rErr || !rec) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!isAdminOrg && rec.org_id !== orgId) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!isAdminOrg && rec.created_by !== user.id) {
    return NextResponse.json({ error: 'only the recording owner or an admin can rename speakers' }, { status: 403 })
  }

  const update: Record<string, unknown> = {
    speaker_names: Object.keys(names).length ? names : null,
  }
  // Merge extra speakers into setup_inputs (only when the client sent the field).
  if (hasExtra) {
    const su = (rec.setup_inputs ?? {}) as Record<string, unknown>
    update.setup_inputs = { ...su, speakers: extraSpeakers }
  }

  const { error: updErr } = await service
    .from('recordings')
    .update(update)
    .eq('id', recording_id)
    .eq('org_id', rec.org_id)
  if (updErr) return serverError(updErr, 'recordings.speakerNames', { orgId: rec.org_id })

  return NextResponse.json({ ok: true, names, extra_speakers: extraSpeakers.map(s => s.name) })
}
