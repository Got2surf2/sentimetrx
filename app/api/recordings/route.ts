// app/api/recordings/route.ts
//
// POST /api/recordings — § 4.1 create a recording (pre-upload).
// GET  /api/recordings — § 4.8 list recordings (role-scoped).
//
// POST creates the recordings row (status='uploading') and one
// recording_files row per source file (upload_status='pending'). Returns
// the TUS upload endpoint + per-file storage_path so the wizard's
// tus-js-client can PUT bytes directly to Supabase Storage with the
// user's session JWT. The wizard calls POST
// /api/recordings/[id]/files/[fileId]/uploaded after each successful
// upload to flip upload_status='uploaded' (§ 4.1a), then POST
// /api/recordings/[id]/process (§ 4.2) once all files are done.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getUserContext } from '@/lib/userContext'
import type {
  AsrStrategy,
  SessionType,
  SetupInputs,
  MeetingProfile,
} from '@/lib/recordings/types'

export const dynamic = 'force-dynamic'

const VALID_SESSION_TYPES: ReadonlySet<SessionType> = new Set<SessionType>([
  'qa', 'focus_group', 'general_meeting', 'interview', 'lecture',
])
const VALID_ASR_STRATEGIES: ReadonlySet<AsrStrategy> = new Set<AsrStrategy>([
  'auto', 'whisper', 'deepgram', 'hybrid',
])

const BUCKET = process.env.RECORDINGS_BUCKET || 'recordings'
const MAX_FILES_PER_RECORDING = 20             // soft cap per the spec's wizard contract
const MAX_FILE_BYTES = 20 * 1024 * 1024 * 1024 // 20GB soft cap (rejected here, not deeper)

interface CreateFileSpec {
  original_filename: string
  size_bytes: number
  mime_type: string
  is_video: boolean
  file_role?: 'media' | 'slides'      // default 'media'; 'slides' = presentation deck (PDF, vision-read)
}

interface CreateBody {
  name: string
  session_type: SessionType
  meeting_date?: string | null
  location?: string | null
  language?: string
  setup_inputs: SetupInputs | Record<string, unknown>
  asr_strategy: AsrStrategy
  meeting_profile?: MeetingProfile | null   // meeting-tool preset + phases; null = legacy Q&A
  brand_tag?: string | null                 // §3.5c brand-entity convergence
  underlying_agent_id?: string | null       // §3.5c linked agent (entity catalog seed)
  files: CreateFileSpec[]
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const ctx = await getUserContext(supabase)
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!ctx.features.analyze || !ctx.features.recordings) {
    return NextResponse.json({ error: 'recordings not enabled' }, { status: 403 })
  }
  const org_id = ctx.orgId

  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const valid = validate(body)
  if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: 400 })

  const service = createServiceRoleClient()

  // Create the recording row first — we need its UUID to compute storage paths.
  const { data: rec, error: rErr } = await service
    .from('recordings')
    .insert({
      org_id,
      created_by: ctx.userId,
      name: body.name.trim(),
      session_type: body.session_type,
      meeting_date: body.meeting_date ?? null,
      location: body.location ?? null,
      language: (body.language || 'en').trim(),
      setup_inputs: body.setup_inputs,
      asr_strategy: body.asr_strategy,
      meeting_profile: body.meeting_profile ?? null,
      // §3.5c — only set when provided so creation still works before sql/103
      // adds these columns (omitting the keys avoids "column does not exist").
      ...((body.brand_tag ?? '').trim() ? { brand_tag: (body.brand_tag as string).trim() } : {}),
      ...(body.underlying_agent_id ? { underlying_agent_id: body.underlying_agent_id } : {}),
      status: 'uploading',
      // Only media files count toward the source byte total; slides are tiny.
      source_size_bytes: body.files.filter(f => (f.file_role ?? 'media') === 'media').reduce((sum, f) => sum + f.size_bytes, 0),
    })
    .select('id')
    .single()
  if (rErr || !rec) {
    return NextResponse.json({ error: `recordings insert failed: ${rErr?.message ?? 'unknown'}` }, { status: 500 })
  }

  const recording_id = rec.id as string

  // Each file: storage_path = <org_id>/<recording_id>/<original_filename>.
  const fileRows = body.files.map((f, i) => ({
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
    // Best-effort: roll back the recording row so the user isn't left with a phantom.
    await service.from('recordings').delete().eq('id', recording_id).eq('org_id', org_id)
    return NextResponse.json({ error: `recording_files insert failed: ${fErr?.message ?? 'unknown'}` }, { status: 500 })
  }

  // Supabase Storage TUS endpoint — same for all files. The client uses
  // tus-js-client with the user's session JWT and per-file metadata.
  const tusEndpoint = `${requireSupabaseUrl()}/storage/v1/upload/resumable`

  return NextResponse.json({
    recording_id,
    upload: {
      protocol: 'tus' as const,
      endpoint: tusEndpoint,
      bucket: BUCKET,
    },
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

// ── Validation ───────────────────────────────────────────────────────────────

function validate(body: Partial<CreateBody>): { ok: true } | { ok: false; error: string } {
  if (!body) return { ok: false, error: 'missing body' }
  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return { ok: false, error: 'name is required' }
  }
  if (!body.session_type || !VALID_SESSION_TYPES.has(body.session_type)) {
    return { ok: false, error: `session_type must be one of: ${Array.from(VALID_SESSION_TYPES).join(', ')}` }
  }
  if (!body.asr_strategy || !VALID_ASR_STRATEGIES.has(body.asr_strategy)) {
    return { ok: false, error: `asr_strategy must be one of: ${Array.from(VALID_ASR_STRATEGIES).join(', ')}` }
  }
  if (!body.setup_inputs || typeof body.setup_inputs !== 'object') {
    return { ok: false, error: 'setup_inputs object is required (may be {})' }
  }
  if (!Array.isArray(body.files) || body.files.length === 0) {
    return { ok: false, error: 'files[] is required and must be non-empty' }
  }
  if (body.files.length > MAX_FILES_PER_RECORDING) {
    return { ok: false, error: `at most ${MAX_FILES_PER_RECORDING} files per recording` }
  }
  const filenames = new Set<string>()
  let slidesCount = 0
  let mediaCount = 0
  for (const f of body.files) {
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
      return { ok: false, error: `each files[] entry needs mime_type` }
    }
    if (typeof f.is_video !== 'boolean') {
      return { ok: false, error: `each files[] entry needs is_video (boolean)` }
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

// ── § 4.8 GET — list ─────────────────────────────────────────────────────────
//
// Scoping per spec:
//   isAdminOrg=true       → see all recordings; honor optional ?org_id=X filter
//   isAdmin (org admin)   → see all in own org
//   regular user          → see only created_by=self
// Pagination via ?limit (1..100, default 50) + ?offset (default 0).
// Filter ?status= passes through to the recordings.status enum.

const LIST_VALID_STATUSES: ReadonlySet<string> = new Set([
  'uploading', 'queued', 'extracting', 'transcribing', 'transcribed',
  'analyzing', 'rendering', 'complete', 'failed', 'cancelled',
])

export async function GET(req: Request) {
  const supabase = await createClient()
  const ctx = await getUserContext(supabase)
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!ctx.features.analyze || !ctx.features.recordings) {
    return NextResponse.json({ error: 'recordings not enabled' }, { status: 403 })
  }

  const url = new URL(req.url)
  const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get('limit') || '50', 10) || 50))
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0)
  const statusFilter = url.searchParams.get('status')
  if (statusFilter && !LIST_VALID_STATUSES.has(statusFilter)) {
    return NextResponse.json({ error: `unknown status filter: ${statusFilter}` }, { status: 400 })
  }
  const orgFilter = url.searchParams.get('org_id')

  const service = createServiceRoleClient()

  let q = service
    .from('recordings')
    .select(
      'id, org_id, created_by, name, session_type, meeting_date, status, asr_vendor_chosen, ' +
      'source_duration_sec, cost_cents, created_at, started_at, completed_at',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (ctx.isAdminOrg) {
    if (orgFilter) q = q.eq('org_id', orgFilter)
    // else: no scope — admin-org sees everything
  } else if (ctx.isAdmin) {
    q = q.eq('org_id', ctx.orgId)
  } else {
    q = q.eq('org_id', ctx.orgId).eq('created_by', ctx.userId)
  }
  if (statusFilter) q = q.eq('status', statusFilter)

  const { data, error, count } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    recordings: data ?? [],
    pagination: {
      limit,
      offset,
      total: count ?? 0,
      has_more: count != null ? offset + (data?.length ?? 0) < count : (data?.length ?? 0) === limit,
    },
    scope: ctx.isAdminOrg ? 'all' : ctx.isAdmin ? 'org' : 'self',
  })
}
