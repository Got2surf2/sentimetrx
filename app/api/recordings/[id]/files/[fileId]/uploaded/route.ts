// app/api/recordings/[id]/files/[fileId]/uploaded/route.ts
//
// POST /api/recordings/[id]/files/[fileId]/uploaded — § 4.1a (companion to
// § 4.1). Called by the wizard after a TUS upload to Storage completes,
// to flip recording_files.upload_status from 'pending' → 'uploaded'.
//
// Server-side guard: we re-verify the object actually exists at the
// expected storage_path before flipping the flag. Without that check, a
// hostile client could mark a non-existent file as uploaded and the
// pipeline would fail downstream in extract.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const BUCKET = process.env.RECORDINGS_BUCKET || 'recordings'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string; fileId: string }> }) {
  const { id: recording_id, fileId } = (await ctx.params)
  if (!recording_id || !fileId) return NextResponse.json({ error: 'missing ids' }, { status: 400 })

  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: userRow } = await supabase
    .from('users')
    .select('org_id')
    .eq('id', user.id)
    .single()
  const org_id = userRow?.org_id as string | undefined
  if (!org_id) return NextResponse.json({ error: 'org not found' }, { status: 403 })

  const service = createServiceRoleClient()

  const { data: file, error: fErr } = await service
    .from('recording_files')
    .select('id, recording_id, storage_path, size_bytes, upload_status')
    .eq('id', fileId)
    .eq('recording_id', recording_id)
    .eq('org_id', org_id)
    .single()
  if (fErr || !file) return NextResponse.json({ error: 'file not found' }, { status: 404 })

  if (file.upload_status === 'uploaded' || file.upload_status === 'extracted') {
    return NextResponse.json({ ok: true, upload_status: file.upload_status, already: true })
  }

  // Verify the object actually exists at the expected path before trusting the ack.
  // Storage's list() returns the object metadata when the prefix matches a single file.
  const storagePath = file.storage_path as string
  const lastSlash = storagePath.lastIndexOf('/')
  const dir = storagePath.slice(0, lastSlash)
  const basename = storagePath.slice(lastSlash + 1)
  const { data: listing, error: lErr } = await service.storage.from(BUCKET).list(dir, {
    search: basename,
    limit: 100,
  })
  if (lErr) {
    return NextResponse.json({ error: `storage list failed: ${lErr.message}` }, { status: 500 })
  }
  const match = (listing ?? []).find(o => o.name === basename)
  if (!match) {
    return NextResponse.json(
      { error: 'object not found at expected storage_path — upload did not complete', storage_path: storagePath },
      { status: 409 },
    )
  }

  const { error: updErr } = await service
    .from('recording_files')
    .update({ upload_status: 'uploaded' })
    .eq('id', fileId)
    .eq('recording_id', recording_id)
    .eq('org_id', org_id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, upload_status: 'uploaded' })
}
