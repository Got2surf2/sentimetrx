// app/api/bots/knowledge-document/route.ts
// P2c (AGENT_TIERS §5 Phase 2) — POST a PDF / DOCX / text file and get back its
// extracted text, exactly like /deep-crawl and /research return crawled/searched
// text. The editor appends the text to the knowledge base; save() then runs it
// through the shared chunk→embed→dedup→budget ingest (POST /bots/[id]/knowledge),
// so no ingestion logic is duplicated here. Bot-agnostic + auth-only (mirrors
// /deep-crawl and /fetch-url) so it works before a new agent has been saved.
// Text-first (unpdf/mammoth); a scanned PDF falls back to the vision pipeline.

import { NextResponse } from 'next/server'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { extractDocumentText, docKind } from '@/lib/botKnowledge/documentText'
import { extractPdfViaVision } from '@/lib/botKnowledge/documentVision'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'
export const maxDuration = 300  // vision fallback boots a Sandbox + reads pages

const MAX_FILE_BYTES = 25 * 1024 * 1024  // 25 MB

export async function POST(req: Request) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase.from('users').select('org_id').eq('id', user.id).single()
  const orgId = userData?.org_id
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data with a "file" field' }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
  }
  if (file.size === 0) return NextResponse.json({ error: 'File is empty' }, { status: 400 })
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'File too large (max 25 MB)' }, { status: 413 })
  }
  if (docKind(file.name, file.type) === 'unsupported') {
    return NextResponse.json({ error: 'Unsupported file type — upload a PDF, DOCX, or text file' }, { status: 415 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())

  try {
    const extracted = await extractDocumentText(buffer, file.name, file.type)
    let text = extracted.text
    const method = extracted.method

    // Scanned/image-only PDF → vision fallback (readDocument pipeline).
    if (extracted.sparse && method === 'pdf-text') {
      const vision = await extractPdfViaVision({ buffer, botId: user.id, orgId, filename: file.name })
      if (vision) {
        text = vision.text
      } else if (text.replace(/## Page \d+/g, '').trim().length < 20) {
        return NextResponse.json({ error: 'This PDF appears to be scanned/image-only and no text could be read from it.' }, { status: 422 })
      }
    }

    // Prefix with a source heading so the ingested chunks are attributable.
    const heading = '# ' + file.name.replace(/\.[a-z0-9]+$/i, '')
    return NextResponse.json({
      text: heading + '\n\n' + text,
      method,
      pages: extracted.pageCount,
      filename: file.name,
      chars: text.length,
    })
  } catch (err: unknown) {
    if (err instanceof Error && /Unsupported file type/.test(err.message)) {
      return NextResponse.json({ error: err.message }, { status: 415 })
    }
    return serverError(err, 'bots.knowledgeDocument')
  }
}
