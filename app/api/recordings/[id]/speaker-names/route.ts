// app/api/recordings/[id]/speaker-names/route.ts
//
// POST — set human names for diarized speaker labels on a recording's
// transcript. Body: { names: { "<label>": "<name>", ... } }. Applied across
// the transcript view + Q&A (display only; the raw segment labels are kept).
//
// Auth: recording OWNER or an admin org. Service-role read pairs id with the
// caller's org for non-admins (404 cross-org).

import { NextResponse } from 'next/server'
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
  const orgId = (userRow as any)?.org_id as string | undefined
  const orgRel = (userRow as any)?.organizations
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

  const service = createServiceRoleClient()
  const { data: rec, error: rErr } = await service
    .from('recordings')
    .select('id, org_id, created_by')
    .eq('id', recording_id)
    .single()
  if (rErr || !rec) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!isAdminOrg && rec.org_id !== orgId) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!isAdminOrg && rec.created_by !== user.id) {
    return NextResponse.json({ error: 'only the recording owner or an admin can rename speakers' }, { status: 403 })
  }

  const { error: updErr } = await service
    .from('recordings')
    .update({ speaker_names: Object.keys(names).length ? names : null })
    .eq('id', recording_id)
    .eq('org_id', rec.org_id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, names })
}
