// app/api/recordings/extract-setup/route.ts
//
// POST § 4.1d — propose setup fields from an uploaded project document
// (the deck that will be presented), so the wizard can pre-fill objectives /
// agenda / panel / glossary instead of making the analyst type them.
//
// Stateless: the PDF is uploaded to a temp path, rendered + read with vision
// (lib/recordings/setupExtract), then the temp objects are deleted. Nothing is
// persisted to a recording — the analyst confirms the proposal in the wizard,
// and the deck itself is attached later with the recording (file_role='slides').
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
const MAX_BYTES = 50 * 1024 * 1024     // 50MB — a setup doc, not a media file

export async function POST(req: Request) {
  const supabase = await createClient()
  const ctx = await getUserContext(supabase)
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!ctx.features.analyze || !ctx.features.recordings) {
    return NextResponse.json({ error: 'recordings not enabled' }, { status: 403 })
  }

  let file: File | null = null
  try {
    const form = await req.formData()
    const f = form.get('file')
    if (f instanceof File) file = f
  } catch {
    return NextResponse.json({ error: 'expected multipart/form-data with a "file" field' }, { status: 400 })
  }
  if (!file) return NextResponse.json({ error: 'no file provided' }, { status: 400 })
  if (file.size <= 0) return NextResponse.json({ error: 'file is empty' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'document exceeds the 50MB cap' }, { status: 400 })

  const isPdf = file.type.includes('pdf') || file.name.toLowerCase().endsWith('.pdf')
  if (!isPdf) {
    return NextResponse.json({ error: 'only PDF documents are supported for setup extraction in this version' }, { status: 400 })
  }

  const service = createServiceRoleClient()
  // Temp workspace under the org so storage RLS/quotas stay tenant-scoped.
  const token = crypto.randomUUID()
  const dir = `${ctx.orgId}/_setup-extract/${token}`
  const pdfPath = `${dir}/${file.name}`
  const outPrefix = `${dir}/pages`

  const cleanup: string[] = [pdfPath]
  try {
    const buf = Buffer.from(await file.arrayBuffer())
    const { error: upErr } = await service.storage.from(BUCKET).upload(pdfPath, buf, {
      contentType: 'application/pdf',
      upsert: true,
    })
    if (upErr) return NextResponse.json({ error: `temp upload failed: ${upErr.message}` }, { status: 500 })

    const proposal = await extractSetupFromPdf(pdfPath, outPrefix)

    // Collect rendered page PNGs for cleanup too.
    const { data: pages } = await service.storage.from(BUCKET).list(outPrefix, { limit: 1000 })
    for (const p of (pages ?? []) as Array<{ name?: string; id?: string | null }>) {
      if (p?.name && p.id !== null) cleanup.push(`${outPrefix}/${p.name}`)
    }

    return NextResponse.json({ proposal, source: file.name })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'extraction failed' }, { status: 500 })
  } finally {
    // Best-effort temp cleanup — never persist the setup-extract workspace.
    if (cleanup.length) await service.storage.from(BUCKET).remove(cleanup).catch(() => {})
  }
}
