// app/api/recordings/[id]/files/route.ts
//
// POST § 4.1c — attach media to an existing project (setup-before-media).
// A project created without media sits in 'awaiting_media'; this inserts the
// recording_files rows, flips status → 'uploading', and returns the TUS upload
// endpoint + per-file storage paths (same contract as POST /api/recordings).
// The wizard's "Add recording" pane then uploads via tus-js-client, acks each
// file (§ 4.1a), and calls POST .../process (§ 4.2).
//
// Same-tenant guard: the recording is loaded with id paired to org_id; only
// projects in draft / awaiting_media accept an attach (media isn't yet present).

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getUserContext } from '@/lib/userContext'

export const dynamic = 'force-dynamic'

const BUCKET = process.env.RECORDINGS_BUCKET || 'recordings'
const MAX_FILES_PER_RECORDING = 20
const MAX_FILE_BYTES = 20 * 1024 * 1024 * 1024 // 20GB

interface FileSpec {
  original_filename: string
  size_bytes: number
  mime_type: string
  is_video: boolean
  file_role?: 'media' | 'slides'
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: recording_id } = await ctx.params
  if (!recording_id) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  const supabase = await createClient()
  const uctx = await getUserContext(supabase)
  if (!uctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!uctx.features.analyze || !uctx.features.recordings) {
    return NextResponse.json({ error: 'recordings not enabled' }, { status: 403 })
  }
  const org_id = uctx.orgId

  let files: FileSpec[]
  try {
    const body = (await req.json()) as { files?: FileSpec[] }
    files = body.files ?? []
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const valid = validateFiles(files)
  if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: 400 })

  const service = createServiceRoleClient()

  // Same-tenant gate — pair id with org_id, and require an awaiting_media/draft project.
  const { data: rec } = await service
    .from('recordings')
    .select('id, status, meeting_profile')
    .eq('id', recording_id)
    .eq('org_id', org_id)
    .single()
  if (!rec) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (rec.status !== 'awaiting_media' && rec.status !== 'draft') {
    return NextResponse.json({ error: `cannot attach media to a project in '${rec.status}'` }, { status: 409 })
  }
  const hasSlides = files.some(f => (f.file_role ?? 'media') === 'slides')

  const fileRows = files.map((f, i) => ({
    recording_id,
    org_id,
    original_filename: f.original_filename,
    storage_path: `${org_id}/${recording_id}/${f.original_filename}`,
    mime_type: f.mime_type,
    size_bytes: f.size_bytes,
    is_video: f.is_video,
    file_role: (f.file_role ?? 'media') as 'media' | 'slides',
    sort_order: i,
    upload_status: 'pending' as const,
  }))

  const { data: insertedFiles, error: fErr } = await service
    .from('recording_files')
    .insert(fileRows)
    .select('id, original_filename, storage_path, sort_order')
  if (fErr || !insertedFiles) {
    return NextResponse.json({ error: `recording_files insert failed: ${fErr?.message ?? 'unknown'}` }, { status: 500 })
  }

  // Flip into the upload state + record the media byte total. If a deck was
  // attached, mark the meeting profile so the vision/presentation pass runs.
  const profile = rec.meeting_profile as { has_slides?: boolean } | null
  const { error: uErr } = await service
    .from('recordings')
    .update({
      status: 'uploading',
      source_size_bytes: files.filter(f => (f.file_role ?? 'media') === 'media').reduce((sum, f) => sum + f.size_bytes, 0),
      ...(hasSlides && profile ? { meeting_profile: { ...profile, has_slides: true } } : {}),
    })
    .eq('id', recording_id)
    .eq('org_id', org_id)
  if (uErr) return NextResponse.json({ error: `status update failed: ${uErr.message}` }, { status: 500 })

  const tusEndpoint = `${requireSupabaseUrl()}/storage/v1/upload/resumable`

  return NextResponse.json({
    recording_id,
    upload: { protocol: 'tus' as const, endpoint: tusEndpoint, bucket: BUCKET },
    files: insertedFiles
      .sort((a, b) => (a.sort_order as number) - (b.sort_order as number))
      .map(f => ({
        id: f.id as string,
        original_filename: f.original_filename as string,
        storage_path: f.storage_path as string,
        upload_url: tusEndpoint,
      })),
  }, { status: 201 })
}

function validateFiles(files: FileSpec[]): { ok: true } | { ok: false; error: string } {
  if (!Array.isArray(files) || files.length === 0) {
    return { ok: false, error: 'files[] is required and must be non-empty' }
  }
  if (files.length > MAX_FILES_PER_RECORDING) {
    return { ok: false, error: `at most ${MAX_FILES_PER_RECORDING} files per recording` }
  }
  const filenames = new Set<string>()
  let slidesCount = 0
  let mediaCount = 0
  for (const f of files) {
    if (!f || typeof f !== 'object') return { ok: false, error: 'each files[] entry must be an object' }
    if (!f.original_filename || typeof f.original_filename !== 'string') {
      return { ok: false, error: 'each files[] entry needs original_filename' }
    }
    if (filenames.has(f.original_filename)) {
      return { ok: false, error: `duplicate filename: ${f.original_filename}` }
    }
    filenames.add(f.original_filename)
    if (typeof f.size_bytes !== 'number' || f.size_bytes <= 0) {
      return { ok: false, error: `each files[] entry needs positive size_bytes (got ${f.size_bytes} for ${f.original_filename})` }
    }
    if (f.size_bytes > MAX_FILE_BYTES) {
      return { ok: false, error: `${f.original_filename} exceeds the 20GB per-file cap` }
    }
    if (!f.mime_type || typeof f.mime_type !== 'string') {
      return { ok: false, error: 'each files[] entry needs mime_type' }
    }
    if (typeof f.is_video !== 'boolean') {
      return { ok: false, error: 'each files[] entry needs is_video (boolean)' }
    }
    const role = f.file_role ?? 'media'
    if (role !== 'media' && role !== 'slides') {
      return { ok: false, error: `file_role must be 'media' or 'slides' (got ${role})` }
    }
    if (role === 'slides') {
      slidesCount++
      const isPdf = f.mime_type.includes('pdf') || f.original_filename.toLowerCase().endsWith('.pdf')
      if (!isPdf) return { ok: false, error: 'slide decks must be PDF in this version' }
    } else {
      mediaCount++
    }
  }
  if (slidesCount > 1) return { ok: false, error: 'at most one slide deck (file_role=slides) per recording' }
  if (mediaCount === 0) return { ok: false, error: 'at least one media (audio/video) file is required' }
  return { ok: true }
}

function requireSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required to build the TUS upload endpoint')
  return url.replace(/\/+$/, '')
}
