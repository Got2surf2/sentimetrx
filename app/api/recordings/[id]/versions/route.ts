// app/api/recordings/[id]/versions/route.ts
//
// Config version history (§2.8). GET lists the recording's config snapshots;
// POST takes a manual "Save version" snapshot. Auto snapshots (source='analysis')
// are written by the analyze route. Org-scoped with a platform-admin bypass
// (matching the other recordings routes) so the consulting org can manage a
// client recording's versions.

import { NextResponse } from 'next/server'
import { serverError } from '@/lib/apiError'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getUserContext } from '@/lib/userContext'
import { snapshotConfigVersion } from '@/lib/recordings/configVersion'

export const dynamic = 'force-dynamic'

// Resolve the recording org-scoped (admin org may reach any org).
async function resolveRecording(service: ReturnType<typeof createServiceRoleClient>, recordingId: string, uc: { orgId: string; isAdminOrg: boolean }) {
  let q = service.from('recordings').select('id, org_id, analyzed_config_version').eq('id', recordingId)
  if (!uc.isAdminOrg) q = q.eq('org_id', uc.orgId)
  const { data } = await q.single()
  return data as { id: string; org_id: string; analyzed_config_version: number | null } | null
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recording_id = (await ctx.params).id
  if (!recording_id) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  const supabase = await createClient()
  const uc = await getUserContext(supabase)
  if (!uc) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const rec = await resolveRecording(service, recording_id, uc)
  if (!rec) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const { data: rows, error } = await service
    .from('recording_config_versions')
    .select('id, version_number, source, change_note, created_by, created_at')
    .eq('recording_id', recording_id)
    .eq('org_id', rec.org_id)
    .order('version_number', { ascending: false })
  if (error) return serverError(error, 'recordings.versions.list', { orgId: rec.org_id })

  // Attach editor display names.
  const ids = Array.from(new Set((rows ?? []).map(r => r.created_by).filter(Boolean))) as string[]
  const names = new Map<string, string>()
  if (ids.length) {
    const { data: users } = await service.from('users').select('id, full_name, email').in('id', ids)
    for (const u of (users ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) {
      names.set(u.id, (u.full_name?.trim()) || u.email || 'Unknown')
    }
  }

  const versions = (rows ?? []).map(r => ({
    version_number: r.version_number,
    source: r.source,
    change_note: r.change_note,
    created_at: r.created_at,
    created_by_name: r.created_by ? (names.get(r.created_by as string) ?? null) : null,
  }))

  return NextResponse.json({ versions, analyzed_config_version: rec.analyzed_config_version })
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recording_id = (await ctx.params).id
  if (!recording_id) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  const supabase = await createClient()
  const uc = await getUserContext(supabase)
  if (!uc) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const changeNote = typeof body.change_note === 'string' ? body.change_note.trim().slice(0, 500) || null : null

  const service = createServiceRoleClient()
  const rec = await resolveRecording(service, recording_id, uc)
  if (!rec) return NextResponse.json({ error: 'not found' }, { status: 404 })

  try {
    const { version_number, created } = await snapshotConfigVersion(service, recording_id, rec.org_id, {
      source: 'manual',
      createdBy: uc.userId,
      changeNote,
    })
    return NextResponse.json({ ok: true, version_number, created })
  } catch (e) {
    return serverError(e, 'recordings.versions.save', { orgId: rec.org_id })
  }
}
