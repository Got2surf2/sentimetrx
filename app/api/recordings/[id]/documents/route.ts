// app/api/recordings/[id]/documents/route.ts
//
// POST § 4.1e — attach a PROJECT DOCUMENT to a recording at any lifecycle stage
// (edit-anytime / documents-anytime). Unlike § 4.1c (media, TUS), documents are
// small, so this is a direct multipart upload:
//
//   role='slides'   — the presentation deck (PDF). Stored as file_role='slides'
//                     so the pipeline vision-reads it (ingestSlides) → outline.
//                     At-most-one per recording; a new deck REPLACES the old one.
//   role='document' — a brief / agenda / reference doc. Stored as
//                     file_role='document'; kept for reference, NOT pipeline-processed.
//
// Same-tenant guard: the recording is loaded with id paired to org_id.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getUserContext } from '@/lib/userContext'

export const dynamic = 'force-dynamic'

const BUCKET = process.env.RECORDINGS_BUCKET || 'recordings'
const MAX_DOC_BYTES = 50 * 1024 * 1024   // 50MB — matches the setup-extract cap

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: recording_id } = await ctx.params
  if (!recording_id) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  const supabase = await createClient()
  const uctx = await getUserContext(supabase)
  if (!uctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!uctx.features.recordings) return NextResponse.json({ error: 'recordings not enabled' }, { status: 403 })
  const org_id = uctx.orgId

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'expected multipart/form-data' }, { status: 400 })
  }
  const file = form.get('file')
  const role = String(form.get('role') || 'document')
  if (!(file instanceof Blob) || typeof (file as File).name !== 'string') {
    return NextResponse.json({ error: 'file is required' }, { status: 400 })
  }
  if (role !== 'slides' && role !== 'document') {
    return NextResponse.json({ error: "role must be 'slides' or 'document'" }, { status: 400 })
  }
  const original_filename = (file as File).name
  const size_bytes = file.size
  if (size_bytes <= 0) return NextResponse.json({ error: 'file is empty' }, { status: 400 })
  if (size_bytes > MAX_DOC_BYTES) return NextResponse.json({ error: 'file exceeds the 50MB cap' }, { status: 400 })

  const isPdf = (file.type || '').includes('pdf') || original_filename.toLowerCase().endsWith('.pdf')
  if (role === 'slides' && !isPdf) {
    return NextResponse.json({ error: 'the presentation deck must be a PDF in this version' }, { status: 400 })
  }

  const service = createServiceRoleClient()

  // Same-tenant gate — pair id with org_id (admin-org may reach any org).
  let recQ = service.from('recordings').select('id, org_id, meeting_profile').eq('id', recording_id)
  if (!uctx.isAdminOrg) recQ = recQ.eq('org_id', org_id)
  const { data: rec } = await recQ.single()
  if (!rec) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const recOrg = rec.org_id as string

  // Slides are at-most-one: replace any existing deck (storage + row) first.
  if (role === 'slides') {
    const { data: existing } = await service
      .from('recording_files')
      .select('id, storage_path')
      .eq('recording_id', recording_id)
      .eq('org_id', recOrg)
      .eq('file_role', 'slides')
    for (const e of (existing ?? []) as Array<{ id: string; storage_path: string }>) {
      if (e.storage_path) await service.storage.from(BUCKET).remove([e.storage_path]).catch(() => {})
      await service.from('recording_files').delete().eq('id', e.id).eq('org_id', recOrg)
    }
  }

  // Upload the bytes. Namespace documents under docs/ to avoid colliding with a
  // media file of the same name; slides sit at the recording root (matching the
  // add-recording deck convention). upsert so a same-name re-upload overwrites.
  const safeName = original_filename.replace(/[/\\]/g, '_')
  const storage_path = role === 'slides'
    ? `${recOrg}/${recording_id}/${safeName}`
    : `${recOrg}/${recording_id}/docs/${safeName}`
  const buffer = Buffer.from(await file.arrayBuffer())
  const { error: upErr } = await service.storage
    .from(BUCKET)
    .upload(storage_path, buffer, { contentType: file.type || 'application/octet-stream', upsert: true })
  if (upErr) return NextResponse.json({ error: `upload failed: ${upErr.message}` }, { status: 500 })

  // Next sort_order after existing files.
  const { data: maxRow } = await service
    .from('recording_files')
    .select('sort_order')
    .eq('recording_id', recording_id)
    .eq('org_id', recOrg)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const sort_order = ((maxRow?.sort_order as number) ?? -1) + 1

  const { data: inserted, error: insErr } = await service
    .from('recording_files')
    .insert({
      recording_id,
      org_id: recOrg,
      original_filename,
      storage_path,
      mime_type: file.type || 'application/octet-stream',
      size_bytes,
      is_video: false,
      file_role: role,
      sort_order,
      upload_status: 'uploaded',
    })
    .select('id, original_filename, mime_type, size_bytes, file_role, created_at')
    .single()
  if (insErr || !inserted) {
    await service.storage.from(BUCKET).remove([storage_path]).catch(() => {})
    return NextResponse.json({ error: `recording_files insert failed: ${insErr?.message ?? 'unknown'}` }, { status: 500 })
  }

  // A freshly-attached deck means the next analysis should vision-read it.
  if (role === 'slides') {
    const profile = rec.meeting_profile as Record<string, unknown> | null
    if (profile) {
      await service.from('recordings')
        .update({ meeting_profile: { ...profile, has_slides: true } })
        .eq('id', recording_id).eq('org_id', recOrg)
    }
  }

  return NextResponse.json({ file: inserted }, { status: 201 })
}
