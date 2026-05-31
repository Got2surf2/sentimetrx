// app/api/recordings/route.ts
//
// POST /api/recordings — § 4.1 create a recording (pre-upload).
//
// Creates the recordings row (status='uploading') and one recording_files
// row per source file (upload_status='pending'). Returns the TUS upload
// endpoint + per-file storage_path so the wizard's tus-js-client can PUT
// bytes directly to Supabase Storage with the user's session JWT. The
// wizard calls POST /api/recordings/[id]/files/[fileId]/uploaded after
// each successful upload to flip upload_status='uploaded' (§ 4.1a), then
// POST /api/recordings/[id]/process (§ 4.2) once all files are done.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { assertFeatureAllowed } from '@/lib/featureFlags'
import type {
  AsrStrategy,
  SessionType,
  SetupInputs,
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
}

interface CreateBody {
  name: string
  session_type: SessionType
  meeting_date?: string | null
  location?: string | null
  language?: string
  setup_inputs: SetupInputs | Record<string, unknown>
  asr_strategy: AsrStrategy
  files: CreateFileSpec[]
}

export async function POST(req: Request) {
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: userRow } = await supabase
    .from('users')
    .select('org_id')
    .eq('id', user.id)
    .single()
  const org_id = userRow?.org_id as string | undefined
  if (!org_id) return NextResponse.json({ error: 'org not found' }, { status: 403 })

  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const valid = validate(body)
  if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: 400 })

  const gate = await assertFeatureAllowed('recording', org_id, user.id, { unitsConsumed: 1 })
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'recording feature blocked', reason: gate.reason, quota: gate.quotaPerMonth, used: gate.used },
      { status: 403 },
    )
  }

  const service = createServiceRoleClient()

  // Create the recording row first — we need its UUID to compute storage paths.
  const { data: rec, error: rErr } = await service
    .from('recordings')
    .insert({
      org_id,
      created_by: user.id,
      name: body.name.trim(),
      session_type: body.session_type,
      meeting_date: body.meeting_date ?? null,
      location: body.location ?? null,
      language: (body.language || 'en').trim(),
      setup_inputs: body.setup_inputs,
      asr_strategy: body.asr_strategy,
      status: 'uploading',
      source_size_bytes: body.files.reduce((sum, f) => sum + f.size_bytes, 0),
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
  }
  return { ok: true }
}

function requireSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required to build the TUS upload endpoint')
  return url.replace(/\/+$/, '')
}
