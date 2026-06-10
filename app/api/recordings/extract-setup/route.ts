// app/api/recordings/extract-setup/route.ts
//
// § 4.1d — propose setup fields from an uploaded project document (the deck that
// will be presented), so the wizard can pre-fill objectives / agenda / panel /
// glossary instead of making the analyst type them.
//
// Two-step, direct-to-storage (decks routinely exceed Vercel's 4.5MB function
// body limit, which a single multipart POST cannot clear):
//
//   GET  → reserve an org-scoped temp path + hand back the TUS upload endpoint.
//          The browser uploads the PDF straight to Supabase Storage (no function
//          body, no 4.5MB ceiling), exactly like Town Hall media.
//   POST → { storage_path } of the just-uploaded PDF. We render + vision-read it
//          (lib/recordings/setupExtract), return the proposal, then delete the
//          temp objects. Nothing is persisted to a recording — the analyst
//          confirms the proposal in the wizard, and the deck itself is attached
//          later with the recording (file_role='slides').
//
// v1 accepts PDF only (the slide-vision rails are PDF-only). PPTX/DOCX → convert
// to PDF first (future).

import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { createClient } from '@/lib/supabase/server'
import { getUserContext } from '@/lib/userContext'
import { extractSetupFromPdf } from '@/lib/recordings/setupExtract'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const BUCKET = process.env.RECORDINGS_BUCKET || 'recordings'

// GET — reserve a temp upload target for the PDF the browser is about to push
// straight to storage. The object name is fixed ('deck.pdf') under a unique
// token dir so the path is fully server-controlled (the client can't escape the
// org's _setup-extract sandbox).
export async function GET() {
  const supabase = await createClient()
  const ctx = await getUserContext(supabase)
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!ctx.features.analyze || !ctx.features.recordings) {
    return NextResponse.json({ error: 'recordings not enabled' }, { status: 403 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) return NextResponse.json({ error: 'storage endpoint not configured' }, { status: 500 })

  const token = crypto.randomUUID()
  const storage_path = `${ctx.orgId}/_setup-extract/${token}/deck.pdf`

  return NextResponse.json({
    upload: { endpoint: `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/upload/resumable`, bucket: BUCKET },
    storage_path,
  })
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const ctx = await getUserContext(supabase)
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!ctx.features.analyze || !ctx.features.recordings) {
    return NextResponse.json({ error: 'recordings not enabled' }, { status: 403 })
  }

  let storage_path = ''
  let source = ''
  try {
    const body = (await req.json()) as { storage_path?: string; source?: string }
    storage_path = String(body.storage_path || '')
    source = String(body.source || '')
  } catch {
    return NextResponse.json({ error: 'expected JSON body with a "storage_path"' }, { status: 400 })
  }

  // The path MUST live inside this org's setup-extract sandbox — never trust a
  // client-supplied path that could point at another tenant's objects.
  const sandbox = `${ctx.orgId}/_setup-extract/`
  if (!storage_path.startsWith(sandbox) || !storage_path.toLowerCase().endsWith('.pdf')) {
    return NextResponse.json({ error: 'invalid storage_path' }, { status: 400 })
  }

  const service = createServiceRoleClient()
  const dir = storage_path.slice(0, storage_path.lastIndexOf('/'))
  const outPrefix = `${dir}/pages`

  const cleanup: string[] = [storage_path]
  try {
    // The browser uploaded the PDF directly; confirm it actually landed.
    const { data: head } = await service.storage.from(BUCKET).list(dir, { limit: 1000 })
    const fileName = storage_path.slice(dir.length + 1)
    const uploaded = (head ?? []).find((o: { name?: string }) => o?.name === fileName)
    if (!uploaded) return NextResponse.json({ error: 'upload not found — please try again' }, { status: 400 })

    const proposal = await extractSetupFromPdf(storage_path, outPrefix)

    // Collect rendered page PNGs for cleanup too.
    const { data: pages } = await service.storage.from(BUCKET).list(outPrefix, { limit: 1000 })
    for (const p of (pages ?? []) as Array<{ name?: string; id?: string | null }>) {
      if (p?.name && p.id !== null) cleanup.push(`${outPrefix}/${p.name}`)
    }

    return NextResponse.json({ proposal, source: source || fileName })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'extraction failed' }, { status: 500 })
  } finally {
    // Best-effort temp cleanup — never persist the setup-extract workspace.
    if (cleanup.length) await service.storage.from(BUCKET).remove(cleanup).catch(() => {})
  }
}
