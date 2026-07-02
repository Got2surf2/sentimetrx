// app/api/recordings/[id]/documents/route.ts
//
// § 4.1e — attach a PROJECT DOCUMENT to a recording at any lifecycle stage
// (edit-anytime / documents-anytime).
//
//   role='slides'   — the presentation deck (PDF). Stored as file_role='slides'
//                     so the pipeline vision-reads it (ingestSlides) → outline.
//                     At-most-one per recording; a new deck REPLACES the old one.
//   role='document' — a brief / agenda / reference doc. Stored as
//                     file_role='document'; kept for reference, NOT pipeline-processed.
//
// Two upload paths:
//   GET  → reserve the storage path + hand back the TUS endpoint, so the browser
//          can push a large deck straight to Supabase Storage (decks routinely
//          exceed Vercel's 4.5MB function body limit). Then POST with JSON to
//          register the already-uploaded object.
//   POST (application/json) — register an object the browser already TUS-uploaded.
//   POST (multipart)        — direct byte upload for small docs (legacy path).
//
// Same-tenant guard: the recording is loaded with id paired to org_id.

import { NextResponse } from 'next/server'
import { serverError } from '@/lib/apiError'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getUserContext } from '@/lib/userContext'

export const dynamic = 'force-dynamic'

const BUCKET = process.env.RECORDINGS_BUCKET || 'recordings'
const MAX_DOC_BYTES = 50 * 1024 * 1024   // 50MB — matches the setup-extract cap

function storagePathFor(recOrg: string, recording_id: string, role: 'slides' | 'document', filename: string): string {
  // Slides sit at the recording root (matching the add-recording deck
  // convention); briefs go under docs/ to avoid colliding with a media file of
  // the same name.
  const safeName = filename.replace(/[/\\]/g, '_')
  return role === 'slides'
    ? `${recOrg}/${recording_id}/${safeName}`
    : `${recOrg}/${recording_id}/docs/${safeName}`
}

// Resolve the recording with the same-tenant gate. Returns null if not visible.
async function loadRecording(service: ReturnType<typeof createServiceRoleClient>, recording_id: string, org_id: string, isAdminOrg: boolean) {
  let recQ = service.from('recordings').select('id, org_id, meeting_profile').eq('id', recording_id)
  if (!isAdminOrg) recQ = recQ.eq('org_id', org_id)
  const { data } = await recQ.single()
  return data as { id: string; org_id: string; meeting_profile: Record<string, unknown> | null } | null
}

// GET — reserve a storage path + TUS endpoint for a deck the browser will push
// straight to storage. ?role=slides|document & ?name=<filename>.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: recording_id } = await ctx.params
  if (!recording_id) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  const supabase = await createClient()
  const uctx = await getUserContext(supabase)
  if (!uctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!uctx.features.recordings) return NextResponse.json({ error: 'recordings not enabled' }, { status: 403 })

  const url = new URL(req.url)
  const role = url.searchParams.get('role') === 'slides' ? 'slides' : 'document'
  const name = (url.searchParams.get('name') || '').trim()
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (role === 'slides' && !name.toLowerCase().endsWith('.pdf')) {
    return NextResponse.json({ error: 'the presentation deck must be a PDF in this version' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) return NextResponse.json({ error: 'storage endpoint not configured' }, { status: 500 })

  const service = createServiceRoleClient()
  const rec = await loadRecording(service, recording_id, uctx.orgId, uctx.isAdminOrg)
  if (!rec) return NextResponse.json({ error: 'not found' }, { status: 404 })

  return NextResponse.json({
    upload: { endpoint: `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/upload/resumable`, bucket: BUCKET },
    storage_path: storagePathFor(rec.org_id, recording_id, role, name),
  })
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: recording_id } = await ctx.params
  if (!recording_id) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  const supabase = await createClient()
  const uctx = await getUserContext(supabase)
  if (!uctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!uctx.features.recordings) return NextResponse.json({ error: 'recordings not enabled' }, { status: 403 })
  const org_id = uctx.orgId

  const isJson = (req.headers.get('content-type') || '').includes('application/json')

  // Gather the file's metadata + bytes (multipart) OR just metadata + a path the
  // browser already TUS-uploaded (json).
  let original_filename: string
  let role: 'slides' | 'document'
  let mime_type: string
  let size_bytes: number
  let buffer: Buffer | null = null      // null in json (already-uploaded) mode
  let claimedPath = ''                  // set in json mode

  if (isJson) {
    let body: { storage_path?: string; original_filename?: string; role?: string; mime_type?: string; size_bytes?: number }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
    }
    claimedPath = String(body.storage_path || '')
    original_filename = String(body.original_filename || '')
    const rawRole = String(body.role || 'document')
    if (rawRole !== 'slides' && rawRole !== 'document') {
      return NextResponse.json({ error: "role must be 'slides' or 'document'" }, { status: 400 })
    }
    role = rawRole
    mime_type = String(body.mime_type || 'application/octet-stream')
    size_bytes = typeof body.size_bytes === 'number' ? body.size_bytes : 0
    if (!claimedPath || !original_filename) {
      return NextResponse.json({ error: 'storage_path and original_filename are required' }, { status: 400 })
    }
  } else {
    let form: FormData
    try {
      form = await req.formData()
    } catch {
      return NextResponse.json({ error: 'expected multipart/form-data' }, { status: 400 })
    }
    const file = form.get('file')
    const rawRole = String(form.get('role') || 'document')
    if (rawRole !== 'slides' && rawRole !== 'document') {
      return NextResponse.json({ error: "role must be 'slides' or 'document'" }, { status: 400 })
    }
    role = rawRole
    if (!(file instanceof Blob) || typeof (file as File).name !== 'string') {
      return NextResponse.json({ error: 'file is required' }, { status: 400 })
    }
    original_filename = (file as File).name
    size_bytes = file.size
    mime_type = file.type || 'application/octet-stream'
    if (size_bytes <= 0) return NextResponse.json({ error: 'file is empty' }, { status: 400 })
    if (size_bytes > MAX_DOC_BYTES) return NextResponse.json({ error: 'file exceeds the 50MB cap' }, { status: 400 })
    buffer = Buffer.from(await file.arrayBuffer())
  }

  const isPdf = mime_type.includes('pdf') || original_filename.toLowerCase().endsWith('.pdf')
  if (role === 'slides' && !isPdf) {
    return NextResponse.json({ error: 'the presentation deck must be a PDF in this version' }, { status: 400 })
  }

  const service = createServiceRoleClient()
  const rec = await loadRecording(service, recording_id, org_id, uctx.isAdminOrg)
  if (!rec) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const recOrg = rec.org_id

  const storage_path = storagePathFor(recOrg, recording_id, role, original_filename)
  // In json mode the path is server-derived too, so a mismatch means the client
  // uploaded to the wrong place — reject rather than register a stray object.
  if (isJson && claimedPath !== storage_path) {
    return NextResponse.json({ error: 'storage_path does not match the reserved path' }, { status: 400 })
  }

  // Slides are at-most-one: replace any existing deck (storage + row) first. Skip
  // deleting the object we just uploaded to (same filename → upsert overwrote it).
  if (role === 'slides') {
    const { data: existing } = await service
      .from('recording_files')
      .select('id, storage_path')
      .eq('recording_id', recording_id)
      .eq('org_id', recOrg)
      .eq('file_role', 'slides')
    for (const e of (existing ?? []) as Array<{ id: string; storage_path: string }>) {
      if (e.storage_path && e.storage_path !== storage_path) await service.storage.from(BUCKET).remove([e.storage_path]).catch(() => {})
      await service.from('recording_files').delete().eq('id', e.id).eq('org_id', recOrg)
    }
  }

  if (buffer) {
    const { error: upErr } = await service.storage
      .from(BUCKET)
      .upload(storage_path, buffer, { contentType: mime_type, upsert: true })
    if (upErr) return serverError(upErr, 'recordings.documents.upload', { orgId: recOrg })
  } else {
    // json mode — confirm the browser's direct upload actually landed.
    const dir = storage_path.slice(0, storage_path.lastIndexOf('/'))
    const fileName = storage_path.slice(dir.length + 1)
    const { data: head } = await service.storage.from(BUCKET).list(dir, { limit: 1000 })
    if (!(head ?? []).some((o: { name?: string }) => o?.name === fileName)) {
      return NextResponse.json({ error: 'upload not found — please try again' }, { status: 400 })
    }
  }

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
      mime_type,
      size_bytes,
      is_video: false,
      file_role: role,
      sort_order,
      upload_status: 'uploaded',
    })
    .select('id, original_filename, mime_type, size_bytes, file_role, created_at')
    .single()
  if (insErr || !inserted) {
    if (buffer) await service.storage.from(BUCKET).remove([storage_path]).catch(() => {})
    return serverError(insErr, 'recordings.documents.insert', { orgId: recOrg })
  }

  // A freshly-attached deck means the next analysis should vision-read it.
  if (role === 'slides') {
    const profile = rec.meeting_profile
    if (profile) {
      await service.from('recordings')
        .update({ meeting_profile: { ...profile, has_slides: true } })
        .eq('id', recording_id).eq('org_id', recOrg)
    }
  }

  return NextResponse.json({ file: inserted }, { status: 201 })
}
