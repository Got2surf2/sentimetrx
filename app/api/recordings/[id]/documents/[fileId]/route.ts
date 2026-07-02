// app/api/recordings/[id]/documents/[fileId]/route.ts
//
// DELETE § 4.1e — detach a project document (file_role='slides' or 'document')
// from a recording: remove the storage object + the recording_files row. Refuses
// to touch media files (those are managed by the upload pipeline). Same-tenant
// guard pairs (id, recording_id, org_id).

import { NextResponse } from 'next/server'
import { serverError } from '@/lib/apiError'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getUserContext } from '@/lib/userContext'

export const dynamic = 'force-dynamic'

const BUCKET = process.env.RECORDINGS_BUCKET || 'recordings'

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; fileId: string }> }) {
  const { id: recording_id, fileId } = await ctx.params
  if (!recording_id || !fileId) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  const supabase = await createClient()
  const uctx = await getUserContext(supabase)
  if (!uctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!uctx.features.recordings) return NextResponse.json({ error: 'recordings not enabled' }, { status: 403 })

  const service = createServiceRoleClient()

  // Pair fileId with recording_id + org_id (admin-org may reach any org).
  let q = service
    .from('recording_files')
    .select('id, org_id, storage_path, file_role')
    .eq('id', fileId)
    .eq('recording_id', recording_id)
  if (!uctx.isAdminOrg) q = q.eq('org_id', uctx.orgId)
  const { data: file } = await q.single()
  if (!file) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (file.file_role !== 'slides' && file.file_role !== 'document') {
    return NextResponse.json({ error: 'only project documents can be removed here' }, { status: 400 })
  }

  if (file.storage_path) {
    await service.storage.from(BUCKET).remove([file.storage_path as string]).catch(() => {})
  }
  const { error: delErr } = await service
    .from('recording_files')
    .delete()
    .eq('id', fileId)
    .eq('org_id', file.org_id as string)
  if (delErr) return serverError(delErr, 'recordings.documents.delete', { orgId: file.org_id as string })

  return NextResponse.json({ ok: true, deleted: fileId })
}
